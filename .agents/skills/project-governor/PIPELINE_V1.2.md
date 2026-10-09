# PROJECT GOVERNOR v1.4 — GIT HEAD-AWARE PIPELINE (legacy filename retained)

**Status:** Active operating profile
**Evidence mode:** SINGLE MARKDOWN PACKAGE
**OCR/OpenCode:** Removed

## Fixed roles

```text
North Star = product/architecture authority
Project Governor = engineering rules
Checkpoint Contract = scope/invariant contract for one migration
Antigravity = implementer & evidence packager
ChatGPT = independent semantic reviewer/architect
Human = final authority
```

## Official pipeline

```text
BASELINE
  ↓
CHECKPOINT CONTRACT
  ↓
ANTIGRAVITY /implement-feature
  ↓
FOCUSED TEST LOOP
  ↓
FULL VALIDATION
  ↓
ANTIGRAVITY EVIDENCE PACKAGING (One Markdown File)
  ↓
CHATGPT INDEPENDENT REVIEW
  ├── EVIDENCE-INCOMPLETE → Antigravity rebuilds package → review again
  ├── NO-GO → /debug-issue → validation → fresh PACKAGE → re-review
  └── GO
        ↓
HUMAN AUTHORIZATION
        ↓
EXPLICIT-PATH STAGING
        ↓
STAGED DIFF CHECK
        ↓
COMMIT
        ↓
CLEAN STATUS VERIFY
        ↓
CHATGPT NEXT CHECKPOINT CONTRACT
```

## Gate 0 — Baseline

```bash
git status --short
git branch --show-current
git log -3 --oneline
```

If unrelated dirty changes cannot be isolated, STOP.

## Gate 1 — Context Collection
Antigravity locally collects definitions, callers, dependencies, types, validators, selectors, tests, search evidence, and compatibility boundaries to inform implementation.

## Gate 2 — Antigravity implementation
Antigravity consumes North Star + Governor + Checkpoint Contract, edits only approved scope, and does not commit/push.

## Gate 3 — Validation

```bash
npx tsc -b --pretty false
npx vitest run
npm run build  # once on stable final code; rerun only after relevant changes
git diff HEAD --check
git status --short
git diff HEAD --stat
git diff --cached --stat
```

Checkpoint-specific commands may add to this gate.

## Gate 4 — Evidence Packaging
Antigravity compiles the current raw diff, changed symbols, relevant unchanged code, tests, exact validation output, search evidence, and remaining boundaries into a SINGLE MARKDOWN FILE outside the repository.

## Gate 5 — ChatGPT independent review
Allowed outcomes: `GO`, `NO-GO`, `EVIDENCE-INCOMPLETE`.

## Gate 6 — Fix loop
Only confirmed P0/P1 blockers are mandatory in the current checkpoint. After any code change, the previous package is stale; create a fresh EVIDENCE PACKAGE.

## Gate 7 — Commit (HUMAN ONLY)
Only after GO, hand these commands to the human. Antigravity MUST NOT execute stage/commit/push:

```bash
git add <explicit intended paths>
git diff --cached --check
git diff --cached --stat
git status --short
git commit -m "<scoped message>"
git show --check --oneline HEAD
git status --short
```

## Gate 8 — Next checkpoint
Plan the next checkpoint only after verifying the human commit and inventorying remaining dirty/untracked files; preserve unrelated changes. Use committed repository state + final review + remaining boundaries + North Star priorities.

## Hard rules
- Antigravity never self-certifies architecture.
- ChatGPT never returns GO without current raw evidence in the package.
- Human controls commit/push.
- Stale packages are invalid.
- Next checkpoint execution waits for a verified human commit and safely isolated Git status; do not require destructive cleaning of unrelated files.
- The single Markdown package and temporary logs must be stored outside the Git repository.
