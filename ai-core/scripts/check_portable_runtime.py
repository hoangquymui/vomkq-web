"""Read-only portability check. Run using the bundled Python, also after export."""
from __future__ import annotations

import importlib
import json
from pathlib import Path
import subprocess
import sys


def main() -> None:
    project = Path(__file__).resolve().parents[1]
    pointer = json.loads((project / "runtime/active.json").read_text(encoding="utf-8"))
    runtime = (project / "runtime" / pointer["bundle"]).resolve()
    assert runtime.is_relative_to(project / "runtime"), "Runtime escaped project"
    assert Path(sys.executable).resolve() == runtime / "python/python.exe"
    assert sys.flags.isolated and sys.flags.no_site, "Python must not load user site or .pth hooks"
    assert all(Path(p).resolve().is_relative_to(runtime / "python") or Path(p).resolve() == project / "backend" for p in sys.path), sys.path
    for name in ("fastapi", "uvicorn", "httpx", "sympy", "langgraph.graph", "pypdf", "pymupdf", "ssl", "sqlite3"):
        module = importlib.import_module(name)
        assert Path(module.__file__).resolve().is_relative_to(runtime / "python"), name
    core = importlib.import_module("vector_ai_backend")
    assert Path(core.__file__).resolve().is_relative_to(project / "backend")
    subprocess.run([sys.executable, "-c", "from vector_ai_backend.adapters.symbolic import RestrictedSymbolicEngine; import sympy; print(sympy.simplify('2+2'))"], check=True, timeout=20)
    subprocess.run([str(runtime / "node/node.exe"), "--version"], check=True, timeout=10)
    for relative, expected in json.loads((runtime / "manifest.json").read_text(encoding="utf-8"))["checksums"].items():
        import hashlib
        path = runtime / relative
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest().upper()
        assert actual == expected, relative
    if (project / "share-manifest.json").exists():
        manifest = json.loads((project / "share-manifest.json").read_text(encoding="utf-8"))
        for forbidden in (".env", "backend/.venv", ".venv", ".venv-1", "src-tauri/target"):
            assert not (project / forbidden).exists(), forbidden
        if not manifest["includes_knowledge"]:
            assert not (project / "public/knowledge").exists()
            assert not (project / "knowledge_sources").exists()
    print("PASS: relocated Python/Node, isolated imports, child process, binary hashes and share exclusions")


if __name__ == "__main__":
    main()
