from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from vector_ai_backend.application.conversations import ConversationService, ConversationConflict
from vector_ai_backend.storage.checkpoints import LegacyStateRepository
from vector_ai_backend.api import create_app
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings


PAYLOAD = {
    "generalChats": [{"id": "chat-1", "title": "Chat", "messages": [
        {"id": "m-1", "role": "user", "content": "hello", "attachments": [{"fileId": "file-1"}]},
        {"id": "m-2", "role": "assistant", "content": "answer", "branchId": "branch-1"},
    ]}],
    "workspaces": [{"id": "ws-1", "name": "Workspace", "files": [{"id": "f-2"}], "chats": []}],
    "activeWorkspaceId": "ws-1",
}


def test_state_preserves_ids_and_metadata_after_reopen(tmp_path):
    async def run():
        path = tmp_path / "legacy_state.sqlite3"
        store = LegacyStateRepository(path)
        service = ConversationService(store)
        assert (await service.read())["payload"] is None
        saved = await service.save(PAYLOAD, expected_revision=0, operation_id="save-1")
        assert saved["revision"] == 1
        await store.close()
        reopened = LegacyStateRepository(path)
        try:
            assert (await ConversationService(reopened).read())["payload"] == PAYLOAD
        finally:
            await reopened.close()
    asyncio.run(run())


def test_retry_is_idempotent_but_same_operation_with_other_data_is_rejected(tmp_path):
    async def run():
        store = LegacyStateRepository(tmp_path / "state.sqlite3")
        service = ConversationService(store)
        try:
            first = await service.save(PAYLOAD, expected_revision=0, operation_id="retry")
            assert await service.save(PAYLOAD, expected_revision=0, operation_id="retry") == first
            changed = deepcopy(PAYLOAD)
            changed["generalChats"][0]["title"] = "changed"
            with pytest.raises(ConversationConflict):
                await service.save(changed, expected_revision=1, operation_id="retry")
            assert (await service.read())["payload"] == PAYLOAD
        finally:
            await store.close()
    asyncio.run(run())


def test_cas_protects_separate_sqlite_connections(tmp_path):
    async def run():
        stores = [LegacyStateRepository(tmp_path / "state.sqlite3") for _ in range(2)]
        try:
            results = await asyncio.gather(*(
                ConversationService(store).save(PAYLOAD, expected_revision=0, operation_id=f"write-{index}")
                for index, store in enumerate(stores)
            ), return_exceptions=True)
            assert sum(isinstance(result, ConversationConflict) for result in results) == 1
            assert (await stores[0].read_conversation_state())["revision"] == 1
        finally:
            for store in stores:
                await store.close()
    asyncio.run(run())


def test_application_uses_fake_port_and_rejects_invalid_state_before_write():
    class FakeStore:
        called = False
        async def write_conversation_state(self, *args):
            self.called = True
            return {"revision": 1}
    async def run():
        store = FakeStore()
        service = ConversationService(store)
        duplicated = deepcopy(PAYLOAD)
        duplicated["generalChats"].append(deepcopy(duplicated["generalChats"][0]))
        with pytest.raises(ValueError, match="Trùng ID"):
            await service.save(duplicated, expected_revision=0, operation_id="bad")
        assert not store.called
        assert (await service.save(PAYLOAD, expected_revision=0, operation_id="ok"))["revision"] == 1
    asyncio.run(run())


def test_conversation_rest_adapter_and_backup_preserve_state(tmp_path):
    settings = BackendSettings(data_dir=tmp_path / "data")
    core = asyncio.run(build_container(settings))
    try:
        with TestClient(create_app(core)) as client:
            origin = "http://127.0.0.1:3000"
            preflight = client.options("/api/v1/conversations/state", headers={
                "Origin": origin,
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type",
            })
            assert preflight.status_code == 200
            assert preflight.headers["access-control-allow-origin"] == origin
            assert "PUT" in preflight.headers["access-control-allow-methods"]
            rejected = client.options("/api/v1/conversations/state", headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type",
            })
            assert rejected.status_code == 400
            assert "access-control-allow-origin" not in rejected.headers
            request = {"payload": PAYLOAD, "expected_revision": 0, "operation_id": "api-save"}
            response = client.put("/api/v1/conversations/state", json=request, headers={"Origin": origin})
            assert response.status_code == 200
            assert response.headers["access-control-allow-origin"] == origin
            assert client.get("/api/v1/conversations/state").json()["payload"] == PAYLOAD
            request["operation_id"] = "stale-save"
            assert client.put("/api/v1/conversations/state", json=request).status_code == 409
            assert client.put("/api/v1/conversations/state", json={}).status_code == 422
        archive = asyncio.run(core.backups.export())
        asyncio.run(core.backups.stage_restore(archive))
    finally:
        asyncio.run(core.close())
    restored = asyncio.run(build_container(settings))
    try:
        assert asyncio.run(restored.conversations.read())["payload"] == PAYLOAD
    finally:
        asyncio.run(restored.close())
