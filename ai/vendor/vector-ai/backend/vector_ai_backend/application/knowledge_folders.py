"""Readable folder mirror of the knowledge catalog, including archive and trash.

SQLite remains the editable source of truth. Only directories bearing our exact
document marker are moved; unrelated files and original source paths are retained.
"""
from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import unicodedata
from uuid import uuid4


ROOTS = {"active": "kho_kien_thuc", "archived": "luu_tru_kien_thuc", "trashed": "thung_rac_kien_thuc"}


def folder_slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower().replace("đ", "d"))
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_")[:70] or "tai_lieu"
    if value in {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(10)), *(f"lpt{i}" for i in range(10))}:
        value = "_" + value
    return value


def _json_write(path: Path, value) -> None:
    _text_write(path, json.dumps(value, ensure_ascii=False, indent=2))


def _text_write(path: Path, value: str) -> None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f"Không thể đồng bộ vào tệp liên kết hoặc thư mục: {path}")
    if path.is_file() and path.read_text(encoding="utf-8") == value:
        return
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.replace(path)


class KnowledgeFolderStorage:
    def __init__(self, repository, data_dir: Path):
        self.repository = repository
        self.data_dir = data_dir.resolve()
        self.manifest = self.data_dir / "config" / "knowledge-folders.json"
        self.lock = asyncio.Lock()
        self.last_error: str | None = None

    def _path(self, relative: str) -> Path:
        path = self.data_dir / relative
        if path.is_absolute() and (not path.resolve().is_relative_to(self.data_dir) or path.resolve() == self.data_dir):
            raise ValueError("Đường dẫn kho nằm ngoài thư mục dữ liệu")
        # Reject links/junctions even if they happen to point inside the data root.
        for part in (path, *path.parents):
            if part == self.data_dir:
                break
            if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
                raise ValueError("Không đồng bộ kho qua liên kết thư mục")
        return path

    async def sync(self) -> dict:
        async with self.lock:
            documents = await self.repository.list_documents()
            catalog = await self.repository.read_knowledge_catalog() or {"folders": [], "documents": []}
            snapshots = []
            for doc in documents:
                source = await self.repository.dataset_source(doc["id"], doc["version"])
                saved = await self.repository.read_dataset_tree(doc["id"], doc["version"])
                chunks = await self.repository.get_chunks([chunk["id"] for chunk in source["chunks"]])
                snapshots.append((doc, saved, [asdict(chunk) for chunk in chunks]))
            result = await asyncio.to_thread(self._sync_files, catalog, snapshots)
            self.last_error = None
            return result

    async def sync_safely(self) -> dict:
        try:
            return await self.sync()
        except (OSError, ValueError) as exc:
            self.last_error = str(exc)
            return {"warning": f"Đã lưu dữ liệu; đồng bộ folder chưa hoàn tất: {exc}"}

    def _sync_files(self, catalog: dict, snapshots: list) -> dict:
        self.manifest.parent.mkdir(parents=True, exist_ok=True)
        previous = json.loads(self.manifest.read_text(encoding="utf-8")) if self.manifest.is_file() else {"documents": {}}
        entries = previous.get("documents", {})
        folders = {folder["id"]: folder for folder in catalog.get("folders", [])}
        paths, used = {}, set()

        def allocate(parent: str, title: str, identity: str) -> str:
            base = str(Path(parent) / folder_slug(title))
            candidate = base
            if candidate.casefold() in used:
                candidate += "_" + hashlib.sha256(identity.encode()).hexdigest()[:8]
            used.add(candidate.casefold())
            return candidate

        def folder_path(folder_id: str) -> str:
            if folder_id not in paths:
                folder = folders[folder_id]
                parent = folder_path(folder["parent_id"]) if folder.get("parent_id") in folders else ""
                paths[folder_id] = allocate(parent, folder["title"], "folder:" + folder_id)
            return paths[folder_id]

        for folder_id in sorted(folders):
            folder_path(folder_id)
        assignments = {(item["document_id"], item["document_version"]): item.get("parent_id") for item in catalog.get("documents", [])}
        result_entries, old_parents = {}, set()
        for state, root in ROOTS.items():
            self._path(root).mkdir(parents=True, exist_ok=True)
        for relative in paths.values():
            self._path(str(Path(ROOTS["active"]) / relative)).mkdir(parents=True, exist_ok=True)
        for doc, tree, chunks in sorted(snapshots, key=lambda item: (item[0]["id"], item[0]["version"])):
            key = json.dumps([doc["id"], doc["version"]])
            marker = {"document_id": doc["id"], "version": doc["version"]}
            state = doc.get("lifecycle", "active")
            parent = paths.get(assignments.get((doc["id"], doc["version"])), "")
            relative = str(Path(ROOTS[state]) / allocate(parent, doc["title"], key))
            target = self._path(relative)
            old = self._path(entries[key]["path"]) if key in entries else None

            def owned(path: Path) -> bool:
                file = path / ".vector-document.json"
                return file.is_file() and not file.is_symlink() and json.loads(file.read_text(encoding="utf-8")) == marker

            # Names can collide after transliteration, or with user-created folders.
            suffix = hashlib.sha256(key.encode()).hexdigest()[:8]
            index = 0
            while target.exists() and not owned(target):
                index += 1
                target = self._path(relative + "_" + suffix + (f"_{index}" if index > 1 else ""))
            target.parent.mkdir(parents=True, exist_ok=True)
            if old and old != target and old.is_dir() and owned(old) and not target.exists():
                old_parents.add(old.parent)
                old.rename(target)
            target.mkdir(parents=True, exist_ok=True)
            _json_write(target / ".vector-document.json", marker)
            _json_write(target / "tai_lieu.json", doc)
            _json_write(target / "cay_du_lieu.json", tree or {"nodes": [{"id": "root", "title": doc["title"], "kind": "document", "parent_id": None, "content": ""}]})
            _json_write(target / "doan_nguon.json", chunks)
            chunk_by_id = {chunk["id"]: chunk for chunk in chunks}
            parts = [f"# {doc['title']}"]
            if tree:
                children = {}
                for node in tree["nodes"]:
                    children.setdefault(node.get("parent_id"), []).append(node)
                stack = [(node, 1) for node in reversed(children.get(None, []))]
                while stack:
                    node, depth = stack.pop()
                    if node["id"] != "root":
                        parts.append(f"{'#' * min(6, depth)} {node['title']}")
                    if node.get("content"):
                        parts.append(node["content"])
                    if node.get("chunk_id") in chunk_by_id:
                        parts.append(chunk_by_id.pop(node["chunk_id"])["text"])
                    stack.extend((child, depth + 1) for child in reversed(children.get(node["id"], [])))
            parts.extend(chunk["text"] for chunk in chunk_by_id.values())
            _text_write(target / "noi_dung.md", "\n\n".join(parts) + "\n")
            source = Path(doc.get("source_uri") or "__missing__")
            if not source.is_file() and not source.is_absolute():
                source = Path(__file__).resolve().parents[3] / "knowledge_sources" / source.name
            if source.is_file():
                originals = self._path(str((target / "nguon").relative_to(self.data_dir)))
                originals.mkdir(exist_ok=True)
                destination = self._path(str((originals / source.name).relative_to(self.data_dir)))
                if not destination.exists() or destination.stat().st_mtime_ns != source.stat().st_mtime_ns or destination.stat().st_size != source.stat().st_size:
                    temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
                    shutil.copy2(source, temporary)
                    temporary.replace(destination)
            result_entries[key] = {**marker, "path": str(target.relative_to(self.data_dir)), "lifecycle": state}
            entries[key] = result_entries[key]
            # Journal each move so an interrupted sync can resume it.
            _json_write(self.manifest, {"documents": entries, "folder_paths": list(paths.values())})

        for relative in previous.get("folder_paths", []):
            if relative not in paths.values():
                old_parents.add(self._path(str(Path(ROOTS["active"]) / relative)))
        for parent in sorted(old_parents, key=lambda path: len(path.parts), reverse=True):
            while parent not in [self.data_dir / value for value in ROOTS.values()] and parent != self.data_dir:
                try:
                    self._path(str(parent.relative_to(self.data_dir))).rmdir()
                except OSError:
                    break
                parent = parent.parent
        _json_write(self.manifest, {"documents": result_entries, "folder_paths": list(paths.values())})
        _json_write(self._path(ROOTS["active"]) / "kho_kien_thuc.json", catalog)
        return {"root": str(self.data_dir / ROOTS["active"]), "archive_root": str(self.data_dir / ROOTS["archived"]), "trash_root": str(self.data_dir / ROOTS["trashed"]), "documents": list(result_entries.values())}

    async def open_folder(self, document_id: str | None = None, version: int = 1, state: str = "active") -> dict:
        result = await self.sync()
        if document_id:
            entry = next((entry for entry in result["documents"] if entry["document_id"] == document_id and entry["version"] == version), None)
            if entry is None:
                raise ValueError("Không tìm thấy thư mục tài liệu")
            path = self._path(entry["path"])
        else:
            path = self._path(ROOTS.get(state, ROOTS["active"]))
        if os.name == "nt":
            os.startfile(str(path))
        return {"path": str(path)}

    async def export_folder(self, destination: str, state: str = "active") -> dict:
        parent = Path(destination)
        if not parent.is_absolute() or not parent.is_dir():
            raise ValueError("Nhập đường dẫn tuyệt đối tới một thư mục có sẵn trên máy.")
        parent = parent.resolve()
        if parent.is_relative_to(self.data_dir):
            raise ValueError("Chọn thư mục đích bên ngoài vùng dữ liệu VECTOR AI.")
        if state not in ROOTS:
            raise ValueError("Kho cần sao chép không hợp lệ")
        await self.sync()
        async with self.lock:
            source = self._path(ROOTS[state])
            target = parent / f"{ROOTS[state]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}"

            def copy():
                for item in source.rglob("*"):
                    if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
                        raise ValueError("Folder có liên kết ngoài; hãy gỡ liên kết trước khi sao chép.")
                shutil.copytree(source, target)
            await asyncio.to_thread(copy)
            return {"path": str(target)}
