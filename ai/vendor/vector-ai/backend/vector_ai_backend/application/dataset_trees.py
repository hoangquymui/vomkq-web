"""Editable document → chapter → section → child tree (not a runtime graph).

Labels/notes organise the dataset; source text and formula approval remain owned
by ingestion/validation. Moving a branch must never silently rewrite RAG text.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any, Mapping

from ..domain.dataset_tree import DatasetNode, DatasetTree, DatasetTreeStore, NODE_KINDS, source_revision


class DatasetTreeNotFound(LookupError):
    pass


class DatasetTreeConflict(RuntimeError):
    pass


class KnowledgeCatalogConflict(RuntimeError):
    pass


def _catalog_payload(raw: Mapping[str, Any], documents: list[Mapping[str, Any]]) -> dict[str, Any]:
    folders_raw = raw.get("folders", [])
    assignments_raw = raw.get("documents", [])
    if not isinstance(folders_raw, list) or len(folders_raw) > 5000:
        raise ValueError("Kho có tối đa 5.000 thư mục.")
    folders: list[dict[str, Any]] = []
    for item in folders_raw:
        if not isinstance(item, dict):
            raise ValueError("Thư mục kho không hợp lệ.")
        folder_id, title, parent_id = item.get("id"), item.get("title"), item.get("parent_id")
        if not isinstance(folder_id, str) or not folder_id.strip() or len(folder_id) > 120:
            raise ValueError("ID thư mục không hợp lệ.")
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ValueError("Tên thư mục phải có từ 1 đến 200 ký tự.")
        if parent_id is not None and (not isinstance(parent_id, str) or not parent_id or len(parent_id) > 120):
            raise ValueError("Thư mục cha không hợp lệ.")
        if not isinstance(item.get("collapsed", False), bool):
            raise ValueError("Trạng thái thu gọn thư mục không hợp lệ.")
        folders.append({
            "id": folder_id, "title": title.strip(), "parent_id": parent_id,
            "collapsed": item.get("collapsed", False),
        })
    by_id = {item["id"]: item for item in folders}
    if len(by_id) != len(folders):
        raise ValueError("ID thư mục bị trùng.")
    for folder in folders:
        if folder["parent_id"] is not None and folder["parent_id"] not in by_id:
            raise ValueError("Không tìm thấy thư mục cha.")
        seen: set[str] = set()
        current = folder
        while current["parent_id"] is not None:
            if current["id"] in seen:
                raise ValueError("Không thể đặt thư mục vào chính nó hoặc thư mục con của nó.")
            seen.add(current["id"])
            if len(seen) > 64:
                raise ValueError("Cấu trúc thư mục vượt quá 64 cấp.")
            current = by_id[current["parent_id"]]
    if not isinstance(assignments_raw, list) or len(assignments_raw) > 25000:
        raise ValueError("Danh sách tài liệu trong kho không hợp lệ.")
    live = {(str(item["id"]), int(item["version"])) for item in documents}
    assignments: dict[tuple[str, int], str | None] = {}
    for item in assignments_raw:
        if not isinstance(item, dict):
            raise ValueError("Vị trí tài liệu không hợp lệ.")
        document_id, version, parent_id = item.get("document_id"), item.get("document_version"), item.get("parent_id")
        if not isinstance(document_id, str) or not document_id or isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("Tham chiếu tài liệu không hợp lệ.")
        key = (document_id, version)
        if key in assignments:
            raise ValueError("Một tài liệu xuất hiện nhiều lần trong kho.")
        if parent_id is not None and parent_id not in by_id:
            raise ValueError("Thư mục chứa tài liệu không tồn tại.")
        if key in live:
            assignments[key] = parent_id
    return {
        "folders": folders,
        "documents": [
            {"document_id": document_id, "document_version": version, "parent_id": assignments.get((document_id, version))}
            for document_id, version in sorted(live)
        ],
    }


def _id(prefix: str, value: str) -> str:
    return prefix + sha256(value.encode("utf-8")).hexdigest()[:24]


def _nodes(raw: Any) -> list[DatasetNode]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= 25000:
        raise ValueError("Cây phải có từ 1 đến 25.000 mục.")
    result: list[DatasetNode] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Mục dữ liệu không hợp lệ.")
        for key, limit in (("id", 120), ("title", 200), ("description", 4000), ("content", 120000)):
            value = item.get(key, "")
            if not isinstance(value, str) or len(value) > limit or (key != "description" and not value.strip()):
                if key == "content" and isinstance(value, str) and not value:
                    continue
                raise ValueError(f"Trường {key} không hợp lệ (tối đa {limit} ký tự).")
        for key in ("parent_id", "chunk_id"):
            value = item.get(key)
            if value is not None and (not isinstance(value, str) or not value or len(value) > 200):
                raise ValueError(f"Trường {key} không hợp lệ.")
        if item.get("kind") not in NODE_KINDS or not isinstance(item.get("collapsed", False), bool):
            raise ValueError("Loại mục hoặc trạng thái thu gọn không hợp lệ.")
        result.append(DatasetNode(
            id=item["id"], parent_id=item.get("parent_id"), title=item["title"].strip(),
            kind=item["kind"], description=item.get("description", ""), content=item.get("content", ""),
            chunk_id=item.get("chunk_id"), collapsed=item.get("collapsed", False),
        ))
    if sum(len(node.content) for node in result) > 2_000_000:
        raise ValueError("Tổng nội dung nhập trực tiếp trên cây vượt 2.000.000 ký tự.")
    by_id = {n.id: n for n in result}
    if len(by_id) != len(result):
        raise ValueError("ID mục bị trùng.")
    roots = [n for n in result if n.parent_id is None]
    if len(roots) != 1 or roots[0].id != "root" or roots[0].kind != "document" or roots[0].chunk_id:
        raise ValueError("Cây phải có đúng một gốc tài liệu.")
    # Iterative traversal: no Python recursion limit for nested datasets.
    for node in result:
        if node.id != "root" and node.kind == "document":
            raise ValueError("Chỉ mục gốc được mang loại tài liệu.")
        if node.kind == "chunk" and not node.chunk_id:
            raise ValueError("Loại đoạn nguồn chỉ dùng cho mục liên kết với nguồn có thật.")
        if node.chunk_id and node.kind == "document":
            raise ValueError("Đoạn nguồn không thể mang loại tài liệu.")
        seen: set[str] = set()
        current = node
        while current.parent_id is not None:
            if current.id in seen:
                raise ValueError("Không thể nối mục vào chính nó hoặc mục con của nó.")
            seen.add(current.id)
            if len(seen) > 128:
                raise ValueError("Cây vượt quá giới hạn an toàn 128 cấp.")
            if current.parent_id not in by_id:
                raise ValueError("Không tìm thấy mục cha.")
            current = by_id[current.parent_id]
    return result


class DatasetTreeService:
    def __init__(self, store: DatasetTreeStore, folder_storage=None):
        self.store = store
        self.folder_storage = folder_storage

    async def get_catalog(self) -> dict[str, Any]:
        documents = await self.store.list_documents()
        saved = await self.store.read_knowledge_catalog()
        catalog = _catalog_payload(saved or {}, documents)
        return {
            **catalog, "revision": int((saved or {}).get("revision", 0)),
            "updated_at": (saved or {}).get("updated_at"),
        }

    async def update_catalog(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ValueError("Revision kho không hợp lệ.")
        documents = await self.store.list_documents()
        catalog = _catalog_payload(payload, documents)
        if not await self.store.write_knowledge_catalog(catalog, expected_revision=revision):
            raise KnowledgeCatalogConflict("Thư mục kho đã thay đổi ở phiên khác. Hãy tải lại trước khi sửa tiếp.")
        storage = await self.folder_storage.sync_safely() if self.folder_storage else None
        return {**catalog, "revision": revision + 1, "storage": storage}

    async def _source(self, document_id: str, version: int) -> Mapping[str, Any]:
        source = await self.store.dataset_source(document_id, version)
        if source is None:
            raise DatasetTreeNotFound("Không tìm thấy phiên bản tài liệu.")
        return source

    async def get(self, document_id: str, version: int) -> dict[str, Any]:
        source = await self._source(document_id, version)
        saved = await self.store.read_dataset_tree(document_id, version)
        nodes = _nodes(saved["nodes"]) if saved else [DatasetNode("root", None, source["document"]["title"][:200], "document")]
        chunks = source["chunks"]
        live_ids = {c["id"] for c in chunks}
        # Reindex can replace chunk IDs: remove only stale source links, promote
        # their children, and retain every user-authored heading and note.
        stale = {n.id: n.parent_id for n in nodes if n.chunk_id and n.chunk_id not in live_ids}
        for node in nodes:
            while node.parent_id in stale:
                node.parent_id = stale[node.parent_id]
        nodes = [n for n in nodes if n.id not in stale]
        linked = {n.chunk_id for n in nodes if n.chunk_id}
        by_id = {n.id: n for n in nodes}
        for c in chunks:
            if c["id"] in linked:
                continue
            # Use only actual extracted headings; don't invent chapter contents.
            heading = (c.get("heading") or "").strip()
            group_title = heading or (f"Trang {c['page']}" if c.get("page") else f"Đoạn nguồn {int(c['ordinal']) // 25 + 1}")
            group_id = _id("group-", group_title)
            if group_id not in by_id:
                kind = "part" if heading.casefold().startswith("phần ") else "chapter" if heading.casefold().startswith("chương ") else "section" if heading.casefold().startswith("mục ") else "group"
                group = DatasetNode(group_id, "root", group_title[:200], kind, collapsed=True)
                nodes.append(group)
                by_id[group_id] = group
            node_id = _id("source-", c["id"])
            if node_id in by_id:
                # Never overwrite an unrelated user node with a generated ID.
                node_id = _id("source-", c["id"] + source_revision(chunks))
            node = DatasetNode(node_id, group_id, f"Đoạn {int(c['ordinal']) + 1} · {c.get('preview', '').strip()[:130]}", "chunk", chunk_id=c["id"])
            nodes.append(node)
            by_id[node_id] = node
        tree = DatasetTree(document_id, version, saved["revision"] if saved else 0, source_revision(chunks), nodes, saved.get("updated_at") if saved else None)
        return {"tree": asdict(tree), "document": source["document"], "source_count": len(chunks)}

    async def update(self, document_id: str, version: int, payload: Mapping[str, Any]) -> dict[str, Any]:
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ValueError("Revision không hợp lệ.")
        source = await self._source(document_id, version)
        if source["document"].get("lifecycle", "active") != "active":
            raise ValueError("Khôi phục tài liệu từ Lưu trữ hoặc Thùng rác trước khi chỉnh sửa.")
        if payload.get("source_revision") != source_revision(source["chunks"]):
            raise DatasetTreeConflict("Nguồn vừa được nhập hoặc tạo lại chỉ mục. Hãy tải lại cây trước khi sửa tiếp.")
        nodes = _nodes(payload.get("nodes"))
        saved = await self.store.read_dataset_tree(document_id, version)
        previous_content = {
            node.id: node.content
            for node in (_nodes(saved["nodes"]) if saved else [])
            if node.content.strip()
        }
        next_content = {node.id: node.content for node in nodes if node.content.strip()}
        content_changed = previous_content != next_content
        links = [n.chunk_id for n in nodes if n.chunk_id]
        expected_links = {c["id"] for c in source["chunks"]}
        if len(links) != len(set(links)) or set(links) != expected_links:
            raise ValueError("Phải giữ mỗi đoạn nguồn đúng một lần; chỉ di chuyển liên kết, không xóa hoặc thêm nguồn ngoài tài liệu.")
        tree = DatasetTree(document_id, version, revision + 1, payload["source_revision"], nodes, datetime.now(UTC).isoformat())
        if not await self.store.write_dataset_tree(tree, expected_revision=revision):
            raise DatasetTreeConflict("Cây hoặc nguồn đã thay đổi ở phiên khác. Hãy tải lại; bản chỉnh sửa chưa bị ghi đè.")
        storage = await self.folder_storage.sync_safely() if self.folder_storage else None
        return {
            "tree": asdict(tree), "document": source["document"],
            "source_count": len(links), "content_changed": content_changed, "storage": storage,
        }

    async def chunk(self, document_id: str, version: int, chunk_id: str) -> Mapping[str, Any]:
        result = await self.store.dataset_chunk(document_id, version, chunk_id)
        if result is None:
            raise DatasetTreeNotFound("Đoạn nguồn không thuộc tài liệu này hoặc đã được thay thế.")
        return result
