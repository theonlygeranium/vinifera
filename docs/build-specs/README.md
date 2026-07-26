# Vinifera Build Specs

Codex-optimized build specifications for each phase of the Vinifera production build.

## Overview

The Vinifera prototype is complete and deployed at `https://vinifera.edstratumlabs.ai`. These specs describe how to build the **production application** — the real, data-connected, payment-processing platform — in five sequential phases. Each phase produces a working, tested, deployable slice of the product.

The phase sequencing is deliberate: each phase builds on verified output from the previous one. Skipping phases or parallelizing across phases introduces integration risk that the sequencing is designed to eliminate.

## Build Phases

| Phase | Title | Duration | Status | Spec |
|-------|-------|----------|--------|------|
| 1 | The Foundation | Weeks 1–6 | Active | [phase-1-foundation.md](./phase-1-foundation.md) |
| 2 | The Core Club Loop | Weeks 7–16 | Critical | [phase-2-core-club-loop.md](./phase-2-core-club-loop.md) |
| 3 | Retention & Communications | Months 5–7 | Planned | [phase-3-retention-comms.md](./phase-3-retention-comms.md) |
| 4 | Analytics & Growth Intelligence | Months 8–12 | Planned | [phase-4-analytics.md](./phase-4-analytics.md) |
| 5 | Scale & Integrations | Year 2 | Planned | [phase-5-scale-integrations.md](./phase-5-scale-integrations.md) |

## Architecture Summary

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React + Tailwind CSS | SPA, responsive, mobile-first |
| Backend | Node.js (Express or Next.js API routes) | REST or tRPC |
| Database | Supabase (PostgreSQL) | Row-Level Security for tenant isolation |
| Payments | Stripe | Subscriptions + per-shipment billing |
| Email | Resend | Transactional, DKIM/SPF authenticated |
| Hosting | Cloudflare Pages (frontend) + Supabase (backend) | Auto-deploy from Git |
| Auth | Supabase Auth | Magic-link (members), password/OAuth (staff) |
| Compliance | ShipCompliant | State-by-state alcohol shipping legality |
| Monitoring | PostHog + Sentry | Product analytics + error capture |

## QA Integration

Every phase spec embeds QA gates from the [Web & Mobile QA Tester](https://github.com/theonlygeranium/vinifera) skill. Each phase must pass its QA gate before the next phase begins. The QA gates are non-negotiable — a phase is not complete until its QA checklist passes.

## Credentials

Credentials are stored as **encrypted GitHub repository secrets** — never committed to source files. The repository is public, so no secret values may appear in any tracked file.

**Pre-provisioned (Phase 1):**

| Secret | Scope |
|--------|-------|
| `SUPABASE_URL` | Client + server |
| `SUPABASE_ANON_KEY` | Client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** — bypasses RLS |
| `SUPABASE_PUBLISHABLE_KEY` | Client-safe |
| `SUPABASE_SECRET_KEY` | Server-only |
| `STRIPE_PUBLISHABLE_KEY` | Client-safe (test mode) |
| `STRIPE_SECRET_KEY` | Server-only (test mode) |

**Not pre-provisioned (obtain per phase):**

| Phase | Secret | Purpose |
|-------|--------|---------|
| 2 | `UPS_API_KEY` / `UPS_ACCOUNT_NUMBER` | Shipping labels |
| 3 | `RESEND_API_KEY` | Transactional email |
| 4 | `SHIPCOMPLIANT_API_KEY` | Compliance checks |
| 5 | `KLAVIYO_API_KEY`, `QUICKBOOKS_*`, `AVALARA_API_KEY`, `META_*` | Third-party integrations |

See `.env.example` for the full variable list.

## Codex Execution

To execute the full build end-to-end, see [CODEX-PROMPT.md](./CODEX-PROMPT.md) — a single prompt that instructs Codex to orchestrate all five phases sequentially, with full autonomy to implement decisions and spawn subagents as needed.

## Key Principles

1. **Build one complete slice at a time.** Each phase delivers a working, tested product — not a partial feature set.
2. **Verify against real use before building the next layer.** Every phase has an exit criterion that must be met with evidence.
3. **QA is a gate, not an afterthought.** No phase advances without passing its QA checklist.
4. **The prototype is the spec.** The existing prototype at `https://vinifera.edstratumlabs.ai/app/` demonstrates every screen and interaction. Match it.
5. **Document everything.** Every decision, ADR, and change must be documented in the same commit.
