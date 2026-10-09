# POST-IMPLEMENTATION REVIEW PROTOCOL v1.4 — HEAD-AWARE SINGLE MARKDOWN PACKAGE

**Purpose:** Convert the current repository state after Antigravity implementation into a single evidence-first Markdown file outside the repository for independent ChatGPT review.

## Preconditions
Implementation and current validation commands have finished. No commit/push.

## Package structure
Instead of a directory of files, generate ONE Markdown file: `REVIEW_PACKAGE.md` (stored outside the worktree, e.g. in the artifacts directory).

The file MUST contain the following sections in order:

```markdown
# 00. MANIFEST
Checkpoint:
Branch:
Base commit:
Current HEAD:
Review iteration:
Generated after latest changes: YES/NO
Full validation complete: YES/NO
Working tree status:
Expected changed files:
Actual changed files:
Unexpected changed files:
Known incomplete commands:

# 01. CHECKPOINT CONTRACT
(Exact approved contract)

# 02. NORTH_STAR CONTEXT
(Relevant exact sections/references)

# 03. GOVERNOR CONTEXT
(Activated Governor laws/change classes)

# 04. BASELINE AND HEAD
(Branch, base commit, HEAD, recent log)

# 05. GIT STATUS
(Exact `git status --short`)

# 06. DIFF STAT
(Exact `git diff HEAD --stat` and `git diff --cached --stat`)

# 07. DIFF CHECK
(Exact `git diff HEAD --check` and `git diff --cached --check`)

# 08. FULL DIFF
(Complete `git diff HEAD -- <intended paths>`; HEAD/index hash; include staged+unstaged, plus untracked intended source content. Never truncate.)

# 09. CHANGED FILES
(File | Expected? | Mechanical change type | Notes)

# 10. CHANGED SYMBOLS
(File, symbol, hunks, direct callers/dependencies, guard links, selectors/projections, related tests)

# 11. RELATED UNCHANGED CODE
(Only materially relevant unchanged symbols)

# 12. DEPENDENCY EDGES
(Mechanical symbol/import/call edges)

# 13. REPOSITORY SEARCH EVIDENCE
(Raw search command/pattern, scope, matches)

# 14. TEST CHANGES
(Exact test diff)

# 15. TEST RESULTS
(COMMAND / SCOPE / RESULT / FINAL OUTPUT)

# 16. BUILD RESULT
(COMMAND / RESULT / FINAL OUTPUT)

# 17. ANTIGRAVITY CLAIMS
(CLAIM / EVIDENCE STATUS / CANDIDATE EVIDENCE)

# 18. REMAINING BOUNDARIES
(Boundary, file/symbol, raw search evidence, stated reason retained, planned retirement if known)

# 19. OPEN QUESTIONS
(Mechanical ambiguities only)

# 20. PACKAGE INTEGRITY
(Freshness/completeness checklist)
```

For re-reviews, append:
```markdown
# 21. PREVIOUS FINDINGS
# 22. FINDING RESOLUTION MATRIX
# 23. DIFF SINCE PREVIOUS REVIEW
```

## Required git evidence

```bash
git branch --show-current
git log -3 --oneline
git status --short
git diff HEAD --stat
git diff HEAD --check
git diff HEAD -- <all intended changed files>
git diff --cached --stat
git diff --cached --check
git diff --cached -- <all intended changed files>
git ls-files --others --exclude-standard
git ls-files -s -- <all intended changed files>
```

Always capture the staged state explicitly, including the fact it is empty. Enumerate untracked files; intended untracked source/test files require complete readable content. Record SHA-256 of the full raw diff. Package build/test log only when actually available and completed; never invent exit codes. `git diff --check` does not scan untracked.

Use `.agents/tools/capture_checkpoint_evidence.py` (read-only Git capture, external output) if available; manually add the approved contract, architecture context, relevant code and complete real validation logs. The generator must not claim GO.

## Changed-symbol evidence
For each changed unit record file, symbol, changed hunk, direct callers, dependencies, validators/guards, selectors/projections, and related tests.

## Validation evidence
For every command record exact command, scope (`focused|subset|full|build|diff-check`), completion/result, and final output. Never label a subset as full or an unfinished build as passed.

## Antigravity claim ledger

```text
CLAIM:
EVIDENCE STATUS: EVIDENCE-FOUND | EVIDENCE-NOT-FOUND | AMBIGUOUS
CANDIDATE EVIDENCE:
```

ChatGPT performs semantic verification.

## Remaining boundaries
Record every relevant compatibility/legacy surface and raw search evidence. Do not assert safety.

## Re-review rule
After any code fix, previous packages are stale. Generate a fresh package and include previous findings plus diff since previous review.

## Incomplete package rule
If current raw diff, current status, required validation output, checkpoint contract, or checkpoint-required search evidence is missing, mark:

```text
INCOMPLETE — CHATGPT SHOULD RETURN EVIDENCE-INCOMPLETE
```
