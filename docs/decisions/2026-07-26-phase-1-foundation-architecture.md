# ADR: Phase 1 full-stack foundation

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera engineering

## Context

Vinifera began as three static HTML surfaces on Cloudflare Pages. Phase 1 requires a Vite/React application, a Node.js API, Supabase Auth and PostgreSQL with database-enforced tenant isolation, secure cookie sessions, and Stripe test-mode subscriptions.

The original build specification left two material ambiguities:

1. Supabase hosts PostgreSQL and Auth but does not host a conventional Express process.
2. A browser-only Supabase client normally persists tokens in browser storage, while the security gate requires JWTs in `httpOnly` cookies and simultaneous, isolated staff/member sessions.

Provider credentials and control-plane access may be connected after the code is built. Missing credentials must not produce insecure fallbacks or simulated production data.

## Decision

### Runtime and deployment

Use one Cloudflare Worker with the `nodejs_compat` flag:

- Cloudflare Workers Static Assets serves the existing marketing site, investor guide, and Vite output.
- Express 5 runs through Cloudflare's supported Node HTTP server adapter.
- `/api/*` is handled by Express.
- `/app/*` and `/portal/*` serve the same code-split React shell.
- `/` and `/guide/*` remain static and visually unchanged.
- An hourly Worker cron reconciles Stripe failure grace periods.

This satisfies the required Node/Express backend without adding a second hosting vendor. The current Cloudflare Pages deployment remains the public production baseline until the Worker staging build passes Phase 1's complete QA and activation gate.

### Authentication boundary

Use Express as a backend-for-frontend (BFF):

- Supabase access and refresh tokens are written only to secure, `httpOnly`, `SameSite=Lax` cookies.
- Staff and member sessions use different cookie names and different API surfaces, allowing both sessions to coexist without crossing authorization boundaries.
- Staff support email/password and Google OAuth.
- Members use magic links only.
- State-changing browser requests require an allowed `Origin`; CORS is credentialed and allowlisted.
- The service-role/secret Supabase key exists only in the Worker. It is never included in Vite variables or frontend bundles.

### Tenant authorization

PostgreSQL is the authorization source of truth:

- Every tenant-owned table contains and indexes `organization_id`; operational ledgers are inaccessible to browser roles.
- RLS is enabled and forced on every tenant table.
- Staff and members have separate policies and auth-surface claims.
- Members can read only their own member row.
- Platform super-admin access is modeled separately from winery staff roles.
- A custom access-token hook adds server-derived organization, role, platform-role, and auth-surface claims. Editable user metadata is never trusted for authorization.
- Server-only bootstrap, invite, rate-limit, webhook, and access-reconciliation functions revoke execution from `public`, `anon`, and `authenticated`.

### Billing

Use Stripe Billing with hosted Checkout Sessions and immutable recurring Price IDs:

- Vine: $149/month
- Cellar: $349/month
- Estate: $749/month
- Reserve baseline: $1,500/month

The API uses Stripe version `2026-02-25.clover`. Webhooks require the raw request body and a valid Stripe signature. Database functions apply events idempotently by unique Stripe event ID and reject older out-of-order state changes. Stripe's hosted Customer Portal handles self-service billing management.

Organization signup first commits the tenant, then provisions the
organization-scoped Stripe Customer when an authorized key is connected.
Disconnected deployments make no provider call and retain the same
idempotent, leased path for later Checkout provisioning. Ambiguous database or
provider results preserve the owner and tenant and expose a truthful
`ready`, `deferred`, or `reconciliation_required` state. The complete recovery
contract is recorded in
[the signup billing recovery ADR](./2026-07-26-signup-billing-recovery.md).

### Deferred provider activation

Provider integrations are real adapters, not production mocks:

- Configuration health reports only configured/missing variable names, never values.
- Missing provider wiring returns a typed `503 activation_required` response.
- CI applies Supabase migrations only after its management credentials are configured.
- Local and unit tests inject deterministic service doubles at the API boundary.
- No mock rows or fake dashboard metrics are emitted by production code.

## Consequences

### Positive

- One same-origin deployment simplifies secure cookies, CSP, and CORS.
- Tenant isolation remains enforceable even if an API handler is incorrect.
- Staff and member sessions are isolated without storing JWTs in browser storage.
- Provider credentials can be activated later without reworking frontend, API, database, or deployment contracts.
- The old visual prototype remains available in source as a reference but is not shipped as the authenticated production dashboard.

### Tradeoffs

- All dynamic requests pay the Worker invocation cost.
- Express on Workers requires Node compatibility and Cloudflare's Node HTTP adapter.
- Supabase Auth provider settings, SMTP, project hooks, and migration credentials still require control-plane activation.
- The public custom domain cannot be cut over from Pages until the Phase 1 live gate passes.

## Verification

- `npm audit --audit-level=moderate`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run build:worker`
- Supabase migration reset and pgTAP suite
- Playwright functional, axe-core, breakpoint, visual, performance, header, and session-isolation checks
- Live Stripe test Checkout and signed webhook replay after provider activation
