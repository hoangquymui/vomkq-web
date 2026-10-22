from __future__ import annotations

import asyncio
import importlib
from pathlib import Path

import pytest

from vector_ai_backend.application.profiles import E5_SMALL_PRESET
from vector_ai_backend.application.resources import InferenceScheduler, ResourceManager
from vector_ai_backend.application.tools import ToolPolicyError, ToolRegistry
from vector_ai_backend.domain.models import (
    EmbeddingProfile,
    ResourceLimits,
    ResourceRequest,
    SourceScope,
    ToolDescriptor,
    ToolExecutionContext,
    ToolPolicy,
    ToolRequest,
    ToolResult,
    WorkPriority,
)
from vector_ai_backend.storage.checkpoints import SQLiteCheckpointStore


def test_core_has_no_transport_or_infrastructure_imports() -> None:
    for module_name in ("vector_ai_backend.domain.models", "vector_ai_backend.domain.ports", "vector_ai_backend.domain.dataset_tree"):
        module = importlib.import_module(module_name)
        source = Path(module.__file__).read_text(encoding="utf-8")
        assert "fastapi" not in source
        assert "qdrant_client" not in source
        assert "langgraph" not in source
        assert "tauri" not in source
    ingestion_source = Path(importlib.import_module("vector_ai_backend.application.ingestion").__file__).read_text(encoding="utf-8")
    assert "..adapters" not in ingestion_source


def test_embedding_fingerprint_changes_even_when_dimension_is_equal() -> None:
    left = E5_SMALL_PRESET
    right = EmbeddingProfile(
        id="replacement", name="Replacement", provider="sentence-transformers",
        model_path="local/replacement", model_revision="v2", dimension=left.dimension,
    )
    assert left.fingerprint(chunker_version="v1", semantic_representation_version="v1") != right.fingerprint(chunker_version="v1", semantic_representation_version="v1")


def test_scheduler_prioritizes_chat_after_current_batch() -> None:
    async def scenario() -> list[str]:
        manager = ResourceManager(ResourceLimits(cpu_slots=1, ram_mb=512, gpu_mb=0))
        order: list[str] = []
        release = asyncio.Event()

        async def occupying() -> None:
            async with manager.lease(ResourceRequest("first", WorkPriority.BACKGROUND_INDEXING, 1, 1)):
                await release.wait()

        first = asyncio.create_task(occupying())
        await asyncio.sleep(0)

        async def acquire(name: str, priority: WorkPriority) -> None:
            async with manager.lease(ResourceRequest(name, priority, 1, 1)):
                order.append(name)

        background = asyncio.create_task(acquire("background", WorkPriority.BACKGROUND_INDEXING))
        chat = asyncio.create_task(acquire("chat", WorkPriority.INTERACTIVE_CHAT))
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(first, background, chat)
        return order

    assert asyncio.run(scenario()) == ["chat", "background"]


def test_checkpoint_namespaces_are_independent(tmp_path: Path) -> None:
    async def scenario() -> None:
        store = SQLiteCheckpointStore(tmp_path / "checkpoints.sqlite3")
        await store.save("document-ingestion-v1", "same-run", {"stage": "ocr"})
        await store.save("query-reasoning-v1", "same-run", {"stage": "generation"})
        assert (await store.load("document-ingestion-v1", "same-run"))["stage"] == "ocr"
        assert (await store.load("query-reasoning-v1", "same-run"))["stage"] == "generation"
        await store.close()
    asyncio.run(scenario())


def test_tool_policy_and_schema_are_checked_before_execution() -> None:
    class FakeTool:
        called = False
        descriptor = ToolDescriptor(
            "safe.test", "1", "test",
            {"type": "object", "required": ["value"], "additionalProperties": False, "properties": {"value": {"type": "integer"}}},
            {"type": "object"}, ("test",),
        )

        async def execute(self, arguments, context):
            self.called = True
            return ToolResult(True, {"value": arguments["value"]})

    async def scenario() -> None:
        scheduler = InferenceScheduler(ResourceManager(ResourceLimits(1, 256, 0)))
        system = ToolPolicy(frozenset({"safe.test"}), frozenset({"test"}))
        registry = ToolRegistry(scheduler, system)
        tool = FakeTool()
        registry.register(tool)
        denied = ToolExecutionContext("run", SourceScope(), ToolPolicy(frozenset(), frozenset()))
        with pytest.raises(ToolPolicyError):
            await registry.execute(ToolRequest("safe.test", {"value": 1}), denied)
        assert not tool.called
        allowed = ToolExecutionContext("run", SourceScope(), system)
        result = await registry.execute(ToolRequest("safe.test", {"value": 2}), allowed)
        assert result.data["value"] == 2 and tool.called

    asyncio.run(scenario())
