# Phase 1 QA report — Foundation

**Date:** 2026-07-26
**Candidate:** Phase 1 Worker foundation
**Gate status:** Local architecture and QA pass; hosted provider activation and exit criterion remain pending.

## Outcome

The production architecture is implemented and connection-ready without production mock data. The React applications, Express Worker, Supabase migration/RLS model, Stripe adapters, activation gates, CI/CD, and documentation pass the available local gate. The existing Pages custom domain remains the public baseline.

Phase 1 is not marked complete because the real hosted Supabase and Stripe test-mode exit checks require the deferred credentials and provider control-plane configuration listed below.

## Automated evidence

| Check | Result | Evidence |
|---|---:|---|
| Dependency audit | Pass | `npm audit` reports 0 vulnerabilities |
| TypeScript | Pass | `npm run typecheck` |
| API/unit integration | Pass | Vitest 10/10 |
| Browser QA | Pass | Playwright 21/21 |
| Worker packaging | Pass | Wrangler dry run |
| Pages rollback packaging | Pass | `CF_PAGES=1` preserves the original extensionless app |
| Initial JS | Pass | 62.25 KB gzip, budget < 200 KB |
| Accessibility | Pass | axe WCAG 2.1 AA, 0 violations |
| Responsive layout | Pass | 375, 768, 1440; no horizontal overflow |
| Mobile touch targets | Pass | 0 effective targets below 44×44 |
| Orientation | Pass | 375×812 to 812×375 |
| Performance | Pass locally | LCP < 2.5 s and CLS < 0.1 assertions |
| Security headers | Pass | CSP, HSTS, frame denial, nosniff, referrer and permissions policies |
| Browser credential storage | Pass | no local/session storage keys or server secrets |
| Database migration | Pass in embedded PostgreSQL | bootstrap, invite, limiter, Stripe transitions, reconciliation, cross-tenant RLS |
| pgTAP suites | Ready | 92 plan-balanced assertions; native Supabase run pending |
| Hosted activation controls | Pass in source | Staging target hashes fail closed; linked pgTAP and core Worker configuration are mandatory when activated |
| Production release/rollback control | Pass in source | First bootstrap has no route; custom-domain movement retains Pages and requires all Phase 1–5 capabilities |
| Read-only hosted readiness | Pass — [run 30217462802](https://github.com/theonlygeranium/vinifera/actions/runs/30217462802) | Supabase Auth and Stripe test API are reachable; Phase 1 tables, four Stripe Prices, webhook secret, staging-scoped credentials, and Workers-capable Cloudflare authority remain pending |
| Stripe test catalog control | Pass in source — 15/15 focused tests | Read-only account probe is executable; account fingerprint allowlist starts empty, so no Product/Price mutation is yet authorized |

## Functional gate

| Requirement | Status | Notes |
|---|---|---|
| Staff signup/login/logout/reset | Connection-ready | UI, API, cookies, callbacks, validation, and token refresh implemented; hosted email/Auth test pending |
| Google OAuth | Connection-ready | Supabase OAuth handoff implemented; provider configuration pending |
| Staff roles and Owner-only billing | Pass in architecture tests | DB role claims/RLS and server checks implemented; hosted role matrix pending |
| Staff invitation onboarding | Pass in embedded PostgreSQL | Atomic SHA-256 invite consumption; hosted email delivery pending |
| Member magic link | Connection-ready | privacy-safe request and isolated session implemented; hosted email delivery pending |
| Magic-link expiry | Configured | Supabase OTP expiry is 900 seconds; hosted setting verification pending |
| Magic-link rate limit | Pass in embedded PostgreSQL | atomic rolling 5/email/hour plus IP ceiling |
| Staff/member session isolation | Pass | distinct HTTP-only cookie names and API/browser checks |
| Stripe Checkout and portal | Connection-ready | hosted test Prices and portal configuration pending |
| Signed Stripe webhook | Pass at handler/database boundaries | real endpoint signing secret and replay pending |
| Seven/fourteen-day access lifecycle | Pass in embedded PostgreSQL | hourly Worker reconciliation configured |
| Cross-tenant RLS | Pass in embedded PostgreSQL | hosted two-organization verification pending |

## Accessibility and visual QA

- Login, signup, member login, staff dashboard, and member portal pass axe with zero WCAG 2.1 AA violations.
- All fields have programmatic labels; feedback uses `aria-live`; focus styles are visible.
- The 230 px sidebar, 54 px topbar, wine/gold palette, cards, spacing, and member gradient follow the accepted prototype.
- Phase 1 authenticated screens intentionally use empty states instead of the prototype's simulated metrics.
- In-app browser smoke testing confirmed page identity, meaningful DOM, no framework overlay, no relevant console errors, responsive stability, and password-toggle interaction.

## Security QA

- JWT access and refresh tokens are managed in separate staff/member HTTP-only, `SameSite=Lax`, secure production cookies.
- State-changing requests enforce an allowlisted or same-origin `Origin`; wildcard CORS is not used.
- Supabase server keys and Stripe secret keys are Worker-only and absent from frontend source and browser storage.
- RLS is enabled and forced on all seven tables. Browser roles receive only explicit `SELECT` grants and policy-filtered rows.
- Stripe webhooks retain the raw request body, verify the signature, reject live-mode events through Phase 4, and persist event IDs idempotently.
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
- [ ] Add four Stripe recurring test Price IDs.
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
npm run qa:e2e
```
