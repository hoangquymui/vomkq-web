"""Dataset organisation, independent of ingestion/query execution graphs."""
from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
from typing import Any, Mapping, Protocol, Sequence


NODE_KINDS = frozenset({"document", "part", "chapter", "section", "concept", "standard", "formula", "table", "note", "group", "chunk"})


@dataclass(slots=True)
class DatasetNode:
    id: str
    parent_id: str | None
    title: str
    kind: str = "section"
    description: str = ""
    content: str = ""
    chunk_id: str | None = None
    collapsed: bool = False


@dataclass(slots=True)
class DatasetTree:
    document_id: str
    document_version: int
    revision: int
    source_revision: str
    nodes: list[DatasetNode] = field(default_factory=list)
    updated_at: str | None = None


def source_revision(chunks: Sequence[Mapping[str, Any]]) -> str:
    """Also detects replacement/reindexing while an editor is open."""
    data = [(c["id"], c["ordinal"], c.get("heading"), c.get("updated_at")) for c in chunks]
    return sha256(json.dumps(data, ensure_ascii=False).encode("utf-8")).hexdigest()


def dataset_node_chunk_prefix(document_id: str, version: int, node_id: str) -> str:
    """Stable namespace for RAG chunks authored directly on a dataset node."""
    digest = sha256(f"{document_id}:{version}:{node_id}".encode("utf-8")).hexdigest()[:24]
    return f"dataset-node-{digest}"


def dataset_node_source(node: DatasetNode | Mapping[str, Any]) -> str:
    """Add the node title to its body so a retrieved chunk keeps its context."""
    if isinstance(node, Mapping):
        title = str(node.get("title") or "").strip()
        content = str(node.get("content") or "").strip()
    else:
        title = node.title.strip()
        content = node.content.strip()
    return f"# {title}\n\n{content}".strip()


class DatasetTreeStore(Protocol):
    async def list_documents(self, **kwargs: Any) -> list[Mapping[str, Any]]: ...

    async def read_knowledge_catalog(self) -> Mapping[str, Any] | None: ...

    async def write_knowledge_catalog(self, payload: Mapping[str, Any], *, expected_revision: int) -> bool: ...

    async def dataset_source(self, document_id: str, version: int) -> Mapping[str, Any] | None: ...

    async def read_dataset_tree(self, document_id: str, version: int) -> Mapping[str, Any] | None: ...

    async def write_dataset_tree(self, tree: DatasetTree, *, expected_revision: int) -> bool:
        """Atomically compare both tree revision and current source revision."""
        ...

    async def dataset_chunk(self, document_id: str, version: int, chunk_id: str) -> Mapping[str, Any] | None: ...
