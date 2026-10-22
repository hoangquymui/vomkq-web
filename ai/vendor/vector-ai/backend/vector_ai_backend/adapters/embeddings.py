from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any

from ..domain.models import EmbeddingCapabilities, EmbeddingProfile


class LocalModelUnavailable(RuntimeError):
    """Raised when an offline embedding model has not been prepared locally."""


class SentenceTransformerEmbeddingProvider:
    """Configurable, download-free SentenceTransformers adapter.

    The model is loaded lazily. ``local_files_only`` is always enabled so a
    runtime query can never trigger an unexpected network download.
    """

    def __init__(self, profile: EmbeddingProfile) -> None:
        self._profile = profile
        self._model: Any | None = None
        self._lock = asyncio.Lock()

    @property
    def profile(self) -> EmbeddingProfile:
        return self._profile

    @property
    def capabilities(self) -> EmbeddingCapabilities:
        return EmbeddingCapabilities(
            dimension=self._profile.dimension,
            max_input_tokens=self._profile.max_input_tokens,
            tokenizer=self._profile.model_path,
            normalization=self._profile.normalization,
        )

    async def _load(self) -> Any:
        if self._model is not None:
            return self._model
        async with self._lock:
            if self._model is not None:
                return self._model

            def load() -> Any:
                try:
                    from sentence_transformers import SentenceTransformer
                except ImportError as exc:
                    raise LocalModelUnavailable(
                        "Chưa cài sentence-transformers cho embedding local."
                    ) from exc
                try:
                    return SentenceTransformer(
                        self._profile.model_path,
                        revision=None
                        if self._profile.model_revision in {"", "local"}
                        else self._profile.model_revision,
                        device=self._profile.device,
                        local_files_only=True,
                    )
                except Exception as exc:
                    raise LocalModelUnavailable(
                        f"Embedding model chưa có trong bộ nhớ local: {self._profile.model_path}"
                    ) from exc

            self._model = await asyncio.to_thread(load)
            dimension = int(self._model.get_sentence_embedding_dimension())
            if dimension != self._profile.dimension:
                self._model = None
                raise ValueError(
                    f"Embedding profile khai báo {self._profile.dimension} chiều nhưng model trả {dimension}."
                )
            return self._model

    def _render(self, template: str, text: str) -> str:
        return template.replace("{text}", text.strip())

    async def _encode(self, texts: Sequence[str]) -> list[list[float]]:
        model = await self._load()

        def encode() -> list[list[float]]:
            # SentenceTransformers truncates long inputs by default. Check the
            # real tokenizer length first, including the profile's prefix.
            limit = min(self._profile.max_input_tokens, int(model.max_seq_length))
            encoded = model.tokenizer(list(texts), truncation=False, padding=False, return_attention_mask=False)
            if any(len(tokens) > limit for tokens in encoded["input_ids"]):
                raise ValueError(f"Nội dung embedding vượt {limit} token; cần chia lại chunk hoặc chọn profile dài hơn.")
            values = model.encode(
                list(texts),
                normalize_embeddings=self._profile.normalization == "l2",
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            return [[float(item) for item in row] for row in values]

        return await asyncio.to_thread(encode)

    async def embed_documents(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        rendered = [self._render(self._profile.document_template, text) for text in texts]
        return await self._encode(rendered)

    async def embed_query(self, text: str) -> Sequence[float]:
        rows = await self._encode([self._render(self._profile.query_template, text)])
        return rows[0]


class EmbeddingProviderRegistry:
    """Resolve providers by profile without coupling retrieval to the chat model."""

    def __init__(self) -> None:
        self._providers: dict[str, Any] = {}
        self._revisions: dict[str, Any] = {}

    @staticmethod
    def _key(profile: EmbeddingProfile) -> str:
        return profile.fingerprint(chunker_version="provider", semantic_representation_version="provider")

    def register(self, provider: Any) -> None:
        self._providers[provider.profile.id] = provider
        self._revisions[self._key(provider.profile)] = provider

    def for_profile(self, profile: EmbeddingProfile) -> Any:
        key = self._key(profile)
        if key not in self._revisions:
            if profile.provider != "sentence-transformers":
                raise ValueError(f"Unsupported embedding provider: {profile.provider}")
            self._revisions[key] = SentenceTransformerEmbeddingProvider(profile)
        return self._revisions[key]

    def get(self, profile_id: str) -> Any:
        if profile_id not in self._providers:
            raise KeyError(f"Embedding provider chưa được cấu hình: {profile_id}")
        return self._providers[profile_id]

    def has(self, profile_id: str) -> bool:
        return profile_id in self._providers
