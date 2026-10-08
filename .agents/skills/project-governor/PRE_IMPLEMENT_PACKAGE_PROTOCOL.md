# CONTEXT COLLECTION PROTOCOL v1.3

**Purpose:** Build deterministic repository context before Antigravity edits an architecture checkpoint.
**Role:** Antigravity (Local context collection)

## Principle
Context must be constructed from repository evidence, not guessed. Antigravity performs this directly by querying the repository before making implementation changes.

## Collection Checklist

Before implementing, Antigravity must gather:

```text
1. Branch, HEAD, status, recent log.
2. Exact Checkpoint Contract.
3. Target concepts/symbol names.
4. Symbol definitions.
5. Direct callers/call sites.
6. Direct imports/dependencies.
7. Related types/interfaces.
8. Validators/guards and ownership checks.
9. Selectors/projections/adapters touching the same identity.
10. Tests naming/calling affected symbols.
11. Checkpoint-required repository searches.
12. Current compatibility/legacy boundaries.
13. Allowed/forbidden files/subsystems.
```

Antigravity may store this context in memory or a scratch file. If using a scratch file or log, it MUST be saved outside the repository. Do not create temporary files inside the Git worktree. It does not need to generate a formal package for this step.

## Inclusion priority

```text
target definition
> direct callers
> direct dependencies
> invariant-defining types/validators
> related tests
> repository search matches
> distant context
```

Do not omit matches because they appear unimportant.

## Stop Conditions
Stop implementation if:
- checkpoint contract is missing;
- repository baseline cannot be determined;
- target symbols cannot be located;
- dirty changes overlap target files ambiguously;
- required search evidence failed to collect.
