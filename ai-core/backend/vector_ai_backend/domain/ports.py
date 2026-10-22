from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from typing import Any, Mapping, Protocol

from .models import (
    ChatRequest,
    DocumentIngestionState,
    EmbeddingCapabilities,
    EmbeddingProfile,
    ExtractedFormula,
    ExtractedPage,
    FormulaRecord,
    FormulaValidationReport,
    IndexGeneration,
    LLMRequest,
    ModelCapabilities,
    QueryReasoningState,
    RetrievalHit,
    RetrievalRequest,
    RunEvent,
    SourceScope,
    ToolDescriptor,
    ToolExecutionContext,
    ToolResult,
    VectorPoint,
    WorkflowDiagram,
)


EventEmitter = Callable[[RunEvent], Awaitable[None]]


class DocumentExtractor(Protocol):
    async def extract_native(self, path: Any) -> Sequence[ExtractedPage]: ...


class OCREngine(Protocol):
    async def recognize(self, image_path: Any) -> tuple[str, Sequence[ExtractedFormula]]: ...


class EmbeddingProvider(Protocol):
    @property
    def profile(self) -> EmbeddingProfile: ...

    @property
    def capabilities(self) -> EmbeddingCapabilities: ...

    async def embed_documents(self, texts: Sequence[str]) -> Sequence[Sequence[float]]: ...

    async def embed_query(self, text: str) -> Sequence[float]: ...


class VectorStore(Protocol):
    async def health(self) -> Mapping[str, Any]: ...

    async def create_generation(self, generation: IndexGeneration) -> None: ...

    async def upsert(self, generation_id: str, points: Sequence[VectorPoint]) -> None: ...

    async def search(
        self,
        generation_id: str,
        vector: Sequence[float],
        *,
        scope: SourceScope,
        limit: int,
        filters: Mapping[str, Any] | None = None,
    ) -> Sequence[RetrievalHit]: ...

    async def activate_generation(self, profile_id: str, generation_id: str) -> None: ...

    async def active_generation(self, profile_id: str) -> IndexGeneration | None: ...

    async def delete_generation(self, generation_id: str) -> None: ...


class LexicalIndex(Protocol):
    async def search(self, request: RetrievalRequest) -> Sequence[RetrievalHit]: ...

    async def remove_chunks(self, chunk_ids: Sequence[str]) -> None: ...


class Retriever(Protocol):
    async def retrieve(self, request: RetrievalRequest) -> Sequence[RetrievalHit]: ...


class FormulaValidator(Protocol):
    async def validate(
        self,
        formula: FormulaRecord,
        *,
        reference: FormulaRecord | None = None,
    ) -> FormulaValidationReport: ...


class SymbolicEngine(Protocol):
    async def evaluate(self, expression: str, variables: Mapping[str, Any]) -> Any: ...

    async def simplify(self, expression: str) -> str: ...

    async def solve(self, expression: str, symbol: str) -> Sequence[str]: ...

    async def equivalent(
        self,
        left: str,
        right: str,
        assumptions: Sequence[str],
    ) -> bool | None: ...


class LLMClient(Protocol):
    async def capabilities(self, model: str) -> ModelCapabilities: ...

    def stream_chat(self, request: LLMRequest) -> AsyncIterator[Mapping[str, Any]]: ...


class Tool(Protocol):
    @property
    def descriptor(self) -> ToolDescriptor: ...

    async def execute(
        self,
        arguments: Mapping[str, Any],
        context: ToolExecutionContext,
    ) -> ToolResult: ...


class CheckpointStore(Protocol):
    async def load(self, namespace: str, run_id: str) -> Mapping[str, Any] | None: ...

    async def save(self, namespace: str, run_id: str, state: Mapping[str, Any]) -> None: ...

    async def delete(self, namespace: str, run_id: str) -> None: ...


class ConversationStore(Protocol):
    async def read_conversation_state(self) -> Mapping[str, Any]: ...

    async def write_conversation_state(
        self, payload: Mapping[str, Any], expected_revision: int, operation_id: str,
    ) -> Mapping[str, Any] | None:
        """Atomic compare-and-swap; None means a revision conflict."""
        ...


class RunHistoryStore(Protocol):
    async def record_run_event(self, kind: str, event: RunEvent) -> None: ...

    async def list_run_summaries(self, limit: int = 200) -> Sequence[Mapping[str, Any]]: ...


class WorkflowDiagramStore(Protocol):
    async def read_workflow_diagram(self, workflow_id: str) -> WorkflowDiagram | None: ...

    async def write_workflow_diagram(
        self,
        diagram: WorkflowDiagram,
        *,
        expected_revision: int,
    ) -> bool: ...

    async def delete_workflow_diagram(
        self,
        workflow_id: str,
        *,
        expected_revision: int | None = None,
    ) -> bool: ...


class DocumentIngestionRunner(Protocol):
    async def run(
        self,
        state: DocumentIngestionState,
        emit: EventEmitter,
    ) -> DocumentIngestionState: ...

    async def cancel(self, run_id: str) -> None: ...


class QueryReasoningRunner(Protocol):
    async def run(self, state: QueryReasoningState, emit: EventEmitter) -> QueryReasoningState: ...

    async def cancel(self, run_id: str) -> None: ...
