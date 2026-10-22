"""Private JSON-only child entrypoint. No filesystem/model/network tools."""
from __future__ import annotations

import asyncio
import json
import sys

from .symbolic import _WorkerSymbolicEngine


async def execute(payload):
    engine = _WorkerSymbolicEngine()
    operation = payload.get("operation")
    if operation == "evaluate":
        return await engine.evaluate(payload["expression"], payload.get("variables", {}))
    if operation == "simplify":
        return await engine.simplify(payload["expression"])
    if operation == "solve":
        return await engine.solve(payload["expression"], payload["symbol"])
    if operation == "equivalent":
        return await engine.equivalent(payload["left"], payload["right"], payload.get("assumptions", []))
    raise ValueError("Unsupported symbolic operation")


def main():
    try:
        raw = sys.stdin.buffer.read(64 * 1024 + 1)
        if len(raw) > 64 * 1024:
            raise ValueError("Request exceeds size limit")
        result = {"ok": True, "value": asyncio.run(execute(json.loads(raw)))}
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > 1024 * 1024:
            raise ValueError("Symbolic result exceeds size limit")
    except Exception as exc:
        encoded = json.dumps({"ok": False, "error": str(exc)[:1500]}, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(encoded)


if __name__ == "__main__":
    main()
