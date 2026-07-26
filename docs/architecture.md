# Architecture — Vinifera

**Last updated:** 2026-07-26
**Maintainer:** Any agent (must reflect actual deployment state)

## System overview

Vinifera is transitioning from a static Cloudflare Pages prototype to a
full-stack SaaS application. The Phase 1 foundation, Phase 2 core-club,
Phase 3 retention, and Phase 4 intelligence architecture use a same-origin
React application and Express API packaged in one
Cloudflare Worker. Supabase provides Auth and PostgreSQL; Stripe provides SaaS
subscriptions and club-shipment payments; EasyPost is the first shipping
adapter; Resend is the first transactional email adapter; ShipCompliant is the
credential-gated compliance provider.

```text
Browser
  │
  ▼
Cloudflare Worker + Static Assets
  ├── / and /guide/* ───────────── static marketing and guide
  ├── /app/* and /portal/* ────── React/Vite application shell
  └── /api/* ──────────────────── Express 5 BFF
                                      ├── Supabase Auth/PostgreSQL
                                      ├── Stripe Billing + PaymentIntents
                                      ├── EasyPost labels + tracking
                                      ├── Resend transactional delivery
                                      └── ShipCompliant legality + tax checks
```

The existing Pages custom-domain deployment remains the live baseline until the
new Worker staging deployment passes the complete Phase 1–4 activation and QA
gates.

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
| Temporary Pages rollback | `app` | `/app/` on Pages only | Original static prototype |

---

## Core club loop

```text
Club tier
  → member assignment
  → immutable release tier/wine snapshot
  → one shipment per eligible member
  → idempotent Stripe PaymentIntent attempt
      ├── charged → address verification → label → pack → ship → deliver
      └── declined → day 1/3/7 retry queue → charged
```

PostgreSQL owns every durable state transition. External provider calls are
orchestrated by the Worker, use stable idempotency keys, and converge through
signed webhooks and reconciliation rather than treating one HTTP request as a
distributed transaction.

Release-tier prices, bottle counts, and wines are snapshots. Later edits to a
club tier affect only future releases. Shipments also snapshot the member's
shipping address before money moves.

CSV migration uses a durable two-request workflow: upload/preview stages
tenant-owned rows under a short-lived, hashed token; commit consumes the token
exactly once. The Worker never relies on in-memory state between requests.

Audit entries are append-only and hash-chained per organization so deleted or
rewritten history is detectable.

---

## Retention and communications

```text
member/release/payment/shipment event
  → idempotent PostgreSQL email outbox
  → bounded Worker claim
  → sanitized responsive render
  → Resend batch send
  → signed raw-body webhook
  → delivery and engagement ledger

nightly schedule
  ├── explainable rules-based churn snapshots
  ├── birthday and anniversary loyalty awards
  ├── loyalty expiration
  └── due/retry email claims
```

Cancellation is an authenticated member state machine. Pause, tier downgrade,
shipment swap, and final cancellation write append-only attempt events; an
accepted alternative terminates the attempt exactly once. Loyalty awards use
stable source-event keys, positive expiring lots, first-expiring-first-out
redemption, and an explicit reservation/finalization boundary around Stripe
shipment charges and refunds.

---

## Analytics and growth intelligence

```text
tenant operational facts
  ├── daily analytics aggregates and cohorts ──> dashboard + CSV
  ├── immutable feature snapshots
  │     └── deterministic L2 logistic training
  │           ├── temporal 80/20 holdout + five expanding folds
  │           ├── candidate/shadow + 30-day A/B comparison
  │           └── nightly prediction or rules fallback
  ├── opted-in benchmark contributions
  │     └── coarsened k >= 10 aggregates ──> dashboard + quarterly report
  └── post-charge/pre-label shipment compliance check
        └── ShipCompliant OAuth adapter ──> exact compliant permits label
```

Analytics event payloads are allowlisted, size-bounded product metadata.
Direct identifiers such as email, address, phone, name, and provider secrets
are rejected. Dashboard layouts and schedules remain tenant- and staff-owned.

Model training stores immutable dataset and feature-contract provenance,
coefficients, standardization parameters, temporal metrics, calibration,
confusion matrix, and the rules baseline. Candidate registration never implies
promotion. PostgreSQL refuses production activation unless volume, provenance,
AUC, drift, and completed A/B-superiority gates all pass; the browser applies a
second defensive fallback.

Benchmark values are returned only after an opted-in cohort reaches ten
wineries. Region/member-band dimensions are progressively coarsened until the
threshold is satisfied; exact participant counts are exposed only as bands.

Shipment labels no longer rely on the Phase 2 whitelist when the Phase 4 path
is active. After a successful charge, every label attempt performs or reuses a
current provider decision immediately before label purchase. Only `compliant`
proceeds; `unknown`, `non_compliant`, incomplete, timed-out, or unconfigured
responses block fulfillment and persist an auditable hold.

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
| Stripe PaymentIntents | Release charges, retries, refunds | Shipment billing returns `503 activation_required` |
| EasyPost | Address verification, carrier rates, labels, tracking | Shipping returns `503 activation_required` |
| Resend | Transactional templates, batch delivery, events | Delivery returns `503 activation_required`; durable work remains queued |
| ShipCompliant | Post-charge/pre-label shipment legality, volume, and tax checks | Labels fail closed; dashboard reports `activation_required` until the contracted adapter configuration is complete |
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
- Phase 2 shipment billing requires Stripe test customers/payment methods for
  members and Phase 2 webhook event subscriptions.
- EasyPost requires a server-only test key and a complete per-winery origin
  address. The shipping simulator is accepted only in an explicitly enabled
  non-production test runtime.
- Resend requires a server-only API key, verified winery sender domain, signed
  webhook secret, and unsubscribe signing secret. The email simulator is
  rejected outside an explicitly enabled test runtime.
- Production ML promotion requires qualifying production history and a
  completed 30-day A/B result. Synthetic QA data is permanently ineligible.
- Peer results require Estate/Reserve entitlement, explicit opt-in, and a
  coarsened cohort of at least ten wineries.
- ShipCompliant requires vendor-approved OAuth credentials, versioned sandbox
  paths, account/license mapping, and verified provider responses. Missing or
  degraded configuration blocks labels.
- The Worker custom-domain cutover occurs only after the hosted Phase 1–4
  activation and regression gates pass.

See [the Phase 1 ADR](./decisions/2026-07-26-phase-1-foundation-architecture.md)
and [the Phase 2 ADR](./decisions/2026-07-26-phase-2-core-club-loop.md) for
rationale and tradeoffs. Retention-specific decisions are recorded in
[the Phase 3 ADR](./decisions/2026-07-26-phase-3-retention-communications.md).
Analytics, ML, benchmarking, and compliance decisions are recorded in
[the Phase 4 ADR](./decisions/2026-07-26-phase-4-analytics-intelligence.md).
