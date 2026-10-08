# EVIDENCE PACKAGER PROTOCOL v1.3 — SINGLE MARKDOWN PACKAGE

**Role:** Deterministic context/evidence collector (executed by Antigravity)
**OpenCode/OCR:** Removed
**Semantic review:** Prohibited during packaging

## Allowed operations

```text
search / grep / ripgrep
symbol indexing
definition lookup
call-site collection
import/dependency tracing
git status/log/diff capture
test discovery
validation-output capture
context-window extraction
manifest generation
one-file package assembly
checksums/integrity listing
```

## Prohibited operations
While packaging evidence, Antigravity MUST NOT edit files, assign GO/NO-GO, judge architecture, decide test sufficiency, infer atomicity/history guarantees, rank semantic findings, hide evidence based on judgment, commit/push, or replace raw evidence with summaries.

## The Evidence Package

Generate ONE single Markdown file outside the repository (e.g. in artifacts) containing all raw validation evidence.

Follow `POST_IMPLEMENT_REVIEW_PROTOCOL.md`.

## Raw evidence law
Never replace these with prose summaries in the package:

```text
git status
git diff
git diff --check
exact test commands/results
exact build completion output
repository search output
```

## Mechanical claim ledger
Antigravity may attach candidate evidence to its claims, but status in the package is limited to:

```text
EVIDENCE-FOUND
EVIDENCE-NOT-FOUND
AMBIGUOUS
```

Only ChatGPT performs semantic support/contradiction classification.

## Secrets filter
Exclude credentials, tokens, keys, private certificates, environment secrets, and unrelated sensitive files.

## Freshness rule
Any source/test change invalidates the prior evidence package. Re-run collection from current repository state to create a fresh one.
