#!/usr/bin/env python3
"""Create read-only, full HEAD-aware Git evidence in one Markdown file outside the repo.

This does not run tests/build or certify a checkpoint. Include their real logs separately.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
from pathlib import Path
import sys


def invoke(repo: Path, *args: str) -> tuple[int, str, str]:
    proc = subprocess.run(["git", *args], cwd=repo, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)
    return (proc.returncode,
            proc.stdout.decode("utf-8", errors="replace"),
            proc.stderr.decode("utf-8", errors="replace"))


def section(title: str, body: str, lang: str = "text") -> str:
    # Fences are auto-sized so untrusted content cannot prematurely close the block.
    fence = "`" * max(4, max((len(x) for x in __import__('re').findall(r"`+", body)), default=0) + 1)
    return f"## {title}\n\n{fence}{lang}\n{body.rstrip()}\n{fence}\n\n"


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo", type=Path, required=True)
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--paths", nargs="+", required=True, metavar="RELATIVE_PATH")
    p.add_argument("--test-log", type=Path)
    p.add_argument("--build-log", type=Path)
    p.add_argument("--contract", type=Path)
    a = p.parse_args()
    repo = a.repo.resolve()
    out = a.out.resolve()
    if not (repo / ".git").exists() and invoke(repo, "rev-parse", "--show-toplevel")[0] != 0:
        p.error("--repo is not a Git repository")
    top_rc, top, _ = invoke(repo, "rev-parse", "--show-toplevel")
    if top_rc or Path(top.strip()).resolve() != repo:
        p.error("--repo must be the Git root")
    if out.is_relative_to(repo):
        p.error("--out must be outside the Git repository")
    if out.exists():
        p.error("--out exists (choose a unique timestamped output; never overwrite evidence)")
    paths = []
    for item in a.paths:
        path = Path(item)
        if path.is_absolute() or ".." in path.parts or not item.strip():
            p.error(f"Unsafe --paths argument: {item}")
        paths.append(path.as_posix())
    current = [repo / x for x in paths]
    if any(not x.is_file() for x in current):
        p.error("All intended paths must exist; handle deleted paths manually as a separate evidence item")
    before_hash = {x: sha_file(repo / x) for x in paths}
    begin = invoke(repo, "rev-parse", "HEAD")[1].strip()
    rc, status_before, se = invoke(repo, "status", "--short", "--untracked-files=all")
    if rc:
        p.error(f"git status failed: {se}")
    commands = [
        ("Repository HEAD and branch", ("rev-parse", "HEAD")),
        ("Branch", ("branch", "--show-current")),
        ("Full status", ("status", "--short", "--untracked-files=all")),
        ("HEAD diff stat, staged + unstaged", ("diff", "HEAD", "--stat")),
        ("Staged diff stat", ("diff", "--cached", "--stat")),
        ("HEAD diff check", ("diff", "HEAD", "--check")),
        ("Staged diff check", ("diff", "--cached", "--check")),
        ("HEAD index blobs for intended paths", ("ls-tree", "HEAD", "--", *paths)),
        ("Index blobs for intended paths", ("ls-files", "-s", "--", *paths)),
        ("Untracked inventory", ("ls-files", "--others", "--exclude-standard")),
        ("Complete intended diff from HEAD", ("diff", "HEAD", "--no-ext-diff", "--", *paths)),
        ("Staged intended diff", ("diff", "--cached", "--no-ext-diff", "--", *paths)),
    ]
    pieces = [f"# Mechanical Git Evidence — {a.checkpoint}\n\n",
              "**Status:** EVIDENCE ONLY — NOT A GO/NO-GO CERTIFICATION. "
              "Validation and contract evidence are not inferred.\n\n",
              "**HEAD-aware policy:** `git diff HEAD` includes staged + unstaged tracked changes; "
              "untracked files require separate coverage.\n\n"]
    commands_ok = True
    for label, cmd in commands:
        rc, stdout, stderr = invoke(repo, *cmd)
        commands_ok &= rc == 0
        pieces.append(section(f"{label} (exit={rc})", "$ git " + " ".join(cmd) + "\n" + stdout +
                              ("\nSTDERR:\n" + stderr if stderr else ""), "diff" if "diff" in label.lower() else "text"))
    rc, tracked, _ = invoke(repo, "ls-files", "--", *paths)
    tracked_set = set(tracked.splitlines()) if rc == 0 else set()
    untracked_targets = [x for x in paths if x not in tracked_set]
    for rel in untracked_targets:
        f = repo / rel
        try:
            body = f.read_text(encoding="utf-8")
        except (UnicodeError, OSError):
            body = f"BINARY_OR_UNREADABLE (sha256={sha_file(f)}); EVIDENCE INCOMPLETE FOR REVIEW"
            commands_ok = False
        pieces.append(section(f"Complete intended untracked file: {rel}", body, "text"))
    rc, full_diff, _ = invoke(repo, "diff", "HEAD", "--no-ext-diff", "--", *paths)
    pieces.append(f"**Full intended HEAD diff SHA-256:** `{hashlib.sha256(full_diff.encode('utf-8')).hexdigest()}`\n\n")
    for label, f in [("Checkpoint contract", a.contract), ("Tests log (supplied)", a.test_log),
                     ("Production build log (supplied)", a.build_log)]:
        if f is None:
            pieces.append(f"## {label}\n\nNOT PROVIDED — do not claim verified.\n\n")
        else:
            pieces.append(section(label + " (not independently authenticated)", f.read_text(encoding="utf-8-sig")))
    end = invoke(repo, "rev-parse", "HEAD")[1].strip()
    rc, status_after, _ = invoke(repo, "status", "--short", "--untracked-files=all")
    after_hash = {x: sha_file(repo / x) for x in paths}
    consistent = end == begin and status_before == status_after and after_hash == before_hash
    pieces.append("## Snapshot consistency\n\n")
    pieces.append(f"- HEAD unchanged during capture: **{end == begin}**\n")
    pieces.append(f"- Git status unchanged during capture: **{status_before == status_after}**\n")
    pieces.append(f"- Intended file contents unchanged: **{after_hash == before_hash}**\n")
    pieces.append(f"- Git captures completed successfully: **{commands_ok}**\n")
    pieces.append("- Validation freshness versus source snapshot: **UNVERIFIED unless logs include evidence**\n")
    pieces.append("- Independent semantic review: **REQUIRED**\n")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(pieces), encoding="utf-8")
    print(f"Created {out} ({out.stat().st_size} bytes), snapshot_consistent={consistent}")
    return 0 if consistent and commands_ok and rc == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
