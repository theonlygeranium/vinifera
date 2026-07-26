# Phase 4 real-data, ML, and benchmark activation

**Owner:** Vinifera data and release engineering

**Scope:** Operational analytics reconciliation, production-history
qualification, temporal churn-model validation, mandatory shadow/A/B
comparison, peer cohort privacy, promotion, monitoring, and rollback

**Safety:** Synthetic fixtures can validate code but can never qualify a model,
benchmark, or production dashboard. Member-level exports and provider payloads
must remain tenant-scoped and access-controlled.

## Current state

The analytics queries, accessible dashboards, immutable feature snapshots,
deterministic logistic trainer, rules fallback, model registry, prediction
explanations, privacy-thresholded benchmarks, scheduled jobs, and
ShipCompliant boundary are implemented. Production promotion remains closed
until lawful real history and the time-based gates below exist.

## 1. Establish provenance and retention

For every participating winery, record:

- organization and brand ownership;
- lawful source and import date;
- covered operational period;
- consent and permissible analytics uses;
- source-system reconciliation owner;
- row counts by members, releases, shipments, payments, communications,
  loyalty events, and cancellations; and
- correction and deletion obligations.

Import only through audited tenant-scoped paths. Mark snapshots derived from
fixtures, demonstrations, manual synthetic generation, or provider sandboxes
as non-production. PostgreSQL promotion constraints must continue rejecting
those snapshots regardless of model metrics.

Do not copy raw member data between wineries to create benchmark volume.

## 2. Reconcile operational analytics

Select at least one active winery with Phase 2 and Phase 3 history. For an
agreed period, reconcile source facts to:

- recognized shipment revenue, refunds, discounts, tax, MRR, and ARR;
- active, new, paused, declined, recovered, and cancelled members;
- release and fulfillment outcomes;
- email deliveries, opens, clicks, and unsubscribes;
- portal sessions and loyalty awards/redemptions; and
- cancellation attempts and retained/cancelled outcomes.

Use the same date boundary and timezone on both sides. Investigate every
material difference rather than inserting adjustment-only dashboard rows.
Save aggregate comparisons and query/version identifiers; do not save
member-level PII in the QA report.

An organization with no qualifying facts must display an explicit empty state.

## 3. Qualify a training snapshot

A production candidate requires, at minimum:

- 500 distinct members with eligible feature history;
- 50 observed cancellation outcomes;
- immutable `production_history` provenance;
- adequate event coverage across the documented feature set; and
- a temporal split that prevents future information from entering training.

Record the observation window, prediction horizon, label definition, cutoff
timestamps, exclusions, missingness, feature version, and class balance.
Hash the ordered snapshot identity and retain that hash with the candidate.

If the thresholds are not met, continue collecting history and serve Phase 3
rules-based scores. Do not lower a database gate to manufacture readiness.

## 4. Train and validate the candidate

Train only through the versioned deterministic pipeline. Require:

- a held-out temporal ROC AUC of at least 0.82;
- performance above the current rules baseline on the same holdout;
- calibration, precision, recall, and confusion-matrix review at the proposed
  high-risk threshold;
- top contributing features for every scored member;
- no prohibited or unexplained proxy feature;
- reproducible model, feature, snapshot, and metric versions; and
- runtime scoring within the Phase 4 performance budget.

The specification's 75–85% accuracy target must be reported with the class
balance and threshold; it does not replace the AUC or baseline gates.

Reject a candidate when leakage, unstable metrics, an unexplained fairness
concern, or rules-baseline underperformance is found.

## 5. Run the mandatory 30-day shadow/A/B comparison

Register an eligible candidate in shadow mode. For at least 30 consecutive
days:

1. score every eligible active member with both ML and rules;
2. expose both values and explanations to authorized staff without replacing
   the rules decision;
3. record immutable assignment, prediction, intervention, and eventual outcome;
4. monitor coverage, latency, failures, feature drift, and disagreement;
5. prohibit manual relabeling that depends on knowing the assigned method; and
6. compare outcomes only after the defined observation window closes.

Document sample sizes, attrition, intervention differences, and statistical
uncertainty. A calendar duration without sufficient outcomes is not a passing
experiment.

Promote only when the completed experiment and database constraints prove the
candidate is superior and operationally safe. Promotion must be an audited
server-only action.

## 6. Activate peer benchmarking

Recruit at least ten opted-in winery organizations for every reported cohort.
For each participant:

- record explicit owner opt-in and entitlement;
- aggregate only the approved, coarsened metrics;
- suppress cohorts below the privacy threshold;
- prevent drill-down to a contributing winery;
- exclude member identifiers and raw events; and
- rerun isolation checks for owner, restricted staff, member, and service roles.

Test differencing attacks by changing one participant and confirming the UI
cannot reveal the participant's value. A benchmark that would identify a
winery remains suppressed.

Estate/Reserve users may see eligible aggregates. Other tiers and opted-out
wineries must receive a clear entitlement or activation state, never fixtures.

## 7. Activate compliance and scheduled operations

Run `docs/runbooks/phase-4-shipcompliant-activation.md` with the vendor-approved
contract. Confirm compliant, non-compliant, unknown, timeout, stale, and
tampered cases. Only an exact current compliant result may allow label
generation.

Verify scheduled jobs refresh analytics, create immutable feature snapshots,
score with the eligible model or rules fallback, send approved reports, and
refresh privacy-thresholded benchmark aggregates. Alert on failed schedules,
model drift, missing feature coverage, stale compliance results, and
reconciliation differences.

## 8. Hosted exit evidence

Phase 4 passes only when:

- at least one winery dashboard is reconciled to real operations;
- the production-provenance model metrics and version are documented;
- the completed 30-day comparison supports promotion or a documented
  rules-fallback decision;
- an eligible opted-in winery sees a privacy-safe cohort of at least ten;
- ShipCompliant sandbox or approved production evidence covers the release
  legality boundary; and
- a non-compliant shipment is blocked before label purchase.

Record immutable workflow/model/snapshot IDs, aggregate counts, metrics,
redacted screenshots, browser/accessibility/performance results, compliance
response identifiers, and the release decision in
`docs/build-specs/phase-4-qa-report.md`.

## 9. Rollback

- Demote the candidate and restore rules-based scoring without deleting model
  history or predictions.
- Stop benchmark publication if a cohort falls below ten or consent changes.
- Rebuild corrected analytics through audited source facts and forward
  migrations; never patch dashboard totals.
- Disable compliance processing and hold labels when ShipCompliant degrades.
- Preserve experiment, model, benchmark, compliance, and release audit records.
