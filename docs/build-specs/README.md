# Vinifera Build Specs

Codex-optimized build specifications for each phase of the Vinifera production build.

## Overview

These specifications define the five sequential slices of the Vinifera
production platform. Version 0.5.0 contains the complete Phase 1–5 source
architecture. The public `https://vinifera.edstratumlabs.ai` domain still serves
the verified static Cloudflare Pages prototype and rollback baseline; it does
not yet prove that the data-connected Worker application is hosted.

Architecture completion and hosted activation are separate gates. Hosted
Supabase migration, provider accounts, winery DNS, Stripe live-mode approval,
signed physical-device testing, and app-store distribution remain deferred
until the required credentials and human authority are available.

## Build Phases

| Phase | Title | Duration | Status | Spec |
|-------|-------|----------|--------|------|
| 1 | The Foundation | Weeks 1–6 | Source complete; hosted activation deferred | [phase-1-foundation.md](./phase-1-foundation.md) |
| 2 | The Core Club Loop | Weeks 7–16 | Source complete; hosted provider proof deferred | [phase-2-core-club-loop.md](./phase-2-core-club-loop.md) |
| 3 | Retention & Communications | Months 5–7 | Source complete; hosted delivery proof deferred | [phase-3-retention-comms.md](./phase-3-retention-comms.md) |
| 4 | Analytics & Growth Intelligence | Months 8–12 | Source complete; real-data/model/provider proof deferred | [phase-4-analytics.md](./phase-4-analytics.md) |
| 5 | Scale & Integrations | Year 2 | 0.5.0 source complete; providers/DNS/stores deferred | [phase-5-scale-integrations.md](./phase-5-scale-integrations.md) |

## Architecture Summary

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 + Tailwind CSS + Vite | Responsive staff and member applications |
| Backend | Express 5 on Cloudflare Workers | Same-origin API and static assets |
| Database | Supabase PostgreSQL | Forced tenant and brand RLS plus durable jobs |
| Payments | Stripe | SaaS subscriptions and per-shipment PaymentIntents |
| Email | Resend | Durable transactional outbox and signed delivery events |
| Shipping | EasyPost | Address, label, tracking, and recovery adapter |
| Compliance | ShipCompliant | Alcohol-shipping authority before label purchase |
| Scale integrations | Klaviyo, QuickBooks, Avalara, Meta | Server-only connectors with encrypted connection credentials |
| White label | Cloudflare for SaaS | Ownership- and certificate-gated custom hostnames |
| Mobile | Capacitor 8 | iOS/Android wrappers around the React source |
| Hosting | Cloudflare Pages rollback + isolated Worker staging | Production cutover remains human-controlled |
| Observability | Cloudflare Worker logs + sanitized provider attempt ledgers | No external APM is represented as implemented |

## QA Integration

Each phase has a checked-in QA report that distinguishes local/CI architecture
evidence from hosted operational evidence. Run the source gates with:

```bash
npm run check
npm run qa:mobile-release
npm run qa:production-release
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:db:phase5
npm run qa:mobile:identity
CI=1 npm run qa:e2e
npm run build:mobile:web
npm run build:mobile:android
```

Native simulator/debug compilation is not store or physical-device proof.
Similarly, a static Pages `200` is not proof that Worker APIs or providers are
active.

Credential-deferred operations are fully wired through the
[hosted environment](../runbooks/hosted-environment-provisioning.md),
[production cutover/rollback](../runbooks/production-cutover-rollback.md), and
[signed mobile release](../runbooks/mobile-store-release.md) runbooks.

The cross-agent merge-cleanup investigation, attribution, regression repairs,
review waiver, exact evidence, remaining blockers, and recommended release
sequence are consolidated in the
[2026-07-28 merge-cleanup regression audit](./merge-cleanup-regression-audit-2026-07-28.md).

## Credentials

The repository is public, so no secret values may appear in a tracked file.
Application-level Supabase, Stripe, Resend, EasyPost, ShipCompliant, QuickBooks
OAuth, mobile signing/push, and Cloudflare control-plane values are encrypted CI
or Worker secrets.

Winery-specific Klaviyo, Avalara, and Meta credentials are accepted only by the
server and stored as versioned AES-256-GCM database envelopes. QuickBooks
application OAuth credentials are Worker configuration; each winery's access
and rolling refresh tokens are encrypted per connection.

The envelope boundary requires:

```text
INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION
INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS
```

CI uses Node 22.22.0, pinned Supabase CLI 2.109.1, and an isolated
`vinifera-staging` Worker environment. Available runtime secrets are attached
atomically to a staging version. The workflow does not automate production
custom-domain cutover.

See `.env.example`, `docs/setup.md`, and the per-phase activation runbooks for
the exact non-secret contract.

## Codex Execution

To execute the full build end-to-end, see [CODEX-PROMPT.md](./CODEX-PROMPT.md) — a single prompt that instructs Codex to orchestrate all five phases sequentially, with full autonomy to implement decisions and spawn subagents as needed.

## Key Principles

1. **Preserve the dependency order.** Later phases rely on earlier database and
   service contracts.
2. **Separate wiring from activation.** Missing credentials must fail closed,
   and a compile or simulator cannot stand in for a provider/store round trip.
3. **Keep tenant isolation at the database layer.** Service-role paths repeat
   brand authorization instead of bypassing it.
4. **Use the prototype as the visual spec.** The original `/app/` remains the
   Pages rollback surface until hosted cutover.
5. **Document and verify every release.** ADRs, changelog, QA evidence, rollback,
   accessibility, responsive behavior, and security are part of the build.
