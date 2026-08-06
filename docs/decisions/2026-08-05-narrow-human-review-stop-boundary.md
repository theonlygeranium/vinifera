# ADR: Narrow the human-review stop boundary

- **Date:** 2026-08-05
- **Status:** Accepted
- **Decision owner:** EdStratum Labs human owner
- **Scope:** Agent autonomy, stop-label semantics, review, previews, release
  preparation, promotion, deployment, and rollback
- **Amends:** `2026-07-27-pr-ownership-and-automation-governance.md`,
  `2026-07-29-two-speed-delivery-governance.md`, and
  `2026-07-30-principal-orchestrator-candidate-delivery.md`

## Context

The existing `human-review-required` implementation pauses every automated
action. That includes exact-head Octopus review, non-production preview
publication, readiness polling, replies and thread resolution, and immutable
release-candidate packaging. Those actions gather evidence or apply reversible
repairs; suppressing them leaves the owner with less information and forces
manual restarts after a decision.

The owner explicitly authorized greater agent autonomy and asked to remove
human-review checks wherever they are unnecessary. Exact-revision validation,
trusted default-branch execution, environment protection, tenant isolation,
provider-mode checks, immutable artifacts, and rollback remain the primary
technical controls.

## Decision

`human-review-required` becomes a **consequential-mutation stop**, not a global
automation stop.

While it is present, trusted automation continues:

- diagnosis, read-only readiness checks, and evidence publication;
- scoped reversible fixes, replies, and review-thread resolution;
- exact-head CI, Octopus, and optional CodeRabbit review;
- non-production preview publication from prebuilt unprivileged artifacts;
- promotion readiness polling and immutable release-candidate packaging; and
- exact known-good rollback to a prior reviewed Worker version.

The label is rechecked and remains blocking immediately before:

- an automated merge to `dev`;
- a `dev → staging` promotion merge;
- a forward staging or production deployment associated with the paused
  candidate; or
- the specific destructive, irreversible, real-money, legal, credential,
  production-data, or DNS/domain decision awaiting the owner.

`do-not-merge` remains an absolute merge prohibition. It does not suppress
review, validation, preview, or evidence gathering. Production approval,
live-billing confirmation, destructive hosted-data operations, credential
rotation, and DNS/domain ownership changes retain their independent protected
confirmations regardless of labels.

Routine workflow and Octopus configuration repairs may proceed through the
normal `dev` PR path with exact-head CI and applicable trusted Octopus review.
Additional owner review is reserved for changes that weaken a production,
privacy, authentication, authorization, tenant-isolation, or hard-stop
boundary. This ADR and the initiating owner instruction provide the explicit
authority for the present governance change.

## Workflow application

- Frontend preview and Octopus review ignore both stop labels because neither
  can merge or deploy a protected environment.
- Release-candidate packaging ignores both labels because it creates an
  immutable artifact but performs no environment mutation.
- Promotion automation may open/update the PR, poll gates, and record
  readiness under either label; it rechecks both labels immediately before
  merge.
- Development auto-merge, staging deployment, and forward production release
  retain the stop-label checks.
- Production rollback ignores the labels only when the workflow proves the
  exact prior reviewed release and all existing rollback invariants.

## Consequences

- A paused candidate keeps accumulating useful evidence instead of producing
  artificial failed checks.
- Removing the label no longer requires rerunning safe review and packaging
  work that already passed at the same exact revision.
- The owner is interrupted only for genuinely consequential decisions.
- Stop labels cannot be used to hide a candidate from automated review.
- Merge and deployment controllers retain exact last-moment fail-closed checks.

## Rollback

Revert this ADR and the associated workflow/documentation commit. Restore the
label predicates in preview, Octopus, packaging, and pre-merge readiness jobs.
No provider, database, Worker, billing, DNS, or production state changes are
required to roll back this governance decision.
