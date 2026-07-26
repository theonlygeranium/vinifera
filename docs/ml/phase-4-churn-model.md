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
- five expanding-window validation folds;
- probability calibration assessment and an explicitly stored decision
  threshold;
- coefficient-based signed feature contributions;
- a bounded heuristic probability band stored with each prediction.

The initial choice favors portability, interpretability, and deterministic
Worker batch inference. A future tree model must exceed the same leakage,
holdout, explainability, latency, and promotion gates.

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

## Labels and split

- Positive outcome: membership cancellation inside the prediction horizon.
- Negative outcome: retained through the complete horizon.
- Censored members without a complete horizon are excluded from supervised
  training.
- The most recent 20 percent by cutoff date is held out.
- Cross-validation uses expanding time windows; random folds are prohibited.

## Promotion gate

A model version remains `candidate` unless:

1. at least 500 labeled members and 50 positive outcomes exist;
2. held-out AUC-ROC is at least 0.82;
3. precision, recall, F1, accuracy, calibration, and confusion matrix are
   recorded;
4. it does not underperform the rules baseline on the same held-out set;
5. leakage and feature-contract checks pass;
6. no already-active model is replaced without an audited service action.

No synthetic metric can satisfy this gate.

## Deployment and fallback

Nightly inference writes one prediction per active member/model/date. Staff see
the ML score, a heuristic model score band, top five signed contributions,
rules score, and shadow comparison status. The band is an operational
uncertainty cue, not a statistical confidence interval. Crossing into high risk
creates one idempotent alert with an auditable acknowledgment path.

The UI and API return the Phase 3 rules score when no eligible active model
exists, prediction freshness expires, or drift/quality policy disables ML.

## Drift

Population Stability Index compares current input distributions with the
training baseline. A policy breach marks the model `retraining_required` and
alerts platform operations. Retraining creates a new candidate; it never
mutates or automatically promotes an existing version.

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
