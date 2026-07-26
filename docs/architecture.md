# Architecture — Vinifera

**Last updated:** 2026-07-26
**Maintainer:** Any agent (must reflect actual deployment state)

## System overview

Vinifera is transitioning from a static Cloudflare Pages prototype to a full-stack SaaS application. The Phase 1 architecture is implemented as a same-origin React application and Express API packaged in one Cloudflare Worker. Supabase provides Auth and PostgreSQL; Stripe provides subscription billing.

```text
Browser
  │
  ▼
Cloudflare Worker + Static Assets
  ├── / and /guide/* ───────────── static marketing and guide
  ├── /app/* and /portal/* ────── React/Vite application shell
  └── /api/* ──────────────────── Express 5 BFF
                                      ├── Supabase Auth/PostgreSQL
                                      └── Stripe Billing
```

The existing Pages custom-domain deployment remains the live baseline until the new Worker staging deployment passes the complete Phase 1 activation and QA gate.

Cloudflare Pages injects `CF_PAGES=1`. In that environment the build also copies
the original extensionless `app` prototype, so the Git-integrated Pages project
continues serving the verified rollback surface. Worker builds omit that file
and route `/app/*` to the React shell.

### Pages

| Surface | Source | Route | Runtime |
|---|---|---|---|
| Marketing | `index.html` | `/` | Static asset |
| Staff application | `src/client/staff/` | `/app/*` | Lazy React chunk |
| Member portal | `src/client/member/` | `/portal/*` | Lazy React chunk |
| Investor guide | `guide` | `/guide/*` | Static asset |
| API | `server/` | `/api/*` | Express on Worker |
| Visual reference only | `app` | not deployed | Original static prototype |

---

## Build and deployment pipeline

```text
web/app.html + src/client/* ── Vite ───────────┐
index.html + guide + public/* ─ build.mjs ─────┼── dist/
server/worker.ts + server/* ── Wrangler ───────┴── Worker version
supabase/migrations/* ──────── Supabase CLI ───── hosted PostgreSQL
```

GitHub-hosted CI installs the lockfile, audits dependencies, type-checks, runs tests, builds assets, validates the Worker bundle, and runs Playwright QA. On `main`, it conditionally applies Supabase migrations when management credentials are present, then deploys the staging Worker and uploads available runtime secrets.

---

## Security boundaries

- Staff and member Supabase sessions use different secure, `httpOnly` cookies.
- The browser calls only the same-origin Express API; JWTs and secret keys never enter local storage.
- All state-changing browser requests require an allowlisted `Origin`.
- Worker secrets contain Supabase and Stripe server credentials.
- RLS is enabled and forced on all tenant tables.
- Custom JWT claims are derived by a database auth hook, not editable user metadata.
- Stripe webhooks use raw bodies, signature verification, unique event IDs, and out-of-order event protection.
- Missing provider credentials fail closed with `activation_required`.

---

## Security headers

The Worker applies security headers to every response. `public/_headers` remains only for the static Pages rollback baseline.

| Header | Value |
|--------|-------|
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | 0 (legacy browser filter disabled by Helmet) |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=() |
| Content-Security-Policy | Restrictive allowlist; framing denied |
| Strict-Transport-Security | One year, including subdomains |
| Cross-Origin-Opener-Policy | Same origin |

The Worker serves `/app/*` and `/portal/*` from the Vite shell with `text/html; charset=utf-8`; the guide retains its extensionless static content-type rule.

---

## Provider adapters

| Provider | Purpose | Missing-wiring behavior |
|---|---|---|
| Supabase | Auth, PostgreSQL, RLS | Auth/data operations return `503 activation_required` |
| Stripe | SaaS subscriptions and portal | Billing operations return `503 activation_required` |
| Google via Supabase | Staff OAuth | OAuth route remains disabled until configured |
| SMTP via Supabase | Invite/reset/magic-link delivery | Delivery QA remains pending |

---

## Animations

The landing page hero includes four animations:

| Animation | Type | Duration | Reduced-Motion |
|-----------|------|----------|----------------|
| Vine line drawing | CSS `stroke-dashoffset` | 2.5s one-time | `animation: none` |
| Gold glow pulse | CSS `opacity` on `::before` | 6s alternate | `animation: none` |
| Grape cluster sway | SVG `<animateTransform additive="sum">` | 7/8/9s | `display: none !important` |
| CTA shimmer sweep | CSS `::after` `translateX` | 4s | `display: none` |

All animations are disabled under `@media (prefers-reduced-motion: reduce)`.

---

## Current activation gates

- Supabase migration management requires `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_PASSWORD`.
- Supabase Google OAuth and outbound Auth email require dashboard/provider configuration.
- Stripe requires four recurring test Price IDs and a webhook signing secret.
- The Worker custom-domain cutover occurs only after live Phase 1 exit verification.

See [the Phase 1 ADR](./decisions/2026-07-26-phase-1-foundation-architecture.md) for rationale and tradeoffs.
