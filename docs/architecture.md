# Architecture — Vinifera

**Last updated:** 2026-07-26
**Maintainer:** Any agent (must reflect actual deployment state)

## System overview

Vinifera 0.5.0 contains the complete Phase 1–5 source architecture for a
full-stack SaaS application. A same-origin React application and Express API are
packaged in one Cloudflare Worker. Supabase provides Auth and PostgreSQL; Stripe
provides SaaS subscriptions and club-shipment payments; EasyPost handles
shipping; Resend handles transactional email; ShipCompliant is the
alcohol-shipping compliance authority; Klaviyo, QuickBooks, Avalara, and Meta
run through a common connector boundary; and Capacitor packages the React source
for iOS and Android.

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
                                      ├── ShipCompliant legality checks
                                      ├── Klaviyo / QuickBooks / Avalara / Meta
                                      └── Cloudflare custom hostnames + mobile push
```

The existing Pages custom-domain deployment remains the live baseline until the
new Worker application passes the complete Phase 1–5 hosted activation and QA
gates.

Credential availability is not deployment authorization. Staging and
production mutations require protected GitHub environments plus hashed target
allowlists; empty target arrays fail before a provider mutation.

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
| Mobile associations | `server/services/integrations.ts` | `/.well-known/*` | Express on Worker |
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

## Scale, integrations, brands, and native mobile

```text
organization
  ├── brands ──> brand grants / member binding / shared-or-independent billing
  ├── integration connections
  │     ├── encrypted credential envelope + explicit consent
  │     ├── leased idempotent job + attempt/reconciliation log
  │     └── Klaviyo / QuickBooks / Avalara / Meta server adapter
  ├── custom hostnames ──> ownership + certificate gate ──> brand context
  └── mobile devices ──> revocable token family + encrypted push token
```

Existing organizations receive one default brand and additive brand backfills.
Forced RLS constrains brand-scoped tables, while service-role application
queries independently validate staff grants, owner/admin all-brand privileges,
and member brand binding. A client-provided brand ID is a scope request, never
authorization.

Integration connections use explicit `activation_required`, `configured`,
`active`, or `degraded` states. Winery-specific Klaviyo, Avalara, and Meta
credentials are stored as versioned AES-256-GCM database envelopes whose
wrapping key remains a Worker secret. QuickBooks application OAuth credentials
are Worker configuration; each winery's access and rolling refresh tokens are
encrypted per connection. Jobs are leased, idempotent, bounded, retryable, and
reconcilable. Logs contain sanitized correlation/provider identifiers rather
than credentials or raw customer payloads.

Avalara calculates tax before Stripe confirmation and fails a connected charge
closed. A successful charge commits the matching tax transaction;
ShipCompliant remains the independent alcohol-shipping authority before label
purchase. Meta identifiers are normalized and SHA-256 hashed before the
transport object is constructed, and marketing consent is checked again
immediately before disclosure.

White-label routing trusts only a hostname whose Cloudflare ownership and
certificate states are active. Unknown or pending hosts use the canonical,
unbranded portal and never select tenant context. Theme colors are validated
against WCAG normal-text contrast.

Capacitor wraps the built React application rather than creating a second UI.
The native boundary adds Keychain/Keystore-backed session and offline storage,
biometric/device-credential relock, APNs/FCM push, barcode scanning, network
recovery, and allowlisted deep links. Mobile refresh tokens rotate and remain
server-revocable. The app may require a signed store update but never downloads
or executes replacement application code.

---

## Build and deployment pipeline

```text
web/app.html + src/client/* ── Vite ───────────┐
index.html + guide + public/* ─ build.mjs ─────┼── dist/
server/worker.ts + server/* ── Wrangler ───────┴── Worker version
supabase/migrations/* ──────── Supabase CLI ───── hosted PostgreSQL
dist/ + capacitor.config.json ─ Capacitor ──────── iOS / Android projects
```

GitHub-hosted CI uses Node 22.22.0 to install the lockfile, audit dependencies,
type-check, run service/browser tests and Phase 2–5 database gates, build assets,
and validate the Worker bundle. A separate Java 21/API 36 job synchronizes,
lints, and assembles Android debug and R8-minified release shells. On `main`,
CI conditionally applies migrations with pinned Supabase CLI 2.109.1, then runs
the linked native pgTAP/RLS suite. Optional deployment targets the isolated
`vinifera-staging` Worker, attaches available secrets atomically to that
version, and verifies its `workers.dev` health plus core configuration report.
It does not move the production custom domain.

Manual protected workflows add three non-overlapping control planes:

```text
read-only readiness ──> credential/permission/table classifications only
production release ──> Worker bootstrap/version/deploy/domain/Pages restore
mobile release ──────> immutable signed AAB/IPA ──> optional internal tracks
```

Stripe test catalog activation is a fourth, narrowly bounded provider control.
Its probe retrieves only the authenticated test account identity and emits a
SHA-256 fingerprint. Bootstrap remains unavailable until that fingerprint is
reviewed in `config/stripe-test-catalog.json`; it can then create or reuse only
the four versioned monthly Prices. Stable lookup keys and request idempotency
keys prevent reruns from creating duplicate catalog objects. It has no
customer, Checkout, subscription, charge, refund, portal, or webhook method.
The staging Worker pipeline re-runs the read-only semantic verifier and
requires each configured `STAGING_STRIPE_PRICE_*` value to match that catalog
before it can deploy.

Production Worker bootstrap contains no route or custom-domain declaration.
Public cutover requires all Phase 1–5 configuration capabilities and retains
the active Pages project for automatic/manual restoration. The release
controller enforces Stripe test mode and cannot enable live billing.

---

## Security boundaries

- Staff and member Supabase sessions use different secure, `httpOnly` cookies.
- Hosted staging and production cookies are always `Secure`; local
  development/test cookies retain the explicit non-HTTPS development behavior.
- The browser calls only the same-origin Express API; JWTs and secret keys never enter local storage.
- All state-changing browser requests require an allowlisted `Origin`.
- Worker secrets contain Supabase, Stripe, provider-application, signing, and
  credential-wrapping configuration.
- Winery Klaviyo, Avalara, and Meta credentials and QuickBooks connection tokens
  use authenticated encrypted database envelopes; the browser sees redacted
  metadata only.
- RLS is enabled and forced on tenant- and brand-scoped tables.
- Service-role operations repeat brand authorization in application queries
  instead of treating an RLS bypass as staff authority.
- Custom JWT claims are derived by a database auth hook, not editable user metadata.
- Stripe webhooks use raw bodies, signature verification, unique event IDs, and out-of-order event protection.
- Stripe secret format and environment are validated at runtime. Live
  credentials are rejected outside production, and live charge/Checkout paths
  require the independent `LIVE_BILLING_ENABLED=true` authority.
- Stripe catalog writes separately require a test key, exact operation
  confirmation, immutable `main` commit, account fingerprint allowlist, and
  exact Product/Price contract. A mismatched existing lookup key fails closed.
- Production QuickBooks, Avalara, and APNs endpoints are rejected outside
  `APP_ENV=production`; Avalara accepts only its canonical sandbox or production
  origin.
- Native refresh tokens are hashed/rotating and push tokens are encrypted;
  Keychain/Keystore-backed storage holds native session and offline data.
- Native bundles have no implicit API-origin fallback. Compile-only, isolated
  staging, and explicitly authorized production profiles are distinct.
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
| Klaviyo | Profiles, list membership, and engagement sync | Jobs remain unclaimable until explicit opt-in and encrypted winery credentials validate |
| QuickBooks Online | Sales receipts, refunds, OAuth refresh, and reconciliation | Application OAuth remains disabled without Worker config; connection tokens are encrypted per winery |
| Avalara | Pre-charge tax calculation, commit, void, and reconciliation | An opted-in connected failure blocks the charge; inactive connections transmit nothing |
| Meta Conversions API | Consent-gated conversions with hashed identifiers | Unconsented events are suppressed; missing encrypted dataset/token configuration transmits nothing |
| Cloudflare for SaaS | White-label hostname validation and certificates | Pending or unverified hosts never choose brand context |
| APNs / FCM | Platform-specific native push delivery | Missing platform credentials leave push work dormant without creating a connected state |
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
- Phase 5 provider activation requires the integration wrapping key, explicit
  winery opt-in, approved field/account mappings, and provider sandbox or live
  accounts. Winery credentials stay in encrypted connection envelopes.
- QuickBooks additionally requires Intuit application OAuth secrets in the
  Worker; returned connection tokens remain encrypted in PostgreSQL.
- White-label activation requires a zone-scoped Cloudflare custom-hostname
  token, winery DNS, and active ownership plus certificate states.
- Native activation requires Apple/Google developer accounts, platform push
  credentials, signing material, privacy/store metadata, physical-device tests,
  and TestFlight/Play internal-track evidence.
- Replacing Stripe test keys with live keys and running a real charge/refund is
  a human-controlled Phase 5 launch action.
- The Worker custom-domain cutover occurs only after the hosted Phase 1–5
  activation and regression gates pass.

See [the Phase 1 ADR](./decisions/2026-07-26-phase-1-foundation-architecture.md)
and [the Phase 2 ADR](./decisions/2026-07-26-phase-2-core-club-loop.md) for
rationale and tradeoffs. Retention-specific decisions are recorded in
[the Phase 3 ADR](./decisions/2026-07-26-phase-3-retention-communications.md).
Analytics, ML, benchmarking, and compliance decisions are recorded in
[the Phase 4 ADR](./decisions/2026-07-26-phase-4-analytics-intelligence.md).
Scale, connector, brand, white-label, and mobile decisions are recorded in
[the Phase 5 ADR](./decisions/2026-07-26-phase-5-scale-integrations.md).
