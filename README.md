<div align="center">

# 🍇 Vinifera

### Wine Club Management Built for What's Next

A web-based platform for wine club operations — member management, shipment processing, AI churn prediction, and a passwordless member portal — designed for small to mid-size wineries.

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-vinifera.edstratumlabs.ai-6B1E30?style=for-the-badge)](https://vinifera.edstratumlabs.ai/)
[![Production Build](https://img.shields.io/badge/Production_Build-0.5.0_Phase_5-C9993A?style=for-the-badge)](./docs/build-specs/phase-5-scale-integrations.md)
[![Investor's Guide](https://img.shields.io/badge/📖_Investor's_Guide-Full_Story-3D0E1B?style=for-the-badge)](https://vinifera.edstratumlabs.ai/guide/)

[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG_2.1_AA-✓_0_Violations-success?style=flat-square)](https://vinifera.edstratumlabs.ai/)
[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Node](https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

---

## Overview

Vinifera 0.5.0 contains the complete Phase 1–5 source architecture: a
React/Vite staff application and member portal, an Express API on Cloudflare
Workers, Supabase Auth/PostgreSQL with forced tenant and brand RLS, Stripe
subscription and shipment billing, EasyPost fulfillment, Resend transactional
delivery, analytics from operational facts, gated ML churn intelligence,
privacy-thresholded peer benchmarks, ShipCompliant fulfillment controls,
multi-brand and white-label operation, Klaviyo/QuickBooks/Avalara/Meta
connectors, and Capacitor iOS/Android projects.

The source architecture is connection-ready and fails closed when credentials or
control-plane settings are absent. Hosted Supabase migration, provider account
validation, winery DNS, Stripe live-mode approval, signed physical-device
testing, and app-store distribution remain separate activation work. The public
custom domain continues to serve the verified static Cloudflare Pages rollback
baseline; it is not evidence that the Worker application is live.

The name comes from *Vitis vinifera*, the Latin species name for the primary wine grape vine. It signals domain knowledge to winery operators and reads as a premium brand word — without the overused "wine" prefix that defines most platform names in this market.

## Project status

v0.5.0: architecturally complete, operationally dormant pending 20 activation
gates. See [`CONTINUITY_BRIEF.md`](./CONTINUITY_BRIEF.md).

## Local development

Use the current local and Worker commands documented under
[Build & Deploy](#build--deploy). There is no standalone local quickstart in
the repository today.

## Agent workflow

All agent changes use pull requests, CI, and Greptile review as documented in
[`docs/agent-workflow.md`](./docs/agent-workflow.md).

## Architecture

The current Pages rollback baseline, Worker/Supabase topology, tenant model,
provider guards, and 20 pending activation gates are documented in
[`docs/architecture.md`](./docs/architecture.md).

## Current live baseline

| Page | URL | Description |
|------|-----|-------------|
| **Landing** | [vinifera.edstratumlabs.ai](https://vinifera.edstratumlabs.ai/) | Marketing site with hero vineyard illustration, feature overview, pricing, and animated CTA |
| **App Prototype** | [vinifera.edstratumlabs.ai/app/](https://vinifera.edstratumlabs.ai/app/) | Static visual and rollback baseline retained until the complete hosted Worker activation gate passes |
| **Investor's Guide** | [vinifera.edstratumlabs.ai/guide/](https://vinifera.edstratumlabs.ai/guide/) | 8-part plain-language guide covering the problem, technology, build plan, and business case |

## Features

The prototype demonstrates thirteen functional areas across an administration portal and a member portal:

| Area | What It Does |
|------|-------------|
| **Dashboard** | KPI tiles, AI Churn Watch panel with per-member risk scores, revenue chart, payment recovery queue |
| **Members / CRM** | Tenant-scoped member records, tier assignment, status transitions, batch actions, export, and durable CSV import |
| **Shipments** | Scheduled release processing, Stripe payment status, decline recovery, refunds, address validation, and retry logic |
| **Analytics** | Operational-fact revenue, member, cohort, shipment, engagement, LTV, and acquisition intelligence with configurable widgets, CSV, and scheduled reports |
| **Club Tiers** | Multi-tier configuration with pricing, billing interval, bottles, frequency, upgrade paths, and immutable release snapshots |
| **Allocations** | Invite-only allocation lists, per-member bottle limits, release embargoes, waitlists |
| **Release Schedule** | Calendar view of all club releases with processing dates and notification timing |
| **Fulfillment** | EasyPost-ready adult-signature labels, pick lists, scan-to-confirm packing, tracking, and delivery state |
| **Communications** | Automated email triggers (pre-shipment, decline, welcome, birthday) and campaign sends |
| **Loyalty** | Points on shipments, events, and referrals — redeemable against upcoming shipments |
| **Integrations** | Klaviyo profile/event sync, QuickBooks Online accounting, Avalara tax, Meta Conversions API, ShipCompliant compliance, Stripe billing, EasyPost shipping, and Resend email |
| **Brands & White Label** | Brand-scoped staff access, shared or independent billing, custom themes, and Cloudflare for SaaS hostname lifecycle |
| **Native Mobile** | Capacitor iOS/Android shells, secure mobile magic-link sessions, biometrics, push, barcode scanning, offline read-only snapshots, and store-directed updates |
| **Settings & Audit** | Role-based permissions, billing config, API key management, tamper-evident audit log |
| **Member Portal** | Self-service: preview shipments, update address, swap bottles, pause membership — magic-link login |

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Interface** | React + Tailwind CSS | Industry standard for fast, responsive web apps |
| **Database** | Supabase (PostgreSQL) | Row-Level Security enforces tenant isolation at the database layer |
| **Payments** | Stripe | Handles decline logic, card updates, fraud detection — Vinifera stores no card data |
| **Email** | Resend | DKKM/SPF-authenticated transactional delivery |
| **Runtime** | Cloudflare Workers + Static Assets | Same-origin React application and Express API |
| **Shipping** | EasyPost adapter | Address verification, rates, adult-signature labels, and tracking; test credentials activate it later |
| **Compliance** | ShipCompliant OAuth adapter | Every label requires an exact compliant decision; missing credentials and unknown responses fail closed |
| **Scale integrations** | Server-side provider adapters + encrypted credential envelopes | Winery credentials never enter browser-readable configuration |
| **Mobile** | Capacitor 8 | One React source with native secure storage, push, camera, network, and deep-link adapters |
| **Observability** | Structured Worker logs + optional Sentry | Correlated safe errors are logged locally; Sentry capture activates only when its server-side DSN secret is configured |
| **Auth** | Supabase Auth | JWT sessions, magic-link for members, password/OAuth for staff |

## Build & Deploy

```bash
# Install locked dependencies
npm ci

# Build for production (outputs to dist/)
npm run build

# Visual development server
npm run dev

# Full Worker + API development server
npm run dev:worker

# Full local verification
npm run check
npm run qa:mobile-release
npm run qa:production-release
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:db:phase5
npm run qa:mobile:identity
npm run qa:e2e

# Native web bundle and project synchronization
npm run build:mobile
npm run build:mobile:android
npm run build:mobile:android:release
npm run build:mobile:ios
```

The build emits code-split React assets, then copies `index.html`, `guide`, and
`public/*` into `dist/`. Wrangler packages those assets with the Express Worker.
GitHub-hosted CI uses Node 22.22.0, runs the Phase 2–5 database gates and browser
QA, builds and lints Android debug plus minified release shells, conditionally
applies migrations with Supabase CLI 2.109.1 plus linked pgTAP/RLS, and can
deploy an isolated `vinifera-staging` Worker only after hashed target approval.
Available runtime secrets are attached atomically to that staging version.
A protected manual controller can later bootstrap and version the production
Worker, move the custom domain only after the full configuration gate, and
restore the retained Pages baseline. A separate protected workflow produces
signed Android/iOS artifacts and optionally uploads only to internal tracks.
All three paths ship fail-closed until their scoped credentials, target hashes,
and confirmations exist.

### Routing

| Route | Served By | Content-Type |
|-------|----------|---------------|
| `/` | `index.html` (static) | `text/html` |
| `/app/*` | React staff application | `text/html` |
| `/portal/*` | React member portal | `text/html` |
| `/guide/*` | `guide` (extensionless, via `_redirects`) | `text/html` |
| `/api/*` | Express BFF | `application/json` |
| `/.well-known/*` | Worker-generated mobile association files | `application/json` |

The original extensionless `app` file remains the visual specification. It is
shipped only by the temporary Cloudflare Pages rollback build; Worker builds
serve the React application instead.

## Quality status

| Metric | Result |
|--------|--------|
| Static marketing/guide baseline | Previously verified for accessibility and responsive layout; rerun as a regression gate |
| Phase 1 foundation | Architecture, API, browser, Worker, and embedded PostgreSQL gates pass |
| Phase 2 core club | 231 database assertions plus service and browser regression gates pass locally |
| Phase 3 retention | Lease-owned activation-safe email, rules scoring, immutable cancel-flow, tenant-scoped commands, snapshot-keyset loyalty, brand-local jobs, and 199 database assertions pass locally |
| Phase 4 intelligence | Current-stack architecture passes 158 database assertions: brand-local real-fact analytics, source-qualified and actor-audited ML lifecycle, all-brand benchmark authorization, and fail-closed compliance/label binding; hosted real-data, model, cohort, and provider evidence remain gated |
| Phase 5 scale | Version 0.5.0 source architecture is complete for connectors, multi-brand isolation, white label, and native shells; the Phase 5 QA report records architecture evidence and deferred hosted checks |
| API resilience | Centralized safe error capture and native per-route/per-tenant rate limiting pass focused, unit, Worker dry-run, and browser/axe regression gates; Sentry remains secret-gated |
| Release controls | Read-only readiness, Stripe test-catalog bootstrap, staging target guards, native hosted pgTAP, production Worker/Pages rollback control, and signed internal-store workflows are source-complete; credential-bound execution remains gated |
| Provider activation | Pending hosted Supabase, Stripe/provider test and live accounts, custom-domain DNS/certificates, APNs/FCM, signing, physical devices, and store tracks |
| Public deployment | Pages continues serving the verified prototype until the Worker activation runbooks pass |

## Repository Structure

```
vinifera/
├── index.html              # Landing page (hero, features, pricing, CTA)
├── app                     # Original visual prototype (source reference only)
├── guide                   # Investor's guide (extensionless, served at /guide/*)
├── web/                    # Vite HTML entry
├── src/client/             # React staff and member applications
├── server/                 # Express BFF and Cloudflare Worker entry
│   └── integrations/       # Klaviyo, QuickBooks, Avalara, Meta, domains, mobile auth, and push adapters
├── supabase/               # PostgreSQL migrations and pgTAP tests
├── tests/                  # API and browser QA suites
├── android/                # Capacitor Android source project; generated web output is ignored
├── ios/                    # Capacitor iOS source project; generated web output is ignored
├── mobile/                 # Canonical app identity, source artwork, native security, and deep links
├── capacitor.config.json   # Shared native shell configuration
├── public/
│   ├── _redirects          # Route rules: /app/* /guide/*
│   └── _headers             # Security headers + Content-Type overrides
├── scripts/
│   ├── build.mjs            # Adds static public surfaces after Vite build
│   ├── verify-phase2-db.mjs # Core-club embedded database and scale QA
│   ├── verify-phase3-db.mjs # Retention database, RLS, RPC, and scale QA
│   ├── verify-phase4-db.mjs # Analytics, ML, benchmark, compliance, and scale QA
│   ├── verify-phase5-db.mjs # Brand, connector, mobile-token, RLS, and scale QA
│   ├── qualify-phase4-ml.mjs # Dry-run/connected operator source attestation
│   ├── verify-mobile-identity.mjs # Cross-platform ID, version, deep-link, and privacy drift gate
│   ├── generate-mobile-assets.mjs # Deterministic iOS/Android branded asset generator
│   └── prepare-capacitor.mjs # Native entrypoint and restrictive CSP preparation
├── docs/                    # Architecture, setup, ADRs, runbooks
├─  .github/workflows/       # CI/CD pipeline
├── AGENTS.md                # AI agent collaboration guide
├── CONTINUITY_BRIEF.md      # Drop-in context for new agent sessions
├── CHANGELOG.md             # Versioned change log
├── REVERT.md                # Stable baseline and rollback guide
├── package.json             # Locked build, test, and deploy commands
└── wrangler.jsonc           # Worker, static assets, and hourly reconciliation
```

---

<div align="center">

## About EdStratum Labs

**[edstratumlabs.ai](https://edstratumlabs.ai)**

Vinifera is designed, architected, and deployed by **EdStratum Labs** — a boutique AI and product engineering firm built on a specific conviction: production-grade software rests on verifiable evidence, not hype.

A *stratum* is a distinct geological layer — each one deposited with precision, each one load-bearing for what comes above it. Production software works the same way: clean data architecture first, then solid application logic, then intelligence on top. Skip a layer, and the structure above it fails.

The founder leads every engagement personally — no handoff to a junior team after the initial pitch. Every technical recommendation stems from direct, verifiable experience building and shipping production systems.

**Founder & Principal**
**Contact:** founder@edstratumlabs.ai

</div>

---

<sub>© 2026 EdStratum Labs. Vinifera is a product in active development. Feature availability and pricing are subject to change.</sub>
