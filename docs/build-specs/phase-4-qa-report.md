# Phase 4 QA report: analytics and growth intelligence

**Date:** 2026-07-26

**Scope:** Phase 4 local architecture, automated QA, visual evidence, and
activation readiness

**Overall status:** **Local architecture release gate passed; hosted
operational exit criterion deferred and not met**

## Executive result

The repository contains the Phase 4 analytics, guarded churn-model lifecycle,
private peer benchmarking, and fail-closed compliance architecture. The
TypeScript, unit/service, embedded database, browser, accessibility,
responsive, build, and Worker packaging gates pass locally.

Phase 4 is not operational or complete against the specification's exit
criterion:

- the public custom domain still serves the static Cloudflare Pages prototype,
  not the Worker application;
- no hosted winery dataset has been used to validate dashboard numbers;
- no production-history model has met the data, AUC, and 30-day A/B gates;
- no ten-winery peer cohort has been evidenced;
- no vendor-approved ShipCompliant sandbox or production response has been
  recorded.

Credential deferral is supported by explicit activation states. It does not
convert any of those hosted gates into a pass.

## Evidence snapshot

| Gate | Command or evidence | Result |
| --- | --- | --- |
| Production dependency audit | `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| TypeScript | `npm run typecheck` | PASS |
| Full unit/service suite | `npm test` | PASS — 71/71 across 5 files |
| Focused Phase 4 unit/service suite | `npx vitest run tests/client/phase4-normalizers.test.ts tests/server/phase4-services.test.ts` | PASS — 25/25 |
| Client production build | `npm run build` | PASS |
| Worker packaging | `npm run build:worker` | PASS — 3,051.30 KiB upload / 646.87 KiB gzip dry run |
| Browser secret-binding scan | `rg` against `dist/assets` for server-only binding names | PASS — no matches |
| Full browser regression | `npm run qa:e2e` | PASS — 94/94 across Phases 1–4; Phase 4 contributed 18/18 and five charts were visible 33.70ms after dashboard response end |
| Phase 4 embedded database | `npm run qa:db:phase4` | PASS — schema 46/46, tenant RLS 25/25, functional analytics/ML/compliance 50/50; 121/121 total |
| Hosted root | `curl` against `https://vinifera.edstratumlabs.ai/` | HTTP 200 from the existing static Pages site |
| Hosted application | `curl` against `/app/` | HTTP 200 static prototype HTML, 189,835 bytes |
| Hosted API | `curl` against `/api/health` | HTTP 200 `text/html`, 89,647 bytes; not the Worker JSON health contract |

The browser suite uses deterministic API fixtures. Its passing values and
screenshots are not production analytics, model, benchmark, or legal-compliance
evidence.

## Functional gate

### Analytics

- [x] The client exposes MRR, ARR, ARPM, revenue churn, revenue by tier, active
  members, growth, LTV by tier, tenure, cohorts, fulfillment, average shipment
  value, decline trend and reasons, shipping-cost ratio, email open/click,
  portal login, and loyalty-redemption metrics.
- [x] The service and client normalize the database-shaped analytics contract;
  missing operational series render empty guidance instead of invented rows.
- [x] Date presets, custom dates, chart CSV downloads, widget
  add/remove/reorder/size controls, saved layouts, and report scheduling pass
  deterministic browser workflows.
- [x] Every visual chart has a focusable tabular alternative with headers.
- [ ] A hosted dashboard has not been reconciled against a real winery's Phase
  2/3 source records.
- [ ] A weekly or monthly summary has not been delivered through an activated
  hosted email provider.

### Churn model and lifecycle

- [x] The L2 logistic trainer implements temporal holdout, five expanding
  folds, training-only imputation/scaling, calibration metrics, confusion
  matrix, signed feature contributions, and immutable provenance.
- [x] Synthetic-fixture training cannot satisfy the production promotion gate.
- [x] The application has rules fallback, A/B status, drift status, five-factor
  explainability, high-risk alert creation, and alert acknowledgment paths.
- [x] The scheduled architecture refreshes features and predictions nightly,
  evaluates lifecycle/drift nightly, and attempts candidate training monthly.
- [x] Promotion requires production-history provenance, at least 500 labeled
  members, at least 50 cancellations, held-out AUC-ROC of 0.82, superiority to
  rules over a completed 30-day comparison, explicit promotion, and stable
  drift.
- [x] The UI describes the stored uncertainty values as a heuristic score band,
  not a statistical confidence interval.
- [ ] No production-history model has been trained, validated, or promoted.
- [ ] The target accuracy/AUC has not been demonstrated against held-out hosted
  outcomes.
- [ ] The required 30-day A/B comparison has not run against observed
  cancellations.
- [ ] Predictions have not been proven for every active member in hosted data.

### Peer benchmarking

- [x] Estate/Reserve entitlement, explicit opt-in/opt-out, coarsened groups,
  minimum cohort size of ten, suppression guidance, percentile output, and
  deterministic quarterly PDF/HTML/text/CSV generation are locally tested.
- [x] Suppressed cohorts return no peer metric values or small exact peer
  counts.
- [ ] No hosted Estate/Reserve winery and ten-contributor peer cohort has been
  evidenced.
- [ ] No quarterly report has been delivered through the hosted email pipeline.

### Compliance and label boundary

- [x] The adapter validates HTTPS configuration, performs OAuth
  client-credentials caching, maps complete provider evidence, and converts
  malformed, unknown, timeout, and provider failures into fail-closed outcomes.
- [x] The deterministic simulator is allowed only when `APP_ENV=test` and the
  explicit simulator flag is enabled.
- [x] The operational compliance check runs after a successful charge and
  immediately before label generation.
- [x] Only an exact `compliant` decision may proceed; `non_compliant` and
  `unknown` block labels and retain reason, tax, response ID, checked time, and
  minimized evidence.
- [x] Provider health distinguishes missing configuration, configured without a
  successful call, active latest success, and degraded newer failure/unknown.
  `lastSuccessfulCheckAt` is not presented as a rules-refresh timestamp.
- [x] The dashboard exposes provider response ID, checked time, freshness,
  decision, reason, tax estimate, and recheck actions only for `charged`
  pre-label shipments.
- [x] Compliance request and shipment-state fingerprints cover the
  compliance-relevant snapshot. Relevant changes invalidate the decision
  before labeling and are rejected after labeling.
- [x] Durable EasyPost label attempts use `create_shipment`,
  `recover_purchase`, `reconcile`, `in_progress`, and `succeeded`
  dispositions. They persist the carrier shipment and rate before buy, reuse
  success, retrieve the stored provider shipment after lease loss, and require
  reconciliation for indeterminate outcomes instead of blindly repurchasing.
- [ ] ShipCompliant credentials and the vendor-approved request/response
  contract are not connected in a hosted environment.
- [ ] Compliant, non-compliant, unknown, tax, timeout, and current-regulation
  cases have not been proven against ShipCompliant.
- [ ] A real non-compliant shipment and member notification have not been
  evidenced end to end.
- [ ] The static whitelist remains historical source and has not been replaced
  by an activated provider on the hosted application.

## Accessibility, visual, performance, and mobile

- [x] axe-core reports zero WCAG 2.1 AA violations on Analytics, AI Churn
  Watch, Peer Benchmarks, and Compliance at 375, 768, and 1440px.
- [x] The browser matrix finds no document-level horizontal overflow.
- [x] Visible mobile controls meet the 44 by 44px target.
- [x] Charts use labels and line styles in addition to color and expose data
  tables.
- [x] A keyboard-only analytics workflow uses Tab/Shift+Tab, Enter, and Escape
  to traverse and activate the widget dialog, verify focus trapping and return,
  select/apply a date range, and disclose a chart data table.
- [x] The deterministic browser harness passes LCP below 2.5 seconds and CLS
  below 0.1 on all four surfaces at all three breakpoints.
- [x] An in-page MutationObserver/requestAnimationFrame probe measured all five
  analytics charts visibly rendered 33.70ms after the dashboard resource
  response ended in the full parallel run, below the 500ms gate.
- [x] The embedded database gate measured 10,000-member scoring at 13,668.44ms
  against the 300,000ms ceiling and the 365-day dashboard at 53.01ms against
  the 2,000ms ceiling.
- [ ] Real ShipCompliant latency below two seconds has not been measured.
- [ ] Hosted/mobile QA against real data remains pending.

Accepted deterministic visual evidence:

- `docs/qa/phase-4/analytics-375.png`
- `docs/qa/phase-4/analytics-1440.png`
- `docs/qa/phase-4/churn-intelligence-768.png`
- `docs/qa/phase-4/benchmarks-375.png`
- `docs/qa/phase-4/compliance-375.png`
- `docs/qa/phase-4/benchmark-report.pdf`
- `docs/qa/phase-4/benchmark-report.png`

See `docs/qa/phase-4/README.md` for dimensions, inspection notes, and the
reproducible capture command.

## Security gate

- [x] Analytics event types are allowlisted, payload size is bounded, and
  identifying/free-form keys are rejected by service tests.
- [x] Model artifacts, training rows, raw benchmark contributions, and provider
  credentials have no client API contract and remain server/database concerns.
- [x] ShipCompliant configuration is server-only and cannot be Vite-prefixed.
- [x] The built browser assets contain none of the server-secret binding names
  `SHIPCOMPLIANT_API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
  `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, or `EASYPOST_API_KEY`.
- [x] Benchmark output is suppressed below ten contributors.
- [x] The Phase 4 schema suite passes 46/46, including forced-RLS and privilege
  declarations.
- [x] The complete embedded tenant-isolation and functional RPC suites pass
  25/25 and 50/50 respectively.
- [ ] Hosted two-tenant RLS, CSV tenant isolation, service/super-admin training
  access, and compliance-ledger access remain unverified.
- [ ] Hosted secret/configuration inspection remains pending.

## Specification divergences made explicit

1. The build specification uses “confidence interval.” The implemented values
   are a heuristic model score band and are labeled that way because they are
   not a formal statistical confidence interval.
2. “Pre-shipment compliance” is implemented specifically after a successful
   test-mode charge and immediately before label generation. This preserves the
   non-negotiable pre-label guard while avoiding provider calls for declined
   shipments.
3. The provider adapter is connection-ready, not live. Local simulation proves
   orchestration only.
4. Synthetic model metrics prove trainer behavior only and cannot satisfy the
   Phase 4 accuracy or promotion gate.

## Exit criterion

| Criterion | Status | Required evidence |
| --- | --- | --- |
| Full analytics dashboard live with real winery data | NOT MET | Worker deployment, hosted migration, real-source reconciliation, hosted accessibility/performance |
| ML-assisted scoring at target accuracy | NOT MET | Production-history dataset, held-out metrics, baseline comparison, active version |
| 30-day ML/rules comparison | NOT MET | Dated experiment and observed cancellation outcomes showing ML superiority |
| Estate/Reserve peer benchmarking functional | NOT MET | Explicit consent plus a cohort of at least ten real wineries |
| ShipCompliant integrated into release processing | NOT MET | Vendor-approved sandbox/production calls and audit records |
| Non-compliant shipment blocked | LOCAL ONLY | Hosted provider decision, blocked label, hold, and member notification |

**Phase 4 local architecture release gate: PASSED.**

**Phase 4 hosted operational exit criterion: NOT PASSED.**

## Required closeout sequence

1. Apply the Phase 4 migration to staging Supabase and run native pgcrypto,
   pgTAP, and two-tenant checks.
2. Deploy the Worker to staging and confirm `/api/health` returns its JSON
   contract.
3. Reconcile dashboard figures and exports against at least one winery's
   operational source records.
4. Activate and prove the hosted email, benchmark, and ShipCompliant paths with
   redacted evidence.
5. Accumulate the required outcomes, train the model, complete the 30-day
   comparison, and promote only if every guardrail passes.
6. Repeat accessibility, mobile, performance, security-header, and full
   regression checks against staging before moving the custom domain.
