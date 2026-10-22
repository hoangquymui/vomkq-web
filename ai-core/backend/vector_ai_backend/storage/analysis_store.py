"""Durable analysis tables within the application's existing backed-up DB."""
from __future__ import annotations

import asyncio
import copy
import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..domain.analysis import AnalysisConflict, AnalysisNotFound, canonical_json, geometry, text, timestamp, validate_report_sources, validate_snapshot

ANALYSIS_SCHEMA_VERSION = 2


def now() -> str:
    return datetime.now(UTC).isoformat()


def duration_seconds(created_at: str, updated_at: str) -> float:
    """Elapsed wall-clock seconds from backend-owned timestamps, not token time."""
    start = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    end = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    return round(max(0.0, (end - start).total_seconds()), 3)


class AnalysisStore:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        try:
            self._initialize()
        except BaseException:
            self._connection.close()
            raise

    def _initialize(self) -> None:
        with self._lock:
            self._connection.execute("PRAGMA foreign_keys=ON")
            row = self._connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='analysis_metadata'").fetchone()
            version = 0
            if row:
                found = self._connection.execute("SELECT value FROM analysis_metadata WHERE key='schema_version'").fetchone()
                version = int(found[0]) if found else 0
            if version > ANALYSIS_SCHEMA_VERSION:
                raise ValueError("Analysis database có schema mới hơn runtime")
            if version < ANALYSIS_SCHEMA_VERSION:
                if self.path != ":memory:":
                    original = Path(self.path)
                    folder = original.parent / "backups" / "analysis-migrations"
                    folder.mkdir(parents=True, exist_ok=True)
                    target = sqlite3.connect(folder / f"before-v{ANALYSIS_SCHEMA_VERSION}-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')}.sqlite3")
                    try:
                        self._connection.backup(target)
                    finally:
                        target.close()
                try:
                    self._connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE IF NOT EXISTS analysis_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS analysis_snapshots(
                        id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS analysis_runs(
                        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, snapshot_id TEXT,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
                        result_json TEXT, error TEXT, metadata_json TEXT NOT NULL,
                        FOREIGN KEY(snapshot_id) REFERENCES analysis_snapshots(id));
                    CREATE INDEX IF NOT EXISTS analysis_runs_created ON analysis_runs(created_at DESC);
                    CREATE TABLE IF NOT EXISTS analysis_reports(
                        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, parent_id TEXT,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS analysis_evidence(
                        owner_type TEXT NOT NULL CHECK(owner_type IN ('snapshot','run')),
                        owner_id TEXT NOT NULL, ref_id TEXT NOT NULL, source_id TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        PRIMARY KEY(owner_type,owner_id,ref_id));
                    CREATE INDEX IF NOT EXISTS analysis_evidence_source
                        ON analysis_evidence(source_id,owner_type,owner_id);
                    """)
                    # Existing JSON stays unchanged. Evidence gains independent
                    # durable rows within the same transaction and backup domain.
                    for row in self._connection.execute("SELECT id,payload_json FROM analysis_snapshots").fetchall():
                        self._save_evidence_sync("snapshot", row["id"], json.loads(row["payload_json"]).get("evidence", []))
                    for row in self._connection.execute("SELECT id,result_json FROM analysis_runs WHERE result_json IS NOT NULL").fetchall():
                        self._save_evidence_sync("run", row["id"], json.loads(row["result_json"]).get("citations", []))
                    self._connection.execute("INSERT OR REPLACE INTO analysis_metadata(key,value) VALUES('schema_version',?)", (str(ANALYSIS_SCHEMA_VERSION),))
                    self._connection.commit()
                except BaseException:
                    self._connection.rollback()
                    raise
            # Runs are never resumed automatically after process restart.
            with self._connection:
                self._connection.execute("UPDATE analysis_runs SET status='interrupted',updated_at=?,error=? WHERE status IN ('queued','running')",
                    (now(), "Backend khởi động lại trước khi lượt phân tích hoàn tất"))

    async def close(self) -> None:
        await asyncio.to_thread(self._connection.close)

    def _save_evidence_sync(self, owner_type: str, owner_id: str, refs: list[dict[str, Any]]) -> None:
        """Caller owns lock/transaction. Reference identities are immutable."""
        for ref in refs:
            ref_id = text(ref.get("id"), "evidence.id", limit=512)
            source_id = text(ref.get("sourceId"), "evidence.sourceId", limit=256)
            payload = canonical_json(ref)
            existing = self._connection.execute("SELECT payload_json FROM analysis_evidence WHERE owner_type=? AND owner_id=? AND ref_id=?",
                (owner_type, owner_id, ref_id)).fetchone()
            if existing and existing[0] != payload:
                raise AnalysisConflict("Evidence bất biến; hãy tạo snapshot/run mới")
            self._connection.execute("INSERT OR IGNORE INTO analysis_evidence VALUES(?,?,?,?,?)",
                (owner_type, owner_id, ref_id, source_id, payload))

    async def save_snapshot(self, raw: Any) -> dict[str, Any]:
        snapshot = validate_snapshot(raw)
        def write():
            with self._lock, self._connection:
                previous = self._connection.execute("SELECT content_hash FROM analysis_snapshots WHERE id=?", (snapshot["id"],)).fetchone()
                if previous and previous[0] != snapshot["contentHash"]:
                    raise AnalysisConflict("Snapshot bất biến; hãy tạo ID mới khi dữ liệu thay đổi")
                self._connection.execute("INSERT OR IGNORE INTO analysis_snapshots VALUES(?,?,?,?)",
                    (snapshot["id"], snapshot["contentHash"], snapshot["createdAt"], canonical_json(snapshot)))
                self._save_evidence_sync("snapshot", snapshot["id"], snapshot["evidence"])
            return snapshot
        return await asyncio.to_thread(write)

    async def get_snapshot(self, snapshot_id: str) -> dict[str, Any]:
        def read():
            with self._lock:
                row = self._connection.execute("SELECT payload_json FROM analysis_snapshots WHERE id=?", (snapshot_id,)).fetchone()
                if not row:
                    raise AnalysisNotFound(snapshot_id)
                return json.loads(row[0])
        return await asyncio.to_thread(read)

    async def create_run(self, request) -> None:
        def write():
            with self._lock, self._connection:
                try:
                    self._connection.execute("INSERT INTO analysis_runs VALUES(?,?,?,?,?,'queued',NULL,NULL,?)",
                        (request.run_id, request.workflow_id, request.snapshot_id, now(), now(), canonical_json({
                            "model": request.model, "mode": request.mode.value, "documentIds": list(request.document_ids),
                            "reportIds": list(request.report_ids), "workflowVersion": 1,
                        })))
                except sqlite3.IntegrityError as exc:
                    raise AnalysisConflict("Run ID đã tồn tại hoặc snapshot không tồn tại") from exc
        await asyncio.to_thread(write)

    async def transition(self, run_id: str, status: str, error: str | None = None) -> None:
        if status not in {"queued", "running", "completed", "cancelled", "failed", "interrupted"}:
            raise ValueError("Trạng thái run không hợp lệ")
        def write():
            with self._lock, self._connection:
                self._connection.execute("UPDATE analysis_runs SET status=?,error=?,updated_at=? WHERE id=? AND status IN ('queued','running')",
                    (status, error, now(), run_id))
        await asyncio.to_thread(write)

    async def complete(self, run_id: str, result: dict[str, Any]) -> None:
        def write():
            with self._lock, self._connection:
                row = self._connection.execute("SELECT created_at,status,metadata_json FROM analysis_runs WHERE id=?", (run_id,)).fetchone()
                if row is None or row["status"] not in {"queued", "running"}:
                    raise AnalysisConflict("Run không còn đang xử lý")
                completed_at = now()
                metadata = json.loads(row["metadata_json"])
                usage = result.setdefault("usage", {})
                usage.update(durationSeconds=duration_seconds(row["created_at"], completed_at), workflowVersion=1, validatorVersion=1)
                if metadata.get("modelDigest"):
                    usage["modelDigest"] = metadata["modelDigest"]
                self._save_evidence_sync("run", run_id, result["citations"])
                changed = self._connection.execute("UPDATE analysis_runs SET status='completed',result_json=?,updated_at=?,error=NULL WHERE id=? AND status IN ('queued','running')",
                    (canonical_json(result), completed_at, run_id)).rowcount
                if not changed:
                    raise AnalysisConflict("Run không còn đang xử lý")
        await asyncio.to_thread(write)

    async def record_model_revision(self, run_id: str, digest: str | None) -> bool:
        if digest is None:
            return False
        text(digest, "modelDigest", limit=256)
        def write():
            with self._lock, self._connection:
                row = self._connection.execute("SELECT metadata_json FROM analysis_runs WHERE id=? AND status IN ('queued','running')", (run_id,)).fetchone()
                if row is None:
                    return False
                metadata = json.loads(row[0])
                metadata["modelDigest"] = digest
                self._connection.execute("UPDATE analysis_runs SET metadata_json=? WHERE id=?", (canonical_json(metadata), run_id))
                return True
        return await asyncio.to_thread(write)

    @staticmethod
    def _run(row, *, include_result: bool = True) -> dict[str, Any]:
        return {"runId": row["id"], "workflowId": row["workflow_id"], "snapshotId": row["snapshot_id"],
            "createdAt": row["created_at"], "updatedAt": row["updated_at"], "durationSeconds": duration_seconds(row["created_at"], row["updated_at"]),
            "status": row["status"], "result": (json.loads(row["result_json"]) if row["result_json"] else None) if include_result else None,
            "error": row["error"], "metadata": json.loads(row["metadata_json"])}

    async def get_run(self, run_id: str) -> dict[str, Any]:
        def read():
            with self._lock:
                row = self._connection.execute("SELECT * FROM analysis_runs WHERE id=?", (run_id,)).fetchone()
                if not row:
                    raise AnalysisNotFound(run_id)
                return self._run(row)
        return await asyncio.to_thread(read)

    async def history(self, limit: int = 200) -> list[dict[str, Any]]:
        def read():
            with self._lock:
                # History only needs IDs/lifecycle metadata. Loading hundreds
                # of results with source snapshots can consume gigabytes;
                # recovery reads one canonical result via get_run instead.
                rows = self._connection.execute("SELECT id,workflow_id,snapshot_id,created_at,updated_at,status,error,metadata_json FROM analysis_runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
                return [self._run(row, include_result=False) for row in rows]
        return await asyncio.to_thread(read)

    async def save_report(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict) or type(raw.get("schemaVersion")) is not int or raw["schemaVersion"] != 1:
            raise ValueError("Report schemaVersion chưa hỗ trợ")
        report = copy.deepcopy(raw)
        for key in ("id", "title"):
            text(report.get(key), f"report.{key}", limit=256)
        if type(report.get("revision")) is not int or report["revision"] < 1:
            raise ValueError("Report revision phải lớn hơn 0")
        for key in ("createdAt", "updatedAt"):
            timestamp(report.get(key), key)
        imported = report.get("importedFrom")
        if imported is not None:
            if not isinstance(imported, dict) or set(imported) != {"reportId", "revision", "importedAt"}:
                raise ValueError("Report importedFrom không hợp lệ")
            text(imported.get("reportId"), "importedFrom.reportId", limit=256)
            if type(imported.get("revision")) is not int or imported["revision"] < 1:
                raise ValueError("importedFrom.revision phải lớn hơn 0")
            timestamp(imported.get("importedAt"), "importedFrom.importedAt")
        if not isinstance(report.get("notes"), str) or len(report["notes"]) > 100_000:
            raise ValueError("Report notes không hợp lệ")
        report = validate_report_sources(report)
        if report.get("snapshot") is not None:
            report["snapshot"] = await self.save_snapshot(report["snapshot"])
        result = report.get("result")
        if not isinstance(result, dict) or result.get("schemaVersion") != 1 or result.get("workflowId") not in {"gis-analysis-v1", "data-quality-v1", "document-qa-v1", "report-summary-v1"}:
            raise ValueError("Report thiếu kết quả phân tích hợp lệ")
        text(result.get("runId"), "result.runId", limit=256)
        if not isinstance(result.get("answer"), str) or result.get("status") not in {"complete", "partial", "insufficient"}:
            raise ValueError("Report kết quả không hợp lệ")
        if result.get("snapshotId") != (report["snapshot"]["id"] if report.get("snapshot") else None):
            raise ValueError("Report snapshot không khớp kết quả")
        for source_snapshot in result.get("sourceSnapshots", []):
            await self.save_snapshot(source_snapshot)
        local_result = False
        try:
            persisted = await self.get_run(result["runId"])
            if persisted["status"] != "completed" or canonical_json(persisted["result"]) != canonical_json(result):
                raise ValueError("Report sửa kết quả đã lưu; chỉnh ghi chú hoặc tạo phân tích mới")
            local_result = True
        except AnalysisNotFound:
            # A shared file is an archived assertion, not a new locally verified
            # model run. Preserve its original validation record with a warning.
            result.setdefault("warnings", [])
            warning = "Gói nhập: kết quả lưu từ máy khác; chưa chạy lại với dữ liệu local"
            if warning not in result["warnings"]:
                result["warnings"].append(warning)
        citations = result.get("citations")
        if not isinstance(citations, list) or any(not isinstance(c, dict) or not isinstance(c.get("id"), str) for c in citations):
            raise ValueError("Report citations không hợp lệ")
        citation_ids = {c["id"] for c in citations}
        annotations = report.get("annotations")
        if not isinstance(annotations, list) or len(annotations) > 1000:
            raise ValueError("Report annotations không hợp lệ")
        for annotation in annotations:
            if not isinstance(annotation, dict):
                raise ValueError("Report annotation phải là object")
            text(annotation.get("id"), "annotation.id", limit=256)
            text(annotation.get("label"), "annotation.label")
            geometry(annotation.get("geometry"))
            if not isinstance(annotation.get("evidenceIds"), list) or any(eid not in citation_ids for eid in annotation["evidenceIds"]):
                raise ValueError("Annotation phải trỏ citation của report")
        payload = canonical_json(report)
        if len(payload.encode("utf-8")) > 100 * 1024 * 1024:
            raise ValueError("Report vượt quá 100 MiB")
        def write():
            with self._lock, self._connection:
                existing = self._connection.execute("SELECT payload_json FROM analysis_reports WHERE id=?", (report["id"],)).fetchone()
                if existing:
                    if existing[0] != payload:
                        raise AnalysisConflict("Report bất biến; revision mới phải có ID mới và parentId")
                    return report
                parent = report.get("parentId")
                if parent:
                    row = self._connection.execute("SELECT revision FROM analysis_reports WHERE id=?", (parent,)).fetchone()
                    if row is None or report["revision"] != row[0] + 1:
                        raise AnalysisConflict("Parent report không tồn tại hoặc revision không liên tiếp")
                elif report["revision"] != 1:
                    # Imported revisions can be viewed without their parent chain.
                    if local_result:
                        raise AnalysisConflict("Revision local cần parentId")
                self._connection.execute("INSERT INTO analysis_reports VALUES(?,?,?,?,?,?)",
                    (report["id"], report["revision"], parent, report["createdAt"], report["updatedAt"], payload))
            return report
        return await asyncio.to_thread(write)

    async def get_report(self, report_id: str) -> dict[str, Any]:
        def read():
            with self._lock:
                row = self._connection.execute("SELECT payload_json FROM analysis_reports WHERE id=?", (report_id,)).fetchone()
                if not row:
                    raise AnalysisNotFound(report_id)
                return json.loads(row[0])
        return await asyncio.to_thread(read)

    async def reports(self, limit: int = 200) -> list[dict[str, Any]]:
        def read():
            with self._lock:
                rows = self._connection.execute("SELECT payload_json FROM analysis_reports ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()
                return [json.loads(row[0]) for row in rows]
        return await asyncio.to_thread(read)
