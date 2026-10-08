# POST-IMPLEMENTATION REVIEW PACKAGE TEMPLATE — v1.3 SINGLE FILE

Use this template to generate the single Markdown file (`REVIEW_PACKAGE.md`) for ChatGPT review.

## 00. MANIFEST
```text
Checkpoint:
Checkpoint name:
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
Previous package:
```

## 01. CHECKPOINT CONTRACT
(Exact approved contract)

## 02. NORTH_STAR CONTEXT
(Relevant exact sections/references)

## 03. GOVERNOR CONTEXT
(Activated Governor laws/change classes)

## 04. BASELINE AND HEAD
(Branch, base commit, HEAD, recent log)

## 05. GIT STATUS
(Exact `git status --short`)

## 06. DIFF STAT
(Exact `git diff --stat`)

## 07. DIFF CHECK
(Exact `git diff --check`)

## 08. FULL DIFF
(Exact current raw diff for intended files)

## 09. CHANGED FILES
`File | Expected? | Mechanical change type | Notes`

## 10. CHANGED SYMBOLS
(File, symbol, hunks, direct callers/dependencies, guard links, selectors/projections, related tests)

## 11. RELATED UNCHANGED CODE
(Only materially relevant unchanged symbols)

## 12. DEPENDENCY EDGES
(Mechanical symbol/import/call edges)

## 13. REPOSITORY SEARCH EVIDENCE
(Raw search command/pattern, scope, matches)

## 14. TEST CHANGES
(Exact test diff)

## 15. TEST RESULTS
`COMMAND / SCOPE / RESULT / FINAL OUTPUT`

## 16. BUILD RESULT
`COMMAND / RESULT / FINAL OUTPUT`

## 17. ANTIGRAVITY CLAIMS
`CLAIM / EVIDENCE STATUS / CANDIDATE EVIDENCE`

## 18. REMAINING BOUNDARIES
(Boundary, file/symbol, raw search evidence, stated reason retained, planned retirement if known)

## 19. OPEN QUESTIONS
(Mechanical ambiguities only)

## 20. PACKAGE INTEGRITY
(Freshness/completeness checklist)

## Re-review additions (if applicable)
```text
# 21. PREVIOUS FINDINGS
# 22. FINDING RESOLUTION MATRIX
# 23. DIFF SINCE PREVIOUS REVIEW
```
