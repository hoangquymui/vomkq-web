"""VECTOR AI offline application core."""

__version__ = "0.1.0"

# This protocol is consumed by the desktop bootstrapper. Bump the build id
# whenever a desktop release must reject an already-running, stale backend.
BACKEND_SERVICE_NAME = "vector-ai-python-core"
BACKEND_PROTOCOL_VERSION = 2
BACKEND_BUILD_ID = "2026-09-09.1"
