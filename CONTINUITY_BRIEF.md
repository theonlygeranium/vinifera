# Vinifera — Agent Continuity Brief

**Last updated:** 2026-07-26
**Purpose:** Current handoff for any engineer or agent continuing the production build.

## Project identity

- Owner: EdStratum Labs
- Repository: `https://github.com/theonlygeranium/vinifera`
- Default branch: `main`
- Public domain: `https://vinifera.edstratumlabs.ai`
- Build specifications: `docs/build-specs/`

Read `AGENTS.md`, the phase specification, and this brief before editing.

## Current production state

The public custom domain still serves the verified static Cloudflare Pages
prototype. A 2026-07-26 probe returned static HTML from `/api/health` rather
than the Worker JSON health contract, so the production application has not
replaced that baseline. The repository now contains the Phase 1–4
connection-ready architecture:

- React 19 + Tailwind/Vite staff and member applications
- Express 5 API in a Cloudflare Worker with Static Assets
- Supabase Auth/PostgreSQL migration with forced tenant RLS
- Stripe test-mode subscription and webhook adapters
- Tenant-owned tiers, member CRM, release snapshots, shipments, recovery, fulfillment, and durable CSV import
- Stripe test-mode shipment PaymentIntents, retries, refunds, and an hourly resumable release runner
- EasyPost address/label adapter with fail-closed activation and a test-only deterministic simulator
- Durable Resend email outbox, six lifecycle triggers, signed delivery webhooks, and unsubscribe handling
- Explainable nightly churn snapshots, a configurable four-step cancellation flow, and a FIFO loyalty ledger
- Operational-fact analytics, saved dashboard layouts, CSV exports, and
  scheduled summary reports
- A guarded L2 logistic training, scoring, A/B, drift, promotion, and
  rules-fallback lifecycle that cannot activate from synthetic evidence
- Estate/Reserve benchmark consent, k-anonymous aggregate publication, and
  quarterly report generation
- A ShipCompliant provider adapter, audit ledger, post-charge/pre-label guard,
  compliance-input fingerprints, and durable EasyPost label recovery
- GitHub-hosted CI, conditional migrations, Worker staging deployment, and Playwright/axe QA

The Worker is connection-ready but must not replace the Pages custom-domain
baseline until the hosted Supabase, Stripe, EasyPost, Resend, and Phase 4
activation checks in the phase QA reports pass.

## Runtime architecture

| Route | Implementation |
|---|---|
| `/`, `/guide/*` | Existing static marketing and guide assets |
| `/app/*` | React staff application |
| `/portal/*` | React member portal |
| `/api/*` | Express backend-for-frontend |
| hourly cron | access reconciliation, releases/retries, email claims, churn, loyalty, analytics reports, and guarded Phase 4 schedules |

Staff and member JWTs live only in distinct secure HTTP-only cookies. Provider secrets exist only in the Worker. Production dashboards contain no mock rows.

## Source map

```text
web/                    Vite entry
src/client/             React application
server/                 Express API, provider adapters, Worker entry
supabase/migrations/    PostgreSQL source of truth
supabase/tests/         pgTAP schema, RLS, and RPC suites
tests/server/           API integration tests
tests/e2e/              Playwright/axe browser QA
docs/decisions/         Architecture decisions
docs/build-specs/       Sequential phase specifications and QA reports
wrangler.jsonc          Worker/static assets/cron configuration
```

The extensionless root `app` file is the accepted visual prototype. It is
copied only when Cloudflare Pages injects `CF_PAGES=1`, preserving the public
rollback baseline; Worker builds omit it and serve React at `/app/*`.

## Verified local evidence

- `npm audit`: zero known dependency vulnerabilities
- TypeScript: pass
- Vitest: 71/71 pass across five files
- Focused Phase 4 Vitest: 25/25 pass across browser normalizers and services
- Phase 1 Playwright: 21/21 pass
- Phase 2 Playwright: 34 route, workflow, responsive, and performance checks
- Phase 3 Playwright: 21 retention, communications, loyalty, and responsive checks
- Complete Phase 1–4 Playwright regression: 94/94
- axe WCAG 2.1 AA: zero violations across every Phase 1–4 application surface
- Phase 4 Playwright: 18/18 across Analytics, AI Churn Watch, Peer
  Benchmarks, and Compliance at 375, 768, and 1440px
- Phase 4 axe WCAG 2.1 AA: zero violations in the deterministic browser matrix
- Phase 4 keyboard-only analytics workflow: pass
- Five-chart response-to-visible timing: 24.80ms in the full two-worker
  CI-equivalent run
- Breakpoints: 375, 768, and 1440 pass; orientation change passes
- Phase 4 production build: pass
- Worker dry-run: pass, 3,051.30 KiB upload / 646.87 KiB gzip
- Embedded PostgreSQL functional preflight: pass
- Phase 2 embedded PostgreSQL: 145/145 plan-balanced schema, RLS, and RPC assertions
- Phase 3 embedded PostgreSQL: migration, forced-RLS, retention RPC, and performance gates pass
- Phase 4 embedded PostgreSQL: schema 46/46, tenant RLS 25/25, and functional
  analytics/ML/compliance 50/50 pass for 121/121 total assertions
- Phase 4 embedded performance: 10,000-member scoring completes in 13,668.44ms
  against the 300,000ms ceiling; the 365-day dashboard completes in 53.01ms
  against the 2,000ms ceiling

The Phase 4 local architecture release gate passes. Hosted Supabase native
pgcrypto/pgTAP, real-data reconciliation, model accuracy/A/B, peer-cohort, and
ShipCompliant verification remain required before the hosted operational exit
criterion can pass.

## Activation gates

The code must remain fail-closed until these external connections are active:

1. Add Supabase management credentials and apply `supabase/migrations/`.
2. Give the Cloudflare token Workers Scripts edit permission and set `CLOUDFLARE_WORKERS_DEPLOY_ENABLED=true`.
3. Enable the custom access-token hook, 900-second email OTP expiry, Google OAuth, and SMTP.
4. Add Stripe recurring test Price IDs, register `/api/billing/webhook`, and add its signing secret.
5. Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled.
6. Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof.
7. Run the complete hosted two-tenant RLS, staff, member magic-link, Checkout, webhook, grace-period, and suspension tests.
8. Verify a Resend sending domain, signed webhook, and at least two real staging triggers.
9. Apply the Phase 4 migration to hosted Supabase and run native tenant/RPC
   tests.
10. Connect a winery with real Phase 2/3 operations and verify every analytics
    metric and CSV export against source records.
11. Accumulate at least 500 labeled members and 50 cancellations, train on
    production history, meet held-out AUC-ROC 0.82 without underperforming
    rules, and complete the superior 30-day A/B gate before promotion.
12. Opt an Estate/Reserve winery into a peer cohort with at least ten
    contributors and verify the quarterly report delivery.
13. Obtain vendor-approved ShipCompliant sandbox access, set the server-only
    credential and contract bindings, and prove compliant, non-compliant,
    unknown, timeout, tax, fingerprint invalidation, and label recovery cases.
14. Move the custom domain only after every hosted exit criterion is evidenced.

See `.env.example` and `docs/setup.md` for exact variable names. Never print or commit values.

## Build and QA

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:e2e
```

The human supervisor explicitly authorized credential-gated integrations to remain connection-ready while architecture work continues. Keep every deferred provider fail-closed and do not describe a hosted exit criterion as passed without redacted runtime evidence.
