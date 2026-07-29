# Vinifera UI Testing Work Manifest

**Date:** 2026-07-28

**Base:** `origin/dev` at `4d0ba11`

**Manifest branch:** `docs/ui-test-manifest`

**Pull request base:** `dev`

**Authoritative specification:** `docs/build-specs/vinifera-ui-testing-doc.md`

## Purpose

This manifest records the required UI-testing delegation before any subagent is
dispatched. Testing worktrees are read-only, detached worktrees created from the
exact `dev` baseline above. If a blocking defect is confirmed, the primary agent
will create a separate branch and worktree for that single defect using
`fix/ui-<domain>-<short-description>`.

The untouched baseline passed before this manifest was written:

- `npm ci`: 406 packages installed, 0 vulnerabilities.
- `npm run check`: TypeScript and Worker type checks passed; 448/448 Vitest
  tests passed; Vite and Worker dry-run builds passed.
- `npm run qa:e2e`: 145/145 Playwright/axe tests passed.

## Assignments

| ID | Test domain | Specification sections | Testing worktree |
|---|---|---|---|
| SA-01 | Static surfaces and authentication | 4.1, 4.2 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-01` |
| SA-02 | Staff shell and navigation | 4.3 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-02` |
| SA-03 | Staff dashboard | 4.4 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-03` |
| SA-04 | Club operations: members, tiers, releases | 4.5 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-04` |
| SA-05 | Club operations: shipments, fulfillment, recovery, compliance, import | 4.6 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-05` |
| SA-06 | Member experience: churn, communications, retention, loyalty | 4.7 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-06` |
| SA-07 | Analytics and intelligence | 4.8 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-07` |
| SA-08 | Scale: brands, integrations, white-label, team | 4.9 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-08` |
| SA-09 | Member portal | 4.10 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-09` |
| SA-10 | Shared components and cross-cutting concerns | 4.11 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-10` |
| SA-11 | Accessibility audit sweep | 4.12 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-11` |
| SA-12 | Responsive layout sweep | 4.13 | `/Users/jeffgeronimo/.codex/worktrees/vinifera-sa-12` |

## Execution order

1. SA-01 through SA-10 run in bounded parallel batches against the exact
   baseline recorded above.
2. The primary agent consolidates their screenshots, console/axe evidence, and
   defect reports.
3. SA-11 and SA-12 run only after SA-01 through SA-10 have completed and may
   consume those findings as context.
4. Every confirmed blocking defect receives its own isolated fix branch,
   changelog entry, focused regression test, full baseline verification, and
   pull request targeting `dev`.
5. The primary agent produces
   `docs/build-specs/ui-test-report-2026-07-28.md` after all test domains and
   fix-branch verification are complete.

## Branch and worktree conventions

- Testing worktrees: detached from the recorded `origin/dev` commit; no source
  changes are permitted in them.
- Fix branch: `fix/ui-<domain>-<short-description>`.
- Fix worktree:
  `/Users/jeffgeronimo/.codex/worktrees/vinifera-fix-<domain>-<slug>`.
- One confirmed defect per branch and pull request.
- Every pull request targets `dev`; agents never target `staging` or `main`.
- Every commit updates `CHANGELOG.md` and follows the repository Conventional
  Commits contract.
- No agent may merge its own pull request.

## Safety boundaries

- All 20 activation gates remain `pending`.
- Testing uses local mock API responses and must not connect provider
  credentials, mutate hosted data, or alter deployment targets.
- Real credentials, secrets, browser storage, and authentication material must
  never be inspected, printed, copied, or committed.
- Browser validation uses the user-authorized Chrome `Work` profile without
  inspecting cookies, passwords, profiles, or session stores.
