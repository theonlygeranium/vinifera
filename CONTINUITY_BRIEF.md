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

The public custom domain still serves the verified static Cloudflare Pages prototype. The repository now contains the Phase 1 foundation and Phase 2 core-club production architecture:

- React 19 + Tailwind/Vite staff and member applications
- Express 5 API in a Cloudflare Worker with Static Assets
- Supabase Auth/PostgreSQL migration with forced tenant RLS
- Stripe test-mode subscription and webhook adapters
- Tenant-owned tiers, member CRM, release snapshots, shipments, recovery, fulfillment, and durable CSV import
- Stripe test-mode shipment PaymentIntents, retries, refunds, and an hourly resumable release runner
- EasyPost address/label adapter with fail-closed activation and a test-only deterministic simulator
- GitHub-hosted CI, conditional migrations, Worker staging deployment, and Playwright/axe QA

The Worker is connection-ready but must not replace the Pages custom-domain baseline until the hosted Supabase, Stripe, and EasyPost activation checks in the Phase 1 and Phase 2 QA reports pass.

## Runtime architecture

| Route | Implementation |
|---|---|
| `/`, `/guide/*` | Existing static marketing and guide assets |
| `/app/*` | React staff application |
| `/portal/*` | React member portal |
| `/api/*` | Express backend-for-frontend |
| hourly cron | Stripe access-state reconciliation, due releases, and decline retries |

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
- Vitest: 25/25 pass
- Phase 1 Playwright: 21/21 pass
- Phase 2 Playwright: 34 route, workflow, responsive, and performance checks
- axe WCAG 2.1 AA: zero violations across every Phase 1 and Phase 2 application surface
- Breakpoints: 375, 768, and 1440 pass; orientation change passes
- Initial application JavaScript: 62.25 KB gzip
- Worker dry-run bundle: pass
- Embedded PostgreSQL functional preflight: pass
- Phase 2 embedded PostgreSQL: 145/145 plan-balanced schema, RLS, and RPC assertions

## Activation gates

The code must remain fail-closed until these external connections are active:

1. Add Supabase management credentials and apply `supabase/migrations/`.
2. Give the Cloudflare token Workers Scripts edit permission and set `CLOUDFLARE_WORKERS_DEPLOY_ENABLED=true`.
3. Enable the custom access-token hook, 900-second email OTP expiry, Google OAuth, and SMTP.
4. Add Stripe recurring test Price IDs, register `/api/billing/webhook`, and add its signing secret.
5. Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled.
6. Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof.
7. Run the complete hosted two-tenant RLS, staff, member magic-link, Checkout, webhook, grace-period, and suspension tests.
8. Move the custom domain only after the hosted exit criteria are evidenced.

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
npm run qa:e2e
```

The human supervisor explicitly authorized credential-gated integrations to remain connection-ready while architecture work continues. Keep every deferred provider fail-closed and do not describe a hosted exit criterion as passed without redacted runtime evidence.
