# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

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
