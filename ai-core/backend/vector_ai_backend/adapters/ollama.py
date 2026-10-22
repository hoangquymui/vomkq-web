from __future__ import annotations

import json
import math
import re
from typing import Any, AsyncIterator, Mapping

from ..domain.models import LLMRequest, ModelCapabilities


class OllamaResponseError(RuntimeError):
    """Safe, bounded server diagnostic that survives Core/SSE error reporting."""


def sampler_schema(value):
    """Bounded string repetitions fail on the installed Ollama grammar parser.

    Keep structural constraints for sampling. The complete original schema is
    still enforced by the application, along with token/output size budgets.
    """
    if isinstance(value, dict):
        result = {key: sampler_schema(item) for key, item in value.items()
                  if key not in {"maxLength", "minLength"}}
        kinds = result.get("properties", {}).get("kind", {}).get("enum")
        if kinds == ["fact", "quote", "interpretation", "comparison"]:
            # Sampling enforces the same per-kind empty text/relation rules
            # checked by validated_answer. The tiny local model otherwise
            # routinely writes prose into the quantitative reference field.
            import copy
            branches = []
            for kind in kinds:
                branch = copy.deepcopy(result)
                branch["properties"]["kind"]["enum"] = [kind]
                if kind in {"fact", "comparison"}:
                    branch["properties"]["text"]["enum"] = [""]
                    branch["properties"]["evidenceIds"]["minItems"] = 2 if kind == "comparison" else 1
                    branch["properties"]["evidenceIds"]["maxItems"] = 2 if kind == "comparison" else 1
                if kind != "comparison":
                    branch["properties"]["relation"]["enum"] = [""]
                else:
                    branch["properties"]["relation"]["enum"] = ["lt", "eq", "gt"]
                branches.append(branch)
            return {"oneOf": branches}
        return result
    if isinstance(value, list):
        return [sampler_schema(item) for item in value]
    return value


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 1800.0,
        transport: Any = None,
        keep_alive: str | int = "30m",
    ) -> None:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - exercised in minimal installs
            raise RuntimeError("Install VECTOR AI with the 'api' extra to use Ollama") from exc
        self._httpx = httpx
        self._base_url = base_url.rstrip("/")
        self._timeout = httpx.Timeout(timeout_seconds, connect=8.0)
        self._transport = transport
        self._keep_alive = keep_alive
        self._client = httpx.AsyncClient(timeout=self._timeout, transport=self._transport)
        self._capabilities: dict[str, ModelCapabilities] = {}

    async def close(self) -> None:
        await self._client.aclose()

    async def model_revision(self, model: str) -> str | None:
        """Read an exact local tag digest; no pull, alias guess or cached revision.

        The three-second metadata probe must not prevent local inference if
        tags are unavailable. Actual model loading remains the caller's job.
        """
        try:
            response = await self._client.get(f"{self._base_url}/api/tags", timeout=3.0)
            response.raise_for_status()
            payload = response.json()
            models = payload.get("models", []) if isinstance(payload, dict) else []
            if not isinstance(models, list):
                return None
            for item in models:
                if not isinstance(item, dict) or model not in {item.get("name"), item.get("model")}:
                    continue
                digest = item.get("digest")
                if isinstance(digest, str) and re.fullmatch(r"(?:sha256:)?[0-9a-fA-F]{64}", digest):
                    return digest
                return None
        except Exception:
            return None
        return None

    async def capabilities(self, model: str) -> ModelCapabilities:
        cached = self._capabilities.get(model)
        if cached is not None:
            return cached
        try:
            response = await self._client.post(f"{self._base_url}/api/show", json={"model": model})
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return ModelCapabilities()
        values = payload.get("capabilities", [])
        if not isinstance(values, list):
            values = []
        lowered = {str(value).lower() for value in values}
        capabilities = ModelCapabilities(
            thinking_control="thinking" in lowered,
            embeddings="embedding" in lowered or "embeddings" in lowered,
            vision="vision" in lowered,
        )
        self._capabilities[model] = capabilities
        return capabilities

    async def stream_chat(self, request: LLMRequest) -> AsyncIterator[Mapping[str, Any]]:
        payload: dict[str, Any] = {
            "model": request.model,
            "messages": [
                {
                    "role": message.role,
                    "content": message.content,
                    **({"images": list(message.images)} if message.images else {}),
                }
                for message in request.messages
            ],
            "stream": True,
            "keep_alive": self._keep_alive,
            "options": {
                "num_ctx": request.context_tokens,
                "num_predict": request.generation_tokens,
                "num_gpu": -1,
                "main_gpu": 0,
            },
        }
        if request.thinking is not None:
            payload["think"] = request.thinking
        if request.format is not None:
            payload["format"] = sampler_schema(dict(request.format))
            payload["options"]["temperature"] = 0

        async with self._client.stream("POST", f"{self._base_url}/api/chat", json=payload) as response:
            if response.is_error:
                await response.aread()
                try:
                    body = response.json()
                    detail = body.get("error", body) if isinstance(body, dict) else body
                    if isinstance(detail, dict):
                        detail = detail.get("message", detail)
                except ValueError:
                    detail = response.text
                raise OllamaResponseError(f"Ollama HTTP {response.status_code}: {str(detail)[:2000]}")
            completed = False
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                raw = json.loads(line)
                if raw.get("error"):
                    raise OllamaResponseError(f"Ollama: {str(raw['error'])[:2000]}")
                message = raw.get("message") if isinstance(raw.get("message"), dict) else {}
                event: dict[str, Any] = {"content": message.get("content", "")}
                # Never pass message.thinking across the adapter boundary.
                if raw.get("done"):
                    completed = True
                    done_reason = str(raw.get("done_reason") or "")
                    event["done"] = True
                    event["done_reason"] = done_reason
                    event["truncated"] = done_reason == "length"
                    event["usage"] = {
                        "prompt_tokens": int(raw.get("prompt_eval_count") or 0),
                        "completion_tokens": int(raw.get("eval_count") or 0),
                        "total_tokens": int(raw.get("prompt_eval_count") or 0)
                        + int(raw.get("eval_count") or 0),
                    }
                    duration_fields = {
                        "total_duration_ns": raw.get("total_duration"),
                        "load_duration_ns": raw.get("load_duration"),
                        "prompt_eval_duration_ns": raw.get("prompt_eval_duration"),
                        "eval_duration_ns": raw.get("eval_duration"),
                    }
                    event["usage"].update({
                        key: int(value)
                        for key, value in duration_fields.items()
                        if isinstance(value, (int, float)) and math.isfinite(value)
                    })
                    eval_duration = event["usage"].get("eval_duration_ns", 0)
                    if eval_duration > 0:
                        event["usage"]["tokens_per_second"] = round(
                            event["usage"]["completion_tokens"] * 1_000_000_000 / eval_duration,
                            2,
                        )
                yield event
            if not completed:
                raise OllamaResponseError(
                    "Luồng Ollama kết thúc trước khi xác nhận hoàn tất; "
                    "đây không phải thao tác dừng của người dùng."
                )
