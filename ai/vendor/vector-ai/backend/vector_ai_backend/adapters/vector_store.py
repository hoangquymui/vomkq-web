from __future__ import annotations

import re
from uuid import NAMESPACE_URL, uuid5
from collections.abc import Mapping, Sequence
from typing import Any

from ..domain.models import (
    IndexGeneration,
    RetrievalHit,
    SourceScope,
    VectorPoint,
)


def _scope_allowed(payload: Mapping[str, Any], scope: SourceScope) -> bool:
    kind = str(payload.get("scope_kind", "builtin"))
    owner = payload.get("owner_id")
    if kind == "builtin":
        return scope.builtin
    if kind == "workspace":
        return owner in scope.workspace_ids
    if kind == "chat":
        return owner in scope.chat_ids
    return False


class MemoryVectorStore:
    """Deterministic fake used by Core tests and degraded local development."""

    def __init__(self) -> None:
        self.generations: dict[str, IndexGeneration] = {}
        self.points: dict[str, dict[str, VectorPoint]] = {}
        self.active: dict[str, str] = {}

    async def health(self) -> Mapping[str, Any]:
        return {"status": "ready", "backend": "memory"}

    async def create_generation(self, generation: IndexGeneration) -> None:
        self.generations[generation.id] = generation
        self.points.setdefault(generation.id, {})

    async def upsert(self, generation_id: str, points: Sequence[VectorPoint]) -> None:
        if generation_id not in self.generations:
            raise KeyError(generation_id)
        for point in points:
            if len(point.vector) != self.generations[generation_id].dimension:
                raise ValueError("Vector dimension không khớp generation")
            self.points[generation_id][point.id] = point

    async def search(
        self,
        generation_id: str,
        vector: Sequence[float],
        *,
        scope: SourceScope,
        limit: int,
        filters: Mapping[str, Any] | None = None,
    ) -> Sequence[RetrievalHit]:
        generation = self.generations[generation_id]
        if len(vector) != generation.dimension:
            raise ValueError("Query vector dimension không khớp generation")

        def cosine(left: Sequence[float], right: Sequence[float]) -> float:
            dot = sum(a * b for a, b in zip(left, right, strict=True))
            ln = sum(a * a for a in left) ** 0.5
            rn = sum(b * b for b in right) ** 0.5
            return dot / (ln * rn) if ln and rn else 0.0

        rows: list[tuple[float, VectorPoint]] = []
        for point in self.points.get(generation_id, {}).values():
            if point.payload.get("retrieval_eligible", True) is not True:
                continue
            if not _scope_allowed(point.payload, scope):
                continue
            if filters and any(point.payload.get(key) != value for key, value in filters.items()):
                continue
            rows.append((cosine(vector, point.vector), point))
        rows.sort(key=lambda item: item[0], reverse=True)
        return [
            RetrievalHit(
                chunk_id=point.id,
                text=str(point.payload.get("text", "")),
                score=score,
                source=dict(point.payload.get("source", {})),
                metadata={**dict(point.payload), "retriever": "vector"},
            )
            for score, point in rows[:limit]
        ]

    async def activate_generation(self, profile_id: str, generation_id: str) -> None:
        generation = self.generations[generation_id]
        if generation.profile_id != profile_id:
            raise ValueError("Generation không thuộc embedding profile")
        self.active[profile_id] = generation_id

    async def active_generation(self, profile_id: str) -> IndexGeneration | None:
        generation_id = self.active.get(profile_id)
        return self.generations.get(generation_id) if generation_id else None

    async def delete_generation(self, generation_id: str) -> None:
        self.points.pop(generation_id, None)
        generation = self.generations.pop(generation_id, None)
        if generation and self.active.get(generation.profile_id) == generation_id:
            self.active.pop(generation.profile_id, None)


class QdrantVectorStore:
    """Native Qdrant REST adapter; no Qdrant types cross the Core boundary."""

    _SAFE_ID = re.compile(r"[^a-zA-Z0-9_-]+")

    def __init__(self, base_url: str, generation_repository: Any) -> None:
        if base_url.rstrip("/") != "http://127.0.0.1:6333":
            raise ValueError("Qdrant phải dùng 127.0.0.1:6333")
        self.base_url = base_url.rstrip("/")
        self.generations = generation_repository

    @classmethod
    def _collection(cls, generation_id: str) -> str:
        return "vector_ai_" + cls._SAFE_ID.sub("_", generation_id)[:120]

    @staticmethod
    def _client() -> Any:
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("Cần cài extra api để dùng Qdrant REST") from exc
        return httpx

    async def health(self) -> Mapping[str, Any]:
        httpx = self._client()
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                response = await client.get(f"{self.base_url}/readyz")
                response.raise_for_status()
            return {"status": "ready", "backend": "qdrant", "url": self.base_url}
        except Exception as exc:
            return {"status": "unavailable", "backend": "qdrant", "detail": str(exc)}

    async def create_generation(self, generation: IndexGeneration) -> None:
        httpx = self._client()
        body = {"vectors": {"size": generation.dimension, "distance": generation.distance.capitalize()}}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(
                f"{self.base_url}/collections/{self._collection(generation.id)}", json=body
            )
            response.raise_for_status()
        await self.generations.save_generation(generation, status="building")

    async def upsert(self, generation_id: str, points: Sequence[VectorPoint]) -> None:
        if not points:
            return
        httpx = self._client()
        body = {
            "points": [
                {
                    # Qdrant accepts an unsigned integer or UUID as point id.  Chunk ids
                    # are deliberately human-readable, so keep them in the payload and
                    # derive a stable UUID for the storage adapter only.
                    "id": str(uuid5(NAMESPACE_URL, f"vector-ai:{generation_id}:{point.id}")),
                    "vector": list(point.vector),
                    "payload": {**dict(point.payload), "chunk_id": point.id},
                }
                for point in points
            ]
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.put(
                f"{self.base_url}/collections/{self._collection(generation_id)}/points?wait=true",
                json=body,
            )
            response.raise_for_status()

    @staticmethod
    def _qdrant_filter(scope: SourceScope, extra: Mapping[str, Any] | None) -> dict[str, Any]:
        should: list[dict[str, Any]] = []
        if scope.builtin:
            should.append({"key": "scope_kind", "match": {"value": "builtin"}})
        for owner in scope.workspace_ids:
            should.append({"must": [
                {"key": "scope_kind", "match": {"value": "workspace"}},
                {"key": "owner_id", "match": {"value": owner}},
            ]})
        for owner in scope.chat_ids:
            should.append({"must": [
                {"key": "scope_kind", "match": {"value": "chat"}},
                {"key": "owner_id", "match": {"value": owner}},
            ]})
        must = [{"key": "retrieval_eligible", "match": {"value": True}}]
        for key, value in (extra or {}).items():
            must.append({"key": key, "match": {"value": value}})
        return {
            "must": must,
            "min_should": {"conditions": should, "min_count": 1},
        }

    async def search(
        self,
        generation_id: str,
        vector: Sequence[float],
        *,
        scope: SourceScope,
        limit: int,
        filters: Mapping[str, Any] | None = None,
    ) -> Sequence[RetrievalHit]:
        if not (scope.builtin or scope.workspace_ids or scope.chat_ids):
            return ()
        httpx = self._client()
        body = {
            "query": list(vector),
            "filter": self._qdrant_filter(scope, filters),
            "limit": limit,
            "with_payload": True,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{self.base_url}/collections/{self._collection(generation_id)}/points/query",
                json=body,
            )
            response.raise_for_status()
            result = response.json().get("result", {})
        rows = result.get("points", result if isinstance(result, list) else [])
        return [
            RetrievalHit(
                chunk_id=str((row.get("payload") or {}).get("chunk_id") or row.get("id")),
                text=str((row.get("payload") or {}).get("text", "")),
                score=float(row.get("score") or 0.0),
                source=dict((row.get("payload") or {}).get("source", {})),
                metadata={**dict(row.get("payload") or {}), "retriever": "vector"},
            )
            for row in rows
        ]

    async def activate_generation(self, profile_id: str, generation_id: str) -> None:
        if not await self.generations.activate_generation(profile_id, generation_id):
            raise ValueError("Generation chưa sẵn sàng hoặc không thuộc profile")

    async def active_generation(self, profile_id: str) -> IndexGeneration | None:
        return await self.generations.active_generation(profile_id)

    async def delete_generation(self, generation_id: str) -> None:
        httpx = self._client()
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{self.base_url}/collections/{self._collection(generation_id)}"
            )
            if response.status_code not in {200, 404}:
                response.raise_for_status()
