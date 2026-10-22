from __future__ import annotations

import hashlib
import json
import re
import shutil
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any, AsyncIterator
from uuid import uuid4

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from .bootstrap import ApplicationContainer, build_container
from .application.dataset_trees import (
    DatasetTreeConflict,
    DatasetTreeNotFound,
    KnowledgeCatalogConflict,
)
from .application.conversations import ConversationConflict
from .domain.models import (
    ChatMessage,
    ChatRequest,
    DocumentIngestionState,
    QueryReasoningState,
    ReasoningMode,
    RetrievalRequest,
    SourceScope,
    ToolExecutionContext,
    ToolPolicy,
    ToolRequest,
    VerificationStatus,
)
from .application.ingestion import register_document
from .application.runs import RunNotFoundError
from .application.workflow_diagrams import (
    WorkflowDiagramConflict,
    WorkflowDiagramNotFound,
)
from .lifecycle import RuntimeIdentity


ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".json", ".jsonl", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_BACKUP_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^\w. -]+", re.UNICODE)


def _document_source_path(value: Any) -> Path | None:
    if not value:
        return None
    path = Path(str(value))
    if path.is_file():
        return path.resolve()
    if not path.is_absolute():
        bundled = Path(__file__).resolve().parents[2] / "knowledge_sources" / path.name
        if bundled.is_file():
            return bundled.resolve()
    return None


def _revision(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("revision phải là số nguyên không âm")
    return value


def _scope(raw: Any) -> SourceScope:
    if not isinstance(raw, dict):
        return SourceScope()
    return SourceScope(
        builtin=bool(raw.get("builtin", True)),
        workspace_ids=tuple(str(item) for item in raw.get("workspace_ids", raw.get("workspaceIds", [])) if item),
        chat_ids=tuple(str(item) for item in raw.get("chat_ids", raw.get("chatIds", [])) if item),
    )


def _scope_storage(raw: dict[str, Any]) -> tuple[str, str | None]:
    workspace = raw.get("workspace_ids", raw.get("workspaceIds", []))
    chat = raw.get("chat_ids", raw.get("chatIds", []))
    if workspace:
        return "workspace", str(workspace[0])
    if chat:
        return "chat", str(chat[0])
    return "builtin", None


def _sse(events: AsyncIterator[Any]) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        async for event in events:
            value = event.to_dict()
            yield f"event: {value['type']}\ndata: {json.dumps(value, ensure_ascii=False)}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def create_app(
    container: ApplicationContainer | None = None,
    *,
    runtime_identity: RuntimeIdentity | None = None,
) -> FastAPI:
    state: dict[str, ApplicationContainer | None] = {"container": container}
    identity = runtime_identity or RuntimeIdentity.from_environment()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if state["container"] is None:
            state["container"] = await build_container()
        yield
        if container is None and state["container"] is not None:
            await state["container"].close()

    app = FastAPI(title="VECTOR AI Python Core", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:3000", "http://localhost:1420"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Accept"],
    )

    def core() -> ApplicationContainer:
        value = state["container"]
        if value is None:
            raise HTTPException(503, "Python Core chưa khởi tạo")
        return value

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
        value = core()
        return {
            "status": "ready",
            "address": "127.0.0.1:8000",
            "offline": True,
            **identity.to_dict(),
            "services": await value.services.health(),
            "scheduler": await value.resources.snapshot(),
            "graphs": {
                "document_ingestion": type(value.ingestion_runs._runner).__name__,
                "query_reasoning": type(value.query_runs._runner).__name__,
            },
        }

    @app.get("/api/v1/models")
    async def models() -> dict[str, Any]:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{core().settings.ollama_url}/api/tags")
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            raise HTTPException(503, f"Ollama chưa sẵn sàng: {exc}") from exc

    @app.post("/api/v1/runs")
    async def start_query(payload: dict[str, Any] = Body(...)) -> dict[str, str]:
        try:
            messages = tuple(
                ChatMessage(
                    role=str(item["role"]), content=str(item["content"]),
                    images=tuple(str(image) for image in item.get("images", []) if image),
                )
                for item in payload.get("messages", [])
            )
            if not messages:
                raise ValueError("Cần ít nhất một message")
            request = ChatRequest(
                model=str(payload["model"]), messages=messages,
                mode=ReasoningMode(str(payload.get("mode", "FAST")).upper()),
                scope=_scope(payload.get("scope")), workflow_id=str(payload.get("workflow_id") or "query-reasoning-v1"),
                embedding_profile_id=str(payload.get("embedding_profile_id") or core().settings.default_embedding_profile_id),
                strict_sources=bool(payload.get("strict_sources", True)),
                run_id=str(payload.get("run_id") or uuid4()), target_message_id=payload.get("target_message_id"), branch_id=payload.get("branch_id"),
            )
            await core().query_runs.start(QueryReasoningState(request=request))
            return {"run_id": request.run_id}
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/v1/runs/{run_id}/events")
    async def run_events(run_id: str):
        if core().query_runs.has(run_id):
            return _sse(core().query_runs.events(run_id))
        if core().ingestion_runs.has(run_id):
            return _sse(core().ingestion_runs.events(run_id))
        raise HTTPException(404, "Không tìm thấy run")

    @app.delete("/api/v1/runs/{run_id}", status_code=204)
    async def cancel_run(run_id: str) -> None:
        try:
            await core().query_runs.cancel(run_id)
        except RunNotFoundError:
            try:
                await core().ingestion_runs.cancel(run_id)
            except RunNotFoundError as exc:
                raise HTTPException(404, "Không tìm thấy run") from exc

    @app.get("/api/v1/ingestion-runs/{run_id}/events")
    async def ingestion_events(run_id: str):
        try:
            return _sse(core().ingestion_runs.events(run_id))
        except RunNotFoundError as exc:
            raise HTTPException(404, "Không tìm thấy ingestion run") from exc

    @app.get("/api/v1/profiles/embedding")
    async def list_profiles() -> dict[str, Any]:
        return {"profiles": jsonable_encoder(core().profiles.list())}

    @app.post("/api/v1/profiles/embedding")
    async def save_profile(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from .domain.models import EmbeddingProfile
        from .adapters.embeddings import SentenceTransformerEmbeddingProvider
        try:
            aliases = {"model": "model_path", "revision": "model_revision"}
            normalized = {aliases.get(key, key): value for key, value in payload.items()}
            profile = EmbeddingProfile(**normalized)
            core().profiles.upsert(profile)
            await core().repository.upsert_embedding_profile(profile)
            if profile.enabled and profile.provider == "sentence-transformers":
                core().embeddings.register(SentenceTransformerEmbeddingProvider(profile))
            return jsonable_encoder(profile)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/v1/profiles/embedding/{profile_id}/duplicate")
    async def duplicate_profile(profile_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from .adapters.embeddings import SentenceTransformerEmbeddingProvider
        try:
            duplicate = core().profiles.duplicate(
                profile_id,
                str(payload["id"]),
                str(payload.get("name") or payload["id"]),
            )
            await core().repository.upsert_embedding_profile(duplicate)
            if duplicate.enabled and duplicate.provider == "sentence-transformers":
                core().embeddings.register(SentenceTransformerEmbeddingProvider(duplicate))
            return jsonable_encoder(duplicate)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/v1/documents")
    async def list_documents(state: str = "active") -> dict[str, Any]:
        if state not in {"active", "archived", "trashed", "all"}:
            raise HTTPException(422, "Trạng thái tài liệu không hợp lệ")
        documents = await core().repository.list_documents()
        return {"documents": [doc for doc in documents if state == "all" or doc.get("lifecycle", "active") == state]}

    @app.get("/api/v1/knowledge/storage")
    async def knowledge_storage() -> dict[str, Any]:
        return await core().knowledge_folders.sync_safely()

    @app.post("/api/v1/knowledge/storage/open")
    async def open_knowledge_storage(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        try:
            return await core().knowledge_folders.open_folder(payload.get("document_id"), int(payload.get("version", 1)), str(payload.get("state", "active")))
        except (ValueError, OSError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/v1/knowledge/storage/export")
    async def export_knowledge_folder(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return await core().knowledge_folders.export_folder(str(payload.get("destination", "")), str(payload.get("state", "active")))
        except (ValueError, OSError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/v1/documents", status_code=202)
    async def upload_document(file: UploadFile = File(...), scope: str = Form("{}"), embedding_profile_id: str = Form("")) -> dict[str, Any]:
        suffix = Path(file.filename or "").suffix.casefold()
        if suffix not in ALLOWED_EXTENSIONS:
            raise HTTPException(415, "Chỉ nhận PDF, DOCX, text/JSON/CSV và ảnh được hỗ trợ")
        try:
            raw_scope = json.loads(scope or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(422, "Scope không hợp lệ") from exc
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Tệp vượt quá giới hạn 100 MB")
        digest = hashlib.sha256(content).hexdigest()
        document_id = f"doc-{digest[:24]}"
        previous = [item for item in await core().repository.list_documents() if item.get("sha256") == digest]
        if previous:
            raise HTTPException(409, {"message": "Tài liệu đã được nhập", "document": previous[0]})
        filename = _SAFE_NAME.sub("_", Path(file.filename or f"document{suffix}").name)
        target_dir = core().settings.data_dir / "documents" / document_id / "v1"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / filename
        target.write_bytes(content)
        kind, owner = _scope_storage(raw_scope if isinstance(raw_scope, dict) else {})
        await register_document(core().repository, document_id=document_id, version=1, title=Path(filename).stem, source_path=target, scope_kind=kind, owner_id=owner)
        run_id = str(uuid4())
        state_value = DocumentIngestionState(run_id=run_id, document_id=document_id, document_version=1, checkpoint={
            "source_path": str(target), "scope_kind": kind, "owner_id": owner,
            "embedding_profile_id": embedding_profile_id or core().settings.default_embedding_profile_id,
        })
        await core().ingestion_runs.start(state_value)
        await core().knowledge_folders.sync_safely()
        return {"id": document_id, "run_id": run_id, "event_url": f"/api/v1/ingestion-runs/{run_id}/events"}

    @app.post("/api/v1/documents/blank", status_code=201)
    async def create_blank_document(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            raise HTTPException(422, "Tên tài liệu không được để trống")
        title = title.strip()
        if len(title) > 120:
            raise HTTPException(422, "Tên tài liệu có tối đa 120 ký tự")
        raw_scope = payload.get("scope", {})
        if not isinstance(raw_scope, dict):
            raise HTTPException(422, "Scope không hợp lệ")
        document_id = f"doc-manual-{uuid4().hex[:24]}"
        filename_stem = _SAFE_NAME.sub("_", title).strip(" ._")[:100] or "tai-lieu"
        target_dir = core().settings.data_dir / "documents" / document_id / "v1"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{filename_stem}.md"
        target.write_text("", encoding="utf-8")
        kind, owner = _scope_storage(raw_scope)
        await core().repository.upsert_document({
            "id": document_id,
            "version": 1,
            "title": title,
            "source_uri": str(target),
            "sha256": None,
            "mime_type": "text/markdown",
            "scope_kind": kind,
            "owner_id": owner,
            "enabled": True,
            "metadata": {
                "original_filename": target.name,
                "processor_revision": "dataset-tree-v1",
                "empty_document": True,
            },
        })
        document = next(
            item for item in await core().repository.list_documents()
            if item["id"] == document_id and int(item["version"]) == 1
        )
        storage = await core().knowledge_folders.sync_safely()
        return {"id": document_id, "document": document, "empty": True, "storage": storage}

    @app.post("/api/v1/documents/{document_id}/share")
    async def share_document(document_id: str, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        if core().ingestion_runs.active_for_document(document_id):
            raise HTTPException(409, "Đợi tài liệu nhập hoặc lập chỉ mục xong trước khi đổi phạm vi")
        try:
            version = _revision(payload.get("version", 1))
            if version < 1:
                raise ValueError("Phiên bản tài liệu phải lớn hơn 0")
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc
        if not await core().repository.share_document(document_id, version):
            raise HTTPException(404, "Không tìm thấy tài liệu")
        core().retriever.invalidate()
        return {"ok": True, "scope_kind": "builtin", "storage": await core().knowledge_folders.sync_safely()}

    @app.patch("/api/v1/documents/{document_id}")
    async def patch_document(document_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        changed = await core().repository.set_document_enabled(document_id, int(payload.get("version", 1)), bool(payload.get("enabled", True)))
        if not changed:
            raise HTTPException(404, "Không tìm thấy tài liệu")
        core().retriever.invalidate()
        return {"ok": True}

    @app.delete("/api/v1/documents/{document_id}", status_code=204)
    async def delete_document(document_id: str, version: int = Query(default=1, ge=1)) -> None:
        if core().ingestion_runs.active_for_document(document_id):
            raise HTTPException(409, "Đợi tài liệu nhập hoặc lập chỉ mục xong trước khi xóa")
        if not await core().repository.set_document_lifecycle(document_id, version, "trashed"):
            raise HTTPException(404, "Không tìm thấy tài liệu")
        core().retriever.invalidate()
        await core().knowledge_folders.sync_safely()

    @app.post("/api/v1/documents/{document_id}/lifecycle")
    async def document_lifecycle(document_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if core().ingestion_runs.active_for_document(document_id):
            raise HTTPException(409, "Đợi tài liệu nhập hoặc lập chỉ mục xong trước khi chuyển")
        try:
            if not await core().repository.set_document_lifecycle(document_id, int(payload.get("version", 1)), str(payload.get("state", ""))):
                raise HTTPException(404, "Không tìm thấy tài liệu")
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc
        core().retriever.invalidate()
        return {"ok": True, "storage": await core().knowledge_folders.sync_safely()}

    @app.post("/api/v1/documents/{document_id}/reindex", status_code=202)
    async def reindex_document(document_id: str, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        rows = [item for item in await core().repository.list_documents() if item["id"] == document_id]
        source = _document_source_path(rows[0].get("source_uri")) if rows else None
        if not rows or source is None:
            raise HTTPException(404, "Không còn bản nguồn cục bộ để tạo lại chỉ mục")
        row = rows[0]
        if row.get("lifecycle", "active") != "active":
            raise HTTPException(409, "Khôi phục tài liệu trước khi lập chỉ mục")
        run_id = str(uuid4())
        state_value = DocumentIngestionState(run_id, document_id, int(row["version"]), checkpoint={
            "source_path": str(source), "scope_kind": row["scope_kind"], "owner_id": row["owner_id"],
            "embedding_profile_id": payload.get("embedding_profile_id") or core().settings.default_embedding_profile_id,
        })
        await core().ingestion_runs.start(state_value)
        return {"run_id": run_id, "event_url": f"/api/v1/ingestion-runs/{run_id}/events"}

    @app.get("/api/v1/formulas")
    async def list_formulas(status: str | None = None, document_id: str | None = None, limit: int = 100, offset: int = 0) -> dict[str, Any]:
        try:
            parsed = VerificationStatus(status) if status else None
        except ValueError as exc:
            raise HTTPException(422, "Trạng thái công thức không hợp lệ") from exc
        rows = await core().repository.list_formulas(document_id=document_id, status=parsed, limit=limit, offset=offset)
        return {"formulas": jsonable_encoder(rows)}

    @app.post("/api/v1/formulas/{formula_id}/review")
    async def review_formula(formula_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        formula = await core().repository.get_formula(formula_id, payload.get("version"))
        if formula is None:
            raise HTTPException(404, "Không tìm thấy công thức")
        normalized = payload.get("normalized_latex")
        if isinstance(normalized, str) and normalized.strip() and normalized.strip() != formula.normalized_latex:
            formula.normalized_latex = normalized.strip()
            formula.verification.status = VerificationStatus.NEEDS_REVIEW
            await core().repository.upsert_formula(formula)
        try:
            status_value = VerificationStatus(str(payload["status"]))
        except (KeyError, ValueError) as exc:
            raise HTTPException(422, "Trạng thái duyệt không hợp lệ") from exc
        ok = await core().repository.review_formula(formula.id, formula.version, status=status_value, reviewed_by=str(payload.get("reviewed_by") or "local-user"), reasons=tuple(payload.get("reasons", [])))
        core().retriever.invalidate()
        documents = [item for item in await core().repository.list_documents() if item["id"] == formula.document_id and int(item["version"]) == formula.document_version]
        reindex_run_id = None
        source = _document_source_path(documents[0].get("source_uri")) if documents else None
        if documents and source is not None:
            document = documents[0]
            reindex_run_id = str(uuid4())
            await core().ingestion_runs.start(DocumentIngestionState(
                reindex_run_id, formula.document_id, formula.document_version,
                checkpoint={
                    "source_path": str(source), "scope_kind": document["scope_kind"],
                    "owner_id": document["owner_id"], "embedding_profile_id": core().settings.default_embedding_profile_id,
                },
            ))
        return {"ok": ok, "requires_reindex": bool(reindex_run_id), "run_id": reindex_run_id}

    @app.post("/api/v1/retrieval/preview")
    async def retrieval_preview(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        mode = ReasoningMode(str(payload.get("mode", "FAST")).upper())
        from .application.reasoning import DEFAULT_REASONING_PROFILES
        profile = DEFAULT_REASONING_PROFILES[mode]
        request_value = RetrievalRequest(
            query=str(payload.get("query", "")), scope=_scope(payload.get("scope")),
            embedding_profile_id=str(payload.get("embedding_profile_id") or core().settings.default_embedding_profile_id),
            top_k=profile.evidence_top_k, evidence_token_limit=profile.evidence_tokens,
        )
        hits = await core().retriever.retrieve(request_value)
        return {"hits": jsonable_encoder(hits)}

    @app.get("/api/v1/knowledge/catalog")
    async def knowledge_catalog() -> dict[str, Any]:
        return await core().dataset_trees.get_catalog()

    @app.put("/api/v1/knowledge/catalog")
    async def update_knowledge_catalog(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return await core().dataset_trees.update_catalog(payload)
        except KnowledgeCatalogConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/v1/documents/{document_id}/tree")
    async def dataset_tree(document_id: str, version: int = Query(default=1, ge=1)) -> dict[str, Any]:
        try:
            return await core().dataset_trees.get(document_id, version)
        except DatasetTreeNotFound as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.put("/api/v1/documents/{document_id}/tree")
    async def update_dataset_tree(document_id: str, payload: dict[str, Any] = Body(...), version: int = Query(default=1, ge=1)) -> dict[str, Any]:
        try:
            return await core().dataset_trees.update(document_id, version, payload)
        except DatasetTreeNotFound as exc:
            raise HTTPException(404, str(exc)) from exc
        except DatasetTreeConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/v1/documents/{document_id}/tree/source/{chunk_id}")
    async def dataset_tree_source(document_id: str, chunk_id: str, version: int = Query(default=1, ge=1)) -> dict[str, Any]:
        try:
            return {"chunk": jsonable_encoder(await core().dataset_trees.chunk(document_id, version, chunk_id))}
        except DatasetTreeNotFound as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get("/api/v1/workflows")
    async def workflows() -> dict[str, Any]:
        diagrams = await core().workflow_diagrams.list()
        return {
            "workflows": [
                {
                    "id": diagram.id,
                    "name": diagram.name,
                    "description": diagram.description,
                    "revision": diagram.revision,
                    "state": "independent",
                    "checkpoint_namespace": diagram.id,
                    "node_count": len(diagram.nodes),
                    "editable_capabilities": {
                        "layout": True,
                        "labels": True,
                        "descriptions": True,
                        "runtime_topology": False,
                    },
                }
                for diagram in diagrams
            ]
        }

    @app.get("/api/v1/workflows/{workflow_id}/diagram")
    async def workflow_diagram(workflow_id: str) -> dict[str, Any]:
        try:
            return {"diagram": jsonable_encoder(await core().workflow_diagrams.get(workflow_id))}
        except WorkflowDiagramNotFound as exc:
            raise HTTPException(404, "Không tìm thấy workflow") from exc

    @app.put("/api/v1/workflows/{workflow_id}/diagram")
    async def update_workflow_diagram(
        workflow_id: str,
        payload: dict[str, Any] = Body(...),
    ) -> dict[str, Any]:
        try:
            expected_revision = _revision(payload.get("revision"))
            diagram = await core().workflow_diagrams.update(
                workflow_id,
                payload,
                expected_revision=expected_revision,
            )
            return {"diagram": jsonable_encoder(diagram)}
        except WorkflowDiagramNotFound as exc:
            raise HTTPException(404, "Không tìm thấy workflow") from exc
        except WorkflowDiagramConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.delete("/api/v1/workflows/{workflow_id}/diagram")
    async def reset_workflow_diagram(
        workflow_id: str,
        payload: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        try:
            revision = payload.get("revision")
            diagram = await core().workflow_diagrams.reset(
                workflow_id,
                expected_revision=_revision(revision) if revision is not None else None,
            )
            return {"diagram": jsonable_encoder(diagram)}
        except WorkflowDiagramNotFound as exc:
            raise HTTPException(404, "Không tìm thấy workflow") from exc
        except WorkflowDiagramConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/v1/runs")
    async def list_runs() -> dict[str, Any]:
        rows = [
            *await core().query_runs.summaries(),
            *await core().ingestion_runs.summaries(),
        ]
        rows.sort(key=lambda item: str(item.get("updated_at", "")), reverse=True)
        return {"runs": rows}

    @app.get("/api/v1/tools")
    async def tools() -> dict[str, Any]:
        return {"tools": jsonable_encoder(core().tools.descriptors())}

    @app.post("/api/v1/tools/execute")
    async def execute_tool(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        allow = frozenset(str(item) for item in payload.get("allowlist", []))
        capabilities = frozenset(str(item) for item in payload.get("capabilities", []))
        context = ToolExecutionContext(
            run_id=str(payload.get("run_id") or uuid4()), source_scope=_scope(payload.get("scope")),
            policy=ToolPolicy(allow, capabilities, float(payload.get("timeout_seconds", 15))),
            timeout_seconds=float(payload.get("timeout_seconds", 15)),
        )
        try:
            result = await core().tools.execute(ToolRequest(str(payload["name"]), dict(payload.get("arguments", {}))), context)
            return jsonable_encoder(result)
        except Exception as exc:
            raise HTTPException(422, {"code": getattr(exc, "code", "tool_error"), "message": str(exc)}) from exc

    @app.get("/api/v1/conversations/state")
    async def conversation_state() -> dict[str, Any]:
        return dict(await core().conversations.read())

    @app.put("/api/v1/conversations/state")
    async def save_conversation_state(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return dict(await core().conversations.save(
                payload.get("payload"), expected_revision=payload.get("expected_revision"),
                operation_id=payload.get("operation_id"),
            ))
        except ConversationConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/v1/migration/legacy")
    async def migrate_legacy(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if not isinstance(payload.get("generalChats"), list) or not isinstance(payload.get("workspaces"), list):
            raise HTTPException(422, "Dữ liệu migration thiếu chat hoặc workspace")
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        digest = hashlib.sha256(encoded).hexdigest()
        imported = await core().legacy.import_payload(digest, payload)
        return {"imported": imported, "payload_hash": digest, "legacy_preserved": True}

    @app.get("/api/v1/migration/legacy")
    async def latest_legacy() -> dict[str, Any]:
        return await core().legacy.latest_payload() or {"payload": None}

    @app.post("/api/v1/backups")
    async def export_backup() -> FileResponse:
        archive = await core().backups.export()
        return FileResponse(
            archive,
            media_type="application/zip",
            filename=archive.name,
        )

    @app.get("/api/v1/backups")
    async def list_backups() -> dict[str, Any]:
        directory = core().settings.data_dir / "backups"
        rows = []
        if directory.is_dir():
            for path in sorted(directory.glob("vector-ai-backup-*.zip"), reverse=True):
                rows.append({
                    "name": path.name,
                    "size": path.stat().st_size,
                    "updated_at": path.stat().st_mtime,
                })
        return {"backups": rows}

    @app.get("/api/v1/backups/restore-status")
    async def backup_restore_status() -> dict[str, Any]:
        return await core().backups.restore_status()

    @app.post("/api/v1/backups/restore", status_code=202)
    async def stage_backup_restore(file: UploadFile = File(...), frontend_restore_id: str | None = Form(default=None)) -> dict[str, Any]:
        if Path(file.filename or "").suffix.casefold() != ".zip":
            raise HTTPException(415, "Chỉ nhận backup .zip của VECTOR AI")
        restore_dir = core().settings.data_dir / "work" / "restore_uploads"
        restore_dir.mkdir(parents=True, exist_ok=True)
        target = restore_dir / f"{uuid4()}.zip"
        size = 0
        try:
            with target.open("wb") as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BACKUP_UPLOAD_BYTES:
                        raise HTTPException(413, "Backup vượt quá giới hạn 2 GB")
                    output.write(chunk)
            staged = await core().backups.stage_restore(target, frontend_restore_id)
            return {**staged, "restart_required": True}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, f"Backup không hợp lệ: {exc}") from exc
        finally:
            target.unlink(missing_ok=True)

    return app
