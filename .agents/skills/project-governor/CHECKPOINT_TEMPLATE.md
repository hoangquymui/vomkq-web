# CHECKPOINT CONTRACT TEMPLATE

Use this template for every architecture migration checkpoint.

---

## CHECKPOINT <ID> — <NAME>

### 1. North Star capability

Which North Star capability does this checkpoint advance?

```text
...
```

### 2. Context

Completed prerequisites:

```text
...
```

Current compatibility boundaries:

```text
...
```

### 3. Goal

One clear outcome:

```text
...
```

### 4. Canonical authority

```text
Canonical source of truth:
Canonical identity:
Ownership chain:
Derived/projection state:
Historical state:
```

### 5. Required invariants

```text
1. ...
2. ...
3. ...
```

### 6. Allowed changes

```text
...
```

### 7. Explicit non-goals

```text
...
```

### 8. Compatibility policy

What remains temporarily compatible?

```text
...
```

What must no longer be authoritative?

```text
...
```

### 9. Failure / atomicity behavior

```text
validation occurs before side effects
rejected operation leaves canonical state unchanged
rejected operation leaves compatibility projection unchanged
historical records preserved according to domain rules
```

### 10. Audit phase

Search for:

```text
...
```

Classify every usage:

```text
canonical read
canonical write
legacy boundary
renderer
simulation
analysis
serialization
test-only
```

### 11. Implementation plan

```text
Phase A ...
Phase B ...
Phase C ...
```

### 12. Required tests

Happy path:

```text
...
```

Negative/guard cases:

```text
...
```

Isolation/history cases:

```text
...
```

Compatibility/migration cases:

```text
...
```

### 13. Validation

```text
npx vitest run
npm run build
git diff --check
git status --short
git diff --stat
```

Add checkpoint-specific regression commands here:

```text
...
```

### 14. Files expected to change

```text
...
```

### 15. Files/subsystems forbidden unless blocker is proven

```text
...
```

### 16. Final report requirements

```text
1. Audit classification
2. Exact production changes
3. Invariants enforced
4. Tests added/updated
5. Validation results
6. Remaining compatibility boundaries
7. Exact changed files
8. Known limitations
9. No commit/push confirmation
```

### 17. Independent review policy

Does this checkpoint require the independent ChatGPT review gate?

```text
YES / NO
Reason:
Packager mode: SINGLE MARKDOWN PACKAGE
Required review package searches:
Required claim ledger items:
```

Architecture checkpoints touching domain/schema/mutation authority/simulation/analysis/serialization/interoperability/renderer authority should normally be `YES`.

### 18. Pre-implementation Context

Collect local context following `PRE_IMPLEMENT_PACKAGE_PROTOCOL.md` for architecture checkpoints.

Checkpoint-specific searches/symbols to verify before coding:

```text
...
```

### 19. Post-implementation Evidence Package

Before GO review, Antigravity generates ONE single Markdown package following `POST_IMPLEMENT_REVIEW_PROTOCOL.md`.

Checkpoint-specific package requirements:

```text
...
```

### 20. Commit policy

```text
DO NOT COMMIT.
DO NOT PUSH.
Wait for independent review GO and explicit user authorization.
```
