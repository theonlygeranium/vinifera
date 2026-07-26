# Phase 3 QA report — Retention and communications

**Date:** 2026-07-26
**Candidate:** Phase 3 production architecture
**Gate status:** Architecture/local QA pass; hosted email and real-tenant exit
proof are deferred pending provider activation.

## Outcome

Phase 3 is implemented end to end behind explicit activation gates. Supabase
owns durable email work, explainable rules scores, cancellation attempts, and
the loyalty ledger. The Worker owns authenticated orchestration and the Resend
adapter. The browser consumes only same-origin APIs and never receives provider
credentials.

This report deliberately separates deterministic architecture evidence from
hosted provider evidence. Resend simulation proves orchestration but does not
prove DNS reputation, provider delivery, or a live webhook.

## Automated evidence

| Check | Result | Evidence |
|---|---:|---|
| Dependency audit | Pass | zero known vulnerabilities |
| TypeScript | Pass | `npm run typecheck` |
| API/unit integration | Pass | Vitest 42/42 |
| Browser QA | Pass | Phase 3 21/21; complete Phase 1–3 regression 76/76 |
| Worker packaging | Pass | Wrangler dry run |
| Database migration | Pass locally; hosted pending | fresh embedded database applies Phases 1–3 |
| Database assertions | Pass locally; hosted pending | 45 schema + 39 forced RLS + 54 RPC/invariant assertions; 138/138 |
| Accessibility | Pass | axe WCAG 2.1 AA, zero violations |
| Responsive layout | Pass | 375, 768, and 1440 pixels |
| Performance | Pass locally | 1,000-member scoring, 100-email claim, cancel modal, LCP, and CLS budgets |
| Security | Pass locally | forced RLS, signed raw webhooks, signed unsubscribe, sanitizer, role gates |

## Functional gate

| Requirement | Local architecture | Hosted evidence |
|---|---:|---:|
| Welcome trigger is enqueued exactly once | Pass | Pending Resend |
| Pre-shipment trigger honors configured lead days | Pass | Pending Resend |
| Decline trigger is connected to failed charges | Pass | Pending Stripe/Resend |
| Shipped trigger includes tracking | Pass | Pending EasyPost/Resend |
| Birthday trigger uses member birthday | Pass | Pending Resend |
| Re-engagement trigger uses 60-day inactivity | Pass | Pending Resend |
| Edit, preview, test, and log templates | Pass | Pending Resend |
| Signed unsubscribe updates preference once | Pass | Pending hosted URL |
| Nightly scoring assigns every member a bounded score | Pass | Pending hosted data |
| Risk queue sorts high to low and explains factors | Pass | Pending hosted data |
| Pause offer interrupts cancellation | Pass | Pending hosted member |
| Downgrade offer changes the member tier | Pass | Pending hosted member |
| Swap offer changes an unpacked shipment item | Pass | Pending hosted shipment |
| Final step cancels exactly once | Pass | Pending hosted member |
| Staff can configure/reorder steps and view analytics | Pass | Pending hosted data |
| Shipment, referral, event, birthday, and anniversary awards | Pass | Pending hosted data |
| FIFO expiration and redemption | Pass | Pending hosted shipment |
| Redemption adjusts charge and refund convergence | Pass | Pending Stripe |
| Staff adjustment is reasoned and audit logged | Pass | Pending hosted staff |
| Vine/Cellar/Estate multipliers are 1/1.25/1.5 | Pass | Pending hosted tiers |
| Member portal shows balance and full ledger | Pass | Pending hosted member |

## Accessibility, visual, and mobile gate

- [x] Zero axe-core WCAG 2.1 AA violations on every Phase 3 route.
- [x] Template editor and cancel dialog are keyboard accessible.
- [x] Cancel dialog traps focus, closes on Escape, and restores its trigger.
- [x] Loyalty tables use captions and scoped column headings.
- [x] Risk indicators include text and do not rely on color.
- [x] Communications, churn, retention, loyalty, and member portal render at
      375, 768, and 1440 pixels.
- [x] No horizontal page overflow at 375 pixels.
- [x] Effective interactive touch targets are at least 44 by 44 pixels.
- [x] Visual evidence is saved in `docs/qa/phase-3/`.

## Performance gate

- [x] Nightly scoring completes in 170.07 ms for 1,000 embedded members,
      below the 60-second budget.
- [x] A 100-message outbox claim completes in 7.99 ms, below the 10-second
      batch budget.
- [x] The cancellation modal opens in under 500 milliseconds locally.
- [x] LCP remains below 2.5 seconds on all Phase 3 pages.
- [x] CLS remains below 0.1.

Provider network latency and deliverability must be measured separately after
Resend activation.

## Security gate

- [x] Resend and signing secrets exist only in server-side environment bindings.
- [x] Production cannot enable the deterministic email simulator.
- [x] Template rendering strips executable HTML and escapes interpolation data.
- [x] Resend webhooks verify Svix headers against the unmodified raw body.
- [x] Webhook event IDs are replay protected.
- [x] Unsubscribe tokens are purpose-bound, signed, expiring, and stored hashed.
- [x] Cancellation requires an authenticated member principal.
- [x] Loyalty adjustments require staff authorization, a reason, and audit log.
- [x] Scheduled jobs and final redemption convergence are service-role only.
- [x] Phase 3 tenant tables enable and force row-level security.

## Exit criterion evidence

- [ ] Hosted Phase 1–3 migrations are applied.
- [ ] A staging Worker is connected to the intended Supabase project.
- [ ] A verified Resend sending domain and signed webhook are active.
- [ ] At least welcome and pre-shipment fire on real staging events.
- [ ] Nightly scoring assigns and displays scores for every hosted test member.
- [ ] A hosted member exercises pause or cancellation end to end.
- [ ] A delivered shipment produces a loyalty award.
- [ ] A hosted redemption reduces a Stripe test-mode shipment charge.
- [ ] **Email, retention, and loyalty behavior is evidenced with redacted hosted
      provider and database records.**

These items are intentionally deferred rather than simulated in production.
The architecture can advance under the supervisor's credential-later
instruction, but the hosted exit criterion is not claimed as passed.

## Activation checklist

- [ ] Add Supabase management credentials and apply migrations.
- [ ] Deploy the Worker with a Workers Scripts-capable Cloudflare token.
- [ ] Verify a winery sending domain with Resend DKIM and SPF.
- [ ] Add `RESEND_API_KEY`, sender, webhook, and unsubscribe secrets.
- [ ] Run `docs/runbooks/phase-3-resend-activation.md`.
- [ ] Save redacted provider IDs, webhook events, and hosted database evidence.

## Commands

```bash
npm audit --omit=dev --audit-level=moderate
npm run typecheck
npm test
npm run qa:db:phase2
npm run qa:db:phase3
npm run build
npm run build:worker
npm run qa:e2e
npx supabase db reset
npx supabase test db
```

The embedded verifier uses the production migrations and RPCs and is now a
locked development dependency, so the same architecture gate runs locally and
in GitHub CI. Hosted Supabase still owns native pgcrypto and pgTAP confirmation.
