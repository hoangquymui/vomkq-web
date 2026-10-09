# Fast Validation Protocol — Governor v1.4

## Purpose
Minimize slow rebuilds without lowering regression quality. The *code snapshot* and *evidence freshness* matter more than repeated green command runs.

## Baseline first (once per checkpoint)
- Record branch, HEAD, `git status --short`, intended paths, untracked entries and existing failures.
- Do not assume any file is disposable. Preserve staged, unstaged and untracked work.
- Use an approved checkpoint contract with exact scope and acceptance tests.

## Tier A — edit loop (repeat as needed)
- Inspect narrow diff after each coherent edit; use `git diff --check -- <paths>`.
- Run `npx tsc -b --pretty false` and focused `npx vitest run <relevant-test-file>` only when relevant code changed.
- Fix root causes. Avoid giant regex/text replacement over TS sources; use small context-verified patches and inspect results.
- Never bypass errors via `@ts-nocheck`, `test.skip`, `return` at test entry, tautological/self-comparison assertions or no-op fixtures.
- If *two consecutive attempts* do not reduce the same failure, STOP with evidence; do not run another unchanged full build.

## Tier B — stable checkpoint gate (once on final snapshot)
1. `npx tsc -b --pretty false` (if `npm run build` already includes this, record it rather than duplicating needlessly).
2. `npx vitest run` and checkpoint-specific scenario/golden tests if they apply.
3. `npm run build` once, when test/typecheck status and implementation are stable; rerun only if subsequently changed source/config affects the built artifact.
4. `git diff HEAD --check`, `git diff --cached --check`, `git status --short`, full `git diff HEAD -- <intended paths>`.
5. Enumerate untracked files and verify package is based on same working-tree snapshot that was validated.

## Evidence and stop conditions
- Capture commands, scope, actual exit codes, completion, UTC/local timestamps where available and raw logs. No invented validation or runtime smoke claims.
- A re-run is justified if code changed after a pass, a command was incomplete, or a relevant dependency changed; record why.
- `tsc` pass alone is not a Vite bundle pass, a unit test pass is not runtime smoke, and `git diff --check` ignores untracked files.
- Keep debug logs, scratch scripts and review packages outside repository by default. Do not delete existing scratch scripts just to make status clean.
- Require independent reviewer GO and human-only stage/commit/push. Non-1K dirty files must remain intact.
