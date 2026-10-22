from __future__ import annotations

from dataclasses import dataclass, fields, replace
import json
import os
from pathlib import Path
from typing import Any

from .domain.models import ResourceLimits


def _default_data_dir() -> Path:
    # A portable deployment (VECTOR AI bundled inside another application)
    # redirects every piece of state into the project folder so the assistant
    # travels with the app and needs no per-user directory.
    portable = os.environ.get("VECTOR_AI_DATA_DIR", "").strip()
    if portable:
        return Path(portable)
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "VECTOR_AI"
    return Path.home() / ".vector_ai"


@dataclass(slots=True, frozen=True)
class BackendSettings:
    host: str = "127.0.0.1"
    port: int = 8000
    ollama_url: str = "http://127.0.0.1:11434"
    # Keep the active chat model warm between turns.  This is sent with every
    # chat request, so it also works when Ollama Desktop (rather than Tauri)
    # owns the Ollama server process.
    ollama_keep_alive: str = "30m"
    qdrant_url: str = "http://127.0.0.1:6333"
    qdrant_executable: str = ""
    frontend_origin: str = "http://127.0.0.1:3000"
    data_dir: Path = _default_data_dir()
    resource_cpu_slots: int = 2
    resource_ram_mb: int = 2048
    resource_gpu_mb: int = 6144
    chat_ram_mb: int = 1024
    chat_gpu_mb: int = 5200
    allow_exclusive_gpu: bool = True
    default_embedding_profile_id: str = "e5-small-local"
    auto_verify_confidence: float = 0.98

    @property
    def resource_limits(self) -> ResourceLimits:
        return ResourceLimits(
            cpu_slots=self.resource_cpu_slots,
            ram_mb=self.resource_ram_mb,
            gpu_mb=self.resource_gpu_mb,
            allow_exclusive_gpu=self.allow_exclusive_gpu,
        )

    @property
    def config_file(self) -> Path:
        return self.data_dir / "config" / "runtime.json"

    @classmethod
    def load(cls, data_dir: Path | None = None) -> "BackendSettings":
        base = cls(data_dir=data_dir or _default_data_dir())
        raw: dict[str, Any] = {}
        if base.config_file.is_file():
            try:
                loaded = json.loads(base.config_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    raw.update(loaded)
            except (OSError, json.JSONDecodeError):
                pass

        env_names = {
            "host": "VECTOR_AI_HOST",
            "port": "VECTOR_AI_PORT",
            "ollama_url": "VECTOR_AI_OLLAMA_URL",
            "ollama_keep_alive": "VECTOR_AI_OLLAMA_KEEP_ALIVE",
            "qdrant_url": "VECTOR_AI_QDRANT_URL",
            "qdrant_executable": "VECTOR_AI_QDRANT_EXE",
            "frontend_origin": "VECTOR_AI_FRONTEND_ORIGIN",
            "resource_cpu_slots": "VECTOR_AI_CPU_SLOTS",
            "resource_ram_mb": "VECTOR_AI_RAM_MB",
            "resource_gpu_mb": "VECTOR_AI_GPU_MB",
            "chat_ram_mb": "VECTOR_AI_CHAT_RAM_MB",
            "chat_gpu_mb": "VECTOR_AI_CHAT_GPU_MB",
            "default_embedding_profile_id": "VECTOR_AI_EMBEDDING_PROFILE",
            "auto_verify_confidence": "VECTOR_AI_FORMULA_CONFIDENCE",
        }
        integer_fields = {
            "port",
            "resource_cpu_slots",
            "resource_ram_mb",
            "resource_gpu_mb",
            "chat_ram_mb",
            "chat_gpu_mb",
        }
        float_fields = {"auto_verify_confidence"}
        for name, env_name in env_names.items():
            value = os.environ.get(env_name)
            if value is not None:
                raw[name] = int(value) if name in integer_fields else float(value) if name in float_fields else value
        if "allow_exclusive_gpu" in raw:
            raw["allow_exclusive_gpu"] = bool(raw["allow_exclusive_gpu"])

        allowed = {item.name for item in fields(cls)}
        clean = {name: value for name, value in raw.items() if name in allowed and name != "data_dir"}
        return replace(base, **clean)

    def validate(self) -> None:
        if self.host != "127.0.0.1":
            raise ValueError("VECTOR AI backend must bind to 127.0.0.1")
        if self.port != 8000:
            raise ValueError("VECTOR AI backend uses fixed port 8000")
        if self.ollama_url.rstrip("/") != "http://127.0.0.1:11434":
            raise ValueError("Ollama must use loopback port 11434")
        if not str(self.ollama_keep_alive).strip():
            raise ValueError("Ollama keep-alive must not be empty")
        if self.qdrant_url.rstrip("/") != "http://127.0.0.1:6333":
            raise ValueError("Qdrant must use loopback port 6333")
        if self.frontend_origin != "http://127.0.0.1:3000":
            raise ValueError("Frontend must use 127.0.0.1:3000")
        if self.resource_cpu_slots < 1 or self.resource_ram_mb < 0 or self.resource_gpu_mb < 0:
            raise ValueError("Invalid local resource profile")
        if self.chat_ram_mb > self.resource_ram_mb or self.chat_gpu_mb > self.resource_gpu_mb:
            raise ValueError("Chat resource request exceeds local resource profile")
