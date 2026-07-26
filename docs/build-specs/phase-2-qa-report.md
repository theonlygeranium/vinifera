# Phase 2 QA report — Core club loop

**Date:** 2026-07-26
**Candidate:** Phase 2 production architecture
**Gate status:** Architecture/local QA pass; hosted money-movement and label
exit proof is deferred pending provider activation.

## Outcome

This report separates architecture/local evidence from hosted provider evidence.
A local double or test-only shipping simulator can verify orchestration, state
transitions, accessibility, and failure handling, but it does not satisfy the
claim that Stripe moved test money or that EasyPost created a test label.

## Automated evidence

| Check | Result | Evidence |
|---|---:|---|
| Dependency audit | Pass | zero known vulnerabilities |
| TypeScript | Pass | `npm run typecheck` |
| API/unit integration | Pass | Vitest 25/25 |
| Browser QA | Pass | Phase 2 Playwright 34/34; full Phase 1–2 regression 55/55 |
| Worker packaging | Pass | Wrangler dry run |
| Database migration | Pass locally; hosted pending | fresh embedded database applies Phase 1 then Phase 2 |
| pgTAP | Pass locally; hosted pending | 56 schema + 42 RLS + 47 RPC assertions; 145/145 total |
| Accessibility | Pass | axe WCAG 2.1 AA, zero violations across all ten routes |
| Responsive layout | Pass | 375, 768, and 1440 |
| Performance | Pass locally | embedded release RPC: 50 shipments in 12.02 ms; embedded import RPC: 1,000 rows in 376.62 ms; deterministic member, LCP, and CLS budgets |
| Security | Pass locally | RLS, signatures, upload limits, redaction, activation gates, and audit immutability |

## Functional gate

| Requirement | Local architecture | Hosted evidence |
|---|---:|---:|
| Create and edit unlimited club tiers | Pass | Pending |
| Add ten members and assign tiers | Pass | Pending |
| Search and transition member status | Pass | Pending |
| Batch pause, resume, assign, and export | Pass | Pending |
| Preview/import Commerce7 CSV | Pass | Pending |
| Reject invalid, missing, and duplicate CSV rows | Pass | Pending |
| Create and schedule a release snapshot | Pass | Pending |
| Process a partially successful billing batch | Pass | Pending |
| Record one decline in the recovery queue | Pass | Pending |
| Retry on days 1, 3, and 7 | Pass | Pending |
| Update payment method and manually recover | Pass | Pending |
| Validate and reject an invalid address | Pass | Pending |
| Generate carrier labels | Pass with test-only simulator | Pending EasyPost |
| Generate a complete printable pick list | Pass | Pending |
| Scan items and confirm packing | Pass | Pending |
| Transition shipped → delivered | Pass | Pending |
| Refund a shipment charge | Pass | Pending Stripe |
| Record every operation in audit history | Pass | Pending |
| Member shipment history | Pass | Pending |
| Member address update | Pass | Pending |
| Member payment-method portal | Pass | Pending Stripe |

## Accessibility and visual gate

- [x] Zero axe-core WCAG 2.1 AA violations on every Phase 2 page.
- [x] Tables use captions, table headers, and scoped column headings.
- [x] Every input has a programmatic label.
- [x] Dialogs trap focus, close on Escape, and restore focus.
- [x] Asynchronous success/error state uses `aria-live`.
- [x] Member, release, recovery, shipment, fulfillment, and import views work at
      375, 768, and 1440 pixels.
- [x] No horizontal page overflow at 375 pixels; wide tables scroll within their
      labeled container.
- [x] Effective touch targets are at least 44 by 44 pixels.
- [x] Accepted visual evidence is saved in `docs/qa/phase-2/`.

## Performance gate

- [x] A 100-member list request and render completes in under one second.
- [x] The real `create_release_shipments` RPC created and persisted 50 shipments
      and 50 item snapshots in 12.02 ms, below the 30-second budget.
- [x] The real `complete_member_import` RPC committed 1,000 staged CSV rows with
      1,000 inserts and zero failures in 376.62 ms, below the 10-second budget.
- [x] LCP remains under 2.5 seconds on every new route.
- [x] CLS remains under 0.1.

Provider network latency is measured separately from deterministic local service
tests. Hosted results must include the provider mode and sample size.

## Security gate

- [x] Org A cannot select or mutate Org B Phase 2 data.
- [x] Browser roles cannot execute server-only processing functions.
- [x] Stripe webhook signatures are required on every payment event.
- [x] PaymentIntent and refund calls use stable idempotency keys.
- [x] No card number, CVC, Stripe secret, or provider key is stored client-side.
- [x] CSV MIME, extension, byte size, row count, fields, and duplicates are
      validated server-side.
- [x] Audit entries are append-only and chained for tamper evidence.
- [x] Missing providers return a typed activation error without fake success.
- [x] The production runtime rejects the shipping simulator.

## Exit criterion evidence

- [ ] Hosted Supabase Phase 1 and Phase 2 migrations applied.
- [ ] One real test winery exists.
- [ ] Ten test members have Stripe test customers and payment methods.
- [ ] One real tier contains all ten members.
- [ ] One scheduled release snapshots the tier, price, and wine items.
- [ ] Ten Stripe test-mode PaymentIntents run.
- [ ] One decline is recovered after a test payment-method update.
- [ ] EasyPost test labels exist for all successful shipments.
- [ ] Pick, pack, ship, deliver, and one refund are evidenced.
- [ ] Audit history contains the complete chain.
- [ ] **The money moved in test mode and the wine shipped in simulation.**

## Deferred activation checklist

- [ ] Add Supabase management credentials and apply migrations.
- [ ] Add Stripe webhook signing secret and configure Phase 2 events.
- [ ] Attach Stripe test customers and payment methods to ten members.
- [ ] Add `EASYPOST_API_KEY` and set `SHIPPING_PROVIDER=easypost`.
- [ ] Configure and validate the winery return address.
- [ ] Run the provider activation runbook on the staging Worker.
- [ ] Save redacted hosted evidence in this report.

## Commands

```bash
npm audit --omit=dev --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run qa:e2e
NODE_PATH="/path/to/node_modules-containing-pglite" npm run qa:db:phase2
npx supabase db reset
npx supabase test db
```

`qa:db:phase2` fails when `@electric-sql/pglite` cannot be resolved. Codex can
reuse its workspace copy by pointing `NODE_PATH` at the containing
`node_modules` directory; no project dependency is required. A non-blocking
environment may opt into an explicit skip with
`VINIFERA_DB_VERIFY_ALLOW_SKIP=1 npm run qa:db:phase2`. The embedded check uses
a deterministic 32-byte digest substitute because the workspace PGlite build
does not include pgcrypto. Native SHA-256 and pgTAP remain hosted-Supabase
activation checks.

The two database timings above were captured on 2026-07-26 by
`npm run qa:db:phase2`. The verifier creates a fresh embedded database, applies
the production Phase 1 and Phase 2 migrations, invokes the production RPCs,
asserts returned and persisted counts, and fails when either elapsed-time
budget is exceeded.
