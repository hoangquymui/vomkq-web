import asyncio
import json
from pathlib import Path

import pytest

from fastapi.testclient import TestClient

from vector_ai_backend.api import create_app
from vector_ai_backend.application.dataset_trees import DatasetTreeService
from vector_ai_backend.application.knowledge_folders import KnowledgeFolderStorage, folder_slug
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings
from vector_ai_backend.domain.models import DocumentChunk
from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository


def test_folder_mirror_moves_renames_and_preserves_sources_and_unrelated_files(tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "test.sqlite3")
        storage = KnowledgeFolderStorage(repo, tmp_path)
        service = DatasetTreeService(repo, storage)
        try:
            source = tmp_path / "original.txt"
            source.write_text("Nội dung gốc", encoding="utf-8")
            for document_id in ("a", "b"):
                await repo.upsert_document({"id":document_id, "version":1, "title":"Sổ tay sĩ quan phòng không", "source_uri":str(source)})
            await repo.upsert_chunks([DocumentChunk("source-a", "a", 1, "Nội dung gốc", 0)])
            catalog = await service.get_catalog()
            catalog["folders"] = [{"id":"manuals", "title":"Sổ tay tổng hợp", "parent_id":None, "collapsed":False}]
            for item in catalog["documents"]:
                item["parent_id"] = "manuals"
            result = await service.update_catalog(catalog)
            assert not result["storage"].get("warning")
            records = result["storage"]["documents"]
            first = tmp_path / next(item["path"] for item in records if item["document_id"] == "a")
            second = tmp_path / next(item["path"] for item in records if item["document_id"] == "b")
            assert first == tmp_path / "kho_kien_thuc" / "so_tay_tong_hop" / "so_tay_si_quan_phong_khong"
            assert second != first and second.is_dir()
            assert "Nội dung gốc" in (first / "noi_dung.md").read_text(encoding="utf-8")
            assert (first / "nguon" / "original.txt").read_text(encoding="utf-8") == "Nội dung gốc"
            (first / "user-note.txt").write_text("keep", encoding="utf-8")

            tree = (await service.get("a", 1))["tree"]
            tree["nodes"][0]["title"] = "Sổ tay cập nhật"
            tree["nodes"][0]["content"] = "Bổ sung từ cây"
            result = await service.update("a", 1, tree)
            moved = tmp_path / next(item["path"] for item in result["storage"]["documents"] if item["document_id"] == "a")
            assert not first.exists() or json.loads((first / ".vector-document.json").read_text())["document_id"] == "b"
            assert moved.name == "so_tay_cap_nhat"
            assert (moved / "user-note.txt").read_text() == "keep"
            assert "Bổ sung từ cây" in (moved / "noi_dung.md").read_text(encoding="utf-8")
            assert source.read_text(encoding="utf-8") == "Nội dung gốc"

            await repo.set_document_lifecycle("a", 1, "archived")
            result = await storage.sync()
            archived = tmp_path / next(item["path"] for item in result["documents"] if item["document_id"] == "a")
            assert "luu_tru_kien_thuc" in archived.parts and not moved.exists()
            await repo.set_document_lifecycle("a", 1, "active")
            await storage.sync()
            assert moved.is_dir() and not archived.exists()
            assert (moved / "user-note.txt").read_text() == "keep"

            catalog = await service.get_catalog()
            catalog["folders"][0]["title"] = "Sổ tay mới"
            await service.update_catalog(catalog)
            assert (tmp_path / "kho_kien_thuc" / "so_tay_moi" / "so_tay_cap_nhat").is_dir()
            assert not (tmp_path / "kho_kien_thuc" / "so_tay_tong_hop").exists()
            assert folder_slug("../../CON") == "_con"
        finally:
            await repo.close()
    asyncio.run(run())


def test_archive_trash_restore_are_excluded_from_retrieval_and_survive_restart(tmp_path):
    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    document_id = None
    try:
        with TestClient(create_app(container)) as client:
            document_id = client.post("/api/v1/documents/blank", json={"title":"Kiểm tra lưu trữ"}).json()["id"]
            path = f"/api/v1/documents/{document_id}"
            tree = client.get(path + "/tree").json()["tree"]
            tree["nodes"][0]["content"] = "Từ khóa luutrudulieu987654321"
            assert client.put(path + "/tree", json=tree).status_code == 200
            def hits():
                result = client.post("/api/v1/retrieval/preview", json={"query":"luutrudulieu987654321", "scope":{"builtin":True}, "mode":"FAST"}).json()
                return [hit for hit in result["hits"] if hit["source"]["document_id"] == document_id]
            assert hits()
            assert client.post(path + "/lifecycle", json={"state":"archived"}).status_code == 200
            assert not hits()
            assert document_id not in [item["id"] for item in client.get("/api/v1/documents").json()["documents"]]
            assert client.get("/api/v1/documents?state=archived").json()["documents"][0]["id"] == document_id
            assert client.patch(path, json={"enabled":True}).status_code == 404
            assert client.post(path + "/reindex", json={}).status_code == 409
            assert client.post(path + "/lifecycle", json={"state":"active"}).status_code == 200
            assert hits()
            assert client.delete(path).status_code == 204
            assert not hits()
            assert client.get("/api/v1/documents?state=trashed").json()["documents"][0]["id"] == document_id
            assert client.post(path + "/lifecycle", json={"state":"active"}).status_code == 200
            assert hits()
            # Built-in rows remain as tombstones, so startup cannot re-import them.
            builtin = next(item for item in client.get("/api/v1/documents").json()["documents"] if item["metadata"].get("builtin"))
            assert client.delete(f"/api/v1/documents/{builtin['id']}").status_code == 204
    finally:
        asyncio.run(container.close())
    reopened = asyncio.run(build_container(settings))
    try:
        documents = asyncio.run(reopened.repository.list_documents())
        assert next(item for item in documents if item["id"] == builtin["id"])["lifecycle"] == "trashed"
        assert next(item for item in documents if item["id"] == document_id)["lifecycle"] == "active"
    finally:
        asyncio.run(reopened.close())


def test_export_creates_a_separate_copy_and_does_not_overwrite_destination(tmp_path):
    async def run():
        data = tmp_path / "data"
        repo = SQLiteKnowledgeRepository(data / "test.sqlite3")
        storage = KnowledgeFolderStorage(repo, data)
        destination = tmp_path / "exports"
        destination.mkdir()
        (destination / "user.txt").write_text("keep")
        try:
            await repo.upsert_document({"id":"doc", "version":1, "title":"Tài liệu mới"})
            first = Path((await storage.export_folder(str(destination)))["path"])
            second = Path((await storage.export_folder(str(destination)))["path"])
            assert first != second and first.parent == destination
            assert (first / "tai_lieu_moi" / "noi_dung.md").is_file()
            assert (destination / "user.txt").read_text() == "keep"
            with pytest.raises(ValueError):
                await storage.export_folder(str(data))
            with pytest.raises(ValueError):
                storage._path("../outside")
        finally:
            await repo.close()
    asyncio.run(run())
