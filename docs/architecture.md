# Architecture — Vinifera

**Last updated:** 2026-07-27
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

### Deployment topology

There are three distinct runtime tiers:

1. **Cloudflare Pages** currently serves the public static production and
   rollback baseline. It does not prove that the application Worker is active.
2. **Cloudflare Worker** packages the React/Vite static assets with the
   Express-compatible API. When activated, one same-origin deployment serves
   `/app/*`, `/portal/*`, `/api/*`, and the mobile association routes.
3. **Supabase** provides PostgreSQL, Row Level Security, Auth, and the durable
   RPC/state-machine boundary. No provider or control-plane activation is
   implied by the existence of the source architecture.

### Multi-tenant model

`organization_id` is the winery boundary and `brand_id` is the operational
tenant discriminator within a winery. One Supabase project serves all
organizations and brands. PostgreSQL RLS and same-tenant composite constraints
form the database boundary; the Worker repeats organization/brand predicates
for defense in depth whenever privileged credentials are used.

A browser-supplied brand identifier is only a scope request. Staff grants,
member binding, hostname state, or a service-role claim must authorize it.
Privileged cross-brand schedulers are the explicit exception: a guarded
service-role RPC claims authoritative rows and returns their organization and
brand; downstream queries and provider work remain bound to those values. The
complete service review is recorded in
[`build-specs/tenancy-audit.md`](./build-specs/tenancy-audit.md).

### Service-layer request path

```text
HTTP Request
  └─► Cloudflare Worker (`server/app.ts`)
        ├─► Auth middleware (reads an HTTP-only web-session cookie)
        ├─► Global security and request middleware
        ├─► Route handler (`server/app.ts`; moving to `server/routes/` in BS-02)
        │     └─► Validates API input with Zod
        └─► Service function (`server/services/*.ts`)
              ├─► Supabase query or RPC (organization/brand scoped)
              └─► Provider call (only after its activation guard passes)
```

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
  → bounded lease-token Worker claim
  → sanitized responsive render
  → stable per-outbox Resend request
  → signed raw-body webhook inbox
  → monotonic delivery and engagement ledger

hourly schedule
  ├── due email enqueue and independent delivery
  ├── UTC date-keyed timestamp transaction
  │     ├── explainable rules-based churn snapshots
  │     ├── loyalty expiration
  │     └── stale cancel-attempt cleanup
  └── brand-local date-keyed calendar transaction
        ├── birthday and anniversary loyalty awards
        └── paused-member resumption
```

Cancellation is an authenticated member state machine. Pause, tier downgrade,
shipment swap, and final cancellation write append-only attempt events against
an immutable four-step snapshot; an accepted alternative terminates the attempt
exactly once. Cancellation and loyalty mutations use tenant-scoped retained
UUID commands plus SHA-256 request fingerprints. Loyalty awards use stable
source-event keys, positive expiring lots, first-expiring-first-out redemption,
an immutable insertion sequence for snapshot-keyset history, and an explicit
reservation/finalization boundary around Stripe shipment charges and refunds.
All relationships are organization/brand/member safe, and brand time zones
control calendar-trigger semantics. Explicit unverified senders remain queued
without consuming delivery attempts.

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

Authoritative analytics events come only from trusted server domain workflows;
the generic client-authored event endpoint is denied. Dashboard facts are
brand-scoped, use each brand's local calendar, resolve all-time ranges from the
earliest durable fact, and remain tenant- and staff-owned. CSV export guards
formula-like input after leading control and whitespace characters.

Model training stores immutable dataset and feature-contract provenance,
coefficients, standardization parameters, temporal metrics, calibration,
confusion matrix, and the rules baseline. Candidate registration never implies
promotion. PostgreSQL refuses production activation unless volume, provenance,
AUC, drift, and completed A/B-superiority gates all pass; the browser applies a
second defensive fallback. Training creation, registration, and promotion are
service-only and require a configured active platform automation actor. A
ready snapshot pauses before registration until an operator attests at least
95 percent source coverage across shipments, billing, email delivery, portal
activity, loyalty, and declines. PostgreSQL derives the evidence hash and
persists the actor responsible for promotion.

Benchmark values are returned only after an opted-in cohort reaches ten
wineries. Region/member-band dimensions are progressively coarsened until the
threshold is satisfied; exact participant counts are exposed only as bands.
Organization-wide benchmark reads and consent changes pass both BFF and
database checks for an active all-brand actor, so a restricted-brand employee
cannot inherit service-role visibility.

Shipment labels no longer rely on the Phase 2 whitelist when the Phase 4 path
is active. After a successful charge, every label attempt performs or reuses a
current provider decision immediately before label purchase. Only `compliant`
proceeds; `unknown`, `non_compliant`, incomplete, timed-out, or unconfigured
responses block fulfillment and persist an auditable hold.
The provider token/check sequence rejects redirects, shares one bounded
deadline, requires an explicit vendor-approved token path, and binds every
EasyPost attempt to live ShipCompliant evidence for the same shipment.

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
encrypted per connection. A connection may instead reference an environment
binding through the exact `env://VINIFERA_INTEGRATION_SECRET_*` form; arbitrary
vault schemes, paths, and browser-supplied environment names are rejected.
Jobs are leased, idempotent, bounded by their persisted attempt ceiling,
retryable, and reconcilable. Cloudflare Queues carries only tenant-free wake
signals; PostgreSQL remains the authoritative outbox and lease boundary, and
the hourly cron remains the recovery sweep. Suspended organizations and
inactive or suspended brands cannot enqueue, resolve credentials, or claim
work. A protected, resumable rotation controller covers integration, encrypted
Meta-attribution, and mobile-push envelopes, and verifies that no
source-version ciphertext remains before an old wrapping key can be retired.
Logs contain sanitized correlation/provider identifiers rather than
credentials or raw customer payloads.

QuickBooks rolling refresh tokens use a database refresh lease and credential
generation compare-and-swap, so correctness does not depend on one Worker
isolate. Klaviyo field/list mappings and QuickBooks account mappings are
tenant-safe database commands reached by the existing Integration page and are
used by provider execution rather than stored as display-only configuration.

Avalara calculates tax before Stripe confirmation and fails a connected charge
closed. A successful charge commits the matching tax transaction;
ShipCompliant remains the independent alcohol-shipping authority before label
purchase. Winery-managed wine and shipping tax-code mappings, verified
exemption references, entity-use codes, and read-only filing-registration
snapshots make each tax input auditable. QuickBooks receipts include the
separately persisted shipping charge rather than folding it invisibly into wine
revenue.

Meta identifiers are normalized and SHA-256 hashed before the transport object
is constructed, and marketing consent is checked both before attribution
storage and immediately before disclosure. Browser attribution identifiers are
stored only in an authenticated encrypted envelope, never in Web Storage or
plaintext database columns. Consent withdrawal redacts the encrypted browser
payload while retaining minimized campaign and response-hash facts needed for
auditable aggregate reporting.

White-label routing trusts only a hostname whose Cloudflare ownership and
certificate states are active. Unknown or pending hosts use the canonical,
unbranded portal and never select tenant context. Theme colors are validated
against WCAG normal-text contrast. Staff configure each brand's accessible
theme, HTTPS logo, portal title, custom hostname, and transactional sender from
one brand-scoped white-label surface. Resend domain creation/verification is
per brand, and email delivery uses only a verified active sender. Cloudflare
hostname creates and deletes use separate durable external-write ledgers. An
indeterminate create must be reconciled by provider lookup before another
create is allowed. An indeterminate delete becomes lookup-required; another
DELETE is authorized only after a provider GET proves the object still exists.
Provider absence, the local disable, and release of the old hostname generation
complete through one leased database transition.

Brand changes remount the staff data boundary and discard stale in-flight
responses. Explicit organization-wide analytics aggregates raw per-brand
numerators and denominators on the server before calculating rates. The mobile
shell serializes token rotation and can cold-start from encrypted cached member
data only in a visibly read-only offline state.

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
verify generated Worker binding types, type-check, run service/browser tests
and Phase 2–5 database gates, build assets, and validate the Worker bundle. A
separate Java 21/API 36 job synchronizes,
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

Credential-envelope rotation and Stripe live-billing cutover are separate,
protected production controls. Rotation is disabled by checked-in policy until
the exact Supabase project, source/target key transition, immutable commit, and
confirmation are authorized; it then uses bounded leases and a verify-only
terminal gate. Live Stripe remains default-deny even after production Worker
deployment. Activation or reversion requires independent authority, reviewed
Worker/account/webhook target hashes, the canonical four-Price contract, an
immutable commit, exact confirmation, and post-change health checks.

Production Worker bootstrap contains no route or custom-domain declaration.
Public cutover requires all Phase 1–5 configuration capabilities and retains
the active Pages project for automatic/manual restoration. The release
controller enforces Stripe test mode and cannot enable live billing. The
separate live-billing controller is also disabled by default and is not an
automatic phase or deployment step.

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
- Stripe Customer creation is serialized per immutable organization, brand, or
  member billing subject and uses stable idempotency keys. Checkout and portal
  attempts use opaque caller attempt IDs, payload fingerprints, database
  leases, and stable session keys. Only one nonterminal Checkout can exist per
  billing subject; a completed Checkout remains `awaiting_webhook` and blocks a
  replacement until the signed subscription event reconciles it.
- Organization signup reconciles an ambiguous tenant bootstrap before any
  cleanup, provisions the organization Customer immediately when an authorized
  Stripe key is connected, and otherwise transmits nothing. The API
  distinguishes `ready`, `deferred`, and `reconciliation_required`; Checkout
  uses the same durable claim to finish deferred provisioning later.
- Stripe catalog writes separately require a test key, exact operation
  confirmation, immutable `main` commit, account fingerprint allowlist, and
  exact Product/Price contract. A mismatched existing lookup key fails closed.
- Stripe live-billing mutation is independent from production deployment,
  default-disabled in policy, and requires separate authority plus reviewed
  test/live account, webhook, Worker, and Price contracts.
- Cloudflare custom-hostname, FCM, and ShipCompliant targets must match
  normalized SHA-256 policies. Empty policies deny outbound mutation.
- Indeterminate custom-hostname creates enter a durable lookup/reconciliation
  state; retries cannot issue another create until the provider result is
  resolved.
- Production QuickBooks, Avalara, and APNs endpoints are rejected outside
  `APP_ENV=production`; Avalara accepts only its canonical sandbox or production
  origin.
- Meta browser attribution is consent-gated, encrypted at rest, excluded from
  Web Storage, and redacted on consent withdrawal. Provider transport receives
  hashed identifiers only.
- Credential-envelope rotation is leased, resumable, bounded, and verified
  across integration, Meta-attribution, and mobile-push secrets before an old
  key version may be removed.
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

All provider activation remains pending. Gate numbers refer to the canonical
table below.

| Provider | Purpose | Activation gate | Status | Missing-wiring behavior |
|---|---|---:|---|---|
| Supabase | Auth, PostgreSQL, RLS | 1, 3, 7, 9 | Pending | Auth/data operations return `503 activation_required` |
| Stripe | SaaS subscriptions and portal | 4, 19 | Pending | Billing operations return `503 activation_required` |
| Stripe PaymentIntents | Release charges, retries, refunds | 4, 6, 19 | Pending | Shipment billing returns `503 activation_required` |
| EasyPost | Address verification, carrier rates, labels, tracking | 5, 13 | Pending | Shipping returns `503 activation_required` |
| Resend | Transactional templates, stable per-message delivery, events | 8 | Pending | Delivery returns `503 activation_required`; durable work remains queued |
| ShipCompliant | Post-charge/pre-label shipment legality, volume, and tax checks | 13 | Pending | Labels fail closed; dashboard reports `activation_required` until the contracted adapter configuration is complete |
| Klaviyo | Profiles, list membership, and engagement sync | 14 | Pending | Jobs remain unclaimable until explicit opt-in and encrypted winery credentials validate |
| QuickBooks Online | Sales receipts, refunds, OAuth refresh, and reconciliation | 14 | Pending | Application OAuth remains disabled without Worker config; connection tokens are encrypted per winery |
| Avalara | Pre-charge tax calculation, commit, void, and reconciliation | 14 | Pending | An opted-in connected failure blocks the charge; inactive connections transmit nothing |
| Meta Conversions API | Consent-gated conversions with hashed identifiers | 14 | Pending | Unconsented events are suppressed; missing encrypted dataset/token configuration transmits nothing |
| Cloudflare for SaaS | Worker deployment, hostname validation, and certificates | 2, 16, 20 | Pending | Pending or unverified hosts never choose brand context |
| APNs / FCM | Platform-specific native push delivery | 17, 18 | Pending | Missing platform credentials leave push work dormant without creating a connected state |
| Google via Supabase | Staff OAuth | 3 | Pending | OAuth route remains disabled until configured |
| SMTP via Supabase | Invite/reset/magic-link delivery | 3, 7 | Pending | Delivery QA remains pending |

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

The canonical gates below are reproduced from `CONTINUITY_BRIEF.md`. Source
architecture and local tests do not change their status.

| Gate | Requirement | Status |
|---:|---|---|
| 1 | Add staging-environment Supabase management credentials, then set the exact project hash and repository variable `STAGING_SUPABASE_MIGRATION_ENABLED=true` to apply `supabase/migrations/` and run `supabase test db --linked`. | Pending |
| 2 | Give the staging Cloudflare token Workers Scripts edit permission and set the exact account hash plus repository variable `STAGING_CLOUDFLARE_DEPLOY_ENABLED=true` only for the isolated `vinifera-staging` Worker. | Pending |
| 3 | Enable the custom access-token hook, 900-second email OTP expiry, Google OAuth, and SMTP. | Pending |
| 4 | When service activation is explicitly resumed, reconcile the created-or-unknown Stripe test Price from run `30218801133`, then bootstrap/verify the four recurring Prices without a blind retry, register `/api/billing/webhook`, and add its signing secret. | Pending |
| 5 | Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled. | Pending |
| 6 | Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof. | Pending |
| 7 | Run the complete hosted two-tenant RLS, staff, member magic-link, Checkout, webhook, grace-period, and suspension tests. | Pending |
| 8 | Verify a Resend sending domain, signed webhook, and at least two real staging triggers. | Pending |
| 9 | Apply Phase 4 migration 15 to hosted Supabase and run the 37 current-stack pgTAP assertions plus native tenant/RPC tests. | Pending |
| 10 | Connect a winery with real Phase 2/3 operations and verify every analytics metric and CSV export against source records. | Pending |
| 11 | Configure a dedicated active `ML_PLATFORM_ACTOR_USER_ID`, accumulate at least 500 labeled members and 50 cancellations, reconcile all six source families, dry-run and execute `ops:phase4:qualify-ml`, train on production history, meet held-out AUC-ROC 0.82 without underperforming rules, and complete the superior 30-day A/B gate before actor-audited promotion. | Pending |
| 12 | Opt an Estate/Reserve winery into a peer cohort with at least ten contributors and verify the quarterly report delivery. | Pending |
| 13 | Obtain vendor-approved ShipCompliant sandbox access, set the server-only credential and contract bindings, and prove compliant, non-compliant, unknown, timeout, tax, fingerprint invalidation, and label recovery cases. | Pending |
| 14 | Provision the integration credential keyring, then validate winery-specific Klaviyo, Avalara, and Meta envelopes and the QuickBooks application OAuth plus encrypted per-connection token lifecycle. | Pending |
| 15 | Create two production-like brands and prove database plus service-role cross-brand isolation, shared/independent billing, and hostname-derived member context. | Pending |
| 16 | Add one winery custom hostname, complete DNS ownership and certificate activation, and verify sibling/unknown hosts cannot select its brand. | Pending |
| 17 | Configure APNs and FCM, Apple/Google signing, privacy/store metadata, and prove magic links, secure storage, biometrics, push, camera, offline restore, and relock on physical devices. | Pending |
| 18 | Install signed builds from TestFlight and the Play internal track. | Pending |
| 19 | Replace Stripe test keys with approved live keys only under human supervision and run one controlled charge/refund. | Pending |
| 20 | Move the production custom domain only after every hosted exit criterion is evidenced. | Pending |

## File ownership

This table is copied from `AGENTS.md` so architecture reviewers have the same
ownership boundary.

| File/Directory | Who Can Modify | Notes |
|---|---|---|
| `AGENTS.md` | Human owner only | Requires explicit authorization to change |
| `CONTINUITY_BRIEF.md` | Any agent | Must reflect current reality — update after every session |
| `README.md` | Any agent | Must reflect reality — no aspirational content |
| `CHANGELOG.md` | Any agent | Required on every commit |
| `REVERT.md` | Any agent | Update whenever a new stable tag is created |
| `.env.example` | Any agent | Real secrets NEVER go here |
| `docs/` | Any agent | Must stay in sync with actual architecture |
| `index.html` | Any agent | Landing page — verify WCAG after changes |
| `app` | Any agent | App prototype — verify WCAG + mobile after changes |
| `guide` | Any agent | Investor's guide — verify WCAG after changes |
| `public/_redirects` | Any agent | Routing rules — test after changes |
| `public/_headers` | Any agent | Security + content-type headers — test after changes |

See [the Phase 1 ADR](./decisions/2026-07-26-phase-1-foundation-architecture.md)
and [the Phase 2 ADR](./decisions/2026-07-26-phase-2-core-club-loop.md) for
rationale and tradeoffs. Retention-specific decisions are recorded in
[the Phase 3 ADR](./decisions/2026-07-26-phase-3-retention-communications.md).
Analytics, ML, benchmarking, and compliance decisions are recorded in
[the Phase 4 ADR](./decisions/2026-07-26-phase-4-analytics-intelligence.md).
Scale, connector, brand, white-label, and mobile decisions are recorded in
[the Phase 5 ADR](./decisions/2026-07-26-phase-5-scale-integrations.md).
Credential-independent completion, retry safety, consent minimization, target
hashes, rotation, and deferred live activation are recorded in
[the deferred-service activation ADR](./decisions/2026-07-26-deferred-service-activation-safety.md).
