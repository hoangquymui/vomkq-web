# Antigravity Project Governor v1.4 — HEAD-AWARE EVIDENCE + FAST VALIDATION

Official deterministic evidence packaging profile for this project. Use together with `docs/NORTH_STAR/NORTH_STAR.md`.

## Recommended repository placement

```text
.agents/skills/project-governor/
├── SKILL.md
├── PIPELINE_V1.2.md
├── WORKFLOW_PLAYBOOK.md
├── CHECKPOINT_TEMPLATE.md
├── PRE_IMPLEMENT_PACKAGE_PROTOCOL.md
├── OPENCODE_PACKAGER_PROTOCOL.md
├── POST_IMPLEMENT_REVIEW_PROTOCOL.md
├── FAST_VALIDATION.md
├── REVIEW_PACKAGE_TEMPLATE.md
└── GPT_ENGINEER_REVIEW_PROMPT.md
```

## Fixed roles

```text
Antigravity = implementation engineer & deterministic evidence packager
ChatGPT     = independent reviewer/architect
Human       = final authority
```

Antigravity handles both implementation and evidence collection. OpenCode delegation and OCR are completely removed. Semantic review remains exclusively with ChatGPT.

## Official loop
`Checkpoint Contract → Antigravity implement → validation → Antigravity EVIDENCE PACKAGING (One Markdown File) → ChatGPT independent review → fix/repack/re-review if needed → GO → human authorization → explicit-path commit → Git-status verification (preserve unrelated changes) → ChatGPT next checkpoint`.

## v1.4 changes
- Added runnable `/evidence-package` for source/Git review, distinctly from simulation `/review-readiness`.
- Removed phantom `/evidence-repack` and `/prepare-commit` slash steps; commit remains human-only.
- Added read-only evidence capture + `.agents` consistency checker.
- HEAD-aware full diffs and indexed/untracked evidence, SHA-256 and no-truncation contract.
- Added tiered, low-redundancy validation and explicit STOP rules for failed repair loops.

## v1.3 changes
- removed OpenCode role and OCR delegation;
- standardized process to generate one Markdown review package;
- replaced GPT Engineer with ChatGPT;
- deterministic evidence is packaged directly by Antigravity into a single file outside the repository for ChatGPT review;
- next checkpoint execution begins only after human commit and verification/isolation of any residual dirty files.
