# ANTIGRAVITY WORKFLOW PLAYBOOK v1.4 — HEAD-AWARE FAST-VALIDATION PIPELINE

This playbook implements Project Governor v1.3 with Antigravity generating a single Markdown package for ChatGPT review. OCR and OpenCode delegation are removed.

# 1. STANDARD ARCHITECTURE CHECKPOINT FLOW

```text
/project-audit (when needed)
→ checkpoint contract
→ local context collection
→ /implement-feature
→ focused tests
→ full validation
→ /evidence-package (Antigravity generates complete HEAD-aware Markdown evidence)
→ ChatGPT independent review
→ NO-GO? /debug-issue → /evidence-package (repack mode) → ChatGPT re-review
→ GO
→ human authorization
→ human-only prepare/stage/commit (manual commands, never an agent slash step)
→ verify clean commit
→ ChatGPT next-checkpoint contract
```

# 2. /project-audit
Read/search/classify only. No production edits. Output canonical authority, mutation/read paths, compatibility boundaries, tests, serialization/persistence contracts, and risks.

# 3. CHECKPOINT CONTRACT
Use `CHECKPOINT_TEMPLATE.md`. Define goal, canonical authority, identity/ownership, invariants, scope, history, atomicity, compatibility, tests, validation, PRE-PACK searches, POST-PACK searches, and no-commit policy.

# 4. Local Context Collection
Follow `PRE_IMPLEMENT_PACKAGE_PROTOCOL.md`. No edits, no semantic judgments. If context is missing, stop before implementation.

# 5. /implement-feature

Preflight: status, branch, recent log; consume North Star, Governor, contract, context.

Audit target boundary against repository reality. Context is context, not authority.

Implement smallest coherent diff; no unrelated cleanup; no hidden schema changes; validate before side effects; preserve canonical authority/history/isolation.

Run focused tests + TypeScript during editing; once code stabilizes, run final full validation according to `FAST_VALIDATION.md` (no needless repeated production builds):

```bash
npx vitest run
npm run build
git diff HEAD --check
git status --short
git diff HEAD --stat
git diff --cached --stat
```

Do not commit/push. Report exact implementation + validation only; do not self-certify final GO.

# 6. /evidence-package
Antigravity generates a single Markdown file outside the tree. Follow `POST_IMPLEMENT_REVIEW_PROTOCOL.md`. Package must reflect the latest code, `git diff HEAD` (not only unstaged diff), current index, untracked inventory and latest *completed* validation. Use `.agents/tools/capture_checkpoint_evidence.py` when suitable.

# 7. ChatGPT Review
Use `GPT_ENGINEER_REVIEW_PROMPT.md`. Verdict: `GO`, `NO-GO`, or `EVIDENCE-INCOMPLETE`.

# 8. /debug-issue
Input current diff + ChatGPT P0/P1 findings. Fix only confirmed blockers within scope. Do not opportunistically implement deferred P2/P3. Re-run focused + full validation.

# 9. Evidence repack (mode of /evidence-package, not a standalone slash workflow)
Any code change invalidates the old package. Generate a fresh package; include previous findings and diff since previous review.

# 10. ChatGPT Re-review
Classify each prior blocker: `FIXED`, `PARTIALLY FIXED`, `NOT FIXED`, `REGRESSION INTRODUCED`. GO only with no unresolved P0/P1 and complete evidence.

# 11. HUMAN COMMIT HANDOFF (not a slash workflow)
Only after ChatGPT GO, provide these instructions for the human to execute; Antigravity must not run them:

```bash
git add <exact intended paths>
git diff --cached --check
git diff --cached --stat
git status --short
git commit -m "<scoped conventional message>"
git show --check --oneline HEAD
git status --short
```

Do not use `git add -A` by default. Do not push unless explicitly requested.

# 12. NEXT CHECKPOINT PLANNING
Only after verified human commit and inventory of any remaining unrelated dirty/untracked files. Derive the next contract from North Star + committed repository state + final review + remaining boundaries + deferred P2/P3. Never derive it solely from Antigravity report.

# 13. CHANGE-SPECIFIC MINI WORKFLOWS

## Canonical domain migration
`legacy inventory → canonical identity/ownership → adapters → commands → selectors → render consumers → serialization → parity → retire legacy authority last`

## Simulation change
`canonical IDs → clock/event semantics → run provenance → state transitions → preserve history → determinism/replay tests → renderer integration last`

## Analysis change
`logic contract → units → inputs → validation → output schema → provenance/fingerprint → stale logic → golden regression → visualization adapter`

## Import/export change
`schema version → parse candidate → validate → remap references → graph validation → atomic commit → round-trip → old fixture`

## Renderer change
`canonical read model → renderer adapter/geometry → identity/selection/lifecycle cleanup → verify no domain writes in renderer`

# 14. SMART SCOPE BUDGET
If one checkpoint changes three or more independent architecture boundaries, split unless inseparable for correctness.

# 15. FAILURE RECOVERY
`classify failure → baseline vs regression → violated invariant → root-cause fix → focused retest → dependent suite → full validation`. Do not weaken assertions merely to make tests green.

# 16. HARD RULES & HYGIENE
1. Never use `git add .` or `git add -A` by default.
2. No automatic commit or push. Human controls these.
3. Every new/untracked source file must be included in review evidence.
4. `git diff --check` alone does not cover untracked files; explicitly verify them.
5. The final `git diff --cached --check` must exit 0 before commit.
6. Verify the exact staged file list before commit.
7. Capture real native exit codes; never hardcode them.
8. Preserve complete raw test/build output for review.
9. Any relevant code change invalidates prior evidence package.
10. Human-owned and unknown files are protected.
11. Logs and evidence packages belong outside the Git tree.
12. Do not use `git clean -fd` or silent deletion.
13. Never claim working tree clean if untracked files remain.
14. Next checkpoint planning uses committed state, not an uncommitted implementation report.
