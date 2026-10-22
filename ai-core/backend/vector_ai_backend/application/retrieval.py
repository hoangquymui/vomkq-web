from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any

from ..domain.models import RetrievalHit, RetrievalRequest, ResourceRequest, WorkPriority
from ..domain.ports import LexicalIndex, VectorStore
from .resources import InferenceScheduler


class HybridRetrievalService:
    """Fuse FTS5 and dense ranks without coupling to a vector backend."""

    def __init__(
        self,
        *,
        lexical: LexicalIndex,
        vectors: VectorStore,
        embeddings: Any,
        scheduler: InferenceScheduler,
        embedding_ram_mb: int = 512,
        rrf_k: int = 60,
    ) -> None:
        self.lexical = lexical
        self.vectors = vectors
        self.embeddings = embeddings
        self.scheduler = scheduler
        self.embedding_ram_mb = embedding_ram_mb
        self.rrf_k = rrf_k
        self._cache: dict[tuple[Any, ...], tuple[RetrievalHit, ...]] = {}

    def invalidate(self) -> None:
        self._cache.clear()

    async def retrieve(self, request: RetrievalRequest) -> Sequence[RetrievalHit]:
        generation = await self.vectors.active_generation(request.embedding_profile_id)
        cache_key = (
            request.query.casefold().strip(),
            request.scope,
            request.embedding_profile_id,
            generation.id if generation else None,
            request.top_k,
            request.candidate_limit,
            request.evidence_token_limit,
            request.document_ids,
            getattr(self.lexical, "retrieval_revision", 0),
        )
        if cache_key in self._cache:
            return self._cache[cache_key]

        lexical_task = asyncio.create_task(self.lexical.search(request))
        dense: Sequence[RetrievalHit] = ()
        if generation is not None and self.embeddings.has(request.embedding_profile_id):
            provider = (
                self.embeddings.for_profile(generation.embedding_profile)
                if generation.embedding_profile is not None
                else self.embeddings.get(request.embedding_profile_id)
            )
            provider_profile = provider.profile

            async def embed_and_search() -> Sequence[RetrievalHit]:
                if generation.embedding_profile is None:
                    # Legacy generations have no immutable provider snapshot;
                    # do not query an unknown embedding space after migration.
                    raise ValueError("Generation cũ cần tạo lại để gắn embedding profile")
                query_vector = await provider.embed_query(request.query)
                if len(query_vector) != generation.dimension:
                    raise ValueError("Embedding query không tương thích generation đang hoạt động")
                return await self.vectors.search(
                    generation.id,
                    query_vector,
                    scope=request.scope,
                    limit=request.candidate_limit,
                )

            try:
                dense = await self.scheduler.run(
                    ResourceRequest(
                        owner="retrieval:query-embedding",
                        priority=WorkPriority.INTERACTIVE_CHAT,
                        cpu_slots=1,
                        ram_mb=int(provider_profile.resources.get("ram_mb", self.embedding_ram_mb)),
                        gpu_mb=(
                            int(provider_profile.resources.get("gpu_mb", 0))
                            if provider_profile.device.casefold() not in {"cpu", "auto-cpu"}
                            else 0
                        ),
                    ),
                    embed_and_search,
                )
            except Exception:
                dense = ()
        lexical = await lexical_task
        if request.document_ids:
            allowed = set(request.document_ids)
            lexical = tuple(hit for hit in lexical if hit.source.get("document_id") in allowed)
            dense = tuple(hit for hit in dense if hit.source.get("document_id") in allowed)
        # The vector collection is a rebuildable cache.  Re-check every dense hit
        # against SQLite so disabled/deleted/review-pending content cannot leak
        # through an older active generation.
        if dense and hasattr(self.lexical, "get_chunks"):
            live_chunks = await self.lexical.get_chunks([hit.chunk_id for hit in dense])
            live = {
                chunk.id: chunk
                for chunk in live_chunks
                if bool(chunk.metadata.get("retrieval_eligible", False))
                and (
                    (chunk.metadata.get("scope_kind") == "builtin" and request.scope.builtin)
                    or (chunk.metadata.get("scope_kind") == "workspace" and chunk.metadata.get("owner_id") in request.scope.workspace_ids)
                    or (chunk.metadata.get("scope_kind") == "chat" and chunk.metadata.get("owner_id") in request.scope.chat_ids)
                )
            }
            dense = tuple(
                RetrievalHit(
                    chunk_id=hit.chunk_id,
                    text=live[hit.chunk_id].text,
                    score=hit.score,
                    source={**dict(hit.source), "document_id": live[hit.chunk_id].document_id, "page": live[hit.chunk_id].page, "heading": live[hit.chunk_id].heading},
                    metadata={**dict(hit.metadata), **dict(live[hit.chunk_id].metadata), "verification_revision": live[hit.chunk_id].verification_revision},
                )
                for hit in dense if hit.chunk_id in live
            )

        score: dict[str, float] = {}
        hits: dict[str, RetrievalHit] = {}
        for group in (lexical, dense):
            for rank, hit in enumerate(group, start=1):
                score[hit.chunk_id] = score.get(hit.chunk_id, 0.0) + 1.0 / (self.rrf_k + rank)
                previous = hits.get(hit.chunk_id)
                if previous is None or len(hit.text) > len(previous.text):
                    hits[hit.chunk_id] = hit
        ranked = sorted(hits.values(), key=lambda item: score[item.chunk_id], reverse=True)

        selected: list[RetrievalHit] = []
        used = 0
        for hit in ranked:
            token_count = int(hit.metadata.get("token_count") or max(1, len(hit.text) // 4))
            if used + token_count > request.evidence_token_limit:
                continue
            selected.append(
                RetrievalHit(
                    chunk_id=hit.chunk_id,
                    text=hit.text,
                    score=score[hit.chunk_id],
                    source=hit.source,
                    metadata=hit.metadata,
                )
            )
            used += token_count
            if len(selected) >= request.top_k:
                break
        value = tuple(selected)
        self._cache[cache_key] = value
        if len(self._cache) > 256:
            self._cache.pop(next(iter(self._cache)))
        return value
