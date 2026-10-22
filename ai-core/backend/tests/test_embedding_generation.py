import asyncio

from vector_ai_backend.adapters.embeddings import EmbeddingProviderRegistry
from vector_ai_backend.adapters.vector_store import MemoryVectorStore
from vector_ai_backend.application.retrieval import HybridRetrievalService
from vector_ai_backend.application.resources import InferenceScheduler, ResourceManager
from vector_ai_backend.domain.models import (
    DocumentChunk, EmbeddingProfile, IndexGeneration, ResourceLimits,
    RetrievalRequest, SourceScope, VectorPoint,
)
from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository


def test_profile_revision_switch_keeps_queries_in_the_active_vector_space(tmp_path):
    async def run():
        old = EmbeddingProfile("same-id", "Old", "fake", "model-old", "v1", 2)
        new = EmbeddingProfile("same-id", "New", "fake", "model-new", "v2", 2)
        calls = []
        class Provider:
            def __init__(self, profile):
                self.profile = profile
            async def embed_query(self, text):
                calls.append(self.profile.model_path)
                return [1.0, 0.0]
        registry = EmbeddingProviderRegistry()
        registry.register(Provider(old))
        vectors = MemoryVectorStore()
        repo = SQLiteKnowledgeRepository(tmp_path / "test.sqlite3")
        await repo.upsert_document({"id": "doc", "title": "Source", "scope_kind": "builtin"})
        await repo.upsert_chunks([DocumentChunk("chunk", "doc", 1, "source text", 0)])
        for name, profile in (("old", old), ("new", new)):
            generation = IndexGeneration(name, profile.id, name, 2, embedding_profile=profile)
            await vectors.create_generation(generation)
            await vectors.upsert(name, [VectorPoint("chunk", (1.0, 0.0), {"text": "source text", "scope_kind": "builtin"})])
        await vectors.activate_generation(old.id, "old")
        registry.register(Provider(new))
        retrieval = HybridRetrievalService(lexical=repo, vectors=vectors, embeddings=registry,
            scheduler=InferenceScheduler(ResourceManager(ResourceLimits(1, 1024, 0))))
        request = RetrievalRequest("unmatched", SourceScope(), old.id)
        assert await retrieval.retrieve(request)
        assert calls == ["model-old"]
        await vectors.activate_generation(new.id, "new")
        assert await retrieval.retrieve(request)
        assert calls == ["model-old", "model-new"]
        # Even an old dense point must disappear immediately when its live
        # source is disabled; the vector store deliberately still contains it.
        await repo.set_document_enabled("doc", 1, False)
        assert await retrieval.retrieve(request) == ()
        await repo.close()
    asyncio.run(run())


def test_generation_profile_snapshot_survives_database_restart(tmp_path):
    async def run():
        path = tmp_path / "data.sqlite3"
        profile = EmbeddingProfile("p", "Old", "fake", "old-model", "v1", 2)
        repo = SQLiteKnowledgeRepository(path)
        await repo.upsert_embedding_profile(profile)
        await repo.save_generation(IndexGeneration("g", "p", "fingerprint", 2, embedding_profile=profile), status="ready")
        await repo.activate_generation("p", "g")
        await repo.close()
        repo = SQLiteKnowledgeRepository(path)
        assert (await repo.active_generation("p")).embedding_profile == profile
        await repo.close()
    asyncio.run(run())
