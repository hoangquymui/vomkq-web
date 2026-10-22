from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from pathlib import Path
import subprocess
from typing import Any, Sequence


@dataclass(slots=True, frozen=True)
class LocalServiceSpec:
    name: str
    host: str
    port: int
    command: tuple[str, ...] = ()
    cwd: Path | None = None


class LocalServiceSupervisor:
    """Checks/starts configured local binaries and stops only owned processes."""

    def __init__(self, specs: Sequence[LocalServiceSpec]) -> None:
        self._specs = {spec.name: spec for spec in specs}
        self._owned: dict[str, subprocess.Popen[Any]] = {}

    async def probe(self, name: str, timeout_seconds: float = 0.5) -> dict[str, Any]:
        spec = self._specs[name]
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(spec.host, spec.port), timeout_seconds
            )
            writer.close()
            await writer.wait_closed()
            return {"name": name, "status": "ready", "host": spec.host, "port": spec.port}
        except (OSError, TimeoutError, asyncio.TimeoutError) as exc:
            return {
                "name": name,
                "status": "unavailable",
                "host": spec.host,
                "port": spec.port,
                "detail": str(exc),
            }

    async def health(self) -> dict[str, dict[str, Any]]:
        values = await asyncio.gather(*(self.probe(name) for name in self._specs))
        return {value["name"]: value for value in values}

    async def ensure_started(self, name: str) -> dict[str, Any]:
        status = await self.probe(name)
        if status["status"] == "ready":
            return status
        spec = self._specs[name]
        if not spec.command:
            return {**status, "detail": "No local executable configured; runtime download is disabled"}
        if name in self._owned and self._owned[name].poll() is None:
            return {**status, "status": "starting"}
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._owned[name] = subprocess.Popen(
            list(spec.command),
            cwd=str(spec.cwd) if spec.cwd else None,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        for _ in range(30):
            await asyncio.sleep(0.2)
            status = await self.probe(name)
            if status["status"] == "ready":
                return {**status, "owned": True}
        return {**status, "status": "starting", "owned": True}

    async def stop_owned(self) -> None:
        for name, process in tuple(self._owned.items()):
            if process.poll() is None:
                process.terminate()
                try:
                    await asyncio.wait_for(asyncio.to_thread(process.wait), 5.0)
                except asyncio.TimeoutError:
                    process.kill()
            self._owned.pop(name, None)

