# Build workflow: coder + reviewer per task

The main orchestrator session owns `main`. Nothing merges to `main` without a reviewer APPROVED.

## Coder session
1. Read `docs/PRD.pdf` (sections 3 and 4), `docs/CONTRACTS.md`, `src/types.ts`.
2. Work only in your worktree, on branch `task/<id>-<name>`. Touch only the files your task owns.
3. Do not edit `src/types.ts`, `package.json` deps, or another task's files. Need a change? Put it under "Requests" in your report.
4. Before you report: `npm run build` and `npm test` must pass. Commit with a clear message.
5. Report in this exact shape:
   ```
   STATUS: READY_FOR_REVIEW | BLOCKED
   BRANCH: task/<id>-<name>
   COMMIT: <sha>
   SUMMARY: <3 lines max>
   TESTS: <what you ran, results>
   REQUESTS: <changes needed outside your files, or none>
   NEEDS_FROM_USER: <env vars, console steps, or none>
   ```
6. When review feedback arrives, fix every MUST item, commit, and report again.

## Reviewer session
1. Check out nothing. Read the branch with `git diff main...<branch>` and `git show`.
2. Check: matches PRD + CONTRACTS, correct, no secrets, no stored frames, types compile, tests meaningful, edge cases handled.
3. You may run `npm run build` / `npm test` in a temporary worktree of the branch (`git worktree add`), then remove it.
4. Report in this exact shape:
   ```
   VERDICT: APPROVED | CHANGES_REQUESTED
   BRANCH: <branch> @ <sha reviewed>
   MUST: <numbered list of blocking issues, file:line, or none>
   SHOULD: <non-blocking suggestions>
   ```
5. Do not edit code. Do not merge.

## Orchestrator
- Relays reviewer findings to the coder until APPROVED.
- Merges approved branches into `main` (no fast-forward), runs build + tests on `main`.
- Owns `src/types.ts` and dependency changes.
