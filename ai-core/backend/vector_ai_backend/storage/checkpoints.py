from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class SQLiteCheckpointStore:
    """Durable, namespaced checkpoints shared by neither graph state type."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        with self._connection:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute(
                """CREATE TABLE IF NOT EXISTS workflow_checkpoints(
                    namespace TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(namespace, run_id)
                )"""
            )

    async def load(self, namespace: str, run_id: str) -> Mapping[str, Any] | None:
        return await asyncio.to_thread(self._load, namespace, run_id)

    def _load(self, namespace: str, run_id: str) -> Mapping[str, Any] | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT payload_json FROM workflow_checkpoints WHERE namespace=? AND run_id=?",
                (namespace, run_id),
            ).fetchone()
        return json.loads(row[0]) if row else None

    async def save(self, namespace: str, run_id: str, state: Mapping[str, Any]) -> None:
        await asyncio.to_thread(self._save, namespace, run_id, dict(state))

    def _save(self, namespace: str, run_id: str, state: Mapping[str, Any]) -> None:
        payload = json.dumps(state, ensure_ascii=False, sort_keys=True)
        timestamp = datetime.now(UTC).isoformat()
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO workflow_checkpoints(namespace,run_id,payload_json,updated_at)
                   VALUES(?,?,?,?) ON CONFLICT(namespace,run_id) DO UPDATE SET
                   payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                (namespace, run_id, payload, timestamp),
            )

    async def delete(self, namespace: str, run_id: str) -> None:
        await asyncio.to_thread(self._delete, namespace, run_id)

    def _delete(self, namespace: str, run_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM workflow_checkpoints WHERE namespace=? AND run_id=?",
                (namespace, run_id),
            )

    async def close(self) -> None:
        await asyncio.to_thread(self._connection.close)

    async def backup_to(self, target: str | Path) -> None:
        await asyncio.to_thread(self._backup_to, Path(target))

    def _backup_to(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            destination = sqlite3.connect(target)
            try:
                self._connection.backup(destination)
            finally:
                destination.close()


class LegacyStateRepository:
    """Recoverable/idempotent destination for the one-time origin migration."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        with self._connection:
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS legacy_imports(
                    payload_hash TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    imported_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS app_state(
                    kind TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(kind, item_id)
                );
                CREATE TABLE IF NOT EXISTS conversation_state(
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                    revision INTEGER NOT NULL,
                    operation_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    async def read_conversation_state(self) -> Mapping[str, Any]:
        def read():
            with self._lock:
                row = self._connection.execute("SELECT revision,operation_id,payload_json,updated_at FROM conversation_state WHERE singleton=1").fetchone()
            return {"revision": row[0], "operation_id": row[1], "payload": json.loads(row[2]), "updated_at": row[3]} if row else {"revision": 0, "payload": None, "operation_id": None}
        return await asyncio.to_thread(read)

    async def write_conversation_state(self, payload: Mapping[str, Any], expected_revision: int, operation_id: str) -> Mapping[str, Any] | None:
        def write():
            serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, allow_nan=False)
            with self._lock:
                # BEGIN IMMEDIATE serializes CAS across separate connections,
                # not just threads sharing this repository instance.
                self._connection.execute("BEGIN IMMEDIATE")
                try:
                    row = self._connection.execute("SELECT revision,operation_id,payload_json FROM conversation_state WHERE singleton=1").fetchone()
                    revision = row[0] if row else 0
                    if row and row[1] == operation_id:
                        return {"revision": revision, "operation_id": operation_id} if row[2] == serialized else None
                    if revision != expected_revision:
                        return None
                    now = datetime.now(UTC).isoformat()
                    self._connection.execute(
                        """INSERT INTO conversation_state VALUES(1,?,?,?,?)
                        ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,
                        operation_id=excluded.operation_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at""",
                        (revision + 1, operation_id, serialized, now),
                    )
                    self._connection.commit()
                    return {"revision": revision + 1, "operation_id": operation_id}
                finally:
                    if self._connection.in_transaction:
                        self._connection.rollback()
        return await asyncio.to_thread(write)

    async def import_payload(self, payload_hash: str, payload: Mapping[str, Any]) -> bool:
        return await asyncio.to_thread(self._import, payload_hash, dict(payload))

    async def latest_payload(self) -> dict[str, Any] | None:
        def read():
            with self._lock:
                row = self._connection.execute(
                    "SELECT payload_hash,payload_json FROM legacy_imports ORDER BY imported_at DESC LIMIT 1"
                ).fetchone()
            return {"payload_hash": row[0], "payload": json.loads(row[1])} if row else None
        return await asyncio.to_thread(read)

    def _import(self, payload_hash: str, payload: dict[str, Any]) -> bool:
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        now = datetime.now(UTC).isoformat()
        with self._lock, self._connection:
            found = self._connection.execute(
                "SELECT 1 FROM legacy_imports WHERE payload_hash=?", (payload_hash,)
            ).fetchone()
            if found:
                return False
            self._connection.execute(
                "INSERT INTO legacy_imports(payload_hash,payload_json,imported_at) VALUES(?,?,?)",
                (payload_hash, serialized, now),
            )
            groups = {
                "conversation": payload.get("generalChats", payload.get("chats", [])),
                "workspace": payload.get("workspaces", []),
            }
            for kind, rows in groups.items():
                if not isinstance(rows, list):
                    continue
                for index, row in enumerate(rows):
                    if not isinstance(row, dict):
                        continue
                    item_id = str(row.get("id") or f"legacy-{kind}-{index}")
                    self._connection.execute(
                        """INSERT INTO app_state(kind,item_id,payload_json,updated_at) VALUES(?,?,?,?)
                           ON CONFLICT(kind,item_id) DO UPDATE SET
                           payload_json=excluded.payload_json,updated_at=excluded.updated_at""",
                        (kind, item_id, json.dumps(row, ensure_ascii=False), now),
                    )
            settings = payload.get("settings", {})
            if isinstance(settings, dict):
                self._connection.execute(
                    """INSERT INTO app_state(kind,item_id,payload_json,updated_at) VALUES('settings','current',?,?)
                       ON CONFLICT(kind,item_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at""",
                    (json.dumps(settings, ensure_ascii=False), now),
                )
        return True

    async def close(self) -> None:
        await asyncio.to_thread(self._connection.close)

    async def backup_to(self, target: str | Path) -> None:
        await asyncio.to_thread(self._backup_to, Path(target))

    def _backup_to(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            destination = sqlite3.connect(target)
            try:
                self._connection.backup(destination)
            finally:
                destination.close()
