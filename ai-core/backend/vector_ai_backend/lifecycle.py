from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import ctypes
import errno
import json
import os
from pathlib import Path
import threading
from typing import Callable
from uuid import uuid4

from . import BACKEND_BUILD_ID, BACKEND_PROTOCOL_VERSION, BACKEND_SERVICE_NAME


INSTANCE_TOKEN_ENV = "VECTOR_AI_INSTANCE_TOKEN"
PARENT_PID_ENV = "VECTOR_AI_PARENT_PID"
OWNER_MARKER_NAME = "backend-owner.json"


def _positive_pid(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


@dataclass(frozen=True, slots=True)
class RuntimeIdentity:
    service: str
    protocol_version: int
    build_id: str
    instance_token: str
    pid: int
    parent_pid: int
    managed_by_app: bool
    started_at: str

    @classmethod
    def from_environment(cls) -> "RuntimeIdentity":
        supplied_token = os.environ.get(INSTANCE_TOKEN_ENV, "").strip()
        supplied_parent = _positive_pid(os.environ.get(PARENT_PID_ENV))
        managed_by_app = bool(supplied_token and supplied_parent)
        token = supplied_token[:256] if supplied_token else uuid4().hex
        return cls(
            service=BACKEND_SERVICE_NAME,
            protocol_version=BACKEND_PROTOCOL_VERSION,
            build_id=BACKEND_BUILD_ID,
            instance_token=token,
            pid=os.getpid(),
            parent_pid=supplied_parent or os.getppid(),
            managed_by_app=managed_by_app,
            started_at=datetime.now(timezone.utc).isoformat(),
        )

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class BackendOwnerMarker:
    """Atomic ownership marker used to identify an app-managed backend."""

    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / "work" / OWNER_MARKER_NAME

    def claim(self, identity: RuntimeIdentity) -> bool:
        if not identity.managed_by_app:
            return False
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        payload = json.dumps(identity.to_dict(), ensure_ascii=False, indent=2)
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        return True

    def release(self, identity: RuntimeIdentity) -> bool:
        """Remove the marker only while it still belongs to this exact run."""

        try:
            current = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return False
        if not isinstance(current, dict):
            return False
        if current.get("instance_token") != identity.instance_token or current.get("pid") != identity.pid:
            return False
        try:
            self.path.unlink()
        except FileNotFoundError:
            return False
        return True


def process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        # SYNCHRONIZE is sufficient for WaitForSingleObject and avoids asking
        # for broad access to the desktop process.
        synchronize = 0x00100000
        wait_timeout = 0x00000102
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        kernel32.WaitForSingleObject.restype = ctypes.c_ulong
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if not handle:
            # Access denied means a process exists but cannot be inspected.
            return ctypes.get_last_error() == 5
        try:
            return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError as exc:
        return exc.errno == errno.EPERM
    return True


class ParentWatchdog:
    def __init__(
        self,
        parent_pid: int,
        on_parent_exit: Callable[[], None],
        *,
        poll_interval: float = 1.0,
        is_alive: Callable[[int], bool] = process_is_alive,
    ) -> None:
        self._parent_pid = parent_pid
        self._on_parent_exit = on_parent_exit
        self._poll_interval = poll_interval
        self._is_alive = is_alive
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="vector-ai-parent-watchdog", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=max(1.0, self._poll_interval * 2))

    def _run(self) -> None:
        while not self._stop.wait(self._poll_interval):
            if self._is_alive(self._parent_pid):
                continue
            if not self._stop.is_set():
                self._on_parent_exit()
            return
