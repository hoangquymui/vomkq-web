"""Versioned, transport-independent backup and staged restore support."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import shutil
import sqlite3
import stat
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Protocol
from uuid import uuid4


BACKUP_FORMAT = "vector-ai-backup-v2"
MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024
MAX_BACKUP_ENTRIES = 200_000
STATE_FILES = ("vector_ai.sqlite3", "workflow_checkpoints.sqlite3", "legacy_state.sqlite3")
DATA_FOLDERS = ("documents", "config")


class SnapshotDatabase(Protocol):
    async def backup_to(self, target: str | Path) -> None: ...


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_relative(name: str) -> Path:
    pure = PurePosixPath(name)
    if (
        not name or "\\" in name or ":" in name or "\x00" in name
        or pure.is_absolute() or ".." in pure.parts or not pure.parts
        or str(pure) != name or PureWindowsPath(name).drive
        or any(part.endswith((".", " ")) or PureWindowsPath(part).is_reserved() for part in pure.parts)
    ):
        raise ValueError(f"Đường dẫn không an toàn trong backup: {name}")
    return Path(*pure.parts)


def _manifest_files(manifest: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
        raise ValueError("Đây không phải backup VECTOR AI v2")
    if not isinstance(manifest.get("backup_id"), str):
        raise ValueError("Backup thiếu ID")
    declared = manifest.get("files")
    if not isinstance(declared, list) or len(declared) > MAX_BACKUP_ENTRIES:
        raise ValueError("Danh sách tệp trong manifest không hợp lệ")
    result = {}
    seen = set()
    for item in declared:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("Metadata tệp không hợp lệ")
        name = item["path"]
        relative = _safe_relative(name)
        if relative.parts[0] not in {"state", "documents", "config"}:
            raise ValueError(f"Thư mục không thuộc backup: {name}")
        if relative.parts[0] == "state" and name not in {f"state/{p}" for p in STATE_FILES}:
            raise ValueError(f"Tệp state không được hỗ trợ: {name}")
        if name.casefold() in seen:
            raise ValueError("Backup chứa đường dẫn trùng nhau")
        seen.add(name.casefold())
        if type(item.get("size")) is not int or not 0 <= item["size"] <= MAX_BACKUP_BYTES:
            raise ValueError("Kích thước tệp không hợp lệ")
        if not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
            raise ValueError("SHA256 không hợp lệ")
        result[name] = item
    if not {f"state/{p}" for p in STATE_FILES}.issubset(result):
        raise ValueError("Backup thiếu database bắt buộc")
    if sum(item["size"] for item in result.values()) > MAX_BACKUP_BYTES:
        raise ValueError("Backup vượt quá giới hạn 2 GB")
    return result


def _check_databases(stage: Path) -> None:
    required = {
        "vector_ai.sqlite3": {"documents", "document_chunks", "formulas", "embedding_profiles", "index_generations"},
        "workflow_checkpoints.sqlite3": {"workflow_checkpoints"},
        "legacy_state.sqlite3": {"legacy_imports", "app_state"},
    }
    for name, tables in required.items():
        connection = sqlite3.connect((stage / "state" / name).resolve().as_uri() + "?mode=ro", uri=True)
        try:
            connection.execute("PRAGMA trusted_schema=OFF")
            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError(f"Database bị hỏng: {name}")
            actual = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not tables.issubset(actual):
                raise ValueError(f"Database thiếu bảng bắt buộc: {name}")
        finally:
            connection.close()


class BackupService:
    """Export application data and validate restores without touching live DBs."""

    def __init__(
        self,
        *,
        data_dir: Path,
        repository: SnapshotDatabase,
        checkpoints: SnapshotDatabase,
        legacy: SnapshotDatabase,
    ) -> None:
        self._data_dir = data_dir
        self._repository = repository
        self._checkpoints = checkpoints
        self._legacy = legacy
        self._exports = data_dir / "backups"
        self._exports.mkdir(parents=True, exist_ok=True)

    async def export(self) -> Path:
        backup_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
        work_root = self._data_dir / "work"
        work_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="backup-v2-", dir=work_root) as raw:
            stage = Path(raw)
            state_dir = stage / "state"
            await self._repository.backup_to(state_dir / "vector_ai.sqlite3")
            await self._checkpoints.backup_to(state_dir / "workflow_checkpoints.sqlite3")
            await self._legacy.backup_to(state_dir / "legacy_state.sqlite3")
            await asyncio.to_thread(self._copy_optional_tree, self._data_dir / "documents", stage / "documents")
            await asyncio.to_thread(self._copy_optional_tree, self._data_dir / "config", stage / "config")

            files: list[dict[str, Any]] = []
            for path in sorted(item for item in stage.rglob("*") if item.is_file()):
                relative = path.relative_to(stage).as_posix()
                files.append({"path": relative, "size": path.stat().st_size, "sha256": _sha256(path)})
            manifest = {
                "format": BACKUP_FORMAT,
                "backup_id": backup_id,
                "created_at": datetime.now(UTC).isoformat(),
                "data_root": str(self._data_dir.resolve()),
                "includes": ["application_state", "workflow_checkpoints", "legacy_state", "documents", "config"],
                "excludes": ["ollama_models", "qdrant_index", "temporary_work"],
                "files": files,
            }
            (stage / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            target = self._exports / f"vector-ai-backup-{backup_id}.zip"
            await asyncio.to_thread(self._write_zip, stage, target)
        return target

    async def stage_restore(self, archive: Path, frontend_restore_id: str | None = None) -> dict[str, Any]:
        if frontend_restore_id is not None and not re.fullmatch(r"[A-Za-z0-9-]{1,80}", frontend_restore_id):
            raise ValueError("Frontend restore ID không hợp lệ")
        restore_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
        stage = self._data_dir / "restore_pending"
        incoming = self._data_dir / "work" / f"restore-{restore_id}"
        incoming.mkdir(parents=True, exist_ok=False)
        try:
            manifest = await asyncio.to_thread(self._extract_and_validate, archive, incoming)
            if stage.exists():
                raise ValueError("Đã có một backup đang chờ khôi phục. Khởi động lại app trước khi nhập bản khác.")
            incoming.replace(stage)
            marker = {
                "restore_id": restore_id,
                "staged_at": datetime.now(UTC).isoformat(),
                "backup_id": manifest["backup_id"],
                "apply_on_restart": True,
                "frontend_restore_id": frontend_restore_id,
            }
            (stage / "restore_request.json").write_text(
                json.dumps(marker, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return marker
        except BaseException:
            shutil.rmtree(incoming, ignore_errors=True)
            raise

    async def restore_status(self) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            result = {}
            for key, path in (
                ("pending", self._data_dir / "restore_pending" / "restore_request.json"),
                ("result", self._data_dir / "restore_result.json"),
            ):
                result[key] = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
            return result
        return await asyncio.to_thread(read)

    @staticmethod
    def _copy_optional_tree(source: Path, target: Path) -> None:
        if source.is_dir():
            for path in [source, *source.rglob("*")]:
                if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
                    raise ValueError(f"Không sao lưu liên kết thư mục/tệp: {path}")
            shutil.copytree(source, target)

    @staticmethod
    def _write_zip(stage: Path, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(item for item in stage.rglob("*") if item.is_file()):
                archive.write(path, path.relative_to(stage).as_posix())

    @staticmethod
    def _extract_and_validate(archive_path: Path, target: Path) -> dict[str, Any]:
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_BACKUP_ENTRIES:
                raise ValueError("Backup có quá nhiều tệp")
            if sum(max(0, item.file_size) for item in entries) > MAX_BACKUP_BYTES:
                raise ValueError("Backup vượt quá giới hạn 2 GB")
            names = {item.filename for item in entries if not item.is_dir()}
            if len(names) != sum(not item.is_dir() for item in entries):
                raise ValueError("ZIP có tệp trùng tên")
            for entry in entries:
                _safe_relative(entry.filename.rstrip("/"))
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("ZIP có symbolic link")
            if "manifest.json" not in names:
                raise ValueError("Không tìm thấy manifest.json")
            if archive.getinfo("manifest.json").file_size > 16 * 1024 * 1024:
                raise ValueError("Manifest quá lớn")
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            expected = _manifest_files(manifest)
            if names != {*expected, "manifest.json"}:
                raise ValueError("Danh sách tệp ZIP không khớp manifest")
            for relative_name, item in expected.items():
                relative = _safe_relative(relative_name)
                if relative_name not in names:
                    raise ValueError(f"Backup thiếu tệp: {relative_name}")
                if archive.getinfo(relative_name).file_size != item["size"]:
                    raise ValueError(f"Kích thước ZIP không khớp: {relative_name}")
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(relative_name) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
                if destination.stat().st_size != int(item.get("size", -1)):
                    raise ValueError(f"Kích thước không khớp: {relative_name}")
                if _sha256(destination) != str(item.get("sha256", "")):
                    raise ValueError(f"Checksum không khớp: {relative_name}")
            (target / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        _check_databases(target)
        return manifest


def apply_pending_restore(data_dir: Path) -> dict[str, Any] | None:
    """Apply a validated staged restore before live database connections open."""

    stage = data_dir / "restore_pending"
    request_path = stage / "restore_request.json"
    manifest_path = stage / "manifest.json"
    if not request_path.is_file() or not manifest_path.is_file():
        return None
    request = json.loads(request_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = _manifest_files(manifest)
    for name, item in expected.items():
        path = stage / _safe_relative(name)
        if path.is_symlink() or not path.is_file() or path.stat().st_size != item["size"] or _sha256(path) != item["sha256"]:
            raise ValueError(f"Dữ liệu khôi phục đã bị thay đổi: {name}")
        if not path.resolve().is_relative_to(stage.resolve()):
            raise ValueError("Dữ liệu khôi phục nằm ngoài thư mục staging")
    _check_databases(stage)
    restore_id = str(request.get("restore_id", ""))
    if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", restore_id):
        raise ValueError("Restore ID không hợp lệ")

    archive_dir = data_dir / "restore_archives" / f"{restore_id}-{uuid4().hex[:8]}"
    archive_dir.mkdir(parents=True, exist_ok=False)
    targets = [*STATE_FILES, *DATA_FOLDERS]
    targets.extend(f"{name}{suffix}" for name in STATE_FILES for suffix in ("-wal", "-shm"))
    previous: list[str] = []
    for name in targets:
        path = data_dir / name
        if path.exists():
            if path.is_dir():
                shutil.copytree(path, archive_dir / name)
            else:
                shutil.copy2(path, archive_dir / name)
            previous.append(name)
    (archive_dir / "recovery.json").write_text(json.dumps({"previous": previous}), encoding="utf-8")
    try:
        for name in STATE_FILES:
            destination = data_dir / name
            # Preserve the old WAL above, then remove it before replacing its DB.
            Path(f"{destination}-wal").unlink(missing_ok=True)
            Path(f"{destination}-shm").unlink(missing_ok=True)
            temporary = data_dir / f"{name}.restore-new"
            shutil.copy2(stage / "state" / name, temporary)
            temporary.replace(destination)
        for folder in DATA_FOLDERS:
            destination = data_dir / folder
            if destination.is_dir():
                shutil.rmtree(destination)
            if (stage / folder).is_dir():
                shutil.copytree(stage / folder, destination)
        _prepare_restored_state(data_dir, str(manifest.get("data_root", "")))
    except BaseException:
        for name in targets:
            path = data_dir / name
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
            if name in previous:
                if (archive_dir / name).is_dir():
                    shutil.copytree(archive_dir / name, path)
                else:
                    shutil.copy2(archive_dir / name, path)
        raise
    shutil.rmtree(stage)
    result = {**request, "applied": True, "previous_state": str(archive_dir), "reindex_required": True}
    (data_dir / "restore_result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def _prepare_restored_state(data_dir: Path, original_root: str) -> None:
    """Rebind owned source paths; absent vector/work assets must not look active."""
    old_root = original_root.replace("\\", "/").rstrip("/")

    def rebase(value: Any) -> Any:
        if isinstance(value, str):
            normalized = value.replace("\\", "/")
            if old_root and normalized.casefold().startswith(old_root.casefold() + "/"):
                return str(data_dir / _safe_relative(normalized[len(old_root) + 1:]))
        if isinstance(value, dict):
            return {key: rebase(item) for key, item in value.items()}
        if isinstance(value, list):
            return [rebase(item) for item in value]
        return value

    connection = sqlite3.connect(data_dir / "vector_ai.sqlite3")
    try:
        with connection:
            connection.execute("UPDATE index_generations SET active=0, status='requires_rebuild'")
            for doc_id, version, uri in connection.execute("SELECT id,version,source_uri FROM documents").fetchall():
                connection.execute("UPDATE documents SET source_uri=? WHERE id=? AND version=?", (rebase(uri), doc_id, version))
            for formula_id, version, source in connection.execute("SELECT id,version,source_json FROM formulas").fetchall():
                connection.execute("UPDATE formulas SET source_json=? WHERE id=? AND version=?", (json.dumps(rebase(json.loads(source)), ensure_ascii=False), formula_id, version))
    finally:
        connection.close()
    connection = sqlite3.connect(data_dir / "workflow_checkpoints.sqlite3")
    try:
        with connection:
            for namespace, run_id, raw in connection.execute("SELECT namespace,run_id,payload_json FROM workflow_checkpoints").fetchall():
                value = rebase(json.loads(raw))
                if namespace == "document-ingestion-v1":
                    # Backup excludes temporary OCR pages and vectors. Resume
                    # safely from the source instead of claiming they still exist.
                    source = value.get("checkpoint", {})
                    value["checkpoint"] = {key: source[key] for key in ("source_path", "scope_kind", "owner_id", "embedding_profile_id") if key in source}
                    value["completed_stages"] = []
                    value["stage"] = "received"
                connection.execute("UPDATE workflow_checkpoints SET payload_json=? WHERE namespace=? AND run_id=?", (json.dumps(value, ensure_ascii=False), namespace, run_id))
    finally:
        connection.close()
