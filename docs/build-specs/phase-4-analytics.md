# Phase 4: Analytics & Growth Intelligence

**Duration:** Months 8–12
**Status:** Source architecture implemented; hosted real-data, model,
benchmark-cohort, and ShipCompliant evidence deferred
**Exit Criterion:** Full analytics dashboard is live, ML-assisted churn scoring achieves 75–85% predictive accuracy against held-out test data, peer benchmarking is functional for Estate tier wineries, and ShipCompliant integration verifies shipping legality for every release.

---

## Objective

Elevate Vinifera from a functional platform to an intelligent growth engine. The analytics module gives wineries visibility into their own performance. The ML churn model replaces rules-based scoring with predictive accuracy that rivals or exceeds Commerce7's June 2026 specification. Peer benchmarking gives Estate tier wineries context against anonymized peers. ShipCompliant integration eliminates the compliance risk that haunts every direct-to-consumer wine shipment.

This phase delivers: full analytics, ML-assisted churn scoring, peer benchmarking, and ShipCompliant compliance integration.

---

## Prerequisites

- Phase 3 complete: retention features functional, at least 6 months of real member behavioral data accumulated
- Sufficient data volume for ML training: minimum 500 members across all organizations, minimum 50 cancellation events
- QA gate for Phase 3 passed

---

## Scope

### 4.1 Full Analytics Dashboard

- **Revenue analytics:**
  - Monthly recurring revenue (MRR) — per tier, per organization
  - Annual recurring revenue (ARR)
  - Revenue per member (ARPM)
  - Revenue churn (lost revenue from cancellations and downgrades)
  - Revenue by tier distribution (pie/bar chart)
- **Member analytics:**
  - Active member count over time (line chart)
  - Member growth rate (new signups minus cancellations)
  - Member lifetime value (LTV) — calculated from actual shipment history
  - Member tenure distribution (histogram)
  - Cohort retention curves (members grouped by join month, retention tracked over time)
- **Shipment analytics:**
  - Shipment fulfillment rate (charged / total attempted)
  - Average shipment value
  - Decline rate over time
  - Decline reasons breakdown
  - Shipping cost as percentage of revenue
- **Engagement analytics:**
  - Email open rate, click rate (from Phase 3 email log)
  - Portal login frequency
  - Loyalty point redemption rate
- **Dashboard composition:**
  - Configurable dashboard: staff can add/remove/reorder widgets
  - Date range filter: 7 days, 30 days, 90 days, 12 months, all time, custom
  - Export: CSV export of any chart's underlying data
  - Scheduled reports: staff can schedule weekly/monthly email summaries (uses Phase 3 email infrastructure)

### 4.2 ML-Assisted Churn Scoring

#### Data Pipeline

- Feature engineering from accumulated behavioral data:
  - Recency: days since last shipment, last portal login, last email open
  - Frequency: shipments per year, portal logins per month, email opens per month
  - Monetary: total lifetime spend, average shipment value
  - Engagement: email open rate, click rate, loyalty point balance
  - Tenure: months as member, tier changes
  - Decline history: number of declines, decline reasons, recovery success
  - Seasonality: shipment frequency vs. expected frequency
- Feature store: computed features cached and updated nightly
- Training data: historical members with known outcomes (cancelled vs. retained)

#### Model Training

- Algorithm: Codex selects based on data characteristics — candidates include gradient-boosted trees (XGBoost/LightGBM), logistic regression with regularization, or a small neural network
- Train/test split: 80/20, with temporal split (train on older data, test on recent data) to avoid leakage
- Cross-validation: 5-fold time-series-aware cross-validation
- Target metric: AUC-ROC ≥ 0.82 (corresponds to ~75–85% accuracy at optimal threshold)
- Feature importance: SHAP values or equivalent for interpretability
- Model versioning: each trained model versioned with training data snapshot, hyperparameters, and metrics

#### Model Deployment

- Batch prediction: nightly job scores all active members
- Score confidence: each score includes confidence interval
- Drift detection: monitor feature distribution drift; trigger retraining when drift exceeds threshold
- A/B test: ML scores vs. rules-based scores run in parallel for 30 days; compare predictive accuracy on actual cancellations
- Fallback: if ML model unavailable or accuracy degrades, fall back to rules-based scores from Phase 3

#### Dashboard Integration

- Replace rules-based churn scores with ML scores
- Show top contributing features per member (via SHAP) on member detail page
- "Why this score?" explainer: staff can see which factors drove a member's churn risk
- Alert: staff notified when a member's score crosses into high-risk threshold

### 4.3 Peer Benchmarking (Estate Tier)

- Available to Estate and Reserve tier organizations only
- Anonymized benchmarking against peer wineries:
  - Member retention rate vs. peer median
  - Average shipment value vs. peer median
  - Decline rate vs. peer median
  - MRR growth rate vs. peer median
  - Email engagement vs. peer median
- Peer group definition: by region (AVA), by tier distribution, by member count band
- Data anonymization: no individual winery identifiable; only aggregate percentiles shown
- "How you compare" panel: winery sees their metrics plotted against peer distribution (box-and-whisker or percentile bars)
- Opt-in: wineries must explicitly opt in to share their data for benchmarking
- Quarterly benchmark report: auto-generated PDF emailed to Estate tier wineries

### 4.4 ShipCompliant Integration

- Replace Phase 2's hardcoded state whitelist with real ShipCompliant API integration
- Pre-shipment compliance check: before labels are generated, verify:
  - Recipient state allows direct wine shipment
  - Recipient state allows shipment from the winery's state
  - Recipient is of legal drinking age (address-level age verification where required)
  - Shipment volume within state's annual per-customer limit
  - ShipCompliant returns: compliant, non-compliant (with reason), or unknown
- Non-compliant shipments: flagged in the release processing queue, labels not generated, member notified
- Compliance dashboard: staff can see all non-compliant shipments with reasons
- Tax calculation: ShipCompliant returns estimated tax liability per shipment
- Compliance rules updated quarterly (ShipCompliant maintains the rules database)
- API key management: ShipCompliant API key stored in environment variables

### 4.5 Database Schema (Phase 4 Tables)

```
analytics_events
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - event_type (text)
  - event_data (jsonb)
  - member_id (uuid, nullable)
  - created_at (timestamptz)

ml_model_versions
  - id (uuid, PK)
  - version (text)
  - algorithm (text)
  - hyperparameters (jsonb)
  - training_data_size (integer)
  - metrics (jsonb)  -- {auc_roc, accuracy, precision, recall, f1}
  - feature_importance (jsonb)  -- SHAP values
  - trained_at (timestamptz)
  - is_active (boolean)

ml_churn_predictions
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members)
  - model_version_id (uuid, FK → ml_model_versions)
  - score (decimal, 0-1)  -- probability of churn
  - confidence_interval_low (decimal)
  - confidence_interval_high (decimal)
  - top_features (jsonb)  -- top 5 contributing features with SHAP values
  - predicted_at (timestamptz)

benchmark_contributions
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - period (date)  -- month of contribution
  - metrics (jsonb)  -- {retention_rate, avg_shipment_value, decline_rate, mrr_growth, email_engagement}
  - peer_group (text)  -- {region, tier_distribution, member_count_band}
  - opted_in (boolean)
  - created_at (timestamptz)

compliance_checks
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - shipment_id (uuid, FK → shipments)
  - state (text)
  - status (enum: compliant, non_compliant, unknown)
  - reason (text, nullable)
  - tax_estimate_cents (integer, nullable)
  - shipcompliant_response_id (text)
  - checked_at (timestamptz)
```

---

## Implementation Instructions for Codex

### Build Order

1. **Analytics event pipeline** — instrument all user actions as analytics events
2. **Analytics dashboard** — revenue, member, shipment, engagement widgets
3. **ML data pipeline** — feature engineering, feature store, training data preparation
4. **ML model training** — train, validate, version, deploy
5. **ML scoring** — nightly batch prediction, dashboard integration, SHAP explainability
6. **Peer benchmarking** — data aggregation, anonymization, benchmark queries, dashboard panel
7. **ShipCompliant** — API integration, pre-shipment check, compliance dashboard
8. **Integration** — wire compliance checks into Phase 2 release processing
9. **QA Gate** — run full QA suite
10. **Deploy** — staging → verify exit criterion

### Subagent Delegation

Codex should spawn subagents for:
- Data engineering: analytics event pipeline, feature store, ETL jobs
- ML engineering: model training, validation, deployment, drift monitoring
- Frontend: analytics dashboard with charts (Chart.js or Recharts), benchmarking panel, compliance dashboard
- Backend: analytics aggregation queries, benchmarking API, ShipCompliant API client
- QA: ML model validation, analytics accuracy verification, compliance check testing

### ML Model Notes

- The ML model is the highest-risk component in this phase. Codex should allocate a dedicated subagent to ML engineering.
- If the 75–85% accuracy target is not achievable with available data, Codex should document the gap, report the achieved accuracy, and escalate to the human supervisor. Do not ship a model that performs worse than the rules-based scorer from Phase 3.
- The A/B test (ML vs. rules-based) is mandatory before ML scores replace rules-based scores in production.

---

## QA Gate (Phase 4)

### Functional Tests

- [ ] Analytics dashboard loads with real data from Phase 2/3 operations
- [ ] Revenue charts: MRR, ARR, ARPM, revenue churn all calculated correctly
- [ ] Member analytics: active count, growth rate, LTV, cohort retention curves
- [ ] Shipment analytics: fulfillment rate, decline rate, shipping cost ratio
- [ ] Engagement analytics: email open/click rates, portal login frequency, loyalty redemption rate
- [ ] Date range filter works: 7d, 30d, 90d, 12m, all time, custom
- [ ] CSV export of chart data works
- [ ] Scheduled reports: weekly summary email delivers correctly
- [ ] ML model trained with AUC-ROC ≥ 0.82 (or documented gap if not achievable)
- [ ] ML churn predictions assigned to all active members
- [ ] "Why this score?" explainer shows top 5 contributing features per member
- [ ] ML score alert fires when member crosses high-risk threshold
- [ ] A/B test: ML vs. rules-based scores running in parallel
- [ ] Drift detection triggers retraining when feature distribution shifts
- [ ] Fallback: if ML model unavailable, rules-based scores display
- [ ] Peer benchmarking: Estate tier winery can opt in and see peer comparison
- [ ] Peer benchmarking: no individual winery identifiable in benchmark data
- [ ] Quarterly benchmark report generates and emails
- [ ] ShipCompliant: pre-shipment check runs before label generation
- [ ] ShipCompliant: non-compliant shipment flagged, label not generated, member notified
- [ ] ShipCompliant: compliance dashboard shows all non-compliant shipments with reasons
- [ ] ShipCompliant: tax estimate returned and displayed
- [ ] ShipCompliant: compliance rules reflect current state regulations (verify against ShipCompliant API)

### Accessibility (axe-core)

- [ ] 0 axe-core WCAG 2.1 AA violations on analytics dashboard, benchmarking panel, compliance dashboard
- [ ] Charts are accessible: data tables available as alternative to visual charts (`<table>` with proper headers, or `aria-label` on chart container with summary)
- [ ] Color in charts is not the sole differentiator (patterns, labels, or textures used)
- [ ] Color contrast ≥ 4.5:1 including chart axis labels and legends
- [ ] Keyboard navigation: dashboard widgets reachable via Tab, interactive controls operable
- [ ] Date range picker keyboard accessible
- [ ] "Why this score?" explainer content is screen-reader accessible

### Visual / Layout

- [ ] Analytics dashboard renders correctly at 375px (charts stack vertically, no horizontal scroll)
- [ ] Benchmarking panel renders correctly at all breakpoints
- [ ] Compliance dashboard renders correctly at all breakpoints
- [ ] Charts do not overflow containers at any breakpoint
- [ ] Touch targets ≥ 44×44px on all interactive elements (date picker, filter toggles, export buttons)
- [ ] `visual_qa` passes on all screenshots

### Performance

- [ ] Analytics dashboard loads < 2s with 12 months of data
- [ ] Chart rendering < 500ms per chart
- [ ] ML batch prediction completes < 5 minutes for 10,000 members
- [ ] ShipCompliant check completes < 2s per shipment
- [ ] LCP < 2.5s on all new pages
- [ ] CLS < 0.1

### Security

- [ ] Analytics events do not contain PII beyond what's necessary (email is hashed for aggregation)
- [ ] ML model artifacts stored securely, not in client-accessible locations
- [ ] Peer benchmarking data is properly anonymized — no reverse-engineering possible
- [ ] ShipCompliant API key stored in environment variables, never client-side
- [ ] CSV exports do not include data from other organizations (RLS enforced)
- [ ] Model training data access restricted to platform-level super-admin

### Mobile

- [ ] Analytics dashboard usable on mobile (charts stack, data tables scroll horizontally if needed)
- [ ] Benchmarking panel usable on mobile
- [ ] Compliance dashboard usable on mobile
- [ ] Date range picker functional on mobile
- [ ] CSV export triggers download correctly on mobile

### Exit Criterion Verification

- [ ] Analytics dashboard displays real data from at least one winery's operations
- [ ] ML model trained and deployed — accuracy documented (target 75–85%)
- [ ] A/B test running — ML and rules-based scores both visible to staff for comparison
- [ ] Estate tier winery opted into benchmarking — sees peer comparison panel
- [ ] ShipCompliant integration live — release processing now includes compliance check
- [ ] Non-compliant shipment correctly blocked from label generation

---

## Deliverables

- Full analytics dashboard (revenue, member, shipment, engagement)
- ML-assisted churn scoring with explainability
- Peer benchmarking (Estate tier, anonymized)
- ShipCompliant compliance integration
- ML model documentation (algorithm, features, metrics, version history)
- QA test report (saved as `docs/build-specs/phase-4-qa-report.md`)
- ADRs for architectural decisions (especially ML model selection)
- Updated CHANGELOG.md

---

## Pre-Provisioned Credentials

Phase 4 builds on Phases 1–3 credentials. The following additional credential is NOT pre-provisioned and must be obtained before starting this phase:

| Secret name | Purpose | How to obtain |
|-------------|---------|---------------|
| `SHIPCOMPLIANT_API_KEY` | ShipCompliant API for compliance checks | Register at https://shipcompliant.com, request API access, store key as GitHub repo secret |

**ShipCompliant sandbox access** may be available for development. Codex should check whether a sandbox/test environment exists and use it for development before hitting production compliance checks.

---

## Constraints

- **ML accuracy target is 75–85%.** If not achievable with available data, document the gap and escalate. Do not ship a model worse than Phase 3's rules-based scorer.
- **A/B test is mandatory.** ML scores do not replace rules-based scores until the A/B test confirms superior predictive accuracy.
- **Peer benchmarking is anonymized.** No individual winery must be identifiable. This is a legal and trust requirement.
- **ShipCompliant replaces the state whitelist.** The hardcoded whitelist from Phase 2 must be removed once ShipCompliant is live.
- **Analytics data is real.** No mock data in the dashboard — all numbers must come from actual operations. If insufficient data exists, display an empty state with guidance.
- **Charts must be accessible.** Every chart needs a data table alternative or text summary for screen readers.
- **Never commit secret values to source files.** The repository is public. All credentials are stored as encrypted GitHub repository secrets.
