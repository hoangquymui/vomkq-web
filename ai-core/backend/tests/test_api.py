from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from vector_ai_backend.api import create_app
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings
from vector_ai_backend.application.ingestion import register_document
from vector_ai_backend.domain.models import DocumentChunk, DocumentIngestionState, RetrievalRequest, SourceScope


def test_health_profiles_workflows_and_builtin_retrieval(tmp_path: Path) -> None:
    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    try:
        with TestClient(create_app(container)) as client:
            health = client.get("/api/v1/health")
            assert health.status_code == 200
            assert health.json()["address"] == "127.0.0.1:8000"
            profiles = client.get("/api/v1/profiles/embedding").json()["profiles"]
            assert profiles and profiles[0]["provider"]
            workflows = client.get("/api/v1/workflows").json()["workflows"]
            assert {item["id"] for item in workflows} == {"document-ingestion-v1", "query-reasoning-v1", "gis-analysis-v1", "data-quality-v1", "document-qa-v1", "report-summary-v1"}
            assert all(item["editable_capabilities"]["layout"] for item in workflows)
            assert not any(item["editable_capabilities"]["runtime_topology"] for item in workflows)
            documents = client.get("/api/v1/documents").json()["documents"]
            assert len(documents) == 3
            preview = client.post("/api/v1/retrieval/preview", json={"query": "cự ly phát hiện radar", "scope": {"builtin": True}, "mode": "FAST"})
            assert preview.status_code == 200
            assert preview.json()["hits"]
    finally:
        asyncio.run(container.close())


def test_sharing_one_document_makes_it_retrievable_in_new_chats(tmp_path: Path) -> None:
    container = asyncio.run(build_container(BackendSettings(data_dir=tmp_path)))

    async def prepare():
        for doc_id in ("manual", "private-attachment"):
            await container.repository.upsert_document({
                "id": doc_id, "version": 1, "title": doc_id,
                "scope_kind": "chat", "owner_id": "old-chat",
            })
            await container.repository.upsert_chunks([DocumentChunk(
                f"{doc_id}-chunk", doc_id, 1, "mavuon98765 là tên khu vườn trong tài liệu.", 0,
                scope=SourceScope(builtin=False, chat_ids=("old-chat",)),
            )])

    asyncio.run(prepare())
    try:
        with TestClient(create_app(container)) as client:
            query = {"query": "mavuon98765", "scope": {"builtin": True, "chat_ids": ["new-chat"]}}
            assert client.post("/api/v1/retrieval/preview", json=query).json()["hits"] == []
            original_chunk = asyncio.run(container.repository.get_chunks(["manual-chunk"]))[0]
            for bad_version in (0, True, "1"):
                assert client.post("/api/v1/documents/manual/share", json={"version": bad_version}).status_code == 422
            assert client.post("/api/v1/documents/missing/share", json={}).status_code == 404
            for _ in range(2):
                assert client.post("/api/v1/documents/manual/share", json={"version": 1}).status_code == 200
            hits = client.post("/api/v1/retrieval/preview", json=query).json()["hits"]
            assert [hit["chunk_id"] for hit in hits] == ["manual-chunk"]
            docs = {doc["id"]: doc for doc in client.get("/api/v1/documents").json()["documents"]}
            assert docs["manual"]["scope_kind"] == "builtin"
            assert docs["manual"]["owner_id"] is None
            assert docs["manual"]["metadata"]["scope_before_sharing"] == {"kind": "chat", "owner_id": "old-chat"}
            assert docs["private-attachment"]["scope_kind"] == "chat"
            chunk = asyncio.run(container.repository.get_chunks(["manual-chunk"]))[0]
            assert (chunk.text, chunk.verification_revision, chunk.formula_ids) == (original_chunk.text, original_chunk.verification_revision, original_chunk.formula_ids)
            # Sharing must not silently turn a disabled document back on.
            client.patch("/api/v1/documents/private-attachment", json={"enabled": False})
            assert client.post("/api/v1/documents/private-attachment/share", json={}).status_code == 200
            hits = client.post("/api/v1/retrieval/preview", json=query).json()["hits"]
            assert [hit["chunk_id"] for hit in hits] == ["manual-chunk"]
    finally:
        asyncio.run(container.close())


def test_blank_document_needs_only_a_title_and_accepts_dataset_content_later(tmp_path: Path) -> None:
    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    try:
        with TestClient(create_app(container)) as client:
            assert client.post("/api/v1/documents/blank", json={"title": "   "}).status_code == 422

            created = client.post(
                "/api/v1/documents/blank",
                json={"title": "SỔ TAY TRỐNG", "scope": {"builtin": True}},
            )
            assert created.status_code == 201
            payload = created.json()
            document = payload["document"]
            assert payload["empty"] is True
            assert document["title"] == "SỔ TAY TRỐNG"
            assert document["chunk_count"] == 0
            assert document["metadata"]["empty_document"] is True
            assert Path(document["source_uri"]).read_text(encoding="utf-8") == ""

            path = f"/api/v1/documents/{document['id']}/tree?version=1"
            tree_response = client.get(path)
            assert tree_response.status_code == 200
            tree_payload = tree_response.json()
            assert tree_payload["source_count"] == 0
            tree = tree_payload["tree"]
            assert tree["nodes"] == [{
                "id": "root", "parent_id": None, "title": "SỔ TAY TRỐNG",
                "kind": "document", "description": "", "content": "",
                "chunk_id": None, "collapsed": False,
            }]

            tree["nodes"][0]["content"] = "Từ khóa riêng mahoangsa98765 được bổ sung sau khi tạo tài liệu."
            saved = client.put(path, json=tree)
            assert saved.status_code == 200
            assert saved.json()["content_changed"] is True
            preview = client.post(
                "/api/v1/retrieval/preview",
                json={"query": "mahoangsa98765", "scope": {"builtin": True}, "mode": "FAST"},
            )
            assert preview.status_code == 200
            assert any(hit["source"]["document_id"] == document["id"] for hit in preview.json()["hits"])
    finally:
        asyncio.run(container.close())


def test_workflow_diagram_edit_is_revisioned_and_runtime_topology_is_locked(tmp_path: Path) -> None:
    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    try:
        with TestClient(create_app(container)) as client:
            path = "/api/v1/workflows/document-ingestion-v1/diagram"
            original = client.get(path).json()["diagram"]
            assert original["revision"] == 0
            assert original["edges"]
            default_first_label = original["nodes"][0]["label"]

            nodes = original["nodes"]
            nodes[0]["label"] = "Nguồn tài liệu"
            nodes[0]["x"] = 125
            saved_response = client.put(path, json={"revision": 0, "nodes": nodes})
            assert saved_response.status_code == 200
            saved = saved_response.json()["diagram"]
            assert saved["revision"] == 1
            assert saved["nodes"][0]["label"] == "Nguồn tài liệu"
            assert saved["edges"] == original["edges"]

            stale = client.put(path, json={"revision": 0, "nodes": nodes})
            assert stale.status_code == 409

            removed = client.put(path, json={"revision": 1, "nodes": nodes[:-1]})
            assert removed.status_code == 422

            reset_response = client.request("DELETE", path, json={"revision": 1})
            assert reset_response.status_code == 200
            reset = reset_response.json()["diagram"]
            assert reset["revision"] == 2
            assert reset["nodes"][0]["label"] == default_first_label

            stale_after_reset = client.put(path, json={"revision": 0, "nodes": nodes})
            assert stale_after_reset.status_code == 409
    finally:
        asyncio.run(container.close())


def test_workflow_diagram_api_rejects_ambiguous_revision_and_invalid_fields(tmp_path: Path) -> None:
    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    try:
        with TestClient(create_app(container)) as client:
            path = "/api/v1/workflows/query-reasoning-v1/diagram"
            original = client.get(path).json()["diagram"]
            nodes = original["nodes"]

            for bad_revision in (True, -1, 0.0, "0", None):
                response = client.put(
                    path,
                    json={"revision": bad_revision, "nodes": nodes},
                )
                assert response.status_code == 422, bad_revision

            invalid_label = [dict(node) for node in nodes]
            invalid_label[0]["label"] = None
            assert client.put(
                path,
                json={"revision": 0, "nodes": invalid_label},
            ).status_code == 422

            invalid_coordinate = [dict(node) for node in nodes]
            invalid_coordinate[0]["x"] = True
            assert client.put(
                path,
                json={"revision": 0, "nodes": invalid_coordinate},
            ).status_code == 422

            assert client.request(
                "DELETE",
                path,
                json={"revision": "0"},
            ).status_code == 422

            unchanged = client.get(path).json()["diagram"]
            assert unchanged["revision"] == 0
            assert unchanged["nodes"] == nodes
    finally:
        asyncio.run(container.close())


def test_ingestion_graph_indexes_text_without_qdrant(tmp_path: Path) -> None:
    async def scenario() -> None:
        settings = BackendSettings(data_dir=tmp_path / "data", resource_ram_mb=2048, chat_ram_mb=512)
        container = await build_container(settings)
        try:
            source = tmp_path / "knowledge.txt"
            source.write_text("Công thức thử nghiệm. Vận tốc được tính từ quãng đường và thời gian.", encoding="utf-8")
            await register_document(container.repository, document_id="doc-test", version=1, title="Kiến thức thử", source_path=source, scope_kind="workspace", owner_id="ws-1")
            state = DocumentIngestionState(
                run_id="ingest-test", document_id="doc-test", document_version=1,
                checkpoint={"source_path": str(source), "scope_kind": "workspace", "owner_id": "ws-1", "embedding_profile_id": settings.default_embedding_profile_id},
            )
            events = []
            async def emit(event):
                events.append(event)
            result = await container.ingestion_runs._runner.run(state, emit)
            assert result.stage == "completed"
            assert result.checkpoint["dense_status"] == "skipped_vector_store_unavailable"
            hits = await container.retriever.retrieve(RetrievalRequest(
                query="vận tốc quãng đường", scope=SourceScope(builtin=False, workspace_ids=("ws-1",)),
                embedding_profile_id=settings.default_embedding_profile_id,
            ))
            assert hits and hits[0].source["document_id"] == "doc-test"
        finally:
            await container.close()
    asyncio.run(scenario())


def test_backup_v2_is_validated_and_applied_only_after_restart(tmp_path: Path) -> None:
    async def scenario() -> None:
        settings = BackendSettings(
            data_dir=tmp_path / "data",
            resource_ram_mb=2048,
            chat_ram_mb=512,
        )
        container = await build_container(settings)
        archive: Path
        try:
            await container.repository.upsert_document({
                "id": "backup-doc",
                "version": 1,
                "title": "Bản trong backup",
                "scope_kind": "builtin",
            })
            archive = await container.backups.export()
            await container.repository.upsert_document({
                "id": "backup-doc",
                "version": 1,
                "title": "Bản thay đổi sau backup",
                "scope_kind": "builtin",
            })
            staged = await container.backups.stage_restore(archive, "frontend-test-1")
            assert staged["apply_on_restart"] is True
            assert (await container.backups.restore_status())["pending"]["frontend_restore_id"] == "frontend-test-1"
            current = [
                row for row in await container.repository.list_documents()
                if row["id"] == "backup-doc"
            ][0]
            assert current["title"] == "Bản thay đổi sau backup"
        finally:
            await container.close()

        restored = await build_container(settings)
        try:
            status = await restored.backups.restore_status()
            assert status["pending"] is None
            assert status["result"]["applied"] is True
            assert status["result"]["frontend_restore_id"] == "frontend-test-1"
            current = [
                row for row in await restored.repository.list_documents()
                if row["id"] == "backup-doc"
            ][0]
            assert current["title"] == "Bản trong backup"
            assert not (settings.data_dir / "restore_pending").exists()
            assert list((settings.data_dir / "restore_archives").iterdir())
        finally:
            await restored.close()

    asyncio.run(scenario())
