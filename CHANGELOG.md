# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- Completed the credential-independent production architecture with Stripe
  billing-subject locks and webhook-wait reconciliation, consent-gated
  encrypted Meta attribution, resumable envelope rotation, separately
  persisted QuickBooks shipping, Avalara mappings/exemptions/filing snapshots,
  per-brand Resend activation, provider target policies, a retry-safe hostname
  ledger, and staff white-label controls.
- Added independently protected, default-deny credential-rotation and Stripe
  live-billing controls plus restricted
  `env://VINIFERA_INTEGRATION_SECRET_*` runtime references.
- Added the deferred-service activation ADR and aligned setup, architecture,
  environment, activation, QA, and continuity documentation with the
  connect-services-later operating model.
- Added a protected Stripe test-catalog workflow with a read-only account
  fingerprint probe, tracked SHA-256 account authorization, exact typed
  confirmations, idempotent Product/Price creation, drift verification, and
  sanitized non-secret Price evidence.
- Expanded the integrated application/control suite to 189/189 tests across 16
  files.
- Added a GET-only hosted-readiness workflow that classifies staging versus
  generic Cloudflare, Supabase, and Stripe test credentials without retaining
  values, provider bodies, URLs, or identifiers.
- Added hashed staging and production target policies whose empty unresolved
  arrays block mutation before any provider write.
- Added linked hosted Supabase pgTAP/RLS execution and a sanitized staging
  Worker verifier for the core app, database, Stripe test billing, and webhook
  capabilities.
- Added a protected manual production Worker controller for first bootstrap,
  immutable version upload/deploy, full-capability domain cutover, Worker
  rollback, and non-destructive Pages restoration.
- Added a protected signed mobile-release controller for ephemeral Android/iOS
  signing, signature verification, Google Play internal edit transactions, and
  internal-only TestFlight upload.
- Added the credential-gated release ADR plus Phase 1, Phase 4, environment
  provisioning, production cutover/rollback, and signed mobile runbooks.

### Changed

- Recorded the final local architecture gate: dependency audit 0, TypeScript
  green, Vitest 245/245, Phase 2/3/4 database regressions 145/138/121, Phase 5
  migrations 001–012 and pgTAP suites 013–022 at 279/279, Playwright 123/123
  with zero axe violations, LCP 476 ms, CLS 0, Pages/Worker/production dry-run
  builds, production release 14/14, mobile release 7/7, Stripe catalog 16/16,
  mobile identity, compile-only Capacitor preparation, and Android sync.
- Classified the current Android Gradle rerun as pending because the local Mac
  has no Java runtime; prior Android artifacts remain historical evidence and
  Java 21 CI is required for the current commit.
- Requested Product expansion on newly created Stripe Prices so the controller
  can validate the Product contract in the same response. Protected bootstrap
  run `30218801133` failed closed after the first provider create because the
  initial response returned only a Product ID; the stable lookup and
  idempotency keys make the retry safe.
- Authorized the reviewed Stripe test account fingerprint after successful
  read-only run `30218422165`; the fingerprint is a one-way target binding and
  the canonical Product/Price catalog remains uncreated pending a separately
  reviewed bootstrap operation.
- Removed the implicit native production-origin fallback. Compile-only,
  isolated staging, and explicitly authorized production builds now have
  distinct fail-closed profiles and artifact labels.
- Made hosted migration success contingent on the repository's native pgTAP
  suites and made staging Worker success contingent on the JSON configuration
  contract, not only an HTTP 200 health response.
- Added a named route-free `vinifera-production` Wrangler environment that
  stays on `workers.dev` until the separate domain operation is approved.
- Made Android `bundleRelease` require complete environment-backed signing
  while retaining unsigned `assembleRelease` for compile-only CI.
- Aligned the Phase 5 build specification with the implemented source
  architecture, including credential ownership, additive non-null brand
  backfill, and signed-store mobile updates.
- Standardized the checked-in Apple association template on the canonical
  `MOBILE_APPLE_TEAM_ID` activation variable.
- Replaced the Phase 5 QA placeholders with traceable local architecture,
  database, browser, visual, security, iOS simulator, and local Android
  lint/debug/R8 evidence while keeping hosted providers, signing/FCM, store
  tracks, and live payments explicitly deferred.
- Recorded the final Phase 5 gates: 174/174 application tests, 167/167 Phase 5
  database assertions plus complete Phase 2–4 database regressions, 122/122
  browser tests with zero axe violations, and the reproducible Android debug,
  unsigned release, and R8 mapping hashes.
- Replaced a timer-dependent Phase 5 loading assertion with a controlled
  request gate, then passed the complete 122-test browser suite with retries
  disabled.
- Closed the Android lint/R8 gates by declaring camera hardware optional,
  supplying ionbarcode's Gson 2.10.1 runtime dependency, modernizing Gradle
  assignments, and bounding release-build memory and worker concurrency.
- Recorded the successful GitHub Phase 5 quality and Android jobs plus the
  retained debug/release APK and lint artifact; credential-gated Supabase and
  Worker jobs remained deliberately inactive.
- Recorded the successful post-hardening GitHub quality/Android run and
  GET-only hosted-readiness audit. Existing Supabase and Stripe test
  credentials are reachable, while staging credentials, database migrations,
  Stripe Prices/webhook, and Workers-capable Cloudflare authority remain
  intentionally unresolved.

### Security

- Required stable Stripe Customer/session idempotency, one nonterminal Checkout
  per immutable billing subject, and an `awaiting_webhook` state that prevents
  replacement Checkout creation before signed subscription reconciliation.
- Required current consent and encrypted-at-rest browser attribution for Meta,
  redaction on consent withdrawal, bounded verified envelope rotation, and
  normalized target hashes for Cloudflare custom hostnames, FCM, and
  ShipCompliant.
- Kept live Stripe independent from Worker deployment and default-denied behind
  disabled policy, separate authority, reviewed account/webhook/Worker/Price
  targets, immutable commit binding, and exact protected confirmations.
- Restricted catalog bootstrap to `sk_test_*`, the canonical four monthly plan
  contracts, an immutable `main` commit, an allowlisted account fingerprint,
  stable lookup/idempotency keys, and a workflow that cannot create customers,
  subscriptions, charges, refunds, portals, or webhooks.
- Made staging Worker deployment verify the configured Price IDs against the
  allowlisted Stripe test catalog before uploading any Worker version.
- Enforced Secure cookies in hosted staging as well as production.
- Rejected Stripe live credentials outside production and required the
  independent, default-off `LIVE_BILLING_ENABLED` authority for every Checkout
  and shipment charge/refund/retry/schedule path.
- Rejected QuickBooks production, Avalara production, and APNs production
  endpoints outside `APP_ENV=production`; Avalara now accepts only canonical
  sandbox or production origins.
- Kept production release Stripe test-only, required all 14 configuration
  capabilities before domain movement, retained an active Pages rollback
  target, and added automatic inverse restoration on failed cutover.
- Bound signed mobile artifacts to an immutable commit on `main`, validated the
  Android upload certificate fingerprint, restricted store delivery to fixed
  internal targets, and removed decoded signing material in always-run cleanup.
- Pinned every CI, readiness, production-control, and mobile-release GitHub
  Action to an immutable commit.
- Provisioned `staging`, `production`, and `mobile-release` GitHub environments
  with `main`-only deployment policies; production and mobile release require
  repository-owner review.
- Added repository-owner review to `staging`, covering catalog activation,
  hosted readiness, Supabase migration, and isolated Worker deployment.
- Added durable QuickBooks/Avalara refund checkpoints and crash reconciliation,
  including exact 4,863 + 4,862 = 9,725 cent convergence and SHA-256-derived
  Intuit request IDs.
- Expanded regression coverage for service-only privileges and exact-context
  HMAC authentication of web magic-link organization, brand, redirect, and
  member context.

### Deferred

- All external services remain disconnected by owner direction. No hosted,
  provider, DNS, store, or live-payment exit criterion is claimed.
- Protected Stripe bootstrap run `30218801133` left its first test Price
  created-or-unknown before failing closed. No retry was attempted; activation
  must later reconcile the fixed lookup key before any create.
- The Stripe test account fingerprint is tracked from the completed read-only
  probe. Catalog reconciliation/bootstrap, Price-secret promotion, and staging
  webhook registration remain deferred activation steps.
- Hosted target IDs/hashes, staging-scoped provider credentials, production
  control-plane credentials, native signing credentials, store authority,
  provider round trips, physical-device QA, and Stripe live approval remain
  external activation work. The new workflows intentionally fail closed until
  each input is supplied and reviewed.

## [0.5.0] — 2026-07-26

### Added

- Multi-brand tenancy with additive default-brand backfill, brand-scoped staff
  grants, explicit privileged all-brand aggregates, brand-bound member access,
  shared or independent billing state, and forced PostgreSQL RLS.
- A server-only integration framework with versioned AES-256-GCM credential
  envelopes, explicit opt-in, leased/idempotent jobs, reconciliation, sanitized
  attempt logs, and fail-closed activation states.
- Klaviyo profile/list/engagement synchronization, QuickBooks Online OAuth and
  accounting synchronization, Avalara pre-charge tax calculation and
  reconciliation, and consent-gated Meta Conversions API delivery.
- White-label themes and Cloudflare for SaaS custom-hostname lifecycle with
  ownership/certificate gating and server-derived hostname-to-brand resolution.
- Capacitor 8 iOS and Android projects with secure mobile magic-link exchange,
  rotating server-revocable sessions, biometric/device-credential relock, APNs
  and FCM delivery adapters, barcode scanning, network recovery, minimized
  read-only offline data, allowlisted deep links, and store-directed updates.
- Phase 5 database migrations and pgTAP suites, service and browser tests,
  responsive/axe evidence, native security documentation, an architecture ADR,
  activation runbook, and QA report.
- A canonical mobile identity manifest, deterministic Vinifera native artwork
  generator, and drift gate for package/native versions, IDs, deep links, APNs
  modes, Gradle integrity, privacy declarations, and placeholder artwork.

### Changed

- Advanced the current source release to 0.5.0 with aligned web, Android, and
  iOS version identifiers and a Node 22.12-or-newer engine contract.
- Extended GitHub CI through the Phase 5 database gate and an Android API 36
  lint/debug build using Node 22.22.0 and Java 21.
- Pinned Supabase CLI 2.109.1 and isolated optional Worker deployment to the
  `vinifera-staging` environment. Available secrets are attached atomically to
  the version, and production custom-domain cutover remains human-controlled.
- Kept winery Klaviyo, Avalara, and Meta credentials in encrypted database
  envelopes. QuickBooks application OAuth configuration remains in Worker
  secrets while per-connection OAuth tokens use the same encrypted envelope
  boundary.
- Enabled Android Release R8 minification/resource shrinking, pinned the
  Gradle distribution checksum, replaced default native artwork, narrowed the
  `FileProvider`, and fixed the generated instrumentation identity test.

### Security

- Required tenant and brand authorization in both database policies and
  service-role application queries; a browser-supplied brand identifier never
  grants access.
- Rechecked marketing consent immediately before provider disclosure, hashed
  Meta identifiers before transport construction, and kept provider payloads,
  mobile tokens, and credentials out of browser-readable logs and storage.
- Kept native sessions in Keychain/Keystore-backed storage, made refresh-token
  reuse revoke its token family, disabled Android cleartext traffic and broad
  backup, and constrained native web connectivity with a build-time CSP.
- Bound one-time mobile exchanges to the registered redirect URI, verified
  Klaviyo's canonical signed batch envelope, enforced tax-inclusive shipment
  billing identities, and limited each brand to one safely replaceable or
  disableable sender identity.
- Bound APNs to an explicit sandbox/production host and the signed iOS bundle
  identity; aligned native deep links to one exact scheme/host/route contract
  and completed the iOS privacy plus native permission/data inventory.

### Deferred

- Hosted Supabase migration, live/sandbox provider account validation, custom
  winery DNS and certificates, Stripe live-mode transition, signed
  physical-device push testing, App Store/TestFlight distribution, and Play
  internal-track distribution require external credentials or human authority.
- The public custom domain remains the verified static Cloudflare Pages
  rollback baseline until the hosted activation and regression gates pass.

## [0.4.0] — 2026-07-26

### Added

- Tenant-scoped analytics event, daily aggregate, cohort, dashboard-layout,
  and scheduled-report architecture backed only by production operational
  facts.
- Responsive revenue, member, shipment, engagement, cohort, LTV, and
  acquisition dashboards with accessible chart tables and CSV exports.
- Deterministic L2 logistic churn trainer with immutable snapshots, temporal
  holdout, five expanding folds, calibration, confusion matrix, rules
  baseline, heuristic model score bands, feature attribution, drift
  monitoring, and nightly batch scoring architecture.
- Fail-closed model lifecycle gates for production provenance, minimum data
  volume, ROC AUC, rules-baseline superiority, and a completed 30-day A/B test.
- Estate/Reserve benchmark opt-in, progressively coarsened k-anonymous peer
  groups, percentile comparisons, and polished quarterly PDF/email reports.
- Connection-ready ShipCompliant OAuth adapter, auditable compliance ledger,
  tax estimates, provider response IDs, provider-health states, dashboard, and
  mandatory post-charge/pre-label checks.
- Compliance input fingerprints and durable EasyPost label attempts that
  persist the carrier shipment before purchase, reuse successful outcomes, and
  support resume or reconciliation without blind duplicate purchases.
- Phase 4 ADR, model card, ShipCompliant activation runbook, database verifier,
  browser QA, and visual/PDF evidence.
- A passing Phase 4 local architecture gate with 121/121 embedded database
  assertions, a keyboard-only browser workflow, deterministic sub-500ms chart
  rendering evidence, and measured database scale checks. Hosted real-data,
  model-accuracy, peer-cohort, and ShipCompliant activation remain deferred.

### Changed

- Routed the implemented label path through the Phase 4 provider-backed
  fail-closed boundary. The Phase 2 whitelist remains historical code and is
  not legal authority; hosted ShipCompliant activation is still pending.
- Made the keyboard-only analytics QA use portable native-select key navigation
  so Linux Chromium cannot interpret Enter as an early form submission.
- Extended the Worker schedule for daily analytics/features/predictions,
  monthly candidate training, scheduled summaries, and quarterly benchmarks.
- Extended setup, architecture, CI, secret contracts, and configuration health
  for credential-deferred compliance activation.

### Security

- Forced row-level security across every Phase 4 tenant table and restricted
  cross-tenant aggregation/model lifecycle RPCs to the service role.
- Rejected identifying analytics payload fields, suppressed peer metrics below
  ten wineries, prevented synthetic model promotion, and kept all
  ShipCompliant credentials server-side.

## [0.3.0] — 2026-07-26

### Added

- Tenant-owned transactional email templates, durable outbox claims, delivery
  log, six lifecycle triggers, preview/test sends, and signed unsubscribe links.
- Fail-closed Resend batch adapter with idempotency and raw-body Svix webhook
  verification; test-only deterministic delivery remains unavailable in
  production.
- Explainable rules-based churn scoring with nightly snapshots, risk queue,
  filters, and contributing-factor detail.
- Configurable four-step cancellation interception with pause, downgrade,
  shipment swap, final cancellation, and outcome analytics.
- Append-only loyalty lots and ledger with shipment, referral, event, birthday,
  anniversary, manual adjustment, 24-month expiration, and FIFO redemption.
- Loyalty-adjusted Stripe shipment charge, retry, and refund convergence.
- Phase 3 ADR, Resend activation runbook, QA report, visual evidence, and
  reproducible embedded database verification in CI.

### Changed

- Added birthday and same-tenant referrer data to member management.
- Extended the hourly Worker schedule for email, churn, and loyalty maintenance.
- Made Phase 2 and Phase 3 embedded database gates locked, repeatable CI steps.
- Extended setup, architecture, continuity, and secret contracts for Phase 3.

### Security

- Forced row-level security across every Phase 3 tenant table.
- Restricted scheduled and redemption-finalization RPCs to the service role.
- Sanitized email HTML, kept provider secrets server-side, replay-protected
  delivery events, and rejected production simulators.

## [0.2.0] — 2026-07-26

### Added

- React 19 + Tailwind/Vite staff and member applications with code-split `/app/*` and `/portal/*` routes.
- Express 5 backend-for-frontend packaged with static assets in one Cloudflare Worker.
- Secure staff password, reset, Google OAuth, invitation, and protected-route flows.
- Passwordless member magic-link flow with isolated staff/member HTTP-only cookie sessions.
- Supabase foundation migration with forced RLS, server-derived JWT claims, super-admin access, tenant indexes, atomic invitation consumption, and pgTAP suites.
- Stripe test-mode Checkout, Customer Portal, signed webhook processing, idempotency, out-of-order protection, and seven/fourteen-day access reconciliation.
- Configuration health and typed activation gates so real provider connections can be enabled later without production mocks.
- GitHub-hosted CI for dependency audit, type-checking, unit/integration tests, Worker packaging, Playwright/axe QA, conditional Supabase migration, and Worker deployment.
- Phase 1 architecture ADR and QA report.
- Reproducible Phase 2 embedded database verification with plan-balanced
  schema, tenant-RLS, server-RPC assertions, and measured 50-shipment and
  1,000-row import performance gates.
- Phase 2 tenant-owned club tiers, release snapshots, shipments, billing attempts, durable CSV imports, and tamper-evident audit chain.
- Member CRM, tier management, release calendar, decline recovery, fulfillment station, import workflow, and data-connected member shipment portal.
- Stripe off-session shipment PaymentIntents, partial-success release batches, manual and automatic retries, refunds, and signed webhook convergence.
- EasyPost address verification and adult-signature label adapter behind a fail-closed shipping provider boundary.
- Hourly due-release processing, retry claiming, in-flight attempt recovery, and idempotent resume behavior.
- Phase 2 ADR, provider activation runbook, QA report, embedded performance gates, and breakpoint visual evidence.

### Changed

- Required a nonblank winery name/company and phone in shipping-origin addresses used for adult-signature labels.
- Replaced the static `/app` deployment artifact with a production React shell while retaining the original `app` file as the visual reference.
- Moved runtime configuration from Pages `wrangler.toml` to Worker `wrangler.jsonc`.
- Stopped tracking generated `dist/` output; CI and deployments now build it from source.
- Updated setup, architecture, continuity, rollback, and repository documentation for the Phase 1 production foundation.
- Extended the Worker API, cron, CI secret contract, and operational documentation for the Phase 2 core club loop.

### Fixed

- Replaced the accidentally Base64-encoded `.gitignore` with active ignore rules that prevent local environment files, Worker secrets, dependencies, build output, and QA artifacts from being committed.
- Removed a timer-based Express rate-limit middleware that is incompatible with Cloudflare Worker global scope; member magic-link limits are enforced atomically in PostgreSQL.
- Normalized database RPC and API session contracts, including Stripe event return shapes and camel-cased browser payloads.
- Refreshed newly bootstrapped Supabase sessions so database-derived tenant claims are immediately available.
- Made disconnected session probes fail closed without producing noisy browser errors.
- Gated Worker deployment behind an explicit activation flag after the existing Cloudflare token proved to lack Workers Scripts permission.
- Updated GitHub checkout, Node setup, and artifact actions to their Node 24-based v7 releases.
- Preserved the verified static `/app` prototype in Cloudflare Pages builds while keeping Worker builds on the React application.

---

## [0.1.0] — 2026-07-26

### Added
- Initial repository created from `github-deploy-template`
- `AGENTS.md` — agent collaboration guide
- `CONTINUITY_BRIEF.md` — drop-in context for new agent sessions
- `CHANGELOG.md` — this file
- `REVERT.md` — stable baseline and rollback guide
- `.env.example` — non-secret environment variable template
- `docs/architecture.md` — system architecture documentation
- `docs/setup.md` — setup and deployment guide
- `docs/decisions/` — ADR directory
- `docs/runbooks/` — runbooks directory
- `.github/workflows/deploy.yml` — CI/CD pipeline
- Cloudflare Pages project `vinifera` created and configured
- Custom domain `vinifera.edstratumlabs.ai` with SSL
- GitHub Secrets injected: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `SCHUBERT_SSH_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Landing page (`index.html`) with hero vineyard illustration, feature grid, workflow illustrations, pricing, CTA sunset gradient
- App prototype (`app`) with 13 functional areas, 27 KPI cards, sidebar navigation, KPI watermarks, empty-state illustration
- Investor's guide (`guide`) with 8-part content, sticky TOC sidebar, reading progress bar, scroll-spy navigation, feature grid, tech stack, timeline, pricing, stats strip
- Four hero animations: vine line drawing, gold glow pulse, grape cluster sway, CTA shimmer sweep
- `prefers-reduced-motion` fallback for all animations (CSS + SVG SMIL)
- Extensionless `app` and `guide` files for Cloudflare Pages routing
- `_redirects` routing rules for `/app/*` and `/guide/*`
- `_headers` security headers and Content-Type overrides
- "Investor's Guide" nav links in desktop nav, mobile drawer, and footer

### Fixed
- Mobile navigation: hamburger visibility, positioning, and drawer functionality
- Landing page CTA links pointing to `index.html` instead of `/app/`
- App hamburger menu not opening on mobile
- App mobile pipeline overflow at 375px viewport
- Hero illustration visibility — gradient too dramatic, SVG opacities too low
- Grape cluster rendering — CSS `transform: rotate()` overriding SVG `transform="translate()"` attribute, switched to SVG `<animateTransform additive="sum">`
- Mobile grape cluster overlap with hero-proof text
- WCAG 2.1 AA color-contrast violations across landing, app, and guide pages (20+ elements)
- WCAG 1.4.3 `btn-gold` contrast: white text on gold (2.59:1) → wine-dark text (6.47:1)
- Guide page ARIA table role violations (`aria-required-children`, `aria-required-parent`)
- Guide page `--text-3` color contrast: `#9C8C78` (3.26:1) → `#6B5D4A` (6.38:1)
- Guide page gold stat-value contrast: `#C9993A` (2.59:1) → `#9A7510` (3.5:1)
- Missing `<main>` and `<header>` HTML landmarks
- Touch targets below 44px (WCAG 2.5.5) — 16 elements fixed
- Footer color contrast on dark background
- Guide page `aria-label` on divs without valid ARIA roles — added `role="group"`

### Changed
- Hero gradient from dramatic near-black-to-gold to uniform deep burgundy for SVG illustration visibility
- `--text-3` from `#9C8C78` to `#6B5D4A` for WCAG 2.1 AA compliance
- `--text-muted` from `#9CA3AF` to `#5B6470` for WCAG 2.1 AA compliance
- `--success` from `#16A34A` to `#15803D` for WCAG 2.1 AA compliance
- `--danger` from `#DC2626` to `#B91C1C` for WCAG 2.1 AA compliance
- `.btn-gold` text color from `--white` to `--wine-dark` for WCAG 1.4.3 compliance
- Template files updated with actual vinifera project details (replaced all `[REPO-NAME]` placeholders)
- README.md rewritten with professional project overview, features, tech stack, and EdStratum Labs about section
