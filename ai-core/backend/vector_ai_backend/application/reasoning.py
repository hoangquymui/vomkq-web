from __future__ import annotations

from ..domain.models import ModelCapabilities, ReasoningMode, ReasoningProfile


# Stable buckets avoid making Ollama reload a runner for every slightly
# different prompt size.  The selected bucket is never larger than the
# profile's existing maximum.
CONTEXT_BUCKETS = (4096, 8192, 16384)
CHAT_TEMPLATE_RESERVE = 384
MIN_CHARS_PER_TOKEN = 2
MIN_UTF8_BYTES_PER_TOKEN = 3


DEFAULT_REASONING_PROFILES: dict[ReasoningMode, ReasoningProfile] = {
    ReasoningMode.FAST: ReasoningProfile(
        mode=ReasoningMode.FAST,
        label="Nhanh",
        thinking=False,
        context_tokens=8192,
        generation_tokens=2048,
        evidence_top_k=4,
        evidence_tokens=1500,
    ),
    ReasoningMode.NORMAL: ReasoningProfile(
        mode=ReasoningMode.NORMAL,
        label="Cân bằng",
        # Qwen/Ollama only exposes an on/off switch (no bounded thinking
        # budget).  On this 9B model, hidden thinking can consume the entire
        # generation limit before the visible answer starts.  NORMAL therefore
        # keeps the larger answer/context budget but reserves thinking for DEEP.
        thinking=False,
        context_tokens=8192,
        generation_tokens=4096,
        evidence_top_k=4,
        evidence_tokens=1500,
    ),
    ReasoningMode.DEEP: ReasoningProfile(
        mode=ReasoningMode.DEEP,
        label="Sâu",
        thinking=True,
        context_tokens=16384,
        generation_tokens=8192,
        evidence_top_k=6,
        evidence_tokens=3000,
    ),
}


class ReasoningProfileCatalog:
    def __init__(self, profiles: dict[ReasoningMode, ReasoningProfile] | None = None) -> None:
        self._profiles = dict(profiles or DEFAULT_REASONING_PROFILES)
        missing = set(ReasoningMode) - set(self._profiles)
        if missing:
            raise ValueError(f"Missing reasoning profiles: {sorted(item.value for item in missing)}")

    def list(self) -> tuple[ReasoningProfile, ...]:
        return tuple(self._profiles[mode] for mode in ReasoningMode)

    def get(self, mode: ReasoningMode | str) -> ReasoningProfile:
        return self._profiles[ReasoningMode(mode)]

    def thinking_parameter(
        self,
        mode: ReasoningMode | str,
        capabilities: ModelCapabilities,
    ) -> bool | None:
        profile = self.get(mode)
        return profile.thinking if capabilities.thinking_control else None

    def context_tokens_for(
        self,
        mode: ReasoningMode | str,
        messages: tuple[object, ...] | list[object],
    ) -> int:
        """Choose the smallest safe runner context without truncating input.

        Ollama does not expose a stable tokenizer-count endpoint.  Use the
        larger of a character and UTF-8 byte estimate, plus chat-template
        headroom and the *full* configured generation budget.  The thresholds
        deliberately only select 4K for short requests; longer/history-heavy
        requests retain the profile maximum.  Image requests retain the
        profile maximum because their visual token count is model-specific.
        """

        profile = self.get(mode)
        if any(getattr(message, "images", ()) for message in messages):
            return profile.context_tokens
        input_upper_bound = CHAT_TEMPLATE_RESERVE
        for message in messages:
            content = str(getattr(message, "content", ""))
            estimated_tokens = max(
                (len(content) + MIN_CHARS_PER_TOKEN - 1) // MIN_CHARS_PER_TOKEN,
                (len(content.encode("utf-8")) + MIN_UTF8_BYTES_PER_TOKEN - 1)
                // MIN_UTF8_BYTES_PER_TOKEN,
            )
            input_upper_bound += estimated_tokens + 16
        required = input_upper_bound + profile.generation_tokens
        candidates = [
            bucket
            for bucket in CONTEXT_BUCKETS
            if bucket <= profile.context_tokens and bucket >= required
        ]
        return min(candidates) if candidates else profile.context_tokens

    @staticmethod
    def migrate_legacy_mode(value: str | None) -> ReasoningMode:
        normalized = (value or "").strip().lower()
        if normalized in {"deep", "reasoning", "suy_luan_sau", "suy luận sâu"}:
            return ReasoningMode.DEEP
        if normalized in {"normal", "balanced", "can_bang", "cân bằng"}:
            return ReasoningMode.NORMAL
        return ReasoningMode.FAST
