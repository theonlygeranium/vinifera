<div align="center">

# 🍇 Vinifera

### Wine Club Management Built for What's Next

A web-based platform for wine club operations — member management, shipment processing, AI churn prediction, and a passwordless member portal — designed for small to mid-size wineries.

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-vinifera.edstratumlabs.ai-6B1E30?style=for-the-badge)](https://vinifera.edstratumlabs.ai/)
[![Live Demo](https://img.shields.io/badge/🎮_Live_Demo-App_Prototype-C9993A?style=for-the-badge)](https://vinifera.edstratumlabs.ai/app/)
[![Investor's Guide](https://img.shields.io/badge/📖_Investor's_Guide-Full_Story-3D0E1B?style=for-the-badge)](https://vinifera.edstratumlabs.ai/guide/)

[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG_2.1_AA-✓_0_Violations-success?style=flat-square)](https://vinifera.edstratumlabs.ai/)
[![Cloudflare Pages](https://img.shields.io/badge/Hosted_on-Cloudflare_Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Node](https://img.shields.io/badge/Node-20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

---

## Overview

Vinifera is a working prototype of a wine club management platform. It demonstrates every major workflow a wine club operator needs — from member onboarding to shipment fulfillment — in a single, mobile-optimized web application. The prototype runs in any browser, is fully WCAG 2.1 AA compliant, and deploys automatically from this repository to Cloudflare Pages on every push to `main`.

The name comes from *Vitis vinifera*, the Latin species name for the primary wine grape vine. It signals domain knowledge to winery operators and reads as a premium brand word — without the overused "wine" prefix that defines most platform names in this market.

## Live Pages

| Page | URL | Description |
|------|-----|-------------|
| **Landing** | [vinifera.edstratumlabs.ai](https://vinifera.edstratumlabs.ai/) | Marketing site with hero vineyard illustration, feature overview, pricing, and animated CTA |
| **App Prototype** | [vinifera.edstratumlabs.ai/app/](https://vinifera.edstratumlabs.ai/app/) | Full interactive dashboard prototype — 13 functional areas, 27 KPI cards, sidebar navigation |
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
| **Hosting** | Cloudflare Pages | 330+ global data centers, 99.99% uptime, auto-deploy from Git |
| **Compliance** | ShipCompliant | State-by-state alcohol shipping legality and tax calculation |
| **Monitoring** | PostHog + Sentry | Product analytics and real-time error capture |
| **Auth** | Supabase Auth | JWT sessions, magic-link for members, password/OAuth for staff |

## Build & Deploy

```bash
# Install dependencies
npm install

# Build for production (outputs to dist/)
npm run build

# Local development server
npm run dev
```

The build copies `index.html`, `app`, and `guide` into `dist/` along with `public/_headers` and `public/_redirects`. Cloudflare Pages auto-deploys on every push to `main` — the deployment trigger is verified via `trigger_type: "github:push"`.

### Routing

| Route | Served By | Content-Type |
|-------|----------|---------------|
| `/` | `index.html` (static) | `text/html` |
| `/app/*` | `app` (extensionless, via `_redirects`) | `text/html` |
| `/guide/*` | `guide` (extensionless, via `_redirects`) | `text/html` |

Extensionless filenames are required because Cloudflare Pages' pretty-URL feature 308-redirects `*.html` files, which would intercept `_redirects` rules. The `_headers` file sets `Content-Type: text/html` for all routes.

## Quality

| Metric | Result |
|--------|--------|
| **WCAG 2.1 AA** | 0 axe-core violations across all 3 pages |
| **Touch targets** | All interactive elements meet 44×44px (WCAG 2.5.5) |
| **Color contrast** | All text exceeds 4.5:1 (normal) or 3:1 (large) thresholds |
| **Performance** | FCP < 370ms, CLS 0.0000, DOM load < 0.35s |
| **Security headers** | 6/6 present on all pages (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection, Permissions-Policy, HSTS) |
| **prefers-reduced-motion** | All animations disabled (CSS + SVG SMIL) |
| **Visual QA** | All screenshots pass on desktop and mobile |

## Repository Structure

```
vinifera/
├── index.html              # Landing page (hero, features, pricing, CTA)
├── app                     # App prototype (extensionless, served at /app/*)
├── guide                   # Investor's guide (extensionless, served at /guide/*)
├── public/
│   ├── _redirects          # Route rules: /app/* /guide/*
│   └── _headers             # Security headers + Content-Type overrides
├── scripts/
│   └── build.mjs            # Build script (copies files to dist/)
├── docs/                    # Architecture, setup, ADRs, runbooks
├── .github/workflows/       # CI/CD pipeline
├── AGENTS.md                # AI agent collaboration guide
├── CONTINUITY_BRIEF.md      # Drop-in context for new agent sessions
├── CHANGELOG.md             # Versioned change log
├── REVERT.md                # Stable baseline and rollback guide
├── package.json             # Build config
└── wrangler.toml            # Cloudflare Pages configuration
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
