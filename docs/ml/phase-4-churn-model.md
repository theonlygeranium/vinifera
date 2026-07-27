# Phase 4 churn model card

## Status

**Architecture complete; production training pending real outcome volume.**

This document defines the model contract that may be trained and activated
after the hosted dataset reaches the minimum evidence threshold. A synthetic
fixture is used only to verify the trainer, metrics, persistence, and batch
prediction path. It is not production performance evidence.

## Intended use

Rank active wine-club members for staff retention outreach. The score is a
probability estimate for cancellation during the configured prediction
horizon. It does not make membership decisions, change pricing, or cancel a
member automatically.

Phase 3 rules remain the safe fallback and run in parallel during the required
30-day comparison.

## Candidate algorithm

L2-regularized logistic regression with:

- versioned feature ordering;
- training-only median imputation;
- training-only standardization;
- temporal 80/20 holdout;
- five expanding temporal-cohort validation folds;
- a decision threshold selected only from out-of-fold training predictions,
  maximizing F1 with balanced accuracy and proximity to 0.5 as deterministic
  tie-breakers;
- probability calibration assessment and an explicitly stored decision
  threshold;
- coefficient-based signed feature contributions;
- a bounded heuristic probability band stored with each prediction.

The initial choice favors portability, interpretability, and deterministic
Worker batch inference. A future tree model must exceed the same leakage,
holdout, explainability, latency, and promotion gates.

The selected decision threshold is used for held-out accuracy, precision,
recall, F1, and confusion-matrix reporting. It is distinct from the operational
high-risk alert threshold, which remains a separately versioned product-policy
setting.

## Feature contract

| Group | Features |
|---|---|
| Recency | days since shipment interaction, portal login, and email open |
| Frequency | shipments/year, portal logins/month, email opens/month |
| Monetary | lifetime shipment spend and average successful shipment value |
| Engagement | open rate, click rate, available/redeemed loyalty points |
| Tenure | months active, tier change and downgrade counts |
| Billing | decline count/reasons and recovery rate |
| Seasonality | actual versus expected shipment cadence |

Every feature includes a calculation version and an `as_of` cutoff. Events
after that cutoff and target-window outcomes are excluded from training input.
Direct identifiers, email addresses, free-form notes, and provider payloads are
not model features.

The production decoder rejects non-finite, non-numeric, unknown-version, or
malformed persisted features rather than silently treating corruption as
missing data. Legitimately absent values use training-only median imputation.
Because the persisted feature vector always contains every versioned key, key
presence is not treated as proof of underlying event-source coverage. Hosted
activation must separately report source denominators and observation coverage
for shipment, portal, email, loyalty, tier, and decline signals.

## Labels and split

- Positive outcome: membership cancellation inside the prediction horizon.
- Negative outcome: retained through the complete horizon.
- Censored members without a complete horizon are excluded from supervised
  training.
- Eligible distinct members are ordered by persisted membership join date and
  member ID. The oldest 80 percent form the training cohort and the newest 20
  percent form the member-disjoint holdout cohort.
- Training members use their latest eligible feature snapshot on or before the
  training cutoff. Holdout members use their latest eligible snapshot inside
  the later holdout window. Every selected snapshot must have a complete
  90-day outcome horizon.
- Assigned datasets carry a separate temporal-cohort ordering timestamp and
  feature observation timestamp. Training observations must strictly precede
  holdout observations.
- Cross-validation uses contiguous cohorts 0 through 5. Each of the five
  validation cohorts is evaluated only after its earlier expanding cohorts;
  random folds are prohibited.

## Promotion gate

A model version remains `candidate` unless:

1. an active platform automation actor owns the immutable production-history
   run;
2. operator-attested source coverage reconciles at least 95 percent of the
   shared member denominator across shipments, billing, email delivery, portal
   activity, loyalty, and declines through the full outcome horizon;
3. at least 500 labeled members and 50 positive outcomes exist;
4. held-out AUC-ROC is at least 0.82;
5. precision, recall, F1, accuracy, calibration, and confusion matrix are
   recorded;
6. it does not underperform the rules baseline on the same held-out set;
7. all five temporal validation folds have both outcome classes and a defined
   AUC;
8. leakage and feature-contract checks pass;
9. no already-active model is replaced without an audited service action.

No synthetic metric can satisfy this gate.

The qualification command is an operator seam, not an evidence generator.
PostgreSQL derives its evidence hash from the run, dataset, status, and coverage
document. Model registration and promotion remain service-only, and the
promoted version records the active platform actor. Missing experiments,
metrics, drift evidence, source qualification, or actor identity fail closed.

## Deployment and fallback

Nightly inference writes one prediction per active member/model/date. Staff see
the ML score, a heuristic model score band, top five signed contributions,
rules score, and shadow comparison status. The band is an operational
uncertainty cue, not a statistical confidence interval. Crossing into high risk
creates one idempotent alert with an auditable acknowledgment path.

The UI and API return the Phase 3 rules score when no eligible active model
exists, prediction freshness expires, or drift/quality policy disables ML.
Experiment and drift evidence must identify the same active model, and the
latest stable drift snapshot must be no more than seven UTC calendar days old.
When fallback activates, every member's effective source and score are
rewritten to rules; the ML score remains visible only as comparison evidence.

## Drift

Population Stability Index compares current input distributions with the
training baseline. A policy breach marks the model `retraining_required` and
alerts platform operations. Retraining creates a new candidate; it never
mutates or automatically promotes an existing version.

The nightly order is feature refresh, lifecycle/drift evaluation, then scoring.
A detected retraining requirement suppresses that scoring pass so a newly
degraded model cannot update effective scores or emit fresh ML alerts before
fallback takes effect.

The current lifecycle result exposes aggregate drift state, so suppression is
conservatively batch-wide. Rules remain authoritative during that pass. A
future model-specific scheduler response may continue a healthy candidate's
shadow predictions while suppressing only the degraded production model, but
it must not infer that distinction from aggregate state.

## Known limitations

- Early wineries may have seasonal or sparse outcomes.
- Cancellation reasons can change after pricing, policy, or release changes.
- Email engagement is influenced by client privacy controls.
- The displayed score band is a coarse calibration cue and must not be
  interpreted as a confidence interval, causal certainty, or an individual
  forecast guarantee.
- Feature contributions explain the fitted model, not why a person will
  definitely cancel.

## Required hosted evidence

- successful hosted migration and tenant-isolation verification;
- redacted dataset counts and cutoff dates;
- training, validation, and held-out metrics;
- rules-baseline comparison;
- feature distribution and drift report;
- active model/version record;
- 30-day shadow results with observed outcomes;
- evidence that fallback works when the model is disabled.

Until this evidence exists, the public product must display Phase 3 rules
scores or a clearly labeled activation state. Synthetic fixture metrics and the
deterministic screenshots in `docs/qa/phase-4/` do not satisfy the promotion
gate.
