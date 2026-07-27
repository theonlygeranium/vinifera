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
| Dependency audit | Pass | `npm audit --omit=dev --audit-level=moderate`; zero known vulnerabilities |
| TypeScript | Pass | `npm run typecheck` |
| API/unit integration | Pass | focused Phase 2 Vitest 72/72; full Vitest 290/290 across 25 files |
| Browser QA | Pass | Phase 2 Playwright 38/38; full regression 136/136 |
| Worker and Pages packaging | Pass | Pages build plus default and production Wrangler dry runs |
| Database migration | Pass locally; hosted pending | fresh embedded database runs the Phase 2 point-in-time stack and the complete current stack |
| pgTAP | Pass locally; hosted pending | 170 point-in-time + 61 current-stack transactional assertions; 231/231 total |
| Cross-phase database regression | Pass locally; hosted pending | Phase 1 92/92, Phase 3 138/138, Phase 4 121/121, and Phase 5 340/340 |
| Release controls | Pass | production release 14/14, mobile release 7/7, Stripe catalog 16/16 |
| Native preparation | Pass compile-only | Capacitor web preparation and Android/iOS sync with the non-routable compile-only origin |
| GitHub CI | Pass | commit `15c9942`, run `30226397256`: quality 5m15s, Android 3m39s; hosted mutation jobs skipped |
| Accessibility | Pass | axe WCAG 2.1 AA, zero violations across the full browser suite |
| Responsive layout | Pass | 375, 768, and 1440 |
| Performance | Pass locally | single-worker 100-member roster 941.7 ms; release RPC 10.76 ms; import RPC 338.85 ms; LCP 712 ms; CLS 0 |
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
- [x] The complete 136-test browser inventory passes with zero axe violations.

## Performance gate

- [x] A 100-member list request and render completes in 941.7 ms, under one
      second.
- [x] The real `create_release_shipments` RPC created and persisted 50 shipments
      and 50 item snapshots in 10.76 ms, below the 30-second budget.
- [x] The real `complete_member_import` RPC committed 1,000 staged CSV rows with
      1,000 inserts and zero failures in 338.85 ms, below the 10-second budget.
- [x] Measured LCP is 712 ms, below 2.5 seconds.
- [x] Measured CLS is 0, below 0.1.

Provider network latency is measured separately from deterministic local service
tests. Hosted results must include the provider mode and sample size.

## Security gate

- [x] Org A cannot select or mutate Org B Phase 2 data.
- [x] Browser roles cannot execute server-only processing functions.
- [x] Stripe webhook signatures are required on every payment event.
- [x] PaymentIntent and refund calls use stable idempotency keys.
- [x] A completed full-refund command replays its recorded result without a
      second ledger or Stripe call; conflicting amount/reason reuse is rejected.
- [x] UUID command fingerprints reject conflicting replays while browser
      `sessionStorage` retains only pending command metadata, never raw PII.
- [x] Command audit, business mutation, result persistence, and provider-outbox
      enqueue occur atomically.
- [x] Same-brand composite foreign keys prevent cross-brand references below
      the service layer.
- [x] Stripe event identifiers and financial identifiers are immutable, active
      charge/refund uniqueness is enforced, and stale refunds converge through
      bounded database leases.
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
npm run build:pages
npm run build:worker
npm run build:worker:production
npm run qa:e2e
npm run qa:db:phase2
npm run qa:production-release
npm run qa:mobile-release
npm run qa:stripe-catalog
MOBILE_BUILD_PROFILE=compile-only \
  VITE_MOBILE_API_ORIGIN=https://unconfigured.invalid \
  npm run build:mobile:web
npx cap sync
npx supabase db reset
npx supabase test db
```

The project resolves `@electric-sql/pglite` normally; no `NODE_PATH` override is
required. The embedded check uses a deterministic 32-byte digest substitute
because PGlite does not include pgcrypto. Native SHA-256 and linked pgTAP remain
hosted-Supabase activation checks.

The two database timings above were captured on 2026-07-26 by
`npm run qa:db:phase2`. The verifier first applies migrations 001–002 and runs
170 point-in-time schema, RLS, RPC, and performance assertions. It then applies
migrations 001–013 and runs 61 current-stack transactional-command,
same-brand-integrity, billing-event, and refund-recovery assertions. It invokes
the production RPCs, asserts returned and persisted counts, and fails when
either elapsed-time budget is exceeded.

Capacitor preparation is intentionally fail-closed without a mobile API origin.
The compile-only profile uses `https://unconfigured.invalid`, which cannot route
to a provider, and verifies that both Android and iOS native shells can be
synchronized without activating services.

GitHub Actions run
[`30226397256`](https://github.com/theonlygeranium/vinifera/actions/runs/30226397256)
verified the pushed Phase 2 commit. The quality job completed in 5m15s, the
Android lint/debug/minified-release job completed in 3m39s, QA and native
artifacts uploaded, and the credential-gated Supabase migration and Worker
deployment jobs skipped as designed.
