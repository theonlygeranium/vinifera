# ADR: Phase 4 analytics, predictive intelligence, and compliance

- **Status:** Accepted for implementation; hosted activation pending
- **Date:** 2026-07-26
- **Decision owners:** Vinifera engineering

## Context

Phase 4 must derive analytics from operational facts, prepare an interpretable
churn model without leaking future outcomes, expose anonymous peer context, and
replace a static state whitelist with real regulated-shipping checks after the
provider boundary is activated and verified.

The repository does not yet contain six months of real outcomes, 500 members,
50 cancellations, or ShipCompliant sandbox credentials. The build must
therefore finish the production architecture without inventing model accuracy
or treating local compliance simulation as legal clearance.

## Decision

### Operational facts and read models

PostgreSQL remains the source of truth. Analytics events use an allowlisted
event taxonomy and minimized JSON payloads; email addresses and arbitrary
request bodies are rejected. Financial, member, shipment, engagement, cohort,
and acquisition metrics are calculated from durable Phase 1–3 records.

Daily and monthly aggregate snapshots make dashboard reads bounded while
preserving drill-down to tenant-owned source records. Staff can save widget
order and visibility, date-range presets, custom dates, and scheduled summary
reports. Every chart has the same underlying tabular data and tenant-scoped CSV
export. This is the implemented read architecture; hosted proof against a real
winery dataset remains an activation gate.

### Interpretable regularized logistic model

The first production candidate is L2-regularized logistic regression over a
versioned numeric feature contract. It is deliberately less complex than a
tree ensemble: its coefficients are portable to the Worker, inexpensive for
nightly scoring, auditable, and directly convertible into per-member feature
contributions.

Training uses a temporal 80/20 holdout and five expanding-window validation
folds. Fit, scaling, imputation, threshold selection, calibration, and metrics
are recorded with the model version and feature schema. No active model may be
promoted unless all of the following hold:

- at least 500 labeled members and 50 observed cancellations;
- held-out AUC-ROC is at least 0.82;
- the candidate does not underperform the Phase 3 rules baseline;
- the feature contract and data cutoff pass leakage checks.

Deterministic synthetic fixtures verify trainer correctness and performance,
but their metrics are never reported as production accuracy.

### Shadow deployment, drift, and fallback

Candidate predictions run beside Phase 3 rules scores for at least 30 days.
Staff can inspect both, a heuristic model score band, the top five signed
feature contributions, and which model produced the displayed result. The band
is an operational uncertainty cue, not a statistical confidence interval.
Promotion is a recorded service-only action after the data and validation
gates pass.

Population Stability Index compares current feature distributions with the
training baseline. A threshold breach marks the model for retraining; it does
not silently train or promote a replacement. Missing, stale, degraded, or
ineligible models fall back to the rules score.

### Anonymous peer aggregates

Benchmark contribution is explicit opt-in and available only to Estate and
Reserve organizations. Tenant rows remain private. A service-only aggregation
job coarsens region, tier distribution, and member-count bands and publishes
only percentiles/medians when at least ten opted-in organizations contribute.
Suppressed groups return guidance rather than a smaller exact count or raw
metrics. Quarterly reports use only the published aggregate.

### ShipCompliant provider boundary

Sovos ShipCompliant is isolated behind a versioned provider adapter. Current
official onboarding uses a developer sandbox app, API key and secret, OAuth
client-credentials token, and vendor-approved product access. Base URL,
credentials, account/license identifiers, and exact payload mapping are
server-only configuration.

The operational check runs after a successful charge and immediately before
label generation. Every label request requires a current compliant result for
the exact shipment snapshot. `non_compliant` and `unknown` both block label
creation; only `compliant` may advance. The check, provider response identifier,
reason, tax estimate, minimized decision evidence, rules version, checked
timestamp, and SHA-256 request and shipment-state fingerprints are retained for
audit. The database accepts a compliant result for at most 24 hours and
invalidates it when compliance-relevant shipment, item, origin, or member-age
inputs change; activation must tighten that window if the approved vendor
contract specifies a shorter lifetime.

EasyPost label purchase uses a durable, leased attempt keyed to the compliance
fingerprint. The external carrier shipment is persisted before the irreversible
purchase. A retry reuses a successful attempt, resumes purchase from a stored
carrier shipment, or enters reconciliation after an indeterminate outcome
instead of blindly purchasing another label.

The Phase 2 static whitelist remains historical code only. The implemented
label path uses the provider-backed boundary, but this is not evidence that
ShipCompliant is active on the hosted application.

A deterministic compliance adapter is allowed only in the test runtime with an
explicit simulator gate. It proves orchestration, never legal compliance.

Provider health is evidence based:

- `activation_required`: the server configuration is incomplete;
- `configured`: the required bindings are present but no successful provider
  check has been recorded;
- `active`: the latest recorded provider attempt is successful;
- `degraded`: a newer unsuccessful or unknown attempt exists after the last
  successful check.

`lastSuccessfulCheckAt` is not a compliance-rules refresh timestamp.

### Tenant and privilege boundaries

Phase 4 tenant tables enable and force row-level security. Analytics exports,
dashboard configuration, report schedules, predictions, and compliance checks
remain tenant scoped. Raw training rows, model artifacts, benchmark
contributions, aggregate publication, and model promotion require
service/super-admin authority. Browser bundles contain no model artifact or
provider credential.

## Consequences

### Positive

- Hosted analytics can be reproduced from operational facts after migrations,
  real operations, and scheduled refreshes are active; test fixtures remain
  confined to automated QA.
- The first model is interpretable and cheap to execute at 10,000-member scale.
- Accuracy, leakage, A/B, and drift gates prevent an unvalidated model from
  replacing the rules baseline.
- Small peer groups cannot expose a winery by omission or reverse lookup.
- The implemented label boundary cannot advance on an unknown or failed
  compliance response.
- Credentials and real data can be attached later without redesigning the
  application.

### Tradeoffs

- Logistic regression may plateau below a tuned boosted-tree model; that is an
  acceptable first candidate until real data justify additional complexity.
- Aggregate snapshots are eventually consistent with operational writes.
- A ten-organization privacy floor can suppress early benchmark views.
- ShipCompliant sandbox/product access and payload documentation require vendor
  approval before hosted compliance proof.

## Verification boundary

The repository includes deterministic assertions for real-source-shaped
metrics, date ranges, exports, saved layouts, schedules, event minimization,
model training and fallback, benchmark privacy, ShipCompliant response mapping,
compliance fingerprinting, durable label recovery, and responsive accessible
browser surfaces.

Those tests prove local implementation behavior only. Phase 4 is not considered
operational until the hosted migrations and tenant isolation pass, the public
application serves the Worker rather than the static prototype, a real winery
dataset supports model validation, the 30-day comparison completes, a
k-anonymous peer cohort exists, and vendor-approved ShipCompliant sandbox and
production cases pass. The current evidence and blockers are recorded in
`docs/build-specs/phase-4-qa-report.md`.
