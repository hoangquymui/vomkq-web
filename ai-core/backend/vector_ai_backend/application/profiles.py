from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from typing import Iterable

from ..domain.models import EmbeddingProfile


E5_SMALL_PRESET = EmbeddingProfile(
    id="e5-small-local",
    name="Multilingual E5 Small (local preset)",
    provider="sentence-transformers",
    model_path="intfloat/multilingual-e5-small",
    model_revision="local",
    dimension=384,
    max_input_tokens=512,
    query_template="query: {text}",
    document_template="passage: {text}",
    normalization="l2",
    device="cpu",
)


class EmbeddingProfileCatalog:
    """Profile catalog; E5 is a replaceable initial preset, not a workflow constant."""

    def __init__(self, path: Path | None = None, presets: Iterable[EmbeddingProfile] = ()) -> None:
        self._path = path
        self._profiles = {profile.id: profile for profile in presets}
        if not self._profiles:
            self._profiles[E5_SMALL_PRESET.id] = E5_SMALL_PRESET
        self._load()

    def _load(self) -> None:
        if self._path is None or not self._path.is_file():
            return
        try:
            values = json.loads(self._path.read_text(encoding="utf-8"))
            for raw in values:
                profile = EmbeddingProfile(**raw)
                self._profiles[profile.id] = profile
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            return

    def _save(self) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps([asdict(value) for value in self.list()], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def list(self) -> tuple[EmbeddingProfile, ...]:
        return tuple(sorted(self._profiles.values(), key=lambda value: value.name.casefold()))

    def get(self, profile_id: str) -> EmbeddingProfile:
        try:
            return self._profiles[profile_id]
        except KeyError as exc:
            raise KeyError(f"Unknown embedding profile: {profile_id}") from exc

    def upsert(self, profile: EmbeddingProfile) -> EmbeddingProfile:
        self._profiles[profile.id] = profile
        self._save()
        return profile

    def duplicate(self, profile_id: str, new_id: str, new_name: str) -> EmbeddingProfile:
        original = self.get(profile_id)
        raw = asdict(original)
        raw.update(id=new_id, name=new_name)
        return self.upsert(EmbeddingProfile(**raw))

