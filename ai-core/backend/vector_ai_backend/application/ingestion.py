from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import re
from dataclasses import asdict
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..domain.models import (
    DocumentChunk,
    DocumentIngestionState,
    EmbeddingProfile,
    ExtractedFormula,
    ExtractedPage,
    FormulaRecord,
    IndexGeneration,
    ResourceRequest,
    RunEvent,
    RunEventType,
    SourceScope,
    VectorPoint,
    VerificationMetadata,
    VerificationMethod,
    VerificationStatus,
    WorkPriority,
)
from ..domain.dataset_tree import dataset_node_chunk_prefix, dataset_node_source
from ..formulas.semantic import FORMULA_SEMANTIC_VERSION, formula_semantic_representation
from .formula_policy import is_plain_ratio
from .resources import InferenceScheduler


# Table merge markers (<< into the left cell, ^^ into the cell above) are always
# expanded back to the text they stand for before chunking, so the chunk text
# format is unchanged: no stored corpus can contain a marker, existing index
# generations stay valid and CHUNKER_VERSION does not need to move.
CHUNKER_VERSION = "structural-384-48-tables-v2"
_TOKEN = re.compile(r"\S+")
_FORMULA = re.compile(r"\$\$(.+?)\$\$|\\\[(.+?)\\\]|(?<!\$)\$([^\n$]+?)\$(?!\$)|\\\((.+?)\\\)", re.S)
_TABLE = re.compile(r"^[ \t]*\|[^\n]*\n[ \t]*\|[ \t:|\-]+(?:\n|$)(?:[ \t]*\|[^\n]*(?:\n|$))*", re.M)
_TABLE_CELL_SPLIT = re.compile(r"(?<!\\)\|")


def _text_units(text: str) -> list[str]:
    units: list[str] = []
    cursor = 0
    for match in _FORMULA.finditer(text):
        units.extend(part.strip() for part in re.split(r"\n\s*\n", text[cursor:match.start()]) if part.strip())
        units.append(match.group(0).strip())
        cursor = match.end()
    units.extend(part.strip() for part in re.split(r"\n\s*\n", text[cursor:]) if part.strip())
    return units


def _structural_units(text: str) -> list[str]:
    # Protect complete tables *before* finding inline math. Otherwise a formula
    # inside a cell splits a row and destroys its column/header association.
    units: list[str] = []
    cursor = 0
    for match in _TABLE.finditer(text):
        units.extend(_text_units(text[cursor:match.start()]))
        units.append(match.group(0).strip())
        cursor = match.end()
    units.extend(_text_units(text[cursor:]))
    return units


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text)


def _expand_merge_markers(table: str) -> str:
    """Rewrite covered-cell merge markers inside one recognised pipe table.

    A merged region is stored as ``<<`` (this cell merges into the one on its
    left) or ``^^`` (into the cell above). Resolving the markers left-to-right
    and then top-to-bottom makes the retrieved rows read naturally, for example
    a 2x2 merge repeats its top-left content. Only cells that are exactly a
    marker are replaced, and a marker that cannot resolve (first row or first
    column of the unit) is left verbatim, so no text is ever dropped. Callers
    only pass table units, so prose is never touched.
    """
    resolved: list[list[str]] = []
    output: list[str] = []
    for row_index, line in enumerate(table.splitlines()):
        if not line.lstrip().startswith("|"):
            output.append(line)
            resolved.append([])
            continue
        parts = _TABLE_CELL_SPLIT.split(line)
        cells: list[str] = []
        for position in range(1, len(parts)):
            column = position - 1
            text = parts[position].strip()
            source = ""
            if text == "^^" and row_index and column < len(resolved[row_index - 1]):
                source = resolved[row_index - 1][column]
            elif text == "<<" and column:
                source = cells[column - 1]
            if source:
                parts[position] = parts[position].replace(text, source, 1)
                text = source
            cells.append(text)
        resolved.append(cells)
        output.append("|".join(parts))
    return "\n".join(output)


def _scope(kind: str, owner_id: str | None) -> SourceScope:
    if kind == "workspace" and owner_id:
        return SourceScope(builtin=False, workspace_ids=(owner_id,))
    if kind == "chat" and owner_id:
        return SourceScope(builtin=False, chat_ids=(owner_id,))
    return SourceScope(builtin=True)


class StructuralChunker:
    """Small deterministic chunker that never slices through a formula block."""

    version = CHUNKER_VERSION

    def __init__(self, target_tokens: int = 384, overlap_tokens: int = 48) -> None:
        self.target_tokens = target_tokens
        self.overlap_tokens = overlap_tokens

    def split(self, pages: list[ExtractedPage]) -> list[dict[str, Any]]:
        units: list[tuple[int, str]] = []
        for page in pages:
            text = page.text.replace("\r\n", "\n").strip()
            if not text:
                continue
            units.extend((page.page, unit) for unit in _structural_units(text))

        bounded_units: list[tuple[int, str]] = []
        for page, text in units:
            words = _tokens(text)
            if _TABLE.fullmatch(text):
                # Only a recognised table unit reaches the marker expansion.
                lines = _expand_merge_markers(text).splitlines()
                header = lines[:2]
                batch: list[str] = []
                header_size = len(_tokens("\n".join(header)))
                size = header_size
                for row in lines[2:]:
                    row_size = len(_tokens(row))
                    if batch and size + row_size > self.target_tokens:
                        bounded_units.append((page, "\n".join(header + batch)))
                        batch = []
                        size = header_size
                    batch.append(row)
                    size += row_size
                # An oversized single row stays intact; downstream profile
                # limits must report it, never silently discard cells/formulas.
                bounded_units.append((page, "\n".join(header + batch)))
            elif _FORMULA.fullmatch(text) or len(words) <= self.target_tokens:
                bounded_units.append((page, text))
            else:
                for start in range(0, len(words), self.target_tokens):
                    bounded_units.append((page, " ".join(words[start:start + self.target_tokens])))
        chunks: list[dict[str, Any]] = []
        current: list[tuple[int, str]] = []
        count = 0
        for unit in bounded_units:
            unit_count = len(_tokens(unit[1]))
            if current and count + unit_count > self.target_tokens:
                chunks.append(self._pack(current))
                overlap: list[tuple[int, str]] = []
                overlap_count = 0
                for previous in reversed(current):
                    size = len(_tokens(previous[1]))
                    if overlap_count + size > self.overlap_tokens or overlap_count + size + unit_count > self.target_tokens:
                        break
                    overlap.insert(0, previous)
                    overlap_count += size
                    if overlap_count >= self.overlap_tokens:
                        break
                current = overlap
                count = overlap_count
            current.append(unit)
            count += unit_count
        if current:
            chunks.append(self._pack(current))
        return chunks

    @staticmethod
    def _pack(units: list[tuple[int, str]]) -> dict[str, Any]:
        text = "\n\n".join(value for _, value in units)
        first = next((line.strip("# ") for line in text.splitlines() if line.lstrip().startswith("#")), None)
        return {"page": units[0][0], "text": text, "heading": first, "token_count": len(_tokens(text))}


class DocumentIngestionPipeline:
    """Application service used by DocumentIngestionGraph's independent stages."""

    def __init__(
        self,
        *,
        repository: Any,
        extractor: Any,
        ocr: Any,
        validator: Any,
        profile_catalog: Any,
        embeddings: Any,
        vectors: Any,
        scheduler: InferenceScheduler,
        checkpoints: Any,
        work_dir: Path,
        default_profile_id: str,
        ocr_gpu_mb: int = 512,
        chunker: StructuralChunker | None = None,
    ) -> None:
        self.repository = repository
        self.extractor = extractor
        self.ocr = ocr
        self.validator = validator
        self.profiles = profile_catalog
        self.embeddings = embeddings
        self.vectors = vectors
        self.scheduler = scheduler
        self.checkpoints = checkpoints
        self.work_dir = work_dir
        self.default_profile_id = default_profile_id
        self.ocr_gpu_mb = ocr_gpu_mb
        self.chunker = chunker or StructuralChunker()
        self.work_dir.mkdir(parents=True, exist_ok=True)

    @property
    def steps(self) -> dict[str, Any]:
        return {
            "extract": self.extract,
            "ocr": self.ocr_pages,
            "validate": self.validate,
            "chunk": self.chunk,
            "embed": self.embed,
            "index": self.index,
        }

    def _run_dir(self, state: DocumentIngestionState) -> Path:
        path = self.work_dir / state.run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def _persist(self, state: DocumentIngestionState) -> None:
        saved = await self.checkpoints.load(state.checkpoint_namespace, state.run_id) or {}
        await self.checkpoints.save(state.checkpoint_namespace, state.run_id, {
            **dict(saved), "document_id": state.document_id, "document_version": state.document_version,
            "stage": state.stage, "checkpoint": dict(state.checkpoint),
        })

    @staticmethod
    def _save_pages(path: Path, pages: list[ExtractedPage]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([asdict(page) for page in pages], ensure_ascii=False), encoding="utf-8")

    @staticmethod
    def _load_pages(path: Path) -> list[ExtractedPage]:
        values = json.loads(path.read_text(encoding="utf-8"))
        return [ExtractedPage(
            page=int(item["page"]), text=str(item.get("text", "")),
            image_paths=list(item.get("image_paths", [])),
            formulas=[ExtractedFormula(**formula) for formula in item.get("formulas", [])],
        ) for item in values]

    async def extract(self, state: DocumentIngestionState, emit: Any, cancellation: asyncio.Event) -> DocumentIngestionState:
        source = Path(str(state.checkpoint["source_path"]))
        async def work() -> list[ExtractedPage]:
            return await self.extractor.extract_native(source)
        pages = await self.scheduler.run(
            ResourceRequest(f"extract:{state.run_id}", WorkPriority.BACKGROUND_INDEXING, 1, 256),
            work,
            cancellation=cancellation,
        )
        pages_path = self._run_dir(state) / "pages.json"
        self._save_pages(pages_path, pages)
        state.checkpoint["pages_path"] = str(pages_path)
        state.checkpoint["page_count"] = len(pages)
        await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "extract", 0.15, data={"pages": len(pages)}))
        return state

    async def ocr_pages(self, state: DocumentIngestionState, emit: Any, cancellation: asyncio.Event) -> DocumentIngestionState:
        pages = self._load_pages(Path(state.checkpoint["pages_path"]))
        pending = [(page, image) for page in pages for image in page.image_paths]
        completed_images = set(state.checkpoint.get("ocr_images", []))
        for index, (page, image) in enumerate(pending, start=1):
            if image in completed_images:
                continue
            async def work(image: str = image):
                return await self.ocr.recognize(Path(image))
            text, formulas = await self.scheduler.run(
                ResourceRequest(f"ocr:{state.run_id}", WorkPriority.BACKGROUND_OCR, 1, 768, self.ocr_gpu_mb),
                work,
                cancellation=cancellation,
            )
            if text:
                page.text = f"{page.text}\n\n{text}".strip()
            page.formulas.extend(formulas)
            completed_images.add(image)
            state.checkpoint["ocr_images"] = sorted(completed_images)
            self._save_pages(Path(state.checkpoint["pages_path"]), pages)
            await self._persist(state)
            await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "ocr", 0.15 + 0.15 * index / max(1, len(pending)), data={"completed": index, "total": len(pending)}))
            await asyncio.sleep(0)
        state.checkpoint["ocr_skipped"] = not pending
        return state

    async def validate(self, state: DocumentIngestionState, emit: Any, cancellation: asyncio.Event) -> DocumentIngestionState:
        pages = self._load_pages(Path(state.checkpoint["pages_path"]))
        formulas: list[FormulaRecord] = []
        # A ratio the user typed is data, not a claim to review, so it never
        # becomes a formula record. Positions come from the unfiltered
        # enumeration, keeping the derived formula ids stable for the records
        # that are still created.
        candidates = [
            (page.page, ordinal, extracted)
            for page in pages
            for ordinal, extracted in enumerate(page.formulas)
            if not is_plain_ratio(extracted.latex)
        ]
        saved_tree = await self.repository.read_dataset_tree(state.document_id, state.document_version)
        for node_position, node in enumerate((saved_tree or {}).get("nodes", []), start=1):
            if node.get("chunk_id") or not str(node.get("content") or "").strip():
                continue
            for ordinal, match in enumerate(_FORMULA.finditer(dataset_node_source(node))):
                latex = next(value for value in match.groups() if value is not None).strip()
                if is_plain_ratio(latex):
                    continue
                candidates.append((
                    -node_position,
                    ordinal,
                    ExtractedFormula(
                        latex=latex,
                        confidence=1.0,
                        source={
                            "method": "dataset-node", "dataset_node_id": str(node.get("id")),
                            "document_title": str(node.get("title") or ""),
                        },
                    ),
                ))
        for page_number, ordinal, extracted in candidates:
            if cancellation.is_set():
                raise asyncio.CancelledError
            formula = self._formula(state, page_number, ordinal, extracted)
            existing = await self.repository.get_formula(formula.id, formula.version)
            if existing is not None and existing.verification.method is VerificationMethod.MANUAL:
                formula.normalized_latex = existing.normalized_latex
                formula.sympy_expression = existing.sympy_expression
                formula.name = existing.name
                formula.aliases = list(existing.aliases)
                formula.variables = dict(existing.variables)
                formula.units = dict(existing.units)
                formula.conditions = list(existing.conditions)
                formula.assumptions = list(existing.assumptions)
                formula.verification = existing.verification
            report = await self.validator.validate(formula)
            formula.verification = VerificationMetadata(
                status=report.recommended_status,
                method=(
                    VerificationMethod.MANUAL
                    if existing is not None and existing.verification.method is VerificationMethod.MANUAL
                    else VerificationMethod.AUTOMATIC if report.recommended_status is VerificationStatus.VERIFIED else None
                ),
                validator_version=report.validator_version,
                confidence=extracted.confidence,
                checks=list(report.syntax_checks + report.mathematical_checks),
                reviewed_by=existing.verification.reviewed_by if existing else None,
                reviewed_at=existing.verification.reviewed_at if existing else None,
                reasons=[check.message for check in report.syntax_checks + report.mathematical_checks if check.status.value in {"FAIL", "UNKNOWN"}],
            )
            formulas.append(formula)
            await self.repository.upsert_formula(formula)
        path = self._run_dir(state) / "formulas.json"
        path.write_text(json.dumps([asdict(item) for item in formulas], ensure_ascii=False, default=str), encoding="utf-8")
        state.checkpoint["formula_records"] = str(path)
        state.checkpoint["formula_count"] = len(formulas)
        await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "validate", 0.42, data={"formulas": len(formulas)}))
        return state

    def _formula(self, state: DocumentIngestionState, page: int, ordinal: int, extracted: ExtractedFormula) -> FormulaRecord:
        normalized = " ".join(extracted.latex.split())
        digest = hashlib.sha256(f"{state.document_id}:{state.document_version}:{page}:{ordinal}:{normalized}".encode()).hexdigest()[:24]
        return FormulaRecord(
            id=f"formula-{digest}", version=1, document_id=state.document_id,
            document_version=state.document_version, name=None, aliases=[], raw_latex=extracted.latex,
            normalized_latex=normalized, sympy_expression=None, variables={}, units={}, conditions=[], assumptions=[],
            source={**extracted.source, "page": page, "extraction_method": extracted.source.get("method", "unknown")},
            verification=VerificationMetadata(confidence=extracted.confidence),
        )

    async def chunk(self, state: DocumentIngestionState, emit: Any, cancellation: asyncio.Event) -> DocumentIngestionState:
        pages = self._load_pages(Path(state.checkpoint["pages_path"]))
        profile_id = str(state.checkpoint.get("embedding_profile_id") or self.default_profile_id)
        profile = self.profiles.get(profile_id)
        effective_target = min(
            self.chunker.target_tokens,
            max(64, profile.max_input_tokens - 96),
        )
        effective_chunker = StructuralChunker(
            target_tokens=effective_target,
            overlap_tokens=min(self.chunker.overlap_tokens, max(0, effective_target // 4)),
        )
        packed = effective_chunker.split(pages)
        kind = str(state.checkpoint.get("scope_kind", "builtin"))
        owner = state.checkpoint.get("owner_id")
        records: list[DocumentChunk] = []
        semantic: dict[str, str] = {}
        token_counts: dict[str, int] = {}
        formulas = await self.repository.list_formulas(document_id=state.document_id, limit=1000)
        for ordinal, item in enumerate(packed):
            chunk_id = f"{state.document_id}-v{state.document_version}-{ordinal + 1:05d}"
            related = [
                formula for formula in formulas
                if not formula.source.get("dataset_node_id") and (
                    formula.raw_latex in item["text"]
                    or int(formula.source.get("page") or -1) == int(item["page"])
                )
            ]
            records.append(DocumentChunk(
                id=chunk_id, document_id=state.document_id, document_version=state.document_version,
                text=item["text"], ordinal=ordinal, scope=_scope(kind, owner), formula_ids=[value.id for value in related], page=item["page"],
                heading=item["heading"], metadata={"token_count": item["token_count"], "scope_kind": kind, "owner_id": owner},
                semantic_representation_version=FORMULA_SEMANTIC_VERSION,
            ))
            formula_context = "\n\n".join(formula_semantic_representation(value) for value in related)
            semantic[chunk_id] = f"{item['text']}\n\n{formula_context}".strip()
            token_counts[chunk_id] = item["token_count"]
        saved_tree = await self.repository.read_dataset_tree(state.document_id, state.document_version)
        authored_nodes = [
            node for node in (saved_tree or {}).get("nodes", [])
            if not node.get("chunk_id") and str(node.get("content") or "").strip()
        ]
        next_ordinal = len(records)
        for node in authored_nodes:
            node_id = str(node["id"])
            node_packed = effective_chunker.split([
                ExtractedPage(page=0, text=dataset_node_source(node))
            ])
            prefix = dataset_node_chunk_prefix(state.document_id, state.document_version, node_id)
            for piece, item in enumerate(node_packed, start=1):
                chunk_id = f"{prefix}-{piece:05d}"
                related = [
                    formula for formula in formulas
                    if formula.source.get("dataset_node_id") == node_id
                    and formula.raw_latex in item["text"]
                ]
                metadata = {
                    "token_count": item["token_count"], "scope_kind": kind, "owner_id": owner,
                    "origin": "dataset-node", "dataset_node_id": node_id,
                    "node_kind": str(node.get("kind") or "section"),
                }
                records.append(DocumentChunk(
                    id=chunk_id, document_id=state.document_id,
                    document_version=state.document_version, text=item["text"],
                    ordinal=next_ordinal, scope=_scope(kind, owner),
                    formula_ids=[value.id for value in related], page=None,
                    heading=str(node.get("title") or ""), metadata=metadata,
                    semantic_representation_version=FORMULA_SEMANTIC_VERSION,
                ))
                formula_context = "\n\n".join(formula_semantic_representation(value) for value in related)
                semantic[chunk_id] = f"{item['text']}\n\n{formula_context}".strip()
                token_counts[chunk_id] = item["token_count"]
                next_ordinal += 1
        await self.repository.upsert_chunks(records, semantic_text=semantic, token_counts=token_counts)
        await self.repository.delete_document_chunks_except(
            state.document_id, state.document_version, [item.id for item in records]
        )
        for formula in formulas:
            formula.chunk_ids = [chunk.id for chunk in records if formula.id in chunk.formula_ids]
            await self.repository.upsert_formula(formula)
        state.checkpoint["chunk_ids"] = [item.id for item in records]
        await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "chunk", 0.58, data={"chunks": len(records)}))
        return state

    async def embed(self, state: DocumentIngestionState, emit: Any, cancellation: asyncio.Event) -> DocumentIngestionState:
        profile_id = str(state.checkpoint.get("embedding_profile_id") or self.default_profile_id)
        stored = state.checkpoint.get("embedding_profile_snapshot")
        profile = EmbeddingProfile(**stored) if stored else self.profiles.get(profile_id)
        state.checkpoint["embedding_profile_snapshot"] = asdict(profile)
        if not self.embeddings.has(profile_id):
            state.checkpoint["dense_status"] = "skipped_provider_unavailable"
            await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "embed", 0.72, message="Embedding local chưa sẵn sàng; chỉ mục từ khóa vẫn hoạt động."))
            return state
        health = await self.vectors.health()
        if health.get("status") != "ready":
            state.checkpoint["dense_status"] = "skipped_vector_store_unavailable"
            await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "embed", 0.72, message="Qdrant chưa sẵn sàng; chỉ mục từ khóa vẫn hoạt động."))
            return state
        fingerprint = profile.fingerprint(chunker_version=self.chunker.version, semantic_representation_version=FORMULA_SEMANTIC_VERSION)
        generation_id = str(state.checkpoint.get("generation_id") or f"{profile.id}-{fingerprint[:12]}-{uuid4().hex[:8]}")
        generation = IndexGeneration(id=generation_id, profile_id=profile.id, fingerprint=fingerprint, dimension=profile.dimension, embedding_profile=profile)
        if "generation_id" not in state.checkpoint:
            await self.vectors.create_generation(generation)
            state.checkpoint.update(generation_id=generation.id, profile_id=profile.id)
            await self._persist(state)
        chunks = await self.repository.list_retrieval_chunks()
        provider = self.embeddings.for_profile(profile)
        points_file = self._run_dir(state) / "vector-points.jsonl"
        points_file.touch(exist_ok=True)
        done = set(state.checkpoint.get("embedded_chunk_ids", []))
        for start in range(0, len(chunks), 16):
            batch = [chunk for chunk in chunks[start:start + 16] if chunk.id not in done]
            if not batch:
                continue
            embedding_texts = [self._embedding_text(item, profile.max_input_tokens) for item in batch]
            async def work(embedding_texts: list[str] = embedding_texts):
                return await provider.embed_documents(embedding_texts)
            embedding_gpu = int(profile.resources.get("gpu_mb", 0)) if profile.device.casefold() not in {"cpu", "auto-cpu"} else 0
            vectors = await self.scheduler.run(
                ResourceRequest(
                    f"embedding:{state.run_id}", WorkPriority.BACKGROUND_EMBEDDING, 1,
                    int(profile.resources.get("ram_mb", 768)), embedding_gpu,
                ),
                work, cancellation=cancellation,
            )
            points = [self._point(chunk, vector) for chunk, vector in zip(batch, vectors, strict=True)]
            async def index_work(points: list[VectorPoint] = points) -> None:
                await self.vectors.upsert(generation.id, points)
            await self.scheduler.run(
                ResourceRequest(f"index:{state.run_id}", WorkPriority.BACKGROUND_INDEXING, 1, 256),
                index_work, cancellation=cancellation,
            )
            done.update(item.id for item in batch)
            state.checkpoint["embedded_chunk_ids"] = sorted(done)
            await self._persist(state)
            await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "embed", 0.58 + 0.30 * len(done) / max(1, len(chunks)), data={"embedded": len(done), "total": len(chunks)}))
            await asyncio.sleep(0)
        state.checkpoint.update(dense_status="built", generation_id=generation.id, profile_id=profile.id)
        return state

    @staticmethod
    def _embedding_text(chunk: DocumentChunk, max_tokens: int) -> str:
        semantic = str(chunk.metadata.get("semantic_text") or chunk.text)
        if len(_tokens(semantic)) <= max_tokens:
            return semantic
        marker = f"Phiên bản biểu diễn: {FORMULA_SEMANTIC_VERSION}"
        if chunk.formula_ids and marker in semantic:
            formula_semantics = marker + semantic.split(marker, 1)[1]
            if len(_tokens(formula_semantics)) <= max_tokens:
                return formula_semantics
            raise ValueError(
                f"Semantic representation của công thức trong chunk {chunk.id} vượt "
                f"giới hạn {max_tokens} token; không cắt âm thầm biểu thức."
            )
        # Text-only chunks are already sized for the profile. Reaching this
        # branch means metadata expansion exceeded the estimate, so fail loudly.
        raise ValueError(
            f"Chunk {chunk.id} vượt giới hạn embedding profile ({max_tokens} token)."
        )

    @staticmethod
    def _point(chunk: DocumentChunk, vector: Any) -> VectorPoint:
        kind = str(chunk.metadata.get("scope_kind", "builtin"))
        owner = chunk.metadata.get("owner_id")
        return VectorPoint(chunk.id, tuple(float(value) for value in vector), {
            "text": chunk.text, "source": {"document_id": chunk.document_id, "page": chunk.page, "title": chunk.heading},
            "scope_kind": kind, "owner_id": owner, "retrieval_eligible": True,
            "token_count": chunk.metadata.get("token_count", 0), "verification_revision": chunk.verification_revision,
        })

    async def index(self, state: DocumentIngestionState, emit: Any, cancellation: asyncio.Event) -> DocumentIngestionState:
        if state.checkpoint.get("dense_status") == "built":
            profile_id = str(state.checkpoint["profile_id"])
            generation_id = str(state.checkpoint["generation_id"])
            profile = EmbeddingProfile(**state.checkpoint["embedding_profile_snapshot"])
            generation = IndexGeneration(
                id=generation_id,
                profile_id=profile_id,
                fingerprint=profile.fingerprint(
                    chunker_version=self.chunker.version,
                    semantic_representation_version=FORMULA_SEMANTIC_VERSION,
                ),
                dimension=profile.dimension,
                embedding_profile=profile,
            )
            await self.repository.save_generation(generation, status="ready")
            await self.vectors.activate_generation(profile_id, generation_id)
        state.checkpoint["indexed"] = True
        if getattr(self, "knowledge_folders", None):
            await self.knowledge_folders.sync_safely()
        await emit(RunEvent(state.run_id, RunEventType.PROGRESS, "index", 0.95, data={"dense_status": state.checkpoint.get("dense_status", "skipped")}))
        return state


async def register_document(repository: Any, *, document_id: str, version: int, title: str, source_path: Path, scope_kind: str, owner_id: str | None) -> None:
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    await repository.upsert_document({
        "id": document_id, "version": version, "title": title, "source_uri": str(source_path),
        "sha256": digest, "mime_type": mimetypes.guess_type(source_path.name)[0] or "application/octet-stream",
        "scope_kind": scope_kind, "owner_id": owner_id, "enabled": True,
        "metadata": {"original_filename": source_path.name, "processor_revision": "ingestion-v1"},
    })
