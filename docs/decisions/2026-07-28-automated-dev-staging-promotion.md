# ADR 2026-07-28 — Governance Amendment: Automated dev→staging Readiness

**Status:** Accepted, safety-amended 2026-07-28 and amended 2026-07-30

**Date:** 2026-07-28
**Author:** Writer Agent (authorized by human owner in session thread `7784a4df-eb35-4347-8335-297aa8d85a26`)
**Supersedes:** Sections 7 and 9 of `AGENTS.md` (prior dev→staging human-gate rule)

---

> **2026-07-30 amendment:** The principal-orchestrator candidate-delivery ADR
> supersedes the push-after-every-`dev`-update trigger and the CodeRabbit
> requirement described below. Promotion is one maintained, deliberately
> selected release candidate. Full CI, Octopus, exact-comparison evidence, and
> zero blocking threads remain required; CodeRabbit is advisory. The current
> branch topology remains in place until a separate staging-environment ADR is
> reviewed.

## Context

The Vinifera three-tier environment model previously required the human owner to manually open and merge every `dev → staging` promotion PR. This imposed friction without adding proportionate safety value, because:

1. All code must pass pull-request CI before any promotion merge.
2. The human owner's primary risk-control gate is `staging → main` (production), not `dev → staging` (validation).
3. The self-hosted Supabase stack on Schubert V2 is the only meaningful infrastructure risk at the staging tier, and that risk is monitorable and fail-closeable programmatically.

The human owner authorized amendments on 2026-07-28 covering three options:

- **Option 1:** Agent opens the `dev → staging` PR (previously human-only).
- **Option 2:** Agent auto-merges `dev → staging` when all CI and Schubert health gates pass.
- **Option 4:** `staging → main` remains exclusively human-initiated.

The implementation audit later proved that Option 2 cannot satisfy the
repository's fail-closed comparison boundary through GitHub's PR merge API.
GitHub exposes an expected-head input (`sha` / `--match-head-commit`) but no
expected-base input. A target-branch advance between the last read and the
merge could therefore merge an unattested comparison. Under the owner's
standing authority to patch all validated issues, this ADR is safety-amended:
automation prepares and validates the PR, but a human performs the merge.

---

## Decision

A GitHub Actions workflow (`promote-dev-to-staging.yml`) maintains one
consolidated release candidate. It starts only through deliberate manual or
explicitly owner-authorized dispatch; routine pushes to `dev` do not start
promotion work.

### Gates (all must pass before readiness is reported)

| Gate | Type | Fail behavior |
|------|------|---------------|
| 0. Promotion PR | Open/update via an event-producing repository token and capture its exact head and staging base | Fail closed — readiness is not reported |
| 1. Staging REST pre-flight | HTTP probe to `STAGING_SUPABASE_URL/rest/v1/` | Fail closed — PR remains open |
| 2. PR quality gates | Require aggregate CI, Octopus, all required registered statuses, and zero unresolved threads on the captured head; record CodeRabbit when available | Fail closed — PR remains open for human inspection |
| 3. Staging REST readiness re-check | Same probe immediately before readiness reporting | Fail closed — guards against mid-run provider degradation |
| 4. Readiness report | Revalidate the captured head/base, CI, statuses, reviews, and threads after the second probe | PR remains open for a human merge |
| 5. Dry-run override | `workflow_dispatch` input `dry_run=true` | Runs the same evidence validation, records dry-run readiness, and leaves the PR open |

On success or failure, the PR remains **open**. Before merging, the human must
confirm that the current head and base still match the successful readiness
report.

### What does NOT change

- Both environment-branch merges are human-initiated. No workflow merges to
  `staging` or touches `main` automatically.
- Agents NEVER commit directly to `staging` or `main`.
- Agents NEVER open a PR from a feature branch directly to `staging` or `main`.
- All agent-authored feature PRs still target `dev` only.
- The `direct-push-guard.yml` enforcement on `main` is unchanged.
- Schubert V2 remains a single point of failure for staging. The double health-check is a guardrail, not a redundancy solution. A dedicated monitoring runbook should follow.

### Staging provider risk note

The probe establishes only authenticated Supabase REST availability; it is not
a complete Schubert host or Realtime health check. Automated readiness will fail
closed and leave the PR open if the configured staging endpoint is unreachable.
Repeated failures should trigger investigation of the staging Supabase target,
Schubert V2, and the `schubert-foxtrot` Cloudflare Tunnel.

The PR must be created with `GH_PAT_FOR_OCTOPUS`, rather than the workflow's
default `GITHUB_TOKEN`. GitHub suppresses new workflow runs for most events
created with `GITHUB_TOKEN`; using the existing event-producing repository
token is required for the promotion PR to invoke pull-request CI and Octopus.
Read-only polling and readiness reporting use the least-privileged
`GITHUB_TOKEN`.

Because `pull_request_target` workflow checks are attached to the trusted base
revision rather than the untrusted pull-request head, the Octopus bridge
publishes a separate `Octopus PR Quality Gates` commit status on the exact PR
head SHA after the trusted runbook finishes. Promotion requires that exact-head
status with a description naming the current promotion PR; it does not infer an
Octopus result from a check attached to another revision. Check runs must also
identify the current PR in GitHub's `pull_requests` association, and
check, status, and review results must be no older than the current readiness
attempt. Closing and recreating a promotion PR at the same `dev` SHA therefore
cannot inherit the prior PR's CI or review results. CodeRabbit must also have submitted a
review on the current PR at the captured head SHA; its commit status alone is
not accepted as proof of PR-specific review. The bridge passes the event head,
base ref, and base SHA as required runbook inputs, and the runbook refuses to
check out or inspect the PR unless all three still match GitHub's live metadata.
All review diffs are then generated locally from the immutable
fetched merge-base and expected-head objects, so a later head rewrite or
base-branch switch cannot swap another comparison into the attestation. The
published status description includes the attested base SHA; promotion captures
the staging base SHA when it opens the PR and requires that same value during
polling, in the Octopus status, and immediately before readiness is reported.
Each attempt writes a new timestamped marker to the PR body, forcing fresh PR
events. The quality workflow explicitly handles the resulting `edited` event,
so an unchanged head receives a new base-bound CI run before attempt-fresh
evidence is required. CI check associations must name both captured revisions,
while statuses and CodeRabbit reviews must be created after that attempt began.
An unchanged head cannot reuse evidence from an older staging base.
Check runs must have both `created_at` and `started_at` at or after the current
readiness-attempt timestamp, preventing a check queued for an older attempt
from becoming eligible merely because it starts late. Check runs and commit
statuses are fully paginated before evaluation. The
required aggregate must conclude `success`; non-required jobs that GitHub
intentionally concludes `skipped` or `neutral` do not block readiness. The
workflow intentionally contains no merge command because GitHub documents only
an expected-head merge guard and no expected-base guard. Normal and dry-run
paths share the same final evidence revalidation after the second provider
probe. Head/base reads bracket that evidence refresh so readiness is not
reported if either revision changes while the APIs are queried.

---

## Consequences

- Promotion latency depends on the full CI and automated-review duration; no
  fixed completion time is guaranteed.
- A human must revalidate and merge the `dev → staging` PR after automation
  reports readiness.
- The human owner retains full control of the `staging → main` gate and all production deployments.
- `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` must be present in the
  repository's Actions secrets for the probe to function. As of this decision's
  implementation audit, they are not configured, so promotion intentionally
  remains fail-closed until an isolated staging target is provisioned and both
  secrets are installed.
- `AGENTS.md` sections 7 and 9 are updated to reflect the amended rules. The ownership table entry for `.github/workflows/` still requires human review before merge for any future workflow changes.
