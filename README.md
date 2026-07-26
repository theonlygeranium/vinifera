<div align="center">

# 🍇 Vinifera

### Wine Club Management Built for What's Next

A web-based platform for wine club operations — member management, shipment processing, AI churn prediction, and a passwordless member portal — designed for small to mid-size wineries.

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-vinifera.edstratumlabs.ai-6B1E30?style=for-the-badge)](https://vinifera.edstratumlabs.ai/)
[![Production Build](https://img.shields.io/badge/Production_Build-Phase_4_Architecture-C9993A?style=for-the-badge)](./docs/build-specs/phase-4-analytics.md)
[![Investor's Guide](https://img.shields.io/badge/📖_Investor's_Guide-Full_Story-3D0E1B?style=for-the-badge)](https://vinifera.edstratumlabs.ai/guide/)

[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG_2.1_AA-✓_0_Violations-success?style=flat-square)](https://vinifera.edstratumlabs.ai/)
[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Node](https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

---

## Overview

Vinifera is a production wine club management platform under active build. The repository contains the verified original prototype plus the real Phase 1–4 architecture: a React/Vite staff application and member portal, an Express API on Cloudflare Workers, Supabase Auth/PostgreSQL with forced tenant RLS, Stripe subscription and shipment billing, EasyPost fulfillment, Resend transactional delivery, analytics from operational facts, gated ML churn intelligence, privacy-thresholded peer benchmarks, ShipCompliant-ready fulfillment controls, cancellation interception, and a durable loyalty ledger.

Provider integrations are connection-ready and fail closed when credentials or control-plane settings are not active. Production code does not emit mock dashboard rows or store JWTs in browser storage.

The name comes from *Vitis vinifera*, the Latin species name for the primary wine grape vine. It signals domain knowledge to winery operators and reads as a premium brand word — without the overused "wine" prefix that defines most platform names in this market.

## Current live baseline

| Page | URL | Description |
|------|-----|-------------|
| **Landing** | [vinifera.edstratumlabs.ai](https://vinifera.edstratumlabs.ai/) | Marketing site with hero vineyard illustration, feature overview, pricing, and animated CTA |
| **App Prototype** | [vinifera.edstratumlabs.ai/app/](https://vinifera.edstratumlabs.ai/app/) | Static visual baseline retained until the Phase 1 Worker passes live activation QA |
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
| **Integrations** | Klaviyo, Mailchimp, QuickBooks, ShipCompliant, Avalara, Stripe, Google Analytics, Meta |
| **Settings & Audit** | Role-based permissions, billing config, API key management, tamper-evident audit log |
| **Member Portal** | Self-service: preview shipments, update address, swap bottles, pause membership — magic-link login |

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Interface** | React + Tailwind CSS | Industry standard for fast, responsive web apps |
| **Database** | Supabase (PostgreSQL) | Row-Level Security enforces tenant isolation at the database layer |
| **Payments** | Stripe | Handles decline logic, card updates, fraud detection — Vinifera stores no card data |
| **Email** | Resend | DKIM/SPF-authenticated transactional delivery |
| **Runtime** | Cloudflare Workers + Static Assets | Same-origin React application and Express API |
| **Shipping** | EasyPost adapter | Address verification, rates, adult-signature labels, and tracking; test credentials activate it later |
| **Compliance** | ShipCompliant OAuth adapter | Every label requires an exact compliant decision; missing credentials and unknown responses fail closed |
| **Observability** | Cloudflare Worker logs | Runtime failures are visible at the hosting layer; external APM remains a later activation decision |
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
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:e2e
```

The build emits code-split React assets, then copies `index.html`, `guide`, and `public/*` into `dist/`. Wrangler packages those assets with the Express Worker. GitHub-hosted CI audits, type-checks, tests, builds, validates the Worker bundle, runs browser QA, conditionally applies Supabase migrations, and deploys the staging Worker.

### Routing

| Route | Served By | Content-Type |
|-------|----------|---------------|
| `/` | `index.html` (static) | `text/html` |
| `/app/*` | React staff application | `text/html` |
| `/portal/*` | React member portal | `text/html` |
| `/guide/*` | `guide` (extensionless, via `_redirects`) | `text/html` |
| `/api/*` | Express BFF | `application/json` |

The original extensionless `app` file remains the visual specification. It is
shipped only by the temporary Cloudflare Pages rollback build; Worker builds
serve the React application instead.

## Quality status

| Metric | Result |
|--------|--------|
| Static marketing/guide baseline | Previously verified for accessibility and responsive layout; rerun as a regression gate |
| Phase 1 foundation | Architecture, API, browser, Worker, and embedded PostgreSQL gates pass |
| Phase 2 core club | 145 database assertions plus service and browser regression gates pass locally |
| Phase 3 retention | Email, rules scoring, cancel-flow, and loyalty architecture plus database/service/browser gates pass locally |
| Phase 4 intelligence | Local architecture release gate passes: analytics, ML lifecycle, benchmark privacy, compliance, database, service, browser, accessibility, and performance checks are green; hosted real-data, model, cohort, and provider evidence remain gated |
| Provider activation | Pending hosted Supabase migrations, Stripe test data, EasyPost, Resend sender/webhook, ShipCompliant, Google OAuth, and SMTP |
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
├── supabase/               # PostgreSQL migrations and pgTAP tests
├── tests/                  # API and browser QA suites
├── public/
│   ├── _redirects          # Route rules: /app/* /guide/*
│   └── _headers             # Security headers + Content-Type overrides
├── scripts/
│   ├── build.mjs            # Adds static public surfaces after Vite build
│   ├── verify-phase2-db.mjs # Core-club embedded database and scale QA
│   ├── verify-phase3-db.mjs # Retention database, RLS, RPC, and scale QA
│   └── verify-phase4-db.mjs # Analytics, ML, benchmark, compliance, and scale QA
├── docs/                    # Architecture, setup, ADRs, runbooks
├── .github/workflows/       # CI/CD pipeline
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

**Founder & Principal:** Jeffrey Geronimo
**Contact:** founder@edstratumlabs.ai

</div>

---

<sub>© 2026 EdStratum Labs. Vinifera is a product in active development. Feature availability and pricing are subject to change.</sub>
