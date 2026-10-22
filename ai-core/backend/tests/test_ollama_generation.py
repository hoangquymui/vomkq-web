from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from vector_ai_backend.application.services import QueryReasoningService
from vector_ai_backend.application.reasoning import ReasoningProfileCatalog
from vector_ai_backend.application.resources import InferenceScheduler, ResourceManager
from vector_ai_backend.adapters.ollama import OllamaClient, OllamaResponseError
from vector_ai_backend.domain.models import (
    ChatMessage,
    ChatRequest,
    LLMRequest,
    ModelCapabilities,
    QueryReasoningState,
    ReasoningMode,
    ResourceLimits,
    RetrievalHit,
    RunEventType,
)


@pytest.mark.parametrize("with_sources", [False, True])
def test_system_messages_are_merged_and_conversation_order_preserved(with_sources):
    messages = (
        ChatMessage("system", "Client instruction"),
        ChatMessage("user", "first", ("image-data",)),
        ChatMessage("assistant", "answer"),
        ChatMessage("system", "Legacy context instruction"),
        ChatMessage("user", "next"),
    )
    hits = [RetrievalHit("chunk", "Reference content", 1, {"title": "Source"})] if with_sources else []
    result = QueryReasoningService._with_evidence(messages, hits)
    assert [message.role for message in result] == ["system", "user", "assistant", "user"]
    assert result[1:] == tuple(message for message in messages if message.role != "system")
    assert "Client instruction" in result[0].content
    assert "Legacy context instruction" in result[0].content
    assert ("Reference content" in result[0].content) == with_sources
    assert result[1].images == ("image-data",)


@pytest.mark.parametrize("strict", [False, True])
@pytest.mark.parametrize("with_sources", [False, True])
def test_generation_obeys_source_policy_and_does_not_call_model_on_missing_evidence(strict, with_sources):
    class Retriever:
        async def retrieve(self, request):
            assert request.strict_sources is strict
            return (RetrievalHit("garden", "Vườn Sao mở cửa lúc 09:17.", 1, {"title": "Sổ tay"}),) if with_sources else ()

    class LLM:
        request = None

        async def capabilities(self, _model):
            assert with_sources or not strict, "A strict source miss must not contact Ollama"
            return ModelCapabilities()

        async def stream_chat(self, request):
            self.request = request
            yield {"content": "Vườn Sao mở cửa lúc 09:17 [R1].", "done": True}

    async def run():
        llm = LLM()
        service = QueryReasoningService(
            retriever=Retriever(), llm=llm, reasoning_profiles=ReasoningProfileCatalog(),
            scheduler=InferenceScheduler(ResourceManager(ResourceLimits(1, 64, 0))),
            chat_ram_mb=1, chat_gpu_mb=0,
        )
        events = []
        async def emit(event):
            events.append(event)
        state = QueryReasoningState(ChatRequest(
            model="test", messages=(ChatMessage("user", "Vườn Sao mở cửa lúc nào?"),), strict_sources=strict,
        ))
        await service.run(state, emit)
        completed = next(event for event in events if event.type is RunEventType.COMPLETED)
        if strict and not with_sources:
            assert llm.request is None
            assert completed.data["grounding"] == "no_evidence"
            assert "Chưa đủ thông tin" in completed.data["final_content"]
        else:
            prompt = llm.request.messages[0].content
            assert ("CHẾ ĐỘ CHỈ THEO TÀI LIỆU ĐANG BẬT" in prompt) is strict
            assert ("Kiến thức model — không có trong tài liệu" in prompt) is not strict
            assert ("[R1] Vườn Sao mở cửa lúc 09:17." in prompt) is with_sources
            assert completed.data["final_content"] == "Vườn Sao mở cửa lúc 09:17 [R1]."
        assert state.stage == "completed"
    asyncio.run(run())


@pytest.mark.parametrize("message,expected", [
    (ChatMessage("user", "Phân tích ảnh", ("image-data",)), True),
    (ChatMessage("user", "Đọc tệp\n\n--- TỆP: garden.txt ---\nVườn Sao mở lúc 09:17.\n\n--- HẾT PHẦN ĐƯỢC CHỌN ---"), True),
    (ChatMessage("user", "Đọc tệp\n\n--- TỆP: empty.txt ---\n\n\n--- HẾT PHẦN ĐƯỢC CHỌN ---"), False),
    (ChatMessage("assistant", "Phân tích ảnh", ("image-data",)), False),
    (ChatMessage("user", "Câu hỏi không kèm dữ liệu"), False),
])
def test_inline_sources_include_uploaded_evidence_but_not_assistant_claims(message, expected):
    assert QueryReasoningService._has_inline_sources((message,)) is expected


def request(messages=None):
    return LLMRequest("test-model", messages or (ChatMessage("system", "system"), ChatMessage("user", "test")), 8192, 64, False, "test-run")


def test_assembled_prompt_is_accepted_by_strict_system_template():
    async def run():
        def respond(raw):
            body = json.loads(raw.content)
            roles = [message["role"] for message in body["messages"]]
            if roles[0] != "system" or roles.count("system") != 1:
                return httpx.Response(500, json={"error": "System message must be at the beginning."})
            return httpx.Response(200, text='{"message":{"content":"4"},"done":true,"eval_count":1}\n')
        client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(respond))
        prompt = QueryReasoningService._with_evidence((ChatMessage("system", "legacy"), ChatMessage("user", "2+2")),
            (RetrievalHit("ref", "Example source", 1, {}),))
        chunks = [chunk async for chunk in client.stream_chat(request(prompt))]
        assert chunks[0]["content"] == "4"
        await client.close()
    asyncio.run(run())


@pytest.mark.parametrize("body", [{"error": "System message must be at the beginning."}, {"error": {"message": "System message must be at the beginning."}}])
def test_http_500_keeps_server_diagnostic(body):
    async def run():
        client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(lambda _: httpx.Response(500, json=body)))
        with pytest.raises(OllamaResponseError, match="Ollama HTTP 500: System message must be at the beginning"):
            _ = [chunk async for chunk in client.stream_chat(request())]
        await client.close()
    asyncio.run(run())


@pytest.mark.parametrize("body,expected", [
    ('{"error":"runner failed"}\n', "runner failed"),
    ('{"message":{"content":"partial"},"done":false}\n', "trước khi xác nhận"),
])
def test_stream_error_and_missing_completion_are_not_success(body, expected):
    async def run():
        client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body)))
        with pytest.raises(OllamaResponseError, match=expected):
            _ = [chunk async for chunk in client.stream_chat(request())]
        await client.close()
    asyncio.run(run())


def test_ollama_client_reuses_capability_lookup_and_sends_keep_alive():
    async def run():
        requests = []

        def respond(raw):
            requests.append((raw.url.path, json.loads(raw.content)))
            if raw.url.path == "/api/show":
                return httpx.Response(200, json={"capabilities": ["thinking"]})
            return httpx.Response(
                200,
                text=(
                    '{"message":{"content":"4"},"done":true,'
                    '"done_reason":"stop",'
                    '"prompt_eval_count":10,"eval_count":2,'
                    '"eval_duration":1000000000,"load_duration":20}\n'
                ),
            )

        client = OllamaClient(
            "http://127.0.0.1:11434",
            transport=httpx.MockTransport(respond),
            keep_alive="30m",
        )
        assert (await client.capabilities("test-model")).thinking_control
        assert (await client.capabilities("test-model")).thinking_control
        chunks = [chunk async for chunk in client.stream_chat(request())]
        chat_payload = next(body for path, body in requests if path == "/api/chat")
        assert chat_payload["keep_alive"] == "30m"
        assert [path for path, _ in requests].count("/api/show") == 1
        assert chunks[-1]["done_reason"] == "stop"
        assert chunks[-1]["truncated"] is False
        assert chunks[-1]["usage"]["tokens_per_second"] == 2.0
        await client.close()

    asyncio.run(run())


def test_ollama_length_reason_is_not_reported_as_normal_completion():
    async def run():
        body = '{"message":{"content":"partial"},"done":true,"done_reason":"length","eval_count":64}\n'
        client = OllamaClient(
            "http://127.0.0.1:11434",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body)),
        )
        chunks = [chunk async for chunk in client.stream_chat(request())]
        assert chunks[-1]["done"] is True
        assert chunks[-1]["done_reason"] == "length"
        assert chunks[-1]["truncated"] is True
        await client.close()

    asyncio.run(run())


def test_dynamic_context_uses_small_bucket_only_when_input_is_safe():
    catalog = ReasoningProfileCatalog()
    assert catalog.get(ReasoningMode.NORMAL).thinking is False
    assert catalog.get(ReasoningMode.DEEP).thinking is True
    short = (ChatMessage("system", "brief"), ChatMessage("user", "2 + 2?"))
    assert catalog.context_tokens_for(ReasoningMode.FAST, short) == 4096

    # Exercise the same prompt assembly used by production.  The built-in
    # system prompt must not accidentally force every short FAST turn to 8K.
    production_short = QueryReasoningService._with_evidence(
        (ChatMessage("user", "Xin chào"),),
        (),
    )
    assert catalog.context_tokens_for(ReasoningMode.FAST, production_short) == 4096

    long_text = "á" * 1500
    long_prompt = (ChatMessage("system", long_text), ChatMessage("user", long_text))
    assert catalog.context_tokens_for(ReasoningMode.FAST, long_prompt) == 8192
    assert catalog.context_tokens_for(
        ReasoningMode.FAST,
        (ChatMessage("user", "describe", ("image-data",)),),
    ) == 8192
    assert catalog.context_tokens_for(ReasoningMode.DEEP, short) == 16384


def test_completed_event_reconciles_content_and_reports_length_cutoff():
    class FakeLLM:
        async def capabilities(self, _model):
            return ModelCapabilities(thinking_control=True)

        async def stream_chat(self, _request):
            yield {"content": "Phần một. "}
            yield {
                "content": "Phần hai chưa xong",
                "done": True,
                "done_reason": "length",
                "truncated": True,
                "usage": {"completion_tokens": 4096},
            }

    async def run():
        events = []
        async def emit(event):
            events.append(event)

        resources = ResourceManager(ResourceLimits(2, 2048, 6144))
        service = QueryReasoningService(
            retriever=None,
            llm=FakeLLM(),
            reasoning_profiles=ReasoningProfileCatalog(),
            scheduler=InferenceScheduler(resources),
            chat_ram_mb=1,
            chat_gpu_mb=0,
        )
        state = QueryReasoningState(ChatRequest(
            model="test-model",
            messages=(ChatMessage("user", "test"),),
            mode=ReasoningMode.NORMAL,
            run_id="cutoff-run",
        ))
        await service.generate_stage(state, emit)
        usage = next(event for event in events if event.type is RunEventType.USAGE)
        completed = next(event for event in events if event.type is RunEventType.COMPLETED)
        assert usage.data["done_reason"] == "length"
        assert usage.data["truncated"] is True
        assert completed.data["final_content"] == "Phần một. Phần hai chưa xong"
        assert completed.data["done_reason"] == "length"
        assert completed.data["truncated"] is True
        assert completed.data["reasoning"]["thinking_requested"] is False

    asyncio.run(run())
