from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .adapters.document_extraction import OfflineDocumentExtractor, OfflineOCREngine
from .adapters.embeddings import EmbeddingProviderRegistry, SentenceTransformerEmbeddingProvider
from .adapters.langgraph_runner import LangGraphDocumentIngestionRunner, LangGraphQueryReasoningRunner
from .adapters.ollama import OllamaClient
from .adapters.services import LocalServiceSpec, LocalServiceSupervisor
from .adapters.symbolic import RestrictedSymbolicEngine
from .adapters.vector_store import QdrantVectorStore
from .application.ingestion import DocumentIngestionPipeline
from .application.conversations import ConversationService
from .application.backups import BackupService, apply_pending_restore
from .application.profiles import EmbeddingProfileCatalog
from .application.reasoning import ReasoningProfileCatalog
from .application.resources import InferenceScheduler, ResourceManager
from .application.retrieval import HybridRetrievalService
from .application.runs import IngestionRunCoordinator, RunCoordinator
from .application.analysis import AnalysisReadTool, AnalysisWorkflowRunner
from .application.services import QueryReasoningService
from .application.tools import RagSearchTool, SymbolicMathTool, ToolRegistry
from .application.workflows import DocumentIngestionGraph, QueryReasoningGraph
from .application.workflow_diagrams import WorkflowDiagramService
from .application.dataset_trees import DatasetTreeService
from .application.knowledge_folders import KnowledgeFolderStorage
from .config import BackendSettings
from .domain.models import DocumentChunk, SourceScope, ToolPolicy
from .formulas.validator import SafeFormulaValidator
from .storage.checkpoints import LegacyStateRepository, SQLiteCheckpointStore
from .storage.sqlite_repository import SQLiteKnowledgeRepository
from .storage.analysis_store import AnalysisStore


@dataclass(slots=True)
class ApplicationContainer:
    settings: BackendSettings
    repository: SQLiteKnowledgeRepository
    checkpoints: SQLiteCheckpointStore
    legacy: LegacyStateRepository
    conversations: ConversationService
    resources: ResourceManager
    scheduler: InferenceScheduler
    embeddings: EmbeddingProviderRegistry
    profiles: EmbeddingProfileCatalog
    llm: OllamaClient
    retriever: HybridRetrievalService
    query_runs: RunCoordinator
    ingestion_runs: IngestionRunCoordinator
    ingestion_pipeline: DocumentIngestionPipeline
    tools: ToolRegistry
    workflow_diagrams: WorkflowDiagramService
    dataset_trees: DatasetTreeService
    knowledge_folders: KnowledgeFolderStorage
    services: LocalServiceSupervisor
    backups: BackupService
    analyses: AnalysisStore

    async def close(self) -> None:
        await self.query_runs.close()
        await self.ingestion_runs.close()
        await self.analyses.close()
        await self.llm.close()
        await self.services.stop_owned()
        await self.repository.close()
        await self.checkpoints.close()
        await self.legacy.close()


async def build_container(settings: BackendSettings | None = None) -> ApplicationContainer:
    explicit_settings = settings is not None
    settings = settings or BackendSettings.load()
    settings.validate()
    restored = apply_pending_restore(settings.data_dir)
    if restored and not explicit_settings:
        settings = BackendSettings.load(settings.data_dir)
        settings.validate()
    for name in ("config", "documents", "work", "index", "logs"):
        (settings.data_dir / name).mkdir(parents=True, exist_ok=True)

    repository = SQLiteKnowledgeRepository(settings.data_dir / "vector_ai.sqlite3")
    analyses = AnalysisStore(settings.data_dir / "vector_ai.sqlite3")
    try:
        # Stores written before the current policy can hide a chunk behind a
        # ratio typed into a table; refresh once so existing documents answer
        # without a manual reindex. A stale flag must never stop startup, and
        # the pass reads only SQLite, so it is safe while Qdrant is down.
        await repository.recompute_retrieval_eligibility()
    except Exception:
        pass
    knowledge_folders = KnowledgeFolderStorage(repository, settings.data_dir)
    workflow_diagrams = WorkflowDiagramService(repository)
    checkpoints = SQLiteCheckpointStore(settings.data_dir / "workflow_checkpoints.sqlite3")
    legacy = LegacyStateRepository(settings.data_dir / "legacy_state.sqlite3")
    resources = ResourceManager(settings.resource_limits)
    scheduler = InferenceScheduler(resources)
    profiles = EmbeddingProfileCatalog(settings.data_dir / "config" / "embedding_profiles.json")
    embeddings = EmbeddingProviderRegistry()
    for profile in profiles.list():
        await repository.upsert_embedding_profile(profile)
        if profile.enabled and profile.provider == "sentence-transformers":
            embeddings.register(SentenceTransformerEmbeddingProvider(profile))

    vectors = QdrantVectorStore(settings.qdrant_url, repository)
    retriever = HybridRetrievalService(
        lexical=repository,
        vectors=vectors,
        embeddings=embeddings,
        scheduler=scheduler,
    )
    symbolic = RestrictedSymbolicEngine()
    validator = SafeFormulaValidator(symbolic_engine=symbolic, auto_verify_confidence=settings.auto_verify_confidence)
    reasoning = ReasoningProfileCatalog()
    llm = OllamaClient(settings.ollama_url, keep_alive=settings.ollama_keep_alive)
    query_service = QueryReasoningService(
        retriever=retriever,
        llm=llm,
        reasoning_profiles=reasoning,
        scheduler=scheduler,
        chat_ram_mb=settings.chat_ram_mb,
        chat_gpu_mb=settings.chat_gpu_mb,
    )
    query_graph = QueryReasoningGraph(query_service, checkpoints)
    query_runner = LangGraphQueryReasoningRunner(query_graph)

    extraction_work = settings.data_dir / "work" / "extraction"
    pipeline = DocumentIngestionPipeline(
        repository=repository,
        extractor=OfflineDocumentExtractor(extraction_work),
        ocr=OfflineOCREngine(),
        validator=validator,
        profile_catalog=profiles,
        embeddings=embeddings,
        vectors=vectors,
        scheduler=scheduler,
        checkpoints=checkpoints,
        work_dir=settings.data_dir / "work" / "ingestion",
        default_profile_id=settings.default_embedding_profile_id,
    )
    ingestion_graph = DocumentIngestionGraph(steps=pipeline.steps, checkpoints=checkpoints, scheduler=scheduler)
    pipeline.knowledge_folders = knowledge_folders
    ingestion_runner = LangGraphDocumentIngestionRunner(ingestion_graph)

    policy = ToolPolicy(
        allowed_tools=frozenset({"math.sympy", "rag.search", "gis.measurements", "gis.quality", "reports.read"}),
        allowed_capabilities=frozenset({"math", "symbolic", "rag", "retrieval", "analysis"}),
        max_timeout_seconds=20.0,
    )
    tools = ToolRegistry(scheduler, policy)
    tools.register(SymbolicMathTool(symbolic))
    tools.register(RagSearchTool(retriever, settings.default_embedding_profile_id))
    for name in ("gis.measurements", "gis.quality", "reports.read"):
        tools.register(AnalysisReadTool(analyses, name))
    dispatched_runner = AnalysisWorkflowRunner(
        legacy=query_runner, store=analyses, repository=repository, tools=tools,
        llm=llm, scheduler=scheduler, reasoning_profiles=reasoning,
        chat_ram_mb=settings.chat_ram_mb, chat_gpu_mb=settings.chat_gpu_mb,
    )
    qdrant_config = settings.data_dir / "config" / "qdrant.yaml"
    qdrant_config.write_text(
        "service:\n  host: 127.0.0.1\n  http_port: 6333\n  grpc_port: null\n  enable_cors: false\n"
        "cluster:\n  enabled: false\ntelemetry_disabled: true\n"
        f"storage:\n  storage_path: '{(settings.data_dir / 'index' / 'qdrant').as_posix()}'\n"
        f"  snapshots_path: '{(settings.data_dir / 'index' / 'snapshots').as_posix()}'\n",
        encoding="utf-8",
    )
    qdrant_candidates = [
        Path(settings.qdrant_executable) if settings.qdrant_executable else Path("__missing__"),
        settings.data_dir / "services" / "qdrant" / "qdrant.exe",
        Path(__file__).resolve().parents[2] / "tools" / "qdrant" / "qdrant.exe",
    ]
    qdrant_exe = next((path for path in qdrant_candidates if path.is_file()), None)
    services = LocalServiceSupervisor([
        LocalServiceSpec("ollama", "127.0.0.1", 11434),
        LocalServiceSpec(
            "qdrant", "127.0.0.1", 6333,
            command=(str(qdrant_exe), "--config-path", str(qdrant_config)) if qdrant_exe else (),
            cwd=qdrant_exe.parent if qdrant_exe else None,
        ),
    ])
    backups = BackupService(
        data_dir=settings.data_dir,
        repository=repository,
        checkpoints=checkpoints,
        legacy=legacy,
    )
    container = ApplicationContainer(
        settings=settings, repository=repository, checkpoints=checkpoints, legacy=legacy,
        conversations=ConversationService(legacy),
        resources=resources, scheduler=scheduler, embeddings=embeddings, profiles=profiles, llm=llm,
        retriever=retriever, query_runs=RunCoordinator(dispatched_runner, history_store=repository),
        ingestion_runs=IngestionRunCoordinator(ingestion_runner, history_store=repository), ingestion_pipeline=pipeline,
        tools=tools, workflow_diagrams=workflow_diagrams, dataset_trees=DatasetTreeService(repository, knowledge_folders), knowledge_folders=knowledge_folders, services=services, backups=backups, analyses=analyses,
    )
    await services.ensure_started("qdrant")
    await import_builtin_knowledge(container)
    await knowledge_folders.sync_safely()
    return container


async def import_builtin_knowledge(container: ApplicationContainer) -> None:
    project_root = Path(__file__).resolve().parents[2]
    path = project_root / "public" / "knowledge" / "builtin-knowledge.json"
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    documents = {item["id"]: item for item in payload.get("documents", [])}
    existing = {(item["id"], item["version"]) for item in await container.repository.list_documents()}
    for document_id, item in documents.items():
        if (document_id, 1) not in existing:
            await container.repository.upsert_document({
                "id": document_id, "version": 1, "title": item.get("title", document_id),
                "source_uri": item.get("source_file"), "sha256": item.get("sha256"),
                "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "scope_kind": "builtin", "enabled": True,
                "metadata": {"builtin": True, "knowledge_id": payload.get("knowledge_id")},
            })
    by_document: dict[str, list[DocumentChunk]] = {}
    for raw in payload.get("chunks", []):
        document_id = str(raw["document_id"])
        if (document_id, 1) in existing:
            continue
        by_document.setdefault(document_id, []).append(DocumentChunk(
            id=str(raw["id"]), document_id=document_id, document_version=1,
            text=str(raw.get("text", "")), ordinal=max(0, int(raw.get("index", 1)) - 1),
            scope=SourceScope(builtin=True), heading=raw.get("heading"),
            metadata={"builtin": True, "token_count": max(1, len(str(raw.get("text", ""))) // 4)},
        ))
    for chunks in by_document.values():
        await container.repository.upsert_chunks(chunks)
