from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from vector_ai_backend.api import create_app
from vector_ai_backend.application.dataset_trees import DatasetTreeService, DatasetTreeConflict, DatasetTreeNotFound, KnowledgeCatalogConflict
from vector_ai_backend.domain.models import DocumentChunk
from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository


async def fixture(repo):
    await repo.upsert_document({"id": "handbook", "title": "Sổ tay", "version": 1})
    await repo.upsert_chunks([
        DocumentChunk("chunk-a", "handbook", 1, "Nội dung khái niệm gốc", 0, heading="Chương I"),
        DocumentChunk("chunk-b", "handbook", 1, "Ghi chú gốc", 1, heading="Chương I"),
    ])
    return DatasetTreeService(repo)


def node(id, parent="root", **kw):
    return {"id": id, "parent_id": parent, "title": id, "kind": "section", "description": "", "chunk_id": None, "collapsed": False, **kw}


def test_part_heading_is_classified_and_survives_save(tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "parts.sqlite3")
        try:
            svc = await fixture(repo)
            await repo.upsert_chunks([
                DocumentChunk("part-source", "handbook", 1, "Nội dung phần tổng quan", 2, heading="PHẦN I"),
            ])
            tree = (await svc.get("handbook", 1))["tree"]
            part = next(item for item in tree["nodes"] if item["title"] == "PHẦN I")
            assert part["kind"] == "part"
            source = next(item for item in tree["nodes"] if item["chunk_id"] == "part-source")
            assert source["parent_id"] == part["id"]
            await svc.update("handbook", 1, tree)
            loaded = (await svc.get("handbook", 1))["tree"]
            assert next(item for item in loaded["nodes"] if item["id"] == part["id"])["kind"] == "part"
        finally:
            await repo.close()
    asyncio.run(run())


def test_persist_deep_tree_reparent_backup_and_keep_source_unchanged(tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "source.sqlite3")
        try:
            svc = await fixture(repo)
            tree = (await svc.get("handbook", 1))["tree"]
            source = await svc.chunk("handbook", 1, "chunk-a")
            for i in range(40):
                tree["nodes"].append(node(f"level-{i}", "root" if i == 0 else f"level-{i-1}", kind="part" if i == 0 else "section"))
            leaf = next(n for n in tree["nodes"] if n["chunk_id"] == "chunk-a")
            leaf["parent_id"] = "level-39"
            result = await svc.update("handbook", 1, tree)
            assert result["tree"]["revision"] == 1
            with pytest.raises(DatasetTreeConflict):
                await svc.update("handbook", 1, tree)
            assert await svc.chunk("handbook", 1, "chunk-a") == source
            await repo.backup_to(tmp_path / "backup.sqlite3")
        finally:
            await repo.close()
        restored = SQLiteKnowledgeRepository(tmp_path / "backup.sqlite3")
        try:
            tree = (await DatasetTreeService(restored).get("handbook", 1))["tree"]
            assert tree["revision"] == 1
            assert next(n for n in tree["nodes"] if n["id"] == "level-0")["kind"] == "part"
            assert next(n for n in tree["nodes"] if n["chunk_id"] == "chunk-a")["parent_id"] == "level-39"
            assert len(tree["nodes"]) == 44
            await restored.delete_document("handbook", 1)
            assert await restored.read_dataset_tree("handbook", 1) is None
        finally:
            await restored.close()
    asyncio.run(run())


@pytest.mark.parametrize("mutation", [
    lambda t: t["nodes"].append(node("loop", "loop")),
    lambda t: t["nodes"].extend([node("a", "b"), node("b", "a")]),
    lambda t: t["nodes"].append(node("orphan", "not-found")),
    lambda t: t["nodes"].append(deepcopy(t["nodes"][-1])),
    lambda t: t["nodes"].pop(),
    lambda t: t["nodes"].append(node("foreign", kind="chunk", chunk_id="other-doc-chunk")),
    lambda t: t["nodes"][0].update(parent_id=t["nodes"][-1]["id"]),
    lambda t: t["nodes"][0].update(title=""),
    lambda t: t.update(revision=True),
])
def test_invalid_tree_never_writes(mutation, tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "test.sqlite3")
        try:
            svc = await fixture(repo)
            tree = (await svc.get("handbook", 1))["tree"]
            mutation(tree)
            with pytest.raises(ValueError):
                await svc.update("handbook", 1, tree)
            assert await repo.read_dataset_tree("handbook", 1) is None
        finally:
            await repo.close()
    asyncio.run(run())


def test_reindex_conflict_reconcile_and_disabled_source_management(tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "test.sqlite3")
        try:
            svc = await fixture(repo)
            tree = (await svc.get("handbook", 1))["tree"]
            tree["nodes"].append(node("custom", description="Người dùng phân loại"))
            await svc.update("handbook", 1, tree)
            before = (await svc.get("handbook", 1))["tree"]
            await repo.upsert_chunks([DocumentChunk("chunk-c", "handbook", 1, "Nguồn bổ sung", 2)])
            with pytest.raises(DatasetTreeConflict):
                await svc.update("handbook", 1, before)
            after = (await svc.get("handbook", 1))["tree"]
            assert any(n["id"] == "custom" for n in after["nodes"])
            assert {n["chunk_id"] for n in after["nodes"] if n["chunk_id"]} == {"chunk-a", "chunk-b", "chunk-c"}
            await svc.update("handbook", 1, after)
            await repo.set_document_enabled("handbook", 1, False)
            assert (await svc.get("handbook", 1))["document"]["enabled"] is False
            assert not (await svc.chunk("handbook", 1, "chunk-a"))["metadata"]["retrieval_eligible"]
            with pytest.raises(DatasetTreeNotFound):
                await svc.chunk("other", 1, "chunk-a")
        finally:
            await repo.close()
    asyncio.run(run())


def test_node_content_is_materialized_for_rag_and_source_can_be_classified(tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "content.sqlite3")
        try:
            svc = await fixture(repo)
            tree = (await svc.get("handbook", 1))["tree"]
            tree["nodes"].append(node(
                "calculation", title="Tính thời gian", kind="formula",
                content="Dùng công thức $$s=v\\cdot t$$ trong điều kiện tiêu chuẩn.",
            ))
            source_node = next(item for item in tree["nodes"] if item["chunk_id"] == "chunk-a")
            source_node["kind"] = "concept"
            result = await svc.update("handbook", 1, tree)
            assert result["content_changed"] is True
            assert next(item for item in result["tree"]["nodes"] if item["chunk_id"] == "chunk-a")["kind"] == "concept"
            chunks = await repo.list_retrieval_chunks(include_ineligible=True)
            authored = [item for item in chunks if item.metadata.get("dataset_node_id") == "calculation"]
            assert len(authored) == 1
            assert "# Tính thời gian" in authored[0].text
            assert authored[0].metadata["retrieval_eligible"] is False  # waits for formula validation
            again = await svc.get("handbook", 1)
            assert again["source_count"] == 2
            assert not any(item["chunk_id"] == authored[0].id for item in again["tree"]["nodes"])
        finally:
            await repo.close()
    asyncio.run(run())


def test_knowledge_catalog_groups_documents_without_changing_document_trees(tmp_path):
    async def run():
        repo = SQLiteKnowledgeRepository(tmp_path / "catalog.sqlite3")
        try:
            svc = await fixture(repo)
            before = (await svc.get("handbook", 1))["tree"]
            catalog = await svc.get_catalog()
            assert catalog["revision"] == 0
            catalog["folders"] = [{"id": "manuals", "title": "SỔ TAY", "parent_id": None, "collapsed": False}]
            catalog["documents"][0]["parent_id"] = "manuals"
            saved = await svc.update_catalog(catalog)
            assert saved["revision"] == 1
            assert saved["documents"][0]["parent_id"] == "manuals"
            with pytest.raises(KnowledgeCatalogConflict):
                await svc.update_catalog(catalog)
            assert (await svc.get("handbook", 1))["tree"] == before
        finally:
            await repo.close()
    asyncio.run(run())


def test_rest_adapter_tree_errors_and_source_boundary(tmp_path):
    repo = SQLiteKnowledgeRepository(tmp_path / "api.sqlite3")
    svc = asyncio.run(fixture(repo))
    try:
        with TestClient(create_app(SimpleNamespace(dataset_trees=svc))) as client:
            catalog_path = "/api/v1/knowledge/catalog"
            catalog = client.get(catalog_path).json()
            catalog["folders"] = [{"id": "manuals", "title": "SỔ TAY", "parent_id": None, "collapsed": False}]
            catalog["documents"][0]["parent_id"] = "manuals"
            assert client.put(catalog_path, json=catalog).json()["revision"] == 1
            assert client.put(catalog_path, json=catalog).status_code == 409
            path = "/api/v1/documents/handbook/tree"
            assert client.get(path + "?version=0").status_code == 422
            assert client.get(path + "?version=2").status_code == 404
            original = client.get(path).json()["tree"]
            original["nodes"].append(node("custom"))
            assert client.put(path, json=original).json()["tree"]["revision"] == 1
            assert client.put(path, json=original).status_code == 409
            original["revision"] = 1
            original["nodes"].append(node("cycle", "cycle"))
            assert client.put(path, json=original).status_code == 422
            assert client.get(path + "/source/chunk-a").json()["chunk"]["text"] == "Nội dung khái niệm gốc"
            assert client.get("/api/v1/documents/other/tree/source/chunk-a").status_code == 404
    finally:
        asyncio.run(repo.close())
