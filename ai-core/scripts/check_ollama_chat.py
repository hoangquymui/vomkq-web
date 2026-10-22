"""Explicit local smoke test: synthetic prompt, no chat/database writes."""
import argparse
import asyncio

from vector_ai_backend.application.services import QueryReasoningService
from vector_ai_backend.adapters.ollama import OllamaClient
from vector_ai_backend.domain.models import ChatMessage, RetrievalHit, LLMRequest


async def run(model):
    messages = QueryReasoningService._with_evidence(
        (ChatMessage("system", "Answer briefly."),
         ChatMessage("user", "What is 2 + 2? Reply with the number only.")),
        (RetrievalHit("smoke", "2 + 2 = 4.", 1, {"title": "Synthetic test"}),),
    )
    request = LLMRequest(model, messages, 8192, 32, False, "diagnostic-only")
    answer = ""
    async for event in OllamaClient("http://127.0.0.1:11434", timeout_seconds=120).stream_chat(request):
        answer += event.get("content", "")
        print(event, flush=True)
    if not answer.strip():
        raise RuntimeError("Model completed without an answer")
    print("PASS: single-system RAG prompt returned an answer", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    asyncio.run(run(parser.parse_args().model))
