#!/usr/bin/env python3
"""Read-only consistency checks for VOMKQ .agents configuration (stdlib only)."""
from pathlib import Path
import argparse
import re
import sys


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    required = ["rules", "skills", "workflows"]
    for directory in required:
        if not (root / directory).is_dir():
            errors.append(f"Missing directory: {directory}")
    if errors:
        return errors

    triggers = {"always_on", "model_decision", "glob", "manual"}
    for path in sorted((root / "rules").glob("*.md")):
        text = path.read_text(encoding="utf-8-sig")
        found = re.search(r"(?m)^trigger:\s*([\w-]+)\s*$", text)
        if not text.startswith("---") or not found:
            errors.append(f"Rule YAML/trigger missing: {path.name}")
        elif found.group(1) not in triggers:
            errors.append(f"Unrecognized rule trigger: {path.name} {found.group(1)}")

    for path in sorted((root / "skills").glob("*/SKILL.md")):
        text = path.read_text(encoding="utf-8-sig")
        match = re.search(r"(?m)^name:\s*[\"']?([\w-]+)", text)
        if not text.startswith("---") or not match or match.group(1) != path.parent.name:
            errors.append(f"Skill name/YAML mismatch: {path.relative_to(root)}")

    workflow_names = {p.stem for p in (root / "workflows").glob("*.md")}
    playbook = (root / "skills/project-governor/WORKFLOW_PLAYBOOK.md")
    if playbook.is_file():
        text = playbook.read_text(encoding="utf-8")
        for name in re.findall(r"(?:→\s*/|^#\s+\d+\.\s+/)([\w-]+)", text, re.M):
            if name not in workflow_names:
                errors.append(f"Playbook calls undefined workflow /{name}")
    else:
        errors.append("Project Governor playbook missing")

    for rel in ["skills/project-governor/FAST_VALIDATION.md",
                "skills/project-governor/POST_IMPLEMENT_REVIEW_PROTOCOL.md",
                "workflows/evidence-package.md"]:
        if not (root / rel).is_file():
            errors.append(f"Required upgrade file missing: {rel}")

    protocol = (root / "skills/project-governor/POST_IMPLEMENT_REVIEW_PROTOCOL.md")
    if protocol.exists():
        text = protocol.read_text(encoding="utf-8")
        for phrase in ["git diff HEAD", "git diff --cached", "git ls-files --others"]:
            if phrase not in text:
                errors.append(f"Evidence protocol missing {phrase}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path,
                        default=Path(__file__).resolve().parents[1],
                        help="Path to .agents directory")
    args = parser.parse_args()
    errors = validate(args.root.resolve())
    workflow_count = len(list((args.root / "workflows").glob("*.md")))
    skill_count = len(list((args.root / "skills").glob("*/SKILL.md")))
    rule_count = len(list((args.root / "rules").glob("*.md")))
    print(f"Rules: {rule_count}, Skills: {skill_count}, Workflows: {workflow_count}")
    if errors:
        for err in errors:
            print(f"FAIL: {err}")
        return 1
    print("PASS: .agents structural checks and Governor workflow references")
    return 0


if __name__ == "__main__":
    sys.exit(main())
