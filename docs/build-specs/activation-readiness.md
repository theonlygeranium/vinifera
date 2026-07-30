# Activation readiness

**Last reviewed:** 2026-07-27 (BS-05)
**Allowed statuses:** `pending`, `local-verified`, `live-passed`

All 20 composite activation gates remain `pending`. BS-05 separately proves
partial local prerequisites for Gates 1, 7, and 15: the integrated 22-migration
chain passes native reset and deterministic double-seed replay; local Auth,
two-tenant staff isolation, a populated UI, member-session resolution, and
zero axe violations also pass. Those results do not include linked staging
pgTAP, Checkout/webhook/grace/suspension, independent billing, service-role
isolation, or hostname-derived context, so they do not promote a composite
gate to `local-verified`.

Partial local evidence:

- Gate 1: clean local and embedded migration replay, including fixed fixture
  identities across independent clean databases.
- Gate 7: local staff/member Auth, member magic link, and cross-tenant brand
  denial; no provider-backed billing lifecycle.
- Gate 15: two local organizations/default brands with staff isolation; no
  independent billing or hostname-derived member context.

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
| 1 | Apply migrations to staging Supabase and run linked pgTAP/RLS | pending | Authorized project hash, successful migration job, and complete linked native test output | Track A — staging database |
| 2 | Deploy isolated staging Worker | pending | Authorized account hash, Workers Scripts edit token, successful version/deploy, and readiness output | Track A — staging Worker |
| 3 | Activate Supabase Auth | pending | Custom token hook, 900-second OTP, Google OAuth, SMTP, and staff/member callback proof | Track A — authentication |
| 4 | Activate Stripe test catalog and webhook | pending | Reconciled created-or-unknown Price, four verified Prices, signed webhook, and sanitized test evidence | Track A — Stripe test |
| 5 | Activate EasyPost test fulfillment | pending | Test key, validated winery origin, simulator disabled, and address/label round trip | Track A — fulfillment |
| 6 | Prove Phase 2 billing lifecycle with ten members | pending | Charge, decline, recovery, label, pack, delivery, and refund evidence for ten Stripe test members | Track A — Phase 2 operations |
| 7 | Prove hosted tenant/Auth/billing isolation | pending | Two-tenant native RLS, staff, member magic link, Checkout, webhook, grace, and suspension results | Track A — hosted acceptance |
| 8 | Activate Resend | pending | Verified sending domain, signed webhook, and two real staging lifecycle triggers | Track A — communications |
| 9 | Prove hosted Phase 4 database | pending | Migration 015 applied plus 37 pgTAP assertions and native tenant/RPC tests | Track A — Phase 4 database |
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
