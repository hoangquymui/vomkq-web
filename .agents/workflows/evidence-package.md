---
description: "Assemble a full Git HEAD-aware source review package, without semantic self-approval or Git mutation."
---

# Evidence Package — Code/Git Checkpoint

Use for engineering checkpoint review; **do not confuse with `/review-readiness`**, which is for simulation/assessment human review.

1. Read Governor `POST_IMPLEMENT_REVIEW_PROTOCOL.md` and `FAST_VALIDATION.md`.
2. Capture current branch, full HEAD, index blob IDs, expected paths and `git status --short`.
3. Capture **full** `git diff HEAD -- <intended paths>` (staged + unstaged), `git diff --cached`, diff/check/stat and untracked inventory. Never use only `git diff` for final evidence, never limit to first N characters.
4. Provide full contents for *intended untracked code/test files*, and flag any unknown/unrelated dirty files. Do not delete, stage or restore them.
5. Capture real commands, exit codes and complete finished logs for focused tests, TypeScript, full tests and build. If absent/not run, write `NOT VERIFIED`, never PASS.
6. Generate one Markdown package **outside** the worktree. Include SHA-256, base/HEAD identity, approved contract, change map, full diff, regression evidence and remaining uncertainties.
7. Optionally use `.agents/tools/capture_checkpoint_evidence.py` to gather Git evidence read-only; add contract, surrounding code, search evidence, and real validation logs as required.
8. For re-review use this **same** workflow in `repack` mode, adding previous findings/resolutions and a new evidence snapshot. `/evidence-repack` is not a separate slash command.
9. Stop for independent ChatGPT `GO / NO-GO / EVIDENCE-INCOMPLETE`. Never self-certify GO or run `git add/commit/push`.
