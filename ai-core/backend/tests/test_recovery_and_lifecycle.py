from __future__ import annotations

import asyncio
import json
import zipfile
from pathlib import Path

import pytest

from vector_ai_backend.application.backups import BackupService, _safe_relative
from vector_ai_backend.application.resources import InferenceScheduler, ResourceManager
from vector_ai_backend.application.runs import RunCoordinator
from vector_ai_backend.application.tools import RagSearchTool, ToolRegistry
from vector_ai_backend.domain.models import (
    ChatMessage, ChatRequest, QueryReasoningState, ResourceLimits, ResourceRequest,
    RunEvent, RunEventType, SourceScope, ToolExecutionContext, ToolPolicy, ToolRequest, WorkPriority,
)
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings


@pytest.mark.parametrize("path", ["../escape", "C:/outside", "C:outside", "a\\..\\escape", "a:stream", "//server/share", "documents/CON.txt", "documents/file. "])
def test_backup_rejects_windows_path_escape(path):
    with pytest.raises(ValueError):
        _safe_relative(path)


def test_staged_backup_tamper_never_replaces_live_state(tmp_path):
    async def run():
        settings = BackendSettings(data_dir=tmp_path)
        container = await build_container(settings)
        await container.repository.upsert_document({"id": "mine", "title": "original"})
        backup = await container.backups.export()
        await container.backups.stage_restore(backup)
        await container.close()
        current = (tmp_path / "vector_ai.sqlite3").read_bytes()
        (tmp_path / "restore_pending/state/vector_ai.sqlite3").write_bytes(b"broken")
        with pytest.raises(ValueError, match="thay đổi"):
            await build_container(settings)
        assert (tmp_path / "vector_ai.sqlite3").read_bytes() == current
    asyncio.run(run())


def test_restore_failure_rolls_back_databases_documents_and_config(tmp_path, monkeypatch):
    async def run():
        settings = BackendSettings(data_dir=tmp_path)
        core = await build_container(settings)
        source = tmp_path / "documents/source.txt"
        source.write_text("old")
        backup = await core.backups.export()
        source.write_text("new")
        await core.repository.upsert_document({"id": "after-backup", "title": "keep me"})
        await core.backups.stage_restore(backup)
        await core.close()
        from vector_ai_backend.application import backups
        def fail(*_):
            raise OSError("simulated disk error")
        monkeypatch.setattr(backups, "_prepare_restored_state", fail)
        with pytest.raises(OSError, match="simulated"):
            backups.apply_pending_restore(tmp_path)
        assert source.read_text() == "new"
        from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository
        repo = SQLiteKnowledgeRepository(tmp_path / "vector_ai.sqlite3")
        assert any(row["id"] == "after-backup" for row in await repo.list_documents())
        await repo.close()
    asyncio.run(run())


def test_backup_rebinds_source_paths_on_another_machine(tmp_path):
    async def run():
        old = await build_container(BackendSettings(data_dir=tmp_path / "old"))
        source = tmp_path / "old/documents/example.txt"
        source.write_text("reference")
        await old.repository.upsert_document({"id": "portable", "source_uri": str(source)})
        archive = await old.backups.export()
        new_settings = BackendSettings(data_dir=tmp_path / "new")
        new = await build_container(new_settings)
        await new.backups.stage_restore(archive)
        await new.close()
        await old.close()
        restored = await build_container(new_settings)
        try:
            row = next(row for row in await restored.repository.list_documents() if row["id"] == "portable")
            assert Path(row["source_uri"]) == tmp_path / "new/documents/example.txt"
            assert Path(row["source_uri"]).read_text() == "reference"
        finally:
            await restored.close()
    asyncio.run(run())


def test_two_sse_subscribers_each_receive_the_complete_answer():
    class Runner:
        async def run(self, state, emit):
            for content in ("one", "two", "three"):
                await emit(RunEvent(state.request.run_id, RunEventType.DELTA, "generation", data={"content": content}))
                await asyncio.sleep(0)
            await emit(RunEvent(state.request.run_id, RunEventType.COMPLETED, "completed"))
        async def cancel(self, run_id):
            pass
    async def run():
        coordinator = RunCoordinator(Runner())
        request = ChatRequest("fake", (ChatMessage("user", "hello"),))
        run_id = await coordinator.start(QueryReasoningState(request))
        async def consume():
            return [event async for event in coordinator.events(run_id)]
        left, right = await asyncio.wait_for(asyncio.gather(consume(), consume()), 2)
        assert [event.to_dict() for event in left] == [event.to_dict() for event in right]
        assert "".join(event.data.get("content", "") for event in left) == "onetwothree"
        replay = await consume()
        assert len(replay) == 4
        await coordinator.close()
    asyncio.run(run())


def test_cancel_while_queued_releases_scheduler_waiter():
    async def run():
        manager = ResourceManager(ResourceLimits(1, 512, 0))
        scheduler = InferenceScheduler(manager)
        occupying = await manager.acquire(ResourceRequest("busy", WorkPriority.INTERACTIVE_CHAT, 1))
        cancelled = asyncio.Event()
        called = []
        async def work():
            called.append(True)
        task = asyncio.create_task(scheduler.run(ResourceRequest("waiting", WorkPriority.BACKGROUND_OCR, 1), work, cancellation=cancelled))
        await asyncio.sleep(0)
        cancelled.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        assert not called
        assert not (await manager.snapshot())["queued"]
        await manager.release(occupying)
        assert (await manager.snapshot())["used"]["cpu_slots"] == 0
    asyncio.run(run())


def test_rag_tool_does_not_deadlock_single_cpu_slot():
    async def run():
        scheduler = InferenceScheduler(ResourceManager(ResourceLimits(1, 512, 0)))
        class Retriever:
            async def retrieve(self, request):
                async def work():
                    return []
                return await scheduler.run(ResourceRequest("query", WorkPriority.INTERACTIVE_CHAT, 1), work)
        policy = ToolPolicy(frozenset({"rag.search"}), frozenset({"rag", "retrieval"}))
        registry = ToolRegistry(scheduler, policy)
        registry.register(RagSearchTool(Retriever(), "fake"))
        result = await asyncio.wait_for(registry.execute(ToolRequest("rag.search", {"query": "hello"}), ToolExecutionContext("run", SourceScope(), policy)), 1)
        assert result.ok
    asyncio.run(run())
