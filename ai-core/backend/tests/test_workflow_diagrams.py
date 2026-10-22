from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

from vector_ai_backend.application.workflow_diagrams import WorkflowDiagramService
from vector_ai_backend.domain.models import WorkflowDiagram
from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository


def _editable_nodes(diagram: WorkflowDiagram) -> list[dict[str, object]]:
    return [
        {
            "id": node.id,
            "label": node.label,
            "description": node.description,
            "x": node.x,
            "y": node.y,
        }
        for node in diagram.nodes
    ]


def test_workflow_diagram_persists_and_uses_sql_revision_as_authority(tmp_path: Path) -> None:
    async def scenario() -> None:
        database = tmp_path / "knowledge.sqlite3"
        repository = SQLiteKnowledgeRepository(database)
        service = WorkflowDiagramService(repository)
        try:
            original = await service.get("document-ingestion-v1")
            nodes = _editable_nodes(original)
            nodes[0]["label"] = "Nguồn tài liệu đã sửa"
            nodes[0]["x"] = 321.5
            saved = await service.update(
                original.id,
                {"nodes": nodes},
                expected_revision=original.revision,
            )
            assert saved.revision == 1
        finally:
            await repository.close()

        # Simulate an older/externally written payload whose embedded revision is
        # stale. The normalized SQL column is the CAS source of truth.
        with sqlite3.connect(database) as connection:
            row = connection.execute(
                "SELECT payload_json FROM workflow_diagrams WHERE id=?",
                ("document-ingestion-v1",),
            ).fetchone()
            assert row is not None
            payload = json.loads(row[0])
            payload["revision"] = 999
            connection.execute(
                "UPDATE workflow_diagrams SET revision=?, payload_json=? WHERE id=?",
                (7, json.dumps(payload, ensure_ascii=False), "document-ingestion-v1"),
            )

        reopened = SQLiteKnowledgeRepository(database)
        reopened_service = WorkflowDiagramService(reopened)
        try:
            persisted = await reopened_service.get("document-ingestion-v1")
            assert persisted.revision == 7
            assert persisted.nodes[0].label == "Nguồn tài liệu đã sửa"
            assert persisted.nodes[0].x == 321.5

            nodes = _editable_nodes(persisted)
            nodes[0]["x"] = 400
            resaved = await reopened_service.update(
                persisted.id,
                {"nodes": nodes},
                expected_revision=7,
            )
            assert resaved.revision == 8
        finally:
            await reopened.close()

        final_repository = SQLiteKnowledgeRepository(database)
        final_service = WorkflowDiagramService(final_repository)
        try:
            final = await final_service.get("document-ingestion-v1")
            assert final.revision == 8
            assert final.nodes[0].x == 400
        finally:
            await final_repository.close()

    asyncio.run(scenario())


def test_corrupt_workflow_payload_is_reconciled_and_can_be_repaired(tmp_path: Path) -> None:
    async def scenario() -> None:
        database = tmp_path / "knowledge.sqlite3"
        repository = SQLiteKnowledgeRepository(database)
        await repository.close()

        with sqlite3.connect(database) as connection:
            connection.execute(
                """INSERT INTO workflow_diagrams(id, revision, payload_json, updated_at)
                   VALUES (?, ?, ?, ?)""",
                ("query-reasoning-v1", 12, "{not-valid-json", "not-a-timestamp"),
            )

        reopened = SQLiteKnowledgeRepository(database)
        service = WorkflowDiagramService(reopened)
        try:
            recovered = await service.get("query-reasoning-v1")
            assert recovered.revision == 12
            assert recovered.name == "Truy xuất và suy luận"
            assert recovered.nodes
            assert recovered.edges
            assert recovered.updated_at is None

            nodes = _editable_nodes(recovered)
            nodes[0]["label"] = "Yêu cầu người dùng"
            repaired = await service.update(
                recovered.id,
                {"nodes": nodes},
                expected_revision=12,
            )
            assert repaired.revision == 13
            assert repaired.nodes[0].label == "Yêu cầu người dùng"
        finally:
            await reopened.close()

        final_repository = SQLiteKnowledgeRepository(database)
        final_service = WorkflowDiagramService(final_repository)
        try:
            final = await final_service.get("query-reasoning-v1")
            assert final.revision == 13
            assert final.nodes[0].label == "Yêu cầu người dùng"
            assert final.updated_at is not None
        finally:
            await final_repository.close()

    asyncio.run(scenario())
