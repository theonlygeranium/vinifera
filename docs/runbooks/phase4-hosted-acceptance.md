# Gates 10–12 protected hosted acceptance

This controller records exact hosted evidence after the prerequisites in
`phase-4-data-ml-benchmark-activation.md` exist. It does not create winery
history, shorten the ML experiment, opt a winery into benchmarks, send a
report, promote a model, or mark a gate complete.

## Prepare the selected gate

Create one compact JSON manifest for a single organization and brand and put
the exact deployed candidate SHA in `candidateRevision`. Use timezone-qualified
ISO/RFC3339 instants and the same source window for every comparison. Gate 10 includes all 38
named scalar metrics with integer `source`, `dashboard`, and `csv` values;
bounded proportions in basis points cannot exceed 10,000, while ratios and
per-member activity counts may legitimately exceed one unit,
and requires a hashed active-winery operational-provenance attestation with
synthetic, fixture, and demonstration data explicitly excluded,
plus exact source/dashboard/CSV row digests for the five distribution and
time-series charts, the whole-export digest, and source-query version. Gate 11 includes immutable run/dataset/audit
IDs for one training run, model version, experiment, and promotion audit. The
database qualification row's evidence hash, qualified status, training-run ID,
and dataset hash must bind that same training run and dataset to the chain. The
controller recomputes the database-derived hash from the exact canonical
qualification payload and verifies its training run, dataset, status, and
source-coverage relationship. The nested coverage must reproduce the exact
denominator, all six accepted source counts, and reconciliation-through
horizon, with
explicit matching relationship IDs, the exact 500-or-greater denominator, 50-or-greater cancellations that
cannot exceed the eligible-member denominator, all
six source-family counts, model and same-experiment rules AUC in basis points,
same-experiment ML/rules Brier scores, and closed experiment timestamps, one
exact full-coverage row per consecutive day, a reviewed power-analysis digest
with a minimum of 50 evaluated outcomes, and the latest model-bound
non-retraining drift report no more than seven calendar days old. The
qualification reconciliation horizon is the canonical ISO calendar date that
contains the source-window end. Source reconciliation must extend through the
completed experiment outcome horizon, and experiment completion must be no
later than its observation. Gate 12 includes the selected winery's entitled tier, explicit
opt-in, cohort/report IDs, contributor count, one unique hashed organization
and owner opt-in audit bound to that cohort for every contributor, plus an
Estate/Reserve tier and positive entitlement attestation for every contributor, privacy results, quarter,
provider message ID, persisted email-log ID/status, immutable provider delivery
event ID/type, provider event ID, selected benchmark contribution/aggregate IDs
and aggregate digest, persisted report-content digest, exactly two persisted
PDF/CSV attachment digests, and delivery timestamp. `benchmarkAvailable` must
be true; a delivered privacy-suppression notice is not benchmark delivery.
The protected controller queries `get_benchmark_delivery_attestation` with the
staging service role; the RPC joins the persisted report and immutable delivery
event to the exact stored contribution and least-coarsened aggregate, and
computes the content and attachment hashes from database state. The returned
attestation must bind that report and provider message to the selected organization,
brand, cohort, stored source period within the delivery quarter, report type,
selected aggregate, persisted
report content/attachments, delivered email-log row, and confirmed `delivered`
event. Manifest-provided hashes are expected values only and cannot substitute
for this database attestation.
Every source window must start before it ends and close no later than the
manifest observation. Gate 12 is delivered on a quarterly cadence, but the
existing benchmark refresh stores one monthly snapshot keyed to the prior
quarter's first month. Its source window must therefore be that exact first
calendar month of the declared delivery quarter; it must not substitute a
later month from the same quarter or claim a
three-month aggregate that the database did not compute. Delivery must occur
after that window closes and
no later than both the observation and acceptance capture times.
Timezone-qualified evidence instants are normalized to UTC before comparing
their calendar dates with PostgreSQL `date` fields. PostgreSQL timestamps with
microsecond precision are accepted without weakening calendar validation.

Hash the staging Worker origin and staging Supabase URL with SHA-256. In one
reviewed policy change, enable only the selected gate and add exactly one hash
for each stable target binding. After the candidate revision is immutable,
configure only its `STAGING_GATE<gate>_ACCEPTANCE_ENABLED=true` variable plus
the corresponding manifest and `STAGING_GATE<gate>_ACCEPTANCE_MANIFEST_SHA256`
secrets in `staging-acceptance-control`. Keeping the per-run manifest hash in
protected state avoids a commit-SHA self-reference while preserving exact-byte
and exact-revision authorization. Gate 12 additionally requires the existing
`STAGING_SUPABASE_SERVICE_ROLE_KEY` secret so the protected workflow can call
the service-only attestation RPC.

Dispatch `Phase 4 hosted acceptance` from canonical `main` with its exact
control SHA, the exact current `staging` SHA, and confirmation
`RUN VINIFERA GATE <gate> HOSTED ACCEPTANCE`. The workflow fails on branch,
manifest, runtime revision, runtime-reported Supabase target, or Access drift;
the runtime health revision is probed again after the configuration/database
binding so a concurrent deployment cannot splice two Worker revisions;
future timestamps; missing metric/source family;
insufficient population or elapsed time, privacy failure, or unconfirmed
delivery. Preserve the 90-day artifact with the gate review record, then
disable the one-shot switch and policy in the next reviewed control change.
The controller force-refreshes canonical `main` and `staging` after setup and
again after acceptance. Ref drift before artifact retention rewrites the
report as failed and stops the run instead of retaining stale passing evidence.
Ref-refresh failures take the same invalidation path; if report rewriting
fails, the prior passing report is moved outside the uploader path.

## Current blockers

- Gate 10: a winery with real Phase 2/3 operational source records and a
  complete same-window dashboard/CSV reconciliation.
- Gate 11: a dedicated active actor, 500 labeled members, 50 cancellations,
  qualified production history, and a superior experiment with at least 30
  complete days, 50 evaluated outcomes, superior AUC and Brier metrics, and a
  current non-retraining drift report, all bound to one immutable
  training-run/model/experiment/drift/promotion chain.
- Gate 12: an opted-in Estate/Reserve participant, a privacy-safe cohort of at
  least ten unique winery organizations with owner opt-in and Estate/Reserve
  entitlement attested for every participant, and
  a quarterly report with a persisted delivered email-log state and confirmed
  immutable provider delivery event whose selected aggregate and actual
  persisted PDF/CSV artifacts are cryptographically bound to the evidence.
