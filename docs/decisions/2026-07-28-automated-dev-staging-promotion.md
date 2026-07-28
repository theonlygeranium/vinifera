# ADR 2026-07-28 — Governance Amendment: Automated dev→staging Promotion

**Status:** Accepted  
**Date:** 2026-07-28  
**Author:** Writer Agent (authorized by human owner in session thread `7784a4df-eb35-4347-8335-297aa8d85a26`)  
**Supersedes:** Sections 7 and 9 of `AGENTS.md` (prior dev→staging human-gate rule)

---

## Context

The Vinifera three-tier environment model previously required the human owner to manually open and merge every `dev → staging` promotion PR. This imposed friction without adding proportionate safety value, because:

1. All code must pass pull-request CI before any promotion merge.
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
| 0. Promotion PR | Open/update via an event-producing repository token and capture its exact head | Fail closed — no merge is attempted |
| 1. Staging REST pre-flight | HTTP probe to `STAGING_SUPABASE_URL/rest/v1/` | Fail closed — PR remains open |
| 2. PR quality gates | Require aggregate CI, Octopus, CodeRabbit, all registered statuses, and zero unresolved threads on the captured head | Fail closed — PR remains open for human inspection |
| 3. Staging REST pre-merge re-check | Same probe, immediately before merge commit | Fail closed — guards against mid-run provider degradation |
| 4. Dry-run override | `workflow_dispatch` input `dry_run=true` | Skips merge; PR left open |

On any gate failure, the PR is left **open** (never closed automatically), giving the human owner a clear signal and a one-click merge path once the issue resolves.

### What does NOT change

- `staging → main` is still exclusively human-initiated. No workflow touches `main` automatically.
- Agents NEVER commit directly to `staging` or `main`.
- Agents NEVER open a PR from a feature branch directly to `staging` or `main`.
- All agent-authored feature PRs still target `dev` only.
- The `direct-push-guard.yml` enforcement on `main` is unchanged.
- Schubert V2 remains a single point of failure for staging. The double health-check is a guardrail, not a redundancy solution. A dedicated monitoring runbook should follow.

### Staging provider risk note

The probe establishes only authenticated Supabase REST availability; it is not
a complete Schubert host or Realtime health check. The automated promotion will
fail closed and leave the PR open if the configured staging endpoint is
unreachable. Repeated failures should trigger investigation of the staging
Supabase target, Schubert V2, and the `schubert-foxtrot` Cloudflare Tunnel.

The PR must be created with `GH_PAT_FOR_OCTOPUS`, rather than the workflow's
default `GITHUB_TOKEN`. GitHub suppresses new workflow runs for most events
created with `GITHUB_TOKEN`; using the existing event-producing repository
token is required for the promotion PR to invoke pull-request CI and Octopus.
It is also required for the merge so the resulting `staging` push invokes
staging CI and deployment workflows. Read-only polling continues to use the
least-privileged `GITHUB_TOKEN`.

Because `pull_request_target` workflow checks are attached to the trusted base
revision rather than the untrusted pull-request head, the Octopus bridge
publishes a separate `Octopus PR Quality Gates` commit status on the exact PR
head SHA after the trusted runbook finishes. Promotion requires that exact-head
status with a description naming the current promotion PR; it does not infer an
Octopus result from a check attached to another revision. Check runs must also
identify the current PR in GitHub's `pull_requests` association, and
commit-status results must be no older than the PR creation timestamp. Closing
and recreating a promotion PR at the same `dev` SHA therefore cannot inherit
the prior PR's CI or review results. CodeRabbit must also have submitted a
review on the current PR at the captured head SHA; its commit status alone is
not accepted as proof of PR-specific review.

---

## Consequences

- Promotion latency depends on the full CI and automated-review duration; no
  fixed completion time is guaranteed.
- The human owner retains full control of the `staging → main` gate and all production deployments.
- `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` must be present in the
  repository's Actions secrets for the probe to function. As of this decision's
  implementation audit, they are not configured, so promotion intentionally
  remains fail-closed until an isolated staging target is provisioned and both
  secrets are installed.
- `AGENTS.md` sections 7 and 9 are updated to reflect the amended rules. The ownership table entry for `.github/workflows/` still requires human review before merge for any future workflow changes.
