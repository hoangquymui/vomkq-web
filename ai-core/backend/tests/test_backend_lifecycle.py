from __future__ import annotations

import asyncio
import json
import threading

from fastapi.testclient import TestClient

from vector_ai_backend import BACKEND_BUILD_ID, BACKEND_PROTOCOL_VERSION, BACKEND_SERVICE_NAME
from vector_ai_backend.api import create_app
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings
from vector_ai_backend.lifecycle import BackendOwnerMarker, ParentWatchdog, RuntimeIdentity


def _identity(token: str = "owned-token", *, pid: int = 1234) -> RuntimeIdentity:
    return RuntimeIdentity(
        service=BACKEND_SERVICE_NAME,
        protocol_version=BACKEND_PROTOCOL_VERSION,
        build_id=BACKEND_BUILD_ID,
        instance_token=token,
        pid=pid,
        parent_pid=4321,
        managed_by_app=True,
        started_at="2026-09-08T00:00:00+00:00",
    )


def test_health_exposes_runtime_identity(tmp_path) -> None:
    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    identity = _identity()
    try:
        with TestClient(create_app(container, runtime_identity=identity)) as client:
            payload = client.get("/api/v1/health").json()
        for key, value in identity.to_dict().items():
            assert payload[key] == value
        assert payload["status"] == "ready"
    finally:
        asyncio.run(container.close())


def test_runtime_identity_accepts_desktop_ownership_environment(monkeypatch) -> None:
    monkeypatch.setenv("VECTOR_AI_INSTANCE_TOKEN", "desktop-session-token")
    monkeypatch.setenv("VECTOR_AI_PARENT_PID", "9876")

    identity = RuntimeIdentity.from_environment()

    assert identity.instance_token == "desktop-session-token"
    assert identity.parent_pid == 9876
    assert identity.managed_by_app is True
    assert identity.pid > 0


def test_owner_marker_is_atomic_and_only_owner_can_remove_it(tmp_path) -> None:
    marker = BackendOwnerMarker(tmp_path)
    owner = _identity("owner", pid=111)
    foreign = _identity("foreign", pid=222)

    assert marker.claim(owner)
    assert json.loads(marker.path.read_text(encoding="utf-8"))["instance_token"] == "owner"
    assert not marker.release(foreign)
    assert marker.path.is_file()
    assert marker.release(owner)
    assert not marker.path.exists()


def test_unmanaged_backend_does_not_write_owner_marker(tmp_path) -> None:
    marker = BackendOwnerMarker(tmp_path)
    identity = RuntimeIdentity(
        service=BACKEND_SERVICE_NAME,
        protocol_version=BACKEND_PROTOCOL_VERSION,
        build_id=BACKEND_BUILD_ID,
        instance_token="manual",
        pid=1,
        parent_pid=2,
        managed_by_app=False,
        started_at="2026-09-08T00:00:00+00:00",
    )
    assert not marker.claim(identity)
    assert not marker.path.exists()


def test_owner_cleanup_does_not_delete_replaced_marker(tmp_path) -> None:
    marker = BackendOwnerMarker(tmp_path)
    old = _identity("old", pid=111)
    new = _identity("new", pid=222)
    marker.claim(old)
    marker.claim(new)

    assert not marker.release(old)
    assert json.loads(marker.path.read_text(encoding="utf-8"))["instance_token"] == "new"
    assert marker.release(new)


def test_parent_watchdog_notifies_once_when_parent_exits() -> None:
    alive = iter((True, False, False))
    notified = threading.Event()
    calls: list[int] = []

    def on_exit() -> None:
        calls.append(1)
        notified.set()

    watchdog = ParentWatchdog(
        4321,
        on_exit,
        poll_interval=0.01,
        is_alive=lambda _pid: next(alive, False),
    )
    watchdog.start()
    assert notified.wait(1)
    watchdog.stop()
    assert calls == [1]
