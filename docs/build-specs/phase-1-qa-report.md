# Phase 1 QA report — Foundation

**Date:** 2026-07-26
**Candidate:** Phase 1 Worker foundation
**Gate status:** Local architecture and QA pass; hosted provider activation and exit criterion remain pending.

## Outcome

The production architecture is implemented and connection-ready without
production mock data. The React applications, Express Worker, Supabase
migration/RLS model, retry-safe Stripe runtime, activation gates, CI/CD, and
documentation pass the complete local architecture gate. Services remain
intentionally disconnected, and the existing Pages custom domain remains the
public baseline.

Phase 1 is not marked complete because the real hosted Supabase and Stripe test-mode exit checks require the deferred credentials and provider control-plane configuration listed below.

## Automated evidence

| Check | Result | Evidence |
|---|---:|---|
| Dependency audit | Pass | `npm audit` reports 0 vulnerabilities |
| TypeScript | Pass | `npm run typecheck` |
| API/unit integration | Pass | Current full Vitest regression 256/256 |
| Browser QA | Pass | Current full Playwright regression 132/132; Phase 1 focused suite 30/30 |
| Worker packaging | Pass | Wrangler dry run |
| Pages rollback packaging | Pass | `CF_PAGES=1` preserves the original extensionless app |
| Initial JS | Pass | 66.78 KB gzip app entry, budget < 200 KB |
| Accessibility | Pass | axe WCAG 2.1 AA, 0 violations |
| Responsive layout | Pass | 375, 768, 1440; no horizontal overflow; six login/signup captures retained by CI for 90 days |
| Mobile touch targets | Pass | 0 effective targets below 44×44 |
| Orientation | Pass | 375×812 to 812×375 |
| Performance | Pass locally | LCP < 2.5 s and CLS < 0.1 assertions |
| Security headers | Pass | CSP, HSTS, frame denial, nosniff, referrer and permissions policies |
| Browser credential storage | Pass | no local/session storage keys or server secrets |
| Phase 1 database gate | Pass in embedded PostgreSQL | migrations plus suites 001–003 at 92/92; bootstrap, invite, limiter, webhook state, and cross-tenant RLS |
| Database migration | Pass in embedded PostgreSQL | migrations 001–012; Stripe subject locks, webhook-wait reconciliation, and later-phase schema remain green |
| pgTAP suites | Pass locally | Current Phase 5 migration/pgTAP gate 279/279 across suites 013–022; native hosted Supabase run pending |
| Hosted activation controls | Pass in source | Staging target hashes fail closed; linked pgTAP and core Worker configuration are mandatory when activated |
| Production release/rollback control | Pass in source | First bootstrap has no route; custom-domain movement retains Pages and requires all Phase 1–5 capabilities |
| Read-only hosted readiness | Pass — [run 30217462802](https://github.com/theonlygeranium/vinifera/actions/runs/30217462802) | Supabase Auth and Stripe test API are reachable; Phase 1 tables, four Stripe Prices, webhook secret, staging-scoped credentials, and Workers-capable Cloudflare authority remain pending |
| Stripe test catalog control | Probe pass — [run 30218422165](https://github.com/theonlygeranium/vinifera/actions/runs/30218422165); 16/16 focused tests | Sanitized evidence confirmed a test-mode generic credential and no probe write; protected bootstrap run [30218801133](https://github.com/theonlygeranium/vinifera/actions/runs/30218801133) left the first test Price created-or-unknown, then failed closed because the response did not expand its Product. The controller now requests Product expansion. Connections are deferred, so no retry was attempted |
| Release controls | Pass locally | Production release 14/14; live Stripe remains independently default-deny |

## Functional gate

| Requirement | Status | Notes |
|---|---|---|
| Staff signup/login/logout/reset | Connection-ready | UI, API, cookies, callbacks, validation, session-backed reset completion, retry-safe tenant bootstrap, and token refresh implemented; hosted email/Auth test pending |
| Google OAuth | Connection-ready | Supabase OAuth handoff implemented; provider configuration pending |
| Staff roles and Owner-only billing | Pass in architecture tests | DB role claims/RLS and server checks implemented; hosted role matrix pending |
| Staff invitation onboarding | Pass locally | Owner/admin Team UI, role-aware API, session-backed acceptance, atomic SHA-256 invite consumption, mobile/keyboard/axe checks; hosted email delivery pending |
| Member magic link | Connection-ready | privacy-safe request and isolated session implemented; hosted email delivery pending |
| Magic-link expiry | Configured | Supabase OTP expiry is 900 seconds; hosted setting verification pending |
| Magic-link rate limit | Pass in embedded PostgreSQL | atomic rolling 5/email/hour plus IP ceiling |
| Staff/member session isolation | Pass | distinct HTTP-only cookie names and API/browser checks |
| Stripe organization Customer | Connection-ready | Signup creates or reuses the Customer when an authorized key exists; disconnected, ready, and uncertain states are explicit; hosted test Customer pending |
| Stripe Checkout and portal | Connection-ready | deferred organizations reuse the same Customer claim at Checkout; hosted test Prices and portal configuration pending |
| Concurrent/retried billing | Pass in local architecture | customer provisioning locks, immutable billing subjects, stable idempotency keys, one nonterminal Checkout, and `awaiting_webhook` reconciliation prevent duplicate sessions/subscriptions |
| Signed Stripe webhook | Pass at handler/database boundaries | real endpoint signing secret and replay pending |
| Seven/fourteen-day access lifecycle | Pass in embedded PostgreSQL | hourly Worker reconciliation configured |
| Cross-tenant RLS | Pass in embedded PostgreSQL | hosted two-organization verification pending |

## Accessibility and visual QA

- Login, signup, member login, staff dashboard, and member portal pass axe with zero WCAG 2.1 AA violations.
- Owner/admin Team invitation and manager/staff denial states pass axe with zero
  violations at 375 px.
- All fields have programmatic labels; feedback uses `aria-live`; focus styles are visible.
- Explicit keyboard coverage verifies logical email → password → reveal-button
  Tab order and both Space and Enter activation.
- The 230 px sidebar, 54 px topbar, wine/gold palette, cards, spacing, and member gradient follow the accepted prototype.
- Phase 1 authenticated screens intentionally use empty states instead of the prototype's simulated metrics.
- In-app browser smoke testing confirmed page identity, meaningful DOM, no framework overlay, no relevant console errors, responsive stability, and password-toggle interaction.
- Playwright writes staff login and signup screenshots at 375, 768, and 1440
  into the CI evidence artifact; the workflow retains that artifact for 90
  days.

## Security QA

- JWT access and refresh tokens are managed in separate staff/member HTTP-only, `SameSite=Lax`, secure production cookies.
- State-changing requests enforce an allowlisted or same-origin `Origin`; wildcard CORS is not used.
- Supabase server keys and Stripe secret keys are Worker-only and absent from frontend source and browser storage.
- RLS is enabled and forced on all seven tables. Browser roles receive only explicit `SELECT` grants and policy-filtered rows.
- Stripe webhooks retain the raw request body, verify the signature, reject live-mode events through Phase 4, and persist event IDs idempotently.
- Live Stripe is independent from Worker deployment and remains disabled by
  checked-in policy, empty reviewed target hashes, and separate production
  authority.
- Missing providers return typed `activation_required` errors. Session probes fail closed as unauthenticated.

## Deferred activation checklist

- [ ] Add staging-scoped `STAGING_SUPABASE_ACCESS_TOKEN`,
      `STAGING_SUPABASE_PROJECT_ID`, and `STAGING_SUPABASE_DB_PASSWORD`.
- [ ] Review and commit the exact staging Supabase and Cloudflare target hashes.
- [ ] Replace or expand the staging Cloudflare token with Workers Scripts edit
      permission, then set `STAGING_CLOUDFLARE_DEPLOY_ENABLED=true`.
- [ ] Apply the migration to the hosted Supabase project and run
      `supabase test db --linked`.
- [ ] Enable the custom access-token hook, Google OAuth, SMTP, production redirect URLs, and 900-second OTP expiry.
- [ ] Bootstrap, verify, and bind the four Stripe recurring test Price IDs
      only after service activation is resumed. First reconcile the
      created-or-unknown Price from run `30218801133`; do not blind retry.
- [ ] Register the Worker webhook endpoint and add `STRIPE_WEBHOOK_SECRET`.
- [ ] Create two real test organizations and verify hosted cross-tenant RLS.
- [ ] Complete staff signup/login/reset/OAuth/invite and member magic-link flows.
- [ ] Complete Stripe Checkout, signed webhook replay, payment failure, day-8 restriction, and day-15 suspension.
- [ ] Verify the deployed Worker at 375, 768, and 1440 and confirm HTTPS/security headers.
- [ ] Cut over the custom domain only after every item above passes.

Follow [Phase 1 hosted activation](../runbooks/phase-1-hosted-activation.md)
and the cross-phase
[hosted environment runbook](../runbooks/hosted-environment-provisioning.md).
The checked-in empty target arrays make this checklist connection-ready but
non-operational until independently resolved resources are approved.

## Commands

```bash
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run build:worker:production
npm run qa:production-release
npm run qa:stripe-catalog
npm run qa:db:phase1
npm run qa:e2e
```
