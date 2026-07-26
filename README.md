<div align="center">

# 🍇 Vinifera

### Wine Club Management Built for What's Next

A web-based platform for wine club operations — member management, shipment processing, AI churn prediction, and a passwordless member portal — designed for small to mid-size wineries.

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-vinifera.edstratumlabs.ai-6B1E30?style=for-the-badge)](https://vinifera.edstratumlabs.ai/)
[![Production Build](https://img.shields.io/badge/Production_Build-Phase_1-C9993A?style=for-the-badge)](./docs/build-specs/phase-1-foundation.md)
[![Investor's Guide](https://img.shields.io/badge/📖_Investor's_Guide-Full_Story-3D0E1B?style=for-the-badge)](https://vinifera.edstratumlabs.ai/guide/)

[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG_2.1_AA-✓_0_Violations-success?style=flat-square)](https://vinifera.edstratumlabs.ai/)
[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Node](https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

---

## Overview

Vinifera is a production wine club management platform under active build. The repository contains the verified original prototype and the real Phase 1 application foundation: a React/Vite staff application and member portal, an Express API on Cloudflare Workers, Supabase Auth/PostgreSQL migrations with forced tenant RLS, and Stripe subscription adapters.

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
| **Members / CRM** | Searchable member records with order history, lifetime value, churn risk, communication log |
| **Shipments** | Live release processing: payment status, decline recovery, address validation, retry logic |
| **Analytics** | Revenue trends, cohort retention, tier performance, geographic distribution |
| **Club Tiers** | Multi-tier configuration with per-tier pricing, bottles, frequency, and upgrade paths |
| **Allocations** | Invite-only allocation lists, per-member bottle limits, release embargoes, waitlists |
| **Release Schedule** | Calendar view of all club releases with processing dates and notification timing |
| **Fulfillment** | Pick-list generation, scan-to-confirm pack station, carrier label creation, tracking log |
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
| **Compliance** | ShipCompliant | State-by-state alcohol shipping legality and tax calculation |
| **Monitoring** | PostHog + Sentry | Product analytics and real-time error capture |
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
| Phase 1 application | 10 API tests and 21 browser tests pass; Worker bundle and embedded PostgreSQL preflight pass |
| Provider activation | Pending hosted Supabase migration/Auth settings, Stripe test Prices/webhook, Google OAuth, and SMTP |
| Custom-domain cutover | Blocked until every Phase 1 live checkbox passes |

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
│   └── build.mjs            # Adds static public surfaces after Vite build
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
