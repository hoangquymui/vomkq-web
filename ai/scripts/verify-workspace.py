"""Validate the planning workspace without importing AI code or opening databases."""
from __future__ import annotations

import ast
import hashlib
import json
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def main() -> int:
    errors: list[str] = []
    manifest_path = ROOT / "inventory.json"
    if not manifest_path.is_file():
        print("FAIL: inventory.json missing; create source snapshot first.")
        return 1
    manifest = read_json(manifest_path)
    if manifest.get("format") != "vomkq-ai-source-snapshot-v1":
        errors.append("Unsupported inventory format.")
    records = manifest.get("files", [])
    expected = set()
    backend = ROOT / "vendor/vector-ai/backend"
    python_count = 0
    for record in records:
        relative = PurePosixPath(record["relativePath"])
        if relative.is_absolute() or ".." in relative.parts or "\\" in str(relative):
            errors.append(f"Invalid inventory path: {relative}")
            continue
        path = ROOT.joinpath(*relative.parts)
        expected.add(path.resolve())
        if not path.is_file():
            errors.append(f"Missing snapshot file: {relative}")
            continue
        payload = path.read_bytes()
        if len(payload) != record["bytes"]:
            errors.append(f"Size mismatch: {relative}")
        if hashlib.sha256(payload).hexdigest() != record["sha256"]:
            errors.append(f"Checksum mismatch: {relative}")
        if path.suffix != ".py":
            continue
        python_count += 1
        try:
            tree = ast.parse(payload.decode("utf-8-sig"), filename=str(relative))
        except (SyntaxError, UnicodeError) as exc:
            errors.append(f"Python parse error {relative}: {exc}")
            continue
        package_parts = path.relative_to(backend).parts[:-1]
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.level:
                continue
            if node.level > len(package_parts):
                errors.append(f"Relative import escapes package: {relative}:{node.lineno}")
                continue
            parent = package_parts[: len(package_parts) - node.level + 1]
            suffix = tuple(node.module.split(".")) if node.module else ()
            target = backend.joinpath(*(parent + suffix))
            if not target.with_suffix(".py").is_file() and not (target / "__init__.py").is_file():
                errors.append(f"Missing internal module: {relative}:{node.lineno} -> {node.module}")

    actual = {path.resolve() for path in backend.rglob("*") if path.is_file()}
    unexpected = actual - expected
    errors.extend(f"Unlisted vendor file: {path.relative_to(ROOT)}" for path in sorted(unexpected))
    json_files = list((ROOT / "config").glob("*.json"))
    json_files += list((ROOT / "workflows").glob("*.json"))
    json_files += [ROOT / "models/manifest.example.json", ROOT / "knowledge/manifest.example.json"]
    for path in json_files:
        try:
            data = read_json(path)
            if data.get("implementationState") not in {"planned", "unprepared"}:
                errors.append(f"Example claims unsupported implementation state: {path.relative_to(ROOT)}")
        except (ValueError, OSError) as exc:
            errors.append(f"Invalid JSON {path.relative_to(ROOT)}: {exc}")
    for relative in ("README.md", "PLAN.md", "docs/RAG_AND_WORKFLOWS.md"):
        if not (ROOT / relative).is_file():
            errors.append(f"Missing planning document: {relative}")

    if errors:
        print("\n".join("FAIL: " + error for error in errors))
        return 1
    print(
        f"PASS: {len(records)} snapshot files match SHA-256; "
        f"{python_count} Python files parse and internal imports resolve; "
        f"{len(json_files)} design examples are valid JSON."
    )
    print("This verifies workspace structure only; no engine, model, database, or inference was started.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

