# ADR 2026-07-28 — Governance Amendment: Automated dev→staging Promotion

**Status:** Accepted  
**Date:** 2026-07-28  
**Author:** Writer Agent (authorized by human owner in session thread `7784a4df-eb35-4347-8335-297aa8d85a26`)  
**Supersedes:** Sections 7 and 9 of `AGENTS.md` (prior dev→staging human-gate rule)

---

## Context

The Vinifera three-tier environment model previously required the human owner to manually open and merge every `dev → staging` promotion PR. This imposed friction without adding proportionate safety value, because:

1. All code already passed CI on `dev` before any promotion attempt.
2. The human owner's primary risk-control gate is `staging → main` (production), not `dev → staging` (validation).
3. The self-hosted Supabase stack on Schubert V2 is the only meaningful infrastructure risk at the staging tier, and that risk is monitorable and fail-closeable programmatically.

The human owner authorized amendments on 2026-07-28 covering three options:

- **Option 1:** Agent opens the `dev → staging` PR (previously human-only).
- **Option 2:** Agent auto-merges `dev → staging` when all CI and Schubert health gates pass.
- **Option 4:** `staging → main` remains exclusively human-initiated.

---

## Decision

A new GitHub Actions workflow (`promote-dev-to-staging.yml`) is introduced. It fires on every push to `dev` and on `workflow_dispatch`.

### Gates (all must pass before merge)

| Gate | Type | Fail behavior |
|------|------|---------------|
| 1. Schubert pre-flight | HTTP probe to `STAGING_SUPABASE_URL/rest/v1/` | Fail closed — PR opened but not merged |
| 2. PR CI checks | Poll GitHub check-runs until all complete | Fail closed — PR left open for human inspection |
| 3. Schubert pre-merge re-check | Same probe, immediately before merge commit | Fail closed — guards against mid-run Schubert degradation |
| 4. Dry-run override | `workflow_dispatch` input `dry_run=true` | Skips merge; PR left open |

On any gate failure, the PR is left **open** (never closed automatically), giving the human owner a clear signal and a one-click merge path once the issue resolves.

### What does NOT change

- `staging → main` is still exclusively human-initiated. No workflow touches `main` automatically.
- Agents NEVER commit directly to `staging` or `main`.
- Agents NEVER open a PR from a feature branch directly to `staging` or `main`.
- All agent-authored feature PRs still target `dev` only.
- The `direct-push-guard.yml` enforcement on `main` is unchanged.
- Schubert V2 remains a single point of failure for staging. The double health-check is a guardrail, not a redundancy solution. A dedicated monitoring runbook should follow.

### Schubert SPOF risk note

The automated promotion will fail closed and leave the PR open if Schubert is unreachable. The human owner should treat repeated failed promotions as a signal to investigate Schubert V2 availability or the `schubert-foxtrot` Cloudflare Tunnel health.

---

## Consequences

- Promotion latency from `dev` to `staging` drops from hours (waiting for human action) to ~5 minutes after a CI-green push.
- The human owner retains full control of the `staging → main` gate and all production deployments.
- A new secret `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` must be present in the repository's Actions secrets for the probe to function. These are already present from the Schubert provisioning work.
- `AGENTS.md` sections 7 and 9 are updated to reflect the amended rules. The ownership table entry for `.github/workflows/` still requires human review before merge for any future workflow changes.