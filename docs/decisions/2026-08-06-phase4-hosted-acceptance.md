# ADR: Protected Phase 4 hosted acceptance evidence

**Date:** 2026-08-06
**Status:** Accepted

## Context

The merged Gates 10–16 readiness probe verifies configuration and runtime
reachability but intentionally cannot prove real operational reconciliation,
elapsed experiments, privacy thresholds, or report delivery. Gates 10–12 need
distinct, auditable exit evidence without placing operational records in the
repository or permitting a readiness response to become completion.

## Decision

Use one trusted-main, protected, manually dispatched controller with three
independent default-disabled gate switches. Each run binds an exact staging
revision recorded inside the exact organization/brand evidence manifest to
reviewed SHA-256 target policy. The per-run manifest hash is added to the
protected acceptance environment only after that revision is immutable,
avoiding a candidate-SHA/manifest-hash commit fixed point. The controller performs bounded,
Access-authenticated health and configuration probes, requires the deployed
Worker's runtime-reported Supabase origin hash to equal the authorized target,
rejects reversed source windows and evidence observed, completed, or delivered
in the future, and emits only
identifiers, hashes, counts, aggregate metrics, and pass facts in a 90-day
artifact.
Canonical `main` and `staging` are force-refreshed after setup and again after
acceptance; drift before artifact retention rewrites the report to
`passed: false` and fails the run.
Ref-refresh failures are also invalidated, and a rewrite failure moves the
prior report outside the always-running uploader path.

Gate 10 requires exact equality between all 38 documented scalar source,
dashboard, and CSV metrics and exact row-digest equality for every distribution
and time-series chart, plus hashed active-winery operational provenance and an
explicit exclusion of synthetic/fixture/demo data. Gate 11 enforces a dedicated actor, 500 eligible members, 50
cancellations, at least 95% reconciliation for each of six source families,
held-out AUC-ROC of at least 0.82 above rules, and at least 30 complete days
with at least 50 evaluated outcomes, same-experiment AUC and Brier superiority,
the latest model-bound non-retraining drift report no more than seven days old,
and an audited promotion. The database
qualification evidence hash, qualified status, training-run ID, and dataset
hash must match the accepted training run and dataset. The controller hashes
the exact database-derived qualification payload and validates its run,
dataset, status, exact denominator, six source counts, and
reconciliation-through horizon. Immutable IDs and
matching relationship fields bind that training run, selected model version,
experiment, and promotion audit into one chain. Gate 12 enforces an
Estate/Reserve opt-in, at least ten unique contributor organizations with hashed owner
opt-in audits, Estate/Reserve tiers, and positive entitlement attestations
bound to the exact cohort for every participant, suppression and
differencing checks, and confirmed quarterly delivery.
Quarterly delivery is accepted only when a service-role-only database RPC
joins its report/provider message and persisted delivered
email-log plus immutable delivered-event identities/statuses to the exact
organization, brand, cohort, selected contribution/aggregate and aggregate
digest, report quarter/type, exact stored monthly source window, persisted
report-content digest,
exact PDF/CSV attachment digests, and delivery timestamp. Those digests are
computed from the stored aggregate, report body, and decoded attachments rather
than accepted from a caller-authored relationship payload. A delivered
privacy-suppression notice cannot satisfy this contract.
The quarterly schedule does not imply a full-quarter data aggregate: the
current database refresh publishes the prior-quarter-start monthly snapshot,
so evidence must state that exact quarter-start month, not another month in the
same quarter, unless a future migration introduces a
genuine three-month aggregate.
Gate 11 derives UTC calendar dates from the exact RPC-produced experiment
timestamps and must include one consecutive coverage row for every date from
start through completion, both inclusive, with every eligible member scored by
both methods and immutably assigned.
A reviewed power-analysis digest defines a minimum of at least 50 outcomes,
and the completed experiment must precede its observation. The controller
script and policy are both authority-high-risk delivery paths.
Delivery must occur after the source window closes and no later than both the
manifest observation and acceptance capture times.
The Worker health revision is re-probed after the configuration/database hash
so one report cannot combine runtime facts across a concurrent deploy or rollback.

## Consequences

The checked-in policy cannot execute because it enables no gate and contains
no target hashes; protected per-run manifest hashes are also absent by default.
Provider/data preparation remains external and
time-based prerequisites remain real blockers. Every successful artifact sets
`completionClaimed` to `false`; status reconciliation is a separate action.
