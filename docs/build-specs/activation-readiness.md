# Activation readiness

**Last reviewed:** 2026-08-05
**Allowed statuses:** `pending`, `local-verified`, `live-passed`

Five composite gates are `live-passed`: Gates 1, 3, 4, 5, and 9. The 2026-08-05
hosted re-audit proved exact 30-version staging migration-ledger parity and
331/331 canonical native pgTAP assertions, retained Supabase Auth hook/OTP/
Google/SMTP configuration, accepted one resent signed Stripe test webhook
exactly once, and reverified an EasyPost test address with ZIP+4. Gates 2 and 7
were reopened because the deployed staging Worker did not identify itself as
staging or expose an exact revision and one member Supabase client path omitted
Cloudflare Access headers. All other gates remain `pending`.

Partial local evidence:

- Gate 1: clean local and embedded migration replay, including fixed fixture
  identities across independent clean databases.
- Gate 7: local staff/member Auth, member magic link, and cross-tenant brand
  denial; no provider-backed billing lifecycle.
- Gate 15: two local organizations/default brands with staff isolation; no
  independent billing or hostname-derived member context.

The Gate 2/7 repair candidate carries Access service-token headers through all
member Supabase client paths and requires `environment=staging`, the exact
promoted revision, and a successful database-backed route before deployment
evidence can pass. Those two gates remain pending until this exact reviewed
candidate reaches staging and the hosted acceptance suite succeeds.

The dedicated staging Cloudflare account target is now authorized by its
reviewed SHA-256 hash, while the known production account is explicitly
denied. Its protected environment credential is account-scoped to Workers and
Queues, and the staging queue plus isolated Worker bootstrap are provisioned.
The deployment remains restricted to `vinifera-staging`, the protected
`staging` environment, and the exact immutable candidate artifact; Gate 2
remains pending until deployment and runtime evidence pass.

## Activation phases

This grouping changes sequencing only. It does not change any composite gate
status or weaken a gate's own exit criteria.

### 1. Private production-like beta

Synthetic/non-production data, no live billing, and no production customer
access. Primary gates: 1 (database), 2 (isolated Worker), 3 (Auth), the
non-billing isolation subset of 7, and the synthetic multi-brand subset of 15.
Incomplete billing, shipping, communications, compliance, ML, benchmark,
optional-provider, and mobile-store capabilities remain hidden or fail closed.

### 2. Restricted live winery pilot

Adds the independent controls required for real winery operations. Primary
gates: 4–8, 10, 13–16, 19, and 20. Billing, email, fulfillment, compliance,
imports, customer data, custom hostnames, and live cutover retain their
separate evidence and approvals; completing a private beta does not imply any
of them.

### 3. General availability

Adds remaining scale and distribution evidence. Primary gates: 9, 11, 12, 17,
and 18, plus the GA-scale portions of analytics, integrations, and multi-brand
evidence. ML, peer benchmarks, optional providers, physical devices, and app
stores do not block the private web beta.

| Gate | Description | Status | Evidence required for `live-passed` | Owner |
|---:|---|---|---|---|
| 1 | Apply migrations to staging Supabase and run linked pgTAP/RLS | live-passed | Authorized project hash, successful migration job, exact 30-version ledger parity, and 331/331 linked native pgTAP assertions | Track A — staging database |
| 2 | Deploy isolated staging Worker | pending | Authorized account hash, Workers Scripts edit token, successful version/deploy, and readiness output | Track A — staging Worker |
| 3 | Activate Supabase Auth | live-passed | Custom token hook, 900-second OTP, Google OAuth, SMTP, and staff/member callback proof retained in hosted configuration | Track A — authentication |
| 4 | Activate Stripe test catalog and webhook | live-passed | Reconciled four-price test catalog and one resent signed subscription webhook accepted exactly once | Track A — Stripe test |
| 5 | Activate EasyPost test fulfillment | live-passed | Test credential, validated winery origin, simulator disabled, and deliverable address verification with ZIP+4 | Track A — fulfillment |
| 6 | Prove Phase 2 billing lifecycle with ten members | pending | Charge, decline, recovery, label, pack, delivery, and refund evidence for ten Stripe test members | Track A — Phase 2 operations |
| 7 | Prove hosted tenant/Auth/billing isolation | pending | Two-tenant native RLS, staff, member magic link, Checkout, webhook, grace, and suspension results | Track A — hosted acceptance |
| 8 | Activate Resend | pending | Verified sending domain, signed webhook, and two real staging lifecycle triggers | Track A — communications |
| 9 | Prove hosted Phase 4 database | live-passed | Migration 015 and the current 30-version chain applied; canonical native tenant/RPC/Phase 4 assertions included in the 331/331 hosted pass | Track A — Phase 4 database |
| 10 | Validate real winery analytics | pending | Every metric and CSV reconciled to production-like operational source records | Track A — analytics |
| 11 | Qualify and promote ML | pending | Dedicated actor, required population/events, six-source reconciliation, AUC/rules comparison, 30-day A/B, and audited promotion | Track A — ML |
| 12 | Validate peer benchmarks | pending | Estate/Reserve opt-in, ten-contributor k-anonymous cohort, and quarterly delivery | Track A — benchmarks |
| 13 | Activate ShipCompliant | pending | Vendor sandbox, exact credential/contract bindings, and compliant/non-compliant/unknown/timeout/tax/fingerprint/label-recovery proof | Track A — compliance |
| 14 | Activate external integrations | pending | Credential keyring plus winery-specific Klaviyo, Avalara, Meta, and QuickBooks OAuth/token lifecycle evidence | Track A — integrations |
| 15 | Prove production-like multi-brand isolation | pending | Database and service-role isolation, shared/independent billing, and hostname-derived member context for two brands | Track A — multi-brand |
| 16 | Activate a winery custom hostname | pending | DNS ownership, active certificate, expected brand routing, and sibling/unknown-host denial | Track A — custom domains |
| 17 | Prove physical-device mobile capabilities | pending | APNs/FCM, signing, privacy metadata, magic link, secure storage, biometrics, push, camera, offline restore, and relock evidence | Track A — mobile devices |
| 18 | Install internal-track signed builds | pending | Successful TestFlight and Play internal-track installs from verified signed artifacts | Track A — store tracks |
| 19 | Perform controlled Stripe live proof | pending | Human-supervised approved live keys plus one controlled charge and refund | Track A — live billing |
| 20 | Cut production domain to Worker | pending | All hosted exit criteria passed, approved cutover, live health/routes, and rollback evidence | Track A — production cutover |

See `CONTINUITY_BRIEF.md` for the authoritative gate wording and
`docs/build-specs/local-dev-notes.md` for the BS-05 local evidence and explicit
hosted boundary.
