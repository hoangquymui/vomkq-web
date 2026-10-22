from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import Enum, IntEnum
from hashlib import sha256
import json
from typing import Any, Mapping, Sequence
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(UTC)


class CheckStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class VerificationStatus(str, Enum):
    VERIFIED = "VERIFIED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    REJECTED = "REJECTED"


class VerificationMethod(str, Enum):
    AUTOMATIC = "automatic"
    MANUAL = "manual"


class ReasoningMode(str, Enum):
    FAST = "FAST"
    NORMAL = "NORMAL"
    DEEP = "DEEP"


class WorkflowNodeKind(str, Enum):
    START = "start"
    PROCESS = "process"
    DECISION = "decision"
    END = "end"


class WorkPriority(IntEnum):
    INTERACTIVE_CHAT = 0
    INTERACTIVE_TOOL = 10
    BACKGROUND_EMBEDDING = 50
    BACKGROUND_OCR = 60
    BACKGROUND_INDEXING = 70


class RunEventType(str, Enum):
    STARTED = "started"
    STAGE = "stage"
    PROGRESS = "progress"
    SOURCES = "sources"
    DELTA = "delta"
    USAGE = "usage"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass(slots=True, frozen=True)
class SourceScope:
    builtin: bool = True
    workspace_ids: tuple[str, ...] = ()
    chat_ids: tuple[str, ...] = ()


@dataclass(slots=True, frozen=True)
class EmbeddingCapabilities:
    dimension: int
    max_input_tokens: int
    tokenizer: str
    normalization: str = "l2"


@dataclass(slots=True, frozen=True)
class EmbeddingProfile:
    id: str
    name: str
    provider: str
    model_path: str
    model_revision: str
    dimension: int
    max_input_tokens: int = 512
    query_template: str = "{text}"
    document_template: str = "{text}"
    normalization: str = "l2"
    device: str = "cpu"
    enabled: bool = True
    resources: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.dimension <= 0:
            raise ValueError("Embedding dimension must be positive")
        if "{text}" not in self.query_template or "{text}" not in self.document_template:
            raise ValueError("Embedding templates must contain {text}")

    def fingerprint(
        self,
        *,
        chunker_version: str,
        semantic_representation_version: str,
    ) -> str:
        payload = {
            "provider": self.provider,
            "model_path": self.model_path,
            "model_revision": self.model_revision,
            "dimension": self.dimension,
            "max_input_tokens": self.max_input_tokens,
            "query_template": self.query_template,
            "document_template": self.document_template,
            "normalization": self.normalization,
            "chunker_version": chunker_version,
            "semantic_representation_version": semantic_representation_version,
        }
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        return sha256(encoded).hexdigest()


@dataclass(slots=True, frozen=True)
class ReasoningProfile:
    mode: ReasoningMode
    label: str
    thinking: bool
    context_tokens: int
    generation_tokens: int
    evidence_top_k: int
    evidence_tokens: int


@dataclass(slots=True, frozen=True)
class WorkflowDiagramNode:
    id: str
    label: str
    kind: WorkflowNodeKind
    x: float
    y: float
    description: str = ""
    runtime_stage: str | None = None
    runtime_locked: bool = True


@dataclass(slots=True, frozen=True)
class WorkflowDiagramEdge:
    id: str
    source: str
    target: str
    label: str = ""


@dataclass(slots=True, frozen=True)
class WorkflowDiagram:
    id: str
    name: str
    description: str
    revision: int
    nodes: tuple[WorkflowDiagramNode, ...]
    edges: tuple[WorkflowDiagramEdge, ...]
    updated_at: datetime | None = None


@dataclass(slots=True)
class DocumentChunk:
    id: str
    document_id: str
    document_version: int
    text: str
    ordinal: int
    scope: SourceScope = field(default_factory=SourceScope)
    formula_ids: list[str] = field(default_factory=list)
    page: int | None = None
    heading: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    semantic_representation_version: str = "formula-semantic-v1"
    verification_revision: int = 0


@dataclass(slots=True)
class ExtractedFormula:
    latex: str
    confidence: float | None
    source: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ExtractedPage:
    page: int
    text: str
    image_paths: list[str] = field(default_factory=list)
    formulas: list[ExtractedFormula] = field(default_factory=list)


@dataclass(slots=True, frozen=True)
class FormulaCheckResult:
    name: str
    category: str
    status: CheckStatus
    message: str = ""
    details: Mapping[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class VerificationMetadata:
    status: VerificationStatus = VerificationStatus.NEEDS_REVIEW
    method: VerificationMethod | None = None
    validator_version: str = ""
    confidence: float | None = None
    checks: list[FormulaCheckResult] = field(default_factory=list)
    reference_id: str | None = None
    reference_version: int | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    reasons: list[str] = field(default_factory=list)


@dataclass(slots=True)
class FormulaRecord:
    id: str
    version: int
    document_id: str
    document_version: int
    name: str | None
    aliases: list[str]
    raw_latex: str
    normalized_latex: str
    sympy_expression: str | None
    variables: dict[str, str]
    units: dict[str, str]
    conditions: list[str]
    assumptions: list[str]
    source: dict[str, Any]
    verification: VerificationMetadata = field(default_factory=VerificationMetadata)
    chunk_ids: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True, frozen=True)
class FormulaValidationReport:
    formula_id: str
    syntax_checks: tuple[FormulaCheckResult, ...]
    mathematical_checks: tuple[FormulaCheckResult, ...]
    recommended_status: VerificationStatus
    validator_version: str


@dataclass(slots=True, frozen=True)
class IndexGeneration:
    id: str
    profile_id: str
    fingerprint: str
    dimension: int
    distance: str = "cosine"
    active: bool = False
    embedding_profile: EmbeddingProfile | None = None


@dataclass(slots=True, frozen=True)
class VectorPoint:
    id: str
    vector: tuple[float, ...]
    payload: Mapping[str, Any]


@dataclass(slots=True, frozen=True)
class RetrievalRequest:
    query: str
    scope: SourceScope
    embedding_profile_id: str
    generation_id: str | None = None
    top_k: int = 4
    candidate_limit: int = 20
    evidence_token_limit: int = 1500
    strict_sources: bool = False


@dataclass(slots=True, frozen=True)
class RetrievalHit:
    chunk_id: str
    text: str
    score: float
    source: Mapping[str, Any]
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(slots=True, frozen=True)
class ChatMessage:
    role: str
    content: str
    images: tuple[str, ...] = ()


@dataclass(slots=True, frozen=True)
class ChatRequest:
    model: str
    messages: tuple[ChatMessage, ...]
    mode: ReasoningMode = ReasoningMode.FAST
    scope: SourceScope = field(default_factory=SourceScope)
    workflow_id: str = "query-reasoning-v1"
    embedding_profile_id: str = "e5-small-local"
    strict_sources: bool = False
    run_id: str = field(default_factory=lambda: str(uuid4()))
    target_message_id: str | None = None
    branch_id: str | None = None


@dataclass(slots=True, frozen=True)
class ModelCapabilities:
    thinking_control: bool = False
    embeddings: bool = False
    vision: bool = False


@dataclass(slots=True, frozen=True)
class LLMRequest:
    model: str
    messages: tuple[ChatMessage, ...]
    context_tokens: int
    generation_tokens: int
    thinking: bool | None
    run_id: str


@dataclass(slots=True, frozen=True)
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass(slots=True, frozen=True)
class RunEvent:
    run_id: str
    type: RunEventType
    stage: str | None = None
    progress: float | None = None
    message: str | None = None
    data: Mapping[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["type"] = self.type.value
        value["created_at"] = self.created_at.isoformat()
        return value


@dataclass(slots=True, frozen=True)
class ResourceLimits:
    cpu_slots: int
    ram_mb: int
    gpu_mb: int
    allow_exclusive_gpu: bool = True


@dataclass(slots=True, frozen=True)
class ResourceRequest:
    owner: str
    priority: WorkPriority
    cpu_slots: int = 1
    ram_mb: int = 0
    gpu_mb: int = 0
    exclusive_gpu: bool = False


@dataclass(slots=True, frozen=True)
class ToolDescriptor:
    name: str
    version: str
    description: str
    input_schema: Mapping[str, Any]
    output_schema: Mapping[str, Any]
    capabilities: tuple[str, ...] = ()


@dataclass(slots=True, frozen=True)
class ToolPolicy:
    allowed_tools: frozenset[str]
    allowed_capabilities: frozenset[str] = frozenset()
    max_timeout_seconds: float = 15.0


@dataclass(slots=True, frozen=True)
class ToolRequest:
    name: str
    arguments: Mapping[str, Any]


@dataclass(slots=True)
class ToolExecutionContext:
    run_id: str
    source_scope: SourceScope
    policy: ToolPolicy
    timeout_seconds: float = 15.0
    cancellation: Any = None
    emit_progress: Any = None


@dataclass(slots=True, frozen=True)
class ToolResult:
    ok: bool
    data: Mapping[str, Any] = field(default_factory=dict)
    sources: tuple[Mapping[str, Any], ...] = ()
    warnings: tuple[str, ...] = ()
    error: Mapping[str, Any] | None = None


@dataclass(slots=True)
class DocumentIngestionState:
    run_id: str
    document_id: str
    document_version: int
    stage: str = "received"
    checkpoint_namespace: str = "document-ingestion-v1"
    checkpoint: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


@dataclass(slots=True)
class QueryReasoningState:
    request: ChatRequest
    stage: str = "received"
    checkpoint_namespace: str = "query-reasoning-v1"
    evidence: list[RetrievalHit] = field(default_factory=list)
    checkpoint: dict[str, Any] = field(default_factory=dict)
