"""SQLite source-of-truth repository and FTS5 lexical index."""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import threading
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from vector_ai_backend.application.formula_policy import blocks_retrieval
from vector_ai_backend.domain.models import (
    CheckStatus,
    DocumentChunk,
    EmbeddingProfile,
    FormulaCheckResult,
    FormulaRecord,
    IndexGeneration,
    RetrievalHit,
    RetrievalRequest,
    RunEvent,
    RunEventType,
    SourceScope,
    VerificationMetadata,
    VerificationMethod,
    VerificationStatus,
    WorkflowDiagram,
    WorkflowDiagramEdge,
    WorkflowDiagramNode,
    WorkflowNodeKind,
)
from vector_ai_backend.formulas.semantic import (
    FORMULA_SEMANTIC_VERSION,
    formula_semantic_representation,
)


from vector_ai_backend.domain.dataset_tree import (
    DatasetTree,
    dataset_node_chunk_prefix,
    dataset_node_source,
    source_revision,
)

SCHEMA_VERSION = 5
_FTS_TERM = re.compile(r"[^\W_]+", re.UNICODE)


def _json_default(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value):
        return asdict(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=_json_default)


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    return json.loads(value)


def _utc_text(value: datetime | None = None) -> str:
    return (value or datetime.now(UTC)).isoformat()


class SQLiteKnowledgeRepository:
    """Own documents, chunks, formulas, profiles, generations and lexical search.

    A single connection is protected by a re-entrant lock. Public methods are
    async so application workflows never block the event loop on disk I/O.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._retrieval_revision = 0
        self._initialize_sync()

    @property
    def retrieval_revision(self) -> int:
        return self._retrieval_revision

    def _touch_retrieval_revision(self) -> None:
        self._retrieval_revision += 1

    async def close(self) -> None:
        await asyncio.to_thread(self._close_sync)

    async def backup_to(self, target: str | Path) -> None:
        """Create a transactionally consistent SQLite snapshot."""
        await asyncio.to_thread(self._backup_to_sync, Path(target))

    def _backup_to_sync(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            destination = sqlite3.connect(target)
            try:
                self._connection.backup(destination)
            finally:
                destination.close()

    def _close_sync(self) -> None:
        with self._lock:
            self._connection.close()

    def _initialize_sync(self) -> None:
        with self._lock, self._connection:
            self._connection.execute("PRAGMA foreign_keys = ON")
            if self.path != ":memory:":
                self._connection.execute("PRAGMA journal_mode = WAL")
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    source_uri TEXT,
                    sha256 TEXT,
                    mime_type TEXT,
                    scope_kind TEXT NOT NULL DEFAULT 'builtin',
                    owner_id TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (id, version)
                );
                CREATE INDEX IF NOT EXISTS documents_enabled_scope
                    ON documents(enabled, scope_kind, owner_id);

                CREATE TABLE IF NOT EXISTS document_chunks (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    document_version INTEGER NOT NULL,
                    ordinal INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    semantic_text TEXT NOT NULL,
                    token_count INTEGER NOT NULL DEFAULT 0,
                    page INTEGER,
                    heading TEXT,
                    scope_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    semantic_version TEXT NOT NULL,
                    verification_revision INTEGER NOT NULL DEFAULT 0,
                    retrieval_eligible INTEGER NOT NULL DEFAULT 1 CHECK(retrieval_eligible IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(document_id, document_version)
                        REFERENCES documents(id, version) ON DELETE CASCADE,
                    UNIQUE(document_id, document_version, ordinal)
                );
                CREATE INDEX IF NOT EXISTS chunks_document
                    ON document_chunks(document_id, document_version, ordinal);
                CREATE INDEX IF NOT EXISTS chunks_eligible ON document_chunks(retrieval_eligible);

                CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
                    text,
                    semantic_text,
                    content='document_chunks',
                    content_rowid='rowid',
                    tokenize='unicode61 remove_diacritics 2'
                );
                CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON document_chunks BEGIN
                    INSERT INTO document_chunks_fts(rowid, text, semantic_text)
                    VALUES (new.rowid, new.text, new.semantic_text);
                END;
                CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON document_chunks BEGIN
                    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, text, semantic_text)
                    VALUES ('delete', old.rowid, old.text, old.semantic_text);
                END;
                CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF text, semantic_text ON document_chunks BEGIN
                    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, text, semantic_text)
                    VALUES ('delete', old.rowid, old.text, old.semantic_text);
                    INSERT INTO document_chunks_fts(rowid, text, semantic_text)
                    VALUES (new.rowid, new.text, new.semantic_text);
                END;

                CREATE TABLE IF NOT EXISTS formulas (
                    id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    document_id TEXT NOT NULL,
                    document_version INTEGER NOT NULL,
                    name TEXT,
                    aliases_json TEXT NOT NULL,
                    raw_latex TEXT NOT NULL,
                    normalized_latex TEXT NOT NULL,
                    sympy_expression TEXT,
                    variables_json TEXT NOT NULL,
                    units_json TEXT NOT NULL,
                    conditions_json TEXT NOT NULL,
                    assumptions_json TEXT NOT NULL,
                    source_json TEXT NOT NULL,
                    verification_json TEXT NOT NULL,
                    verification_status TEXT NOT NULL,
                    semantic_representation TEXT NOT NULL,
                    semantic_version TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(id, version),
                    FOREIGN KEY(document_id, document_version)
                        REFERENCES documents(id, version) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS formulas_document
                    ON formulas(document_id, document_version, verification_status);

                CREATE TABLE IF NOT EXISTS formula_chunks (
                    formula_id TEXT NOT NULL,
                    formula_version INTEGER NOT NULL,
                    chunk_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(formula_id, formula_version, chunk_id),
                    FOREIGN KEY(formula_id, formula_version)
                        REFERENCES formulas(id, version) ON DELETE CASCADE,
                    FOREIGN KEY(chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS formula_chunks_chunk ON formula_chunks(chunk_id);

                CREATE TABLE IF NOT EXISTS embedding_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS index_generations (
                    id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    dimension INTEGER NOT NULL,
                    distance TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
                    status TEXT NOT NULL DEFAULT 'building',
                    created_at TEXT NOT NULL,
                    activated_at TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(profile_id) REFERENCES embedding_profiles(id) ON DELETE RESTRICT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_generation_per_profile
                    ON index_generations(profile_id) WHERE active = 1;
                CREATE INDEX IF NOT EXISTS generation_fingerprint
                    ON index_generations(profile_id, fingerprint, status);

                CREATE TABLE IF NOT EXISTS run_history (
                    run_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    stage TEXT,
                    terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0, 1)),
                    event_count INTEGER NOT NULL DEFAULT 0,
                    started_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_event_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS run_history_updated
                    ON run_history(updated_at DESC);

                CREATE TABLE IF NOT EXISTS workflow_diagrams (
                    id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL CHECK(revision >= 1),
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dataset_trees (
                    document_id TEXT NOT NULL,
                    document_version INTEGER NOT NULL,
                    revision INTEGER NOT NULL CHECK(revision >= 1),
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(document_id, document_version),
                    FOREIGN KEY(document_id, document_version)
                        REFERENCES documents(id, version) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS knowledge_catalogs (
                    id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL CHECK(revision >= 1),
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._connection.execute(
                "INSERT OR REPLACE INTO schema_metadata(key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    async def record_run_event(self, kind: str, event: RunEvent) -> None:
        await asyncio.to_thread(self._record_run_event_sync, kind, event)

    def _record_run_event_sync(self, kind: str, event: RunEvent) -> None:
        terminal = event.type in {
            RunEventType.COMPLETED,
            RunEventType.CANCELLED,
            RunEventType.ERROR,
        }
        event_json = _json(event.to_dict())
        timestamp = event.created_at.isoformat()
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO run_history(
                    run_id, kind, stage, terminal, event_count,
                    started_at, updated_at, last_event_json
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    kind=excluded.kind,
                    stage=excluded.stage,
                    terminal=excluded.terminal,
                    event_count=run_history.event_count + 1,
                    updated_at=excluded.updated_at,
                    last_event_json=excluded.last_event_json
                """,
                (
                    event.run_id,
                    kind,
                    event.stage,
                    int(terminal),
                    timestamp,
                    timestamp,
                    event_json,
                ),
            )

    async def list_run_summaries(self, limit: int = 200) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_run_summaries_sync, limit)

    def _list_run_summaries_sync(self, limit: int) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                """SELECT run_id, kind, stage, terminal, event_count,
                          started_at, updated_at, last_event_json
                   FROM run_history ORDER BY updated_at DESC LIMIT ?""",
                (max(1, min(int(limit), 1000)),),
            ).fetchall()
        return [
            {
                "run_id": row["run_id"],
                "kind": row["kind"],
                "stage": row["stage"],
                "terminal": bool(row["terminal"]),
                "events": row["event_count"],
                "started_at": row["started_at"],
                "updated_at": row["updated_at"],
                "last_event": _loads(row["last_event_json"], {}),
            }
            for row in rows
        ]

    async def read_workflow_diagram(self, workflow_id: str) -> WorkflowDiagram | None:
        return await asyncio.to_thread(self._read_workflow_diagram_sync, workflow_id)

    def _read_workflow_diagram_sync(self, workflow_id: str) -> WorkflowDiagram | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT revision, payload_json, updated_at FROM workflow_diagrams WHERE id=?",
                (workflow_id,),
            ).fetchone()
        if row is None:
            return None
        revision = int(row["revision"])
        try:
            updated_at = datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None
            raw = _loads(row["payload_json"], {})
            return WorkflowDiagram(
                id=workflow_id,
                name=str(raw["name"]),
                description=str(raw.get("description", "")),
                revision=revision,
                nodes=tuple(
                    WorkflowDiagramNode(
                        id=str(node["id"]),
                        label=str(node["label"]),
                        kind=WorkflowNodeKind(str(node["kind"])),
                        x=float(node["x"]),
                        y=float(node["y"]),
                        description=str(node.get("description", "")),
                        runtime_stage=node.get("runtime_stage"),
                        runtime_locked=bool(node.get("runtime_locked", True)),
                    )
                    for node in raw.get("nodes", [])
                ),
                edges=tuple(
                    WorkflowDiagramEdge(
                        id=str(edge["id"]),
                        source=str(edge["source"]),
                        target=str(edge["target"]),
                        label=str(edge.get("label", "")),
                    )
                    for edge in raw.get("edges", [])
                ),
                updated_at=updated_at,
            )
        except (KeyError, TypeError, ValueError):
            # A damaged layout must not block the runtime workflow forever. Keep
            # its monotonic SQL revision so the application can safely replace it.
            return WorkflowDiagram(
                id=workflow_id,
                name="",
                description="",
                revision=revision,
                nodes=(),
                edges=(),
                updated_at=None,
            )

    async def write_workflow_diagram(
        self,
        diagram: WorkflowDiagram,
        *,
        expected_revision: int,
    ) -> bool:
        return await asyncio.to_thread(
            self._write_workflow_diagram_sync,
            diagram,
            expected_revision,
        )

    def _write_workflow_diagram_sync(
        self,
        diagram: WorkflowDiagram,
        expected_revision: int,
    ) -> bool:
        payload = _json(diagram)
        updated_at = (diagram.updated_at or datetime.now(UTC)).isoformat()
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT revision FROM workflow_diagrams WHERE id=?",
                (diagram.id,),
            ).fetchone()
            if row is None:
                if expected_revision != 0:
                    return False
                self._connection.execute(
                    "INSERT INTO workflow_diagrams(id, revision, payload_json, updated_at) VALUES (?, ?, ?, ?)",
                    (diagram.id, diagram.revision, payload, updated_at),
                )
                return True
            if int(row["revision"]) != expected_revision:
                return False
            cursor = self._connection.execute(
                """UPDATE workflow_diagrams
                   SET revision=?, payload_json=?, updated_at=?
                   WHERE id=? AND revision=?""",
                (diagram.revision, payload, updated_at, diagram.id, expected_revision),
            )
            return cursor.rowcount == 1

    async def delete_workflow_diagram(
        self,
        workflow_id: str,
        *,
        expected_revision: int | None = None,
    ) -> bool:
        return await asyncio.to_thread(
            self._delete_workflow_diagram_sync,
            workflow_id,
            expected_revision,
        )

    def _delete_workflow_diagram_sync(
        self,
        workflow_id: str,
        expected_revision: int | None,
    ) -> bool:
        with self._lock, self._connection:
            if expected_revision is None:
                cursor = self._connection.execute(
                    "DELETE FROM workflow_diagrams WHERE id=?",
                    (workflow_id,),
                )
            else:
                cursor = self._connection.execute(
                    "DELETE FROM workflow_diagrams WHERE id=? AND revision=?",
                    (workflow_id, expected_revision),
                )
            return cursor.rowcount == 1

    def _dataset_source_sync(self, document_id: str, version: int) -> dict[str, Any] | None:
        with self._lock:
            doc = self._connection.execute(
                "SELECT * FROM documents WHERE id=? AND version=?", (document_id, version)
            ).fetchone()
            if doc is None:
                return None
            chunks = self._connection.execute(
                """SELECT id, ordinal, heading, page, updated_at, substr(text, 1, 160) AS preview
                   FROM document_chunks
                   WHERE document_id=? AND document_version=? AND id NOT LIKE 'dataset-node-%'
                   ORDER BY ordinal, id""",
                (document_id, version),
            ).fetchall()
            return {"document": self._document_from_row(doc), "chunks": [dict(c) for c in chunks]}

    async def dataset_source(self, document_id: str, version: int) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._dataset_source_sync, document_id, version)

    async def read_dataset_tree(self, document_id: str, version: int) -> dict[str, Any] | None:
        def read() -> dict[str, Any] | None:
            with self._lock:
                row = self._connection.execute(
                    "SELECT * FROM dataset_trees WHERE document_id=? AND document_version=?", (document_id, version)
                ).fetchone()
                if row is None:
                    return None
                return {**json.loads(row["payload_json"]), "revision": row["revision"], "updated_at": row["updated_at"]}
        return await asyncio.to_thread(read)

    async def read_knowledge_catalog(self) -> dict[str, Any] | None:
        def read() -> dict[str, Any] | None:
            with self._lock:
                row = self._connection.execute(
                    "SELECT revision, payload_json, updated_at FROM knowledge_catalogs WHERE id='default'"
                ).fetchone()
                if row is None:
                    return None
                return {
                    **_loads(row["payload_json"], {}),
                    "revision": row["revision"], "updated_at": row["updated_at"],
                }
        return await asyncio.to_thread(read)

    async def write_knowledge_catalog(
        self, payload: Mapping[str, Any], *, expected_revision: int
    ) -> bool:
        def write() -> bool:
            now = _utc_text()
            with self._lock, self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                row = self._connection.execute(
                    "SELECT revision FROM knowledge_catalogs WHERE id='default'"
                ).fetchone()
                if (row["revision"] if row else 0) != expected_revision:
                    return False
                self._connection.execute(
                    """INSERT INTO knowledge_catalogs(id, revision, payload_json, updated_at)
                       VALUES ('default', ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
                       payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                    (expected_revision + 1, _json(payload), now),
                )
                return True
        return await asyncio.to_thread(write)

    async def write_dataset_tree(self, tree: DatasetTree, *, expected_revision: int) -> bool:
        def write() -> bool:
            with self._lock, self._connection:
                # Lock source and layout checks together, including reindexing
                # from a different repository/process.
                self._connection.execute("BEGIN IMMEDIATE")
                source = self._dataset_source_sync(tree.document_id, tree.document_version)
                if source is None or source_revision(source["chunks"]) != tree.source_revision:
                    return False
                row = self._connection.execute(
                    "SELECT revision FROM dataset_trees WHERE document_id=? AND document_version=?",
                    (tree.document_id, tree.document_version),
                ).fetchone()
                if (row["revision"] if row else 0) != expected_revision:
                    return False
                self._connection.execute(
                    """INSERT INTO dataset_trees VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(document_id, document_version) DO UPDATE SET
                       revision=excluded.revision, payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                    (tree.document_id, tree.document_version, expected_revision + 1, _json(tree), tree.updated_at),
                )
                self._sync_dataset_node_chunks_sync(tree, source["document"])
                self._connection.execute(
                    "UPDATE documents SET title=?, updated_at=? WHERE id=? AND version=?",
                    (next(node.title for node in tree.nodes if node.id == "root"), _utc_text(), tree.document_id, tree.document_version),
                )
                return True
        return await asyncio.to_thread(write)

    def _sync_dataset_node_chunks_sync(self, tree: DatasetTree, document: Mapping[str, Any]) -> None:
        """Materialize node-authored bodies into FTS-backed RAG chunks.

        The regular ingestion pipeline later replaces these provisional chunks
        with token-bounded chunks and embeddings. Source chunks are kept out of
        this namespace, so the visual tree never duplicates authored nodes.
        """
        rows = self._connection.execute(
            """SELECT id FROM document_chunks
               WHERE document_id=? AND document_version=? AND id LIKE 'dataset-node-%'""",
            (tree.document_id, tree.document_version),
        ).fetchall()
        if rows:
            self._connection.executemany(
                "DELETE FROM document_chunks WHERE id=?",
                [(row["id"],) for row in rows],
            )
        kind = str(document.get("scope_kind") or "builtin")
        owner = document.get("owner_id")
        scope = {
            "builtin": kind == "builtin",
            "workspace_ids": [owner] if kind == "workspace" and owner else [],
            "chat_ids": [owner] if kind == "chat" and owner else [],
        }
        now = _utc_text()
        authored = [node for node in tree.nodes if not node.chunk_id and node.content.strip()]
        for position, node in enumerate(authored, start=1):
            text = dataset_node_source(node)
            chunk_id = f"{dataset_node_chunk_prefix(tree.document_id, tree.document_version, node.id)}-00001"
            metadata = {
                "origin": "dataset-node", "dataset_node_id": node.id,
                "node_kind": node.kind, "scope_kind": kind, "owner_id": owner,
                "token_count": len(_FTS_TERM.findall(text)),
            }
            has_formula = bool(re.search(r"\$\$|\\\[|\\\(|(?<!\$)\$[^$\n]+\$", text))
            self._connection.execute(
                """INSERT INTO document_chunks(
                    id, document_id, document_version, ordinal, text,
                    semantic_text, token_count, page, heading, scope_json,
                    metadata_json, semantic_version, verification_revision,
                    retrieval_eligible, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, ?, ?)""",
                (
                    chunk_id, tree.document_id, tree.document_version, -1_000_000 + position,
                    text, text, metadata["token_count"], node.title, _json(scope), _json(metadata),
                    FORMULA_SEMANTIC_VERSION,
                    int(bool(document.get("enabled", True)) and not has_formula), now, now,
                ),
            )
        if rows or authored:
            self._touch_retrieval_revision()

    async def delete_document_chunks_except(
        self, document_id: str, version: int, chunk_ids: Sequence[str]
    ) -> None:
        await asyncio.to_thread(
            self._delete_document_chunks_except_sync, document_id, version, list(chunk_ids)
        )

    def _delete_document_chunks_except_sync(
        self, document_id: str, version: int, chunk_ids: Sequence[str]
    ) -> None:
        with self._lock, self._connection:
            params: list[Any] = [document_id, version]
            clause = ""
            if chunk_ids:
                clause = f" AND id NOT IN ({','.join('?' for _ in chunk_ids)})"
                params.extend(chunk_ids)
            cursor = self._connection.execute(
                f"DELETE FROM document_chunks WHERE document_id=? AND document_version=?{clause}",
                params,
            )
            if cursor.rowcount:
                self._touch_retrieval_revision()

    async def dataset_chunk(self, document_id: str, version: int, chunk_id: str) -> dict[str, Any] | None:
        chunks = await self.get_chunks([chunk_id])
        if not chunks or chunks[0].document_id != document_id or chunks[0].document_version != version:
            return None
        return asdict(chunks[0])

    async def upsert_document(self, document: Mapping[str, Any]) -> None:
        await asyncio.to_thread(self._upsert_document_sync, dict(document))

    def _upsert_document_sync(self, document: Mapping[str, Any]) -> None:
        now = _utc_text()
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO documents(
                    id, version, title, source_uri, sha256, mime_type, scope_kind,
                    owner_id, enabled, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id, version) DO UPDATE SET
                    title=excluded.title, source_uri=excluded.source_uri,
                    sha256=excluded.sha256, mime_type=excluded.mime_type,
                    scope_kind=excluded.scope_kind, owner_id=excluded.owner_id,
                    enabled=excluded.enabled, metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    str(document["id"]),
                    int(document.get("version", 1)),
                    str(document.get("title") or document["id"]),
                    document.get("source_uri"),
                    document.get("sha256"),
                    document.get("mime_type"),
                    str(document.get("scope_kind", "builtin")),
                    document.get("owner_id"),
                    int(bool(document.get("enabled", True))),
                    _json(document.get("metadata", {})),
                    str(document.get("created_at") or now),
                    now,
                ),
            )
            self._touch_retrieval_revision()

    async def list_documents(
        self,
        *,
        scope_kind: str | None = None,
        owner_id: str | None = None,
        include_disabled: bool = True,
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_documents_sync, scope_kind, owner_id, include_disabled)

    def _list_documents_sync(
        self, scope_kind: str | None, owner_id: str | None, include_disabled: bool
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if scope_kind is not None:
            clauses.append("scope_kind = ?")
            params.append(scope_kind)
        if owner_id is not None:
            clauses.append("owner_id = ?")
            params.append(owner_id)
        if not include_disabled:
            clauses.append("enabled = 1")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self._connection.execute(
                f"""SELECT d.*,
                    (SELECT COUNT(*) FROM document_chunks c
                     WHERE c.document_id=d.id AND c.document_version=d.version) AS chunk_count,
                    (SELECT COUNT(*) FROM formulas f
                     WHERE f.document_id=d.id AND f.document_version=d.version) AS formula_count
                    FROM documents d {where} ORDER BY updated_at DESC""",
                params,
            ).fetchall()
        return [self._document_from_row(row) for row in rows]

    @staticmethod
    def _document_from_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "version": row["version"],
            "title": row["title"],
            "source_uri": row["source_uri"],
            "sha256": row["sha256"],
            "mime_type": row["mime_type"],
            "scope_kind": row["scope_kind"],
            "owner_id": row["owner_id"],
            "enabled": bool(row["enabled"]),
            "metadata": _loads(row["metadata_json"], {}),
            "lifecycle": _loads(row["metadata_json"], {}).get("lifecycle", "active"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "chunk_count": row["chunk_count"] if "chunk_count" in row.keys() else None,
            "formula_count": row["formula_count"] if "formula_count" in row.keys() else None,
        }

    async def set_document_enabled(self, document_id: str, version: int, enabled: bool) -> bool:
        return await asyncio.to_thread(self._set_document_enabled_sync, document_id, version, enabled)

    async def share_document(self, document_id: str, version: int) -> bool:
        """Explicitly promote one document to the shared local knowledge base."""
        def write() -> bool:
            with self._lock, self._connection:
                row = self._connection.execute(
                    "SELECT scope_kind, owner_id, metadata_json FROM documents WHERE id=? AND version=?",
                    (document_id, version),
                ).fetchone()
                if row is None:
                    return False
                if row["scope_kind"] == "builtin":
                    return True
                metadata = _loads(row["metadata_json"], {})
                metadata["scope_before_sharing"] = {"kind": row["scope_kind"], "owner_id": row["owner_id"]}
                self._connection.execute(
                    "UPDATE documents SET scope_kind='builtin', owner_id=NULL, metadata_json=?, updated_at=? WHERE id=? AND version=?",
                    (_json(metadata), _utc_text(), document_id, version),
                )
                self._connection.execute(
                    "UPDATE document_chunks SET scope_json=?, updated_at=? WHERE document_id=? AND document_version=?",
                    (_json({"builtin": True, "workspace_ids": [], "chat_ids": []}), _utc_text(), document_id, version),
                )
                self._touch_retrieval_revision()
                return True
        return await asyncio.to_thread(write)

    def _set_document_enabled_sync(self, document_id: str, version: int, enabled: bool) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE documents SET enabled=?, updated_at=? WHERE id=? AND version=? AND COALESCE(json_extract(metadata_json, '$.lifecycle'), 'active')='active'",
                (int(enabled), _utc_text(), document_id, version),
            )
            if cursor.rowcount:
                self._touch_retrieval_revision()
            return cursor.rowcount > 0

    async def set_document_lifecycle(self, document_id: str, version: int, lifecycle: str) -> bool:
        if lifecycle not in {"active", "archived", "trashed"}:
            raise ValueError("Trạng thái tài liệu không hợp lệ")

        def write() -> bool:
            with self._lock, self._connection:
                row = self._connection.execute(
                    "SELECT enabled, metadata_json FROM documents WHERE id=? AND version=?",
                    (document_id, version),
                ).fetchone()
                if row is None:
                    return False
                metadata = _loads(row["metadata_json"], {})
                previous = metadata.get("lifecycle", "active")
                if previous == lifecycle:
                    return True
                if previous == "active":
                    metadata["enabled_before_storage"] = bool(row["enabled"])
                enabled = bool(metadata.get("enabled_before_storage", True)) if lifecycle == "active" else False
                metadata.update(lifecycle=lifecycle, lifecycle_updated_at=_utc_text())
                self._connection.execute(
                    "UPDATE documents SET enabled=?, metadata_json=?, updated_at=? WHERE id=? AND version=?",
                    (int(enabled), _json(metadata), _utc_text(), document_id, version),
                )
                self._touch_retrieval_revision()
                return True
        return await asyncio.to_thread(write)

    async def delete_document(self, document_id: str, version: int | None = None) -> int:
        return await asyncio.to_thread(self._delete_document_sync, document_id, version)

    def _delete_document_sync(self, document_id: str, version: int | None) -> int:
        with self._lock, self._connection:
            if version is None:
                cursor = self._connection.execute("DELETE FROM documents WHERE id=?", (document_id,))
            else:
                cursor = self._connection.execute(
                    "DELETE FROM documents WHERE id=? AND version=?", (document_id, version)
                )
            if cursor.rowcount:
                self._touch_retrieval_revision()
            return cursor.rowcount

    async def upsert_chunks(
        self,
        chunks: Sequence[DocumentChunk],
        *,
        semantic_text: Mapping[str, str] | None = None,
        token_counts: Mapping[str, int] | None = None,
    ) -> None:
        await asyncio.to_thread(
            self._upsert_chunks_sync,
            list(chunks),
            dict(semantic_text or {}),
            dict(token_counts or {}),
        )

    def _upsert_chunks_sync(
        self,
        chunks: Sequence[DocumentChunk],
        semantic_text: Mapping[str, str],
        token_counts: Mapping[str, int],
    ) -> None:
        now = _utc_text()
        with self._lock, self._connection:
            for chunk in chunks:
                content = semantic_text.get(chunk.id, chunk.text)
                self._connection.execute(
                    """
                    INSERT INTO document_chunks(
                        id, document_id, document_version, ordinal, text,
                        semantic_text, token_count, page, heading, scope_json,
                        metadata_json, semantic_version, verification_revision,
                        retrieval_eligible, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        document_id=excluded.document_id,
                        document_version=excluded.document_version,
                        ordinal=excluded.ordinal, text=excluded.text,
                        semantic_text=excluded.semantic_text,
                        token_count=excluded.token_count, page=excluded.page,
                        heading=excluded.heading, scope_json=excluded.scope_json,
                        metadata_json=excluded.metadata_json,
                        semantic_version=excluded.semantic_version,
                        verification_revision=excluded.verification_revision,
                        updated_at=excluded.updated_at
                    """,
                    (
                        chunk.id,
                        chunk.document_id,
                        chunk.document_version,
                        chunk.ordinal,
                        chunk.text,
                        content,
                        int(token_counts.get(chunk.id, chunk.metadata.get("token_count", 0))),
                        chunk.page,
                        chunk.heading,
                        _json(chunk.scope),
                        _json(chunk.metadata),
                        chunk.semantic_representation_version,
                        chunk.verification_revision,
                        now,
                        now,
                    ),
                )
            for chunk in chunks:
                self._recompute_chunk_eligibility_sync(chunk.id)
            if chunks:
                self._touch_retrieval_revision()

    async def get_chunks(self, chunk_ids: Sequence[str]) -> list[DocumentChunk]:
        return await asyncio.to_thread(self._get_chunks_sync, list(chunk_ids))

    def _get_chunks_sync(self, chunk_ids: Sequence[str]) -> list[DocumentChunk]:
        if not chunk_ids:
            return []
        placeholders = ",".join("?" for _ in chunk_ids)
        with self._lock:
            rows = self._connection.execute(
                f"""SELECT c.*, d.enabled AS document_enabled,
                           d.scope_kind AS document_scope_kind, d.owner_id AS document_owner_id
                    FROM document_chunks c JOIN documents d
                    ON d.id=c.document_id AND d.version=c.document_version
                    WHERE c.id IN ({placeholders})""", list(chunk_ids)
            ).fetchall()
            formula_rows = self._connection.execute(
                f"SELECT chunk_id, formula_id FROM formula_chunks WHERE chunk_id IN ({placeholders}) ORDER BY ordinal",
                list(chunk_ids),
            ).fetchall()
        formula_ids: dict[str, list[str]] = {}
        for row in formula_rows:
            formula_ids.setdefault(row["chunk_id"], []).append(row["formula_id"])
        result: list[DocumentChunk] = []
        for row in rows:
            scope_data = _loads(row["scope_json"], {})
            result.append(
                DocumentChunk(
                    id=row["id"],
                    document_id=row["document_id"],
                    document_version=row["document_version"],
                    text=row["text"],
                    ordinal=row["ordinal"],
                    scope=SourceScope(
                        builtin=bool(scope_data.get("builtin", True)),
                        workspace_ids=tuple(scope_data.get("workspace_ids", ())),
                        chat_ids=tuple(scope_data.get("chat_ids", ())),
                    ),
                    formula_ids=formula_ids.get(row["id"], []),
                    page=row["page"],
                    heading=row["heading"],
                    metadata={
                        **_loads(row["metadata_json"], {}),
                        "semantic_text": row["semantic_text"],
                        "token_count": row["token_count"],
                        "retrieval_eligible": bool(row["retrieval_eligible"] and row["document_enabled"]),
                        "scope_kind": row["document_scope_kind"],
                        "owner_id": row["document_owner_id"],
                    },
                    semantic_representation_version=row["semantic_version"],
                    verification_revision=row["verification_revision"],
                )
            )
        order = {chunk_id: index for index, chunk_id in enumerate(chunk_ids)}
        result.sort(key=lambda chunk: order.get(chunk.id, len(order)))
        return result

    async def upsert_formula(self, formula: FormulaRecord) -> None:
        await asyncio.to_thread(self._upsert_formula_sync, formula)

    def _upsert_formula_sync(self, formula: FormulaRecord) -> None:
        semantic = formula_semantic_representation(formula)
        verification = asdict(formula.verification)
        with self._lock, self._connection:
            previous_chunks = {
                row["chunk_id"]
                for row in self._connection.execute(
                    "SELECT chunk_id FROM formula_chunks WHERE formula_id=? AND formula_version=?",
                    (formula.id, formula.version),
                ).fetchall()
            }
            self._connection.execute(
                """
                INSERT INTO formulas(
                    id, version, document_id, document_version, name,
                    aliases_json, raw_latex, normalized_latex, sympy_expression,
                    variables_json, units_json, conditions_json, assumptions_json,
                    source_json, verification_json, verification_status,
                    semantic_representation, semantic_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id, version) DO UPDATE SET
                    document_id=excluded.document_id,
                    document_version=excluded.document_version,
                    name=excluded.name, aliases_json=excluded.aliases_json,
                    raw_latex=excluded.raw_latex,
                    normalized_latex=excluded.normalized_latex,
                    sympy_expression=excluded.sympy_expression,
                    variables_json=excluded.variables_json,
                    units_json=excluded.units_json,
                    conditions_json=excluded.conditions_json,
                    assumptions_json=excluded.assumptions_json,
                    source_json=excluded.source_json,
                    verification_json=excluded.verification_json,
                    verification_status=excluded.verification_status,
                    semantic_representation=excluded.semantic_representation,
                    semantic_version=excluded.semantic_version,
                    updated_at=excluded.updated_at
                """,
                (
                    formula.id,
                    formula.version,
                    formula.document_id,
                    formula.document_version,
                    formula.name,
                    _json(formula.aliases),
                    formula.raw_latex,
                    formula.normalized_latex,
                    formula.sympy_expression,
                    _json(formula.variables),
                    _json(formula.units),
                    _json(formula.conditions),
                    _json(formula.assumptions),
                    _json(formula.source),
                    _json(verification),
                    formula.verification.status.value,
                    semantic,
                    FORMULA_SEMANTIC_VERSION,
                    _utc_text(formula.created_at),
                    _utc_text(formula.updated_at),
                ),
            )
            self._connection.execute(
                "DELETE FROM formula_chunks WHERE formula_id=? AND formula_version=?",
                (formula.id, formula.version),
            )
            for ordinal, chunk_id in enumerate(formula.chunk_ids):
                if self._connection.execute(
                    "SELECT 1 FROM document_chunks WHERE id=?", (chunk_id,)
                ).fetchone():
                    self._connection.execute(
                        "INSERT INTO formula_chunks(formula_id, formula_version, chunk_id, ordinal) VALUES (?, ?, ?, ?)",
                        (formula.id, formula.version, chunk_id, ordinal),
                    )
            for chunk_id in previous_chunks | set(formula.chunk_ids):
                related = self._connection.execute(
                    """SELECT f.semantic_representation FROM formulas f
                       JOIN formula_chunks fc ON fc.formula_id=f.id AND fc.formula_version=f.version
                       WHERE fc.chunk_id=? ORDER BY fc.ordinal""",
                    (chunk_id,),
                ).fetchall()
                base = self._connection.execute(
                    "SELECT text FROM document_chunks WHERE id=?", (chunk_id,)
                ).fetchone()
                if base is not None:
                    semantic_parts = [base["text"], *(row["semantic_representation"] for row in related)]
                    self._connection.execute(
                        "UPDATE document_chunks SET semantic_text=?, semantic_version=?, updated_at=? WHERE id=?",
                        ("\n\n".join(part for part in semantic_parts if part), FORMULA_SEMANTIC_VERSION, _utc_text(), chunk_id),
                    )
                self._recompute_chunk_eligibility_sync(chunk_id, increment_revision=True)
            self._touch_retrieval_revision()

    async def list_retrieval_chunks(self, *, include_ineligible: bool = False) -> list[DocumentChunk]:
        return await asyncio.to_thread(self._list_retrieval_chunks_sync, include_ineligible)

    def _list_retrieval_chunks_sync(self, include_ineligible: bool) -> list[DocumentChunk]:
        where = "" if include_ineligible else "WHERE c.retrieval_eligible=1 AND d.enabled=1"
        with self._lock:
            rows = self._connection.execute(
                f"""SELECT c.id FROM document_chunks c
                    JOIN documents d ON d.id=c.document_id AND d.version=c.document_version
                    {where} ORDER BY c.document_id,c.document_version,c.ordinal"""
            ).fetchall()
        return self._get_chunks_sync([row["id"] for row in rows])

    async def get_formula(self, formula_id: str, version: int | None = None) -> FormulaRecord | None:
        return await asyncio.to_thread(self._get_formula_sync, formula_id, version)

    def _get_formula_sync(self, formula_id: str, version: int | None) -> FormulaRecord | None:
        with self._lock:
            if version is None:
                row = self._connection.execute(
                    "SELECT * FROM formulas WHERE id=? ORDER BY version DESC LIMIT 1", (formula_id,)
                ).fetchone()
            else:
                row = self._connection.execute(
                    "SELECT * FROM formulas WHERE id=? AND version=?", (formula_id, version)
                ).fetchone()
            if row is None:
                return None
            chunk_rows = self._connection.execute(
                "SELECT chunk_id FROM formula_chunks WHERE formula_id=? AND formula_version=? ORDER BY ordinal",
                (row["id"], row["version"]),
            ).fetchall()
        return self._formula_from_row(row, [item["chunk_id"] for item in chunk_rows])

    async def list_formulas(
        self,
        *,
        document_id: str | None = None,
        status: VerificationStatus | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[FormulaRecord]:
        return await asyncio.to_thread(self._list_formulas_sync, document_id, status, limit, offset)

    def _list_formulas_sync(
        self,
        document_id: str | None,
        status: VerificationStatus | None,
        limit: int,
        offset: int,
    ) -> list[FormulaRecord]:
        clauses: list[str] = []
        params: list[Any] = []
        if document_id is not None:
            clauses.append("document_id=?")
            params.append(document_id)
        if status is not None:
            clauses.append("verification_status=?")
            params.append(status.value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([max(1, min(limit, 1000)), max(0, offset)])
        with self._lock:
            rows = self._connection.execute(
                f"SELECT * FROM formulas {where} ORDER BY updated_at DESC LIMIT ? OFFSET ?", params
            ).fetchall()
            result: list[FormulaRecord] = []
            for row in rows:
                chunk_rows = self._connection.execute(
                    "SELECT chunk_id FROM formula_chunks WHERE formula_id=? AND formula_version=? ORDER BY ordinal",
                    (row["id"], row["version"]),
                ).fetchall()
                result.append(self._formula_from_row(row, [item["chunk_id"] for item in chunk_rows]))
        return result

    @staticmethod
    def _formula_from_row(row: sqlite3.Row, chunk_ids: list[str]) -> FormulaRecord:
        data = _loads(row["verification_json"], {})
        checks = [
            FormulaCheckResult(
                name=item["name"],
                category=item["category"],
                status=CheckStatus(item["status"]),
                message=item.get("message", ""),
                details=item.get("details", {}),
            )
            for item in data.get("checks", [])
        ]
        reviewed_at = data.get("reviewed_at")
        verification = VerificationMetadata(
            status=VerificationStatus(data.get("status", row["verification_status"])),
            method=VerificationMethod(data["method"]) if data.get("method") else None,
            validator_version=data.get("validator_version", ""),
            confidence=data.get("confidence"),
            checks=checks,
            reference_id=data.get("reference_id"),
            reference_version=data.get("reference_version"),
            reviewed_by=data.get("reviewed_by"),
            reviewed_at=datetime.fromisoformat(reviewed_at) if reviewed_at else None,
            reasons=list(data.get("reasons", [])),
        )
        return FormulaRecord(
            id=row["id"],
            version=row["version"],
            document_id=row["document_id"],
            document_version=row["document_version"],
            name=row["name"],
            aliases=list(_loads(row["aliases_json"], [])),
            raw_latex=row["raw_latex"],
            normalized_latex=row["normalized_latex"],
            sympy_expression=row["sympy_expression"],
            variables=dict(_loads(row["variables_json"], {})),
            units=dict(_loads(row["units_json"], {})),
            conditions=list(_loads(row["conditions_json"], [])),
            assumptions=list(_loads(row["assumptions_json"], [])),
            source=dict(_loads(row["source_json"], {})),
            verification=verification,
            chunk_ids=chunk_ids,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    async def review_formula(
        self,
        formula_id: str,
        version: int,
        *,
        status: VerificationStatus,
        reviewed_by: str,
        reasons: Sequence[str] = (),
    ) -> bool:
        return await asyncio.to_thread(
            self._review_formula_sync, formula_id, version, status, reviewed_by, list(reasons)
        )

    def _review_formula_sync(
        self,
        formula_id: str,
        version: int,
        status: VerificationStatus,
        reviewed_by: str,
        reasons: Sequence[str],
    ) -> bool:
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT verification_json FROM formulas WHERE id=? AND version=?", (formula_id, version)
            ).fetchone()
            if row is None:
                return False
            verification = _loads(row["verification_json"], {})
            verification.update(
                {
                    "status": status.value,
                    "method": VerificationMethod.MANUAL.value,
                    "reviewed_by": reviewed_by,
                    "reviewed_at": _utc_text(),
                    "reasons": list(reasons),
                }
            )
            self._connection.execute(
                """UPDATE formulas SET verification_json=?, verification_status=?, updated_at=?
                   WHERE id=? AND version=?""",
                (_json(verification), status.value, _utc_text(), formula_id, version),
            )
            chunks = self._connection.execute(
                "SELECT chunk_id FROM formula_chunks WHERE formula_id=? AND formula_version=?",
                (formula_id, version),
            ).fetchall()
            for chunk in chunks:
                self._recompute_chunk_eligibility_sync(chunk["chunk_id"], increment_revision=True)
            self._touch_retrieval_revision()
            return True

    def _recompute_chunk_eligibility_sync(self, chunk_id: str, *, increment_revision: bool = False) -> bool:
        """Re-derive one chunk's flag from the formulas linked to it.

        The decision itself belongs to ``formula_policy``.  Returns True when
        the stored flag actually changed; an unchanged flag is not written at
        all.  A chunk without a linked formula is eligible: an authored node
        waiting for its first ingestion is held back by the ``has_formula``
        marker written when the node was materialized, not by this method.
        """
        row = self._connection.execute(
            "SELECT text, retrieval_eligible FROM document_chunks WHERE id=?", (chunk_id,)
        ).fetchone()
        if row is None:
            return False
        linked = self._connection.execute(
            """SELECT f.verification_status, f.raw_latex FROM formula_chunks fc
               JOIN formulas f ON f.id=fc.formula_id AND f.version=fc.formula_version
               WHERE fc.chunk_id=?""",
            (chunk_id,),
        ).fetchall()
        blocked = any(
            blocks_retrieval(
                status=formula["verification_status"],
                latex=formula["raw_latex"],
                chunk_text=row["text"],
            )
            for formula in linked
        )
        eligible = 0 if blocked else 1
        if int(row["retrieval_eligible"]) == eligible:
            return False
        self._connection.execute(
            """UPDATE document_chunks
               SET retrieval_eligible=?, verification_revision=verification_revision+?, updated_at=?
               WHERE id=?""",
            (eligible, 1 if increment_revision else 0, _utc_text(), chunk_id),
        )
        return True

    async def recompute_retrieval_eligibility(self) -> int:
        """Re-derive every linked chunk's flag once for stores written earlier.

        Runs at startup so a document indexed under an older policy becomes
        usable without a manual reindex.  Only chunks that already link a
        formula are touched, so an authored node still waiting for its first
        ingestion keeps waiting.  Returns the number of chunks that changed.
        """
        return await asyncio.to_thread(self._recompute_retrieval_eligibility_sync)

    def _recompute_retrieval_eligibility_sync(self) -> int:
        with self._lock, self._connection:
            chunk_ids = [
                row["chunk_id"]
                for row in self._connection.execute(
                    "SELECT DISTINCT chunk_id FROM formula_chunks ORDER BY chunk_id"
                ).fetchall()
            ]
            changed = sum(
                1 for chunk_id in chunk_ids
                if self._recompute_chunk_eligibility_sync(chunk_id, increment_revision=True)
            )
            if changed:
                self._touch_retrieval_revision()
        return changed

    async def remove_chunks(self, chunk_ids: Sequence[str]) -> None:
        await asyncio.to_thread(self._remove_chunks_sync, list(chunk_ids))

    def _remove_chunks_sync(self, chunk_ids: Sequence[str]) -> None:
        if not chunk_ids:
            return
        placeholders = ",".join("?" for _ in chunk_ids)
        with self._lock, self._connection:
            self._connection.execute(f"DELETE FROM document_chunks WHERE id IN ({placeholders})", list(chunk_ids))
            self._touch_retrieval_revision()

    async def upsert_embedding_profile(self, profile: EmbeddingProfile) -> None:
        await asyncio.to_thread(self._upsert_embedding_profile_sync, profile)

    def _upsert_embedding_profile_sync(self, profile: EmbeddingProfile) -> None:
        now = _utc_text()
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO embedding_profiles(id, name, provider, config_json, enabled, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider=excluded.provider,
                   config_json=excluded.config_json, enabled=excluded.enabled, updated_at=excluded.updated_at""",
                (profile.id, profile.name, profile.provider, _json(profile), int(profile.enabled), now, now),
            )

    async def list_embedding_profiles(self, *, include_disabled: bool = True) -> list[EmbeddingProfile]:
        return await asyncio.to_thread(self._list_embedding_profiles_sync, include_disabled)

    def _list_embedding_profiles_sync(self, include_disabled: bool) -> list[EmbeddingProfile]:
        where = "" if include_disabled else "WHERE enabled=1"
        with self._lock:
            rows = self._connection.execute(
                f"SELECT config_json FROM embedding_profiles {where} ORDER BY name"
            ).fetchall()
        return [EmbeddingProfile(**_loads(row["config_json"], {})) for row in rows]

    async def save_generation(
        self,
        generation: IndexGeneration,
        *,
        status: str = "building",
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        await asyncio.to_thread(self._save_generation_sync, generation, status, dict(metadata or {}))

    def _save_generation_sync(
        self, generation: IndexGeneration, status: str, metadata: Mapping[str, Any]
    ) -> None:
        now = _utc_text()
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO index_generations(
                       id, profile_id, fingerprint, dimension, distance, active,
                       status, created_at, activated_at, metadata_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,
                       dimension=excluded.dimension, distance=excluded.distance,
                       status=excluded.status, metadata_json=excluded.metadata_json""",
                (
                    generation.id,
                    generation.profile_id,
                    generation.fingerprint,
                    generation.dimension,
                    generation.distance,
                    int(generation.active),
                    status,
                    now,
                    now if generation.active else None,
                    _json({**metadata, "embedding_profile": asdict(generation.embedding_profile) if generation.embedding_profile else None}),
                ),
            )

    async def activate_generation(self, profile_id: str, generation_id: str) -> bool:
        return await asyncio.to_thread(self._activate_generation_sync, profile_id, generation_id)

    def _activate_generation_sync(self, profile_id: str, generation_id: str) -> bool:
        with self._lock, self._connection:
            exists = self._connection.execute(
                "SELECT 1 FROM index_generations WHERE id=? AND profile_id=? AND status IN ('ready','active')",
                (generation_id, profile_id),
            ).fetchone()
            if not exists:
                return False
            self._connection.execute(
                "UPDATE index_generations SET active=0, status=CASE WHEN status='active' THEN 'ready' ELSE status END WHERE profile_id=?",
                (profile_id,),
            )
            self._connection.execute(
                "UPDATE index_generations SET active=1, status='active', activated_at=? WHERE id=?",
                (_utc_text(), generation_id),
            )
            return True

    async def active_generation(self, profile_id: str) -> IndexGeneration | None:
        return await asyncio.to_thread(self._active_generation_sync, profile_id)

    def _active_generation_sync(self, profile_id: str) -> IndexGeneration | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM index_generations WHERE profile_id=? AND active=1 LIMIT 1", (profile_id,)
            ).fetchone()
        return self._generation_from_row(row) if row else None

    @staticmethod
    def _generation_from_row(row: sqlite3.Row) -> IndexGeneration:
        profile = _loads(row["metadata_json"], {}).get("embedding_profile")
        return IndexGeneration(
            id=row["id"],
            profile_id=row["profile_id"],
            fingerprint=row["fingerprint"],
            dimension=row["dimension"],
            distance=row["distance"],
            active=bool(row["active"]),
            embedding_profile=EmbeddingProfile(**profile) if profile else None,
        )

    async def search(self, request: RetrievalRequest) -> list[RetrievalHit]:
        return await asyncio.to_thread(self._search_sync, request)

    def _search_sync(self, request: RetrievalRequest) -> list[RetrievalHit]:
        terms = list(dict.fromkeys(term.casefold() for term in _FTS_TERM.findall(request.query) if len(term) > 1))
        if not terms:
            return []
        match = " OR ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in terms[:24])
        selected_clause = ""
        selected_args: tuple[Any, ...] = ()
        if request.document_ids:
            selected_clause = " AND c.document_id IN (" + ",".join("?" for _ in request.document_ids) + ")"
            selected_args = request.document_ids
        with self._lock:
            rows = self._connection.execute(
                """SELECT c.*, d.title, d.scope_kind, d.owner_id, bm25(document_chunks_fts) AS rank
                   FROM document_chunks_fts
                   JOIN document_chunks c ON c.rowid=document_chunks_fts.rowid
                   JOIN documents d ON d.id=c.document_id AND d.version=c.document_version
                   WHERE document_chunks_fts MATCH ?
                     AND d.enabled=1 AND c.retrieval_eligible=1
                   """ + selected_clause + " ORDER BY rank LIMIT ?",
                (match, *selected_args, max(1, request.candidate_limit * 4)),
            ).fetchall()
        hits: list[RetrievalHit] = []
        for row in rows:
            if not self._scope_matches(row["scope_kind"], row["owner_id"], request.scope):
                continue
            rank = float(row["rank"])
            score = 1.0 / (1.0 + max(0.0, rank))
            hits.append(
                RetrievalHit(
                    chunk_id=row["id"],
                    text=row["text"],
                    score=score,
                    source={
                        "document_id": row["document_id"],
                        "document_version": row["document_version"],
                        "title": row["title"],
                        "page": row["page"],
                        "heading": row["heading"],
                    },
                    metadata={
                        **_loads(row["metadata_json"], {}),
                        "retriever": "fts5",
                        "raw_rank": rank,
                        "semantic_text": row["semantic_text"],
                        "token_count": row["token_count"],
                        "verification_revision": row["verification_revision"],
                    },
                )
            )
            if len(hits) >= request.candidate_limit:
                break
        return hits

    @staticmethod
    def _scope_matches(scope_kind: str, owner_id: str | None, scope: SourceScope) -> bool:
        if scope_kind == "builtin":
            return scope.builtin
        if scope_kind == "workspace":
            return owner_id is not None and owner_id in scope.workspace_ids
        if scope_kind == "chat":
            return owner_id is not None and owner_id in scope.chat_ids
        return False
