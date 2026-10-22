from __future__ import annotations

import uvicorn
import socket

from .api import create_app
from .config import BackendSettings
from .lifecycle import BackendOwnerMarker, ParentWatchdog, RuntimeIdentity


def main() -> None:
    settings = BackendSettings.load()
    settings.validate()
    identity = RuntimeIdentity.from_environment()
    marker = BackendOwnerMarker(settings.data_dir)
    # Claim the fixed port before lifespan opens or restores databases. A second
    # app instance must fail before it can mutate the first instance's state.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind((settings.host, settings.port))
        listener.listen(128)
        config = uvicorn.Config(
            create_app(runtime_identity=identity),
            host=settings.host,
            port=settings.port,
            log_level="info",
        )
        server = uvicorn.Server(config)
        watchdog = (
            ParentWatchdog(identity.parent_pid, lambda: setattr(server, "should_exit", True))
            if identity.managed_by_app
            else None
        )
        marker.claim(identity)
        try:
            if watchdog is not None:
                watchdog.start()
            server.run(sockets=[listener])
        finally:
            if watchdog is not None:
                watchdog.stop()
            marker.release(identity)


if __name__ == "__main__":
    main()
