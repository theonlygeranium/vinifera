# Activation readiness

**Last reviewed:** 2026-08-06
**Allowed statuses:** `pending`, `local-verified`, `live-passed`

Seven composite gates are `live-passed`: Gates 1, 2, 3, 4, 5, 7, and 9. The 2026-08-05
hosted re-audit proved exact 30-version staging migration-ledger parity and
331/331 canonical native pgTAP assertions, retained Supabase Auth hook/OTP/
Google/SMTP configuration, accepted one resent signed Stripe test webhook
exactly once, and reverified an EasyPost test address with ZIP+4. Gate 2 passed
on 2026-08-06 when protected run `31073800654` deployed immutable candidate
`f3512e7f36df7bc332ec3e59bca33c4153a835d4` as Worker version
`b3180ad7-64d6-440d-b609-09ee6e95bac5` in the dedicated staging Cloudflare
account. Its retained runtime artifact and an independent live probe both
passed the exact revision, staging identity, core configuration, Stripe test
catalog, and database-backed branding contracts. Gate 7 passed on 2026-08-06
in protected staging run `31089753727`; its retained evidence verifies the
complete hosted two-tenant/Auth/Stripe-test lifecycle and fixture cleanup. All
other gates remain `pending`.

Partial local evidence:

- Gate 1: clean local and embedded migration replay, including fixed fixture
  identities across independent clean databases.
- Gate 7: local staff/member Auth, member magic link, and cross-tenant brand
  denial; no provider-backed billing lifecycle.
- Gate 15: two local organizations/default brands with staff isolation; no
  independent billing or hostname-derived member context.

The deployed Gate 2/7 repair carries Access service-token headers through all
member Supabase client paths and requires `environment=staging`, the exact
promoted revision, and a successful database-backed route before deployment
evidence can pass. The reviewed exact candidate is live in staging and its
hosted acceptance suite succeeded.

The Gate 7 follow-up audit found that the deployed Worker still generated Auth
callbacks for the unattached staging custom domain while verification and user
traffic used the isolated `workers.dev` origin. The staging release controller
now derives `APP_ORIGIN` and browser CORS from the same protected
`STAGING_WORKER_ORIGIN`; custom-domain callbacks remain deferred to Gate 16.
The protected staging job now also contains an explicit opt-in Gate 7 runner
that creates and cleans up synthetic two-tenant/Auth/Stripe-test fixtures and
retains sanitized acceptance evidence. That runner passed on the reviewed
exact candidate in run `31089753727`.

The `staging-db.edstratumlabs.ai` endpoint is the Cloudflare Tunnel front door
for the self-hosted Schubert Supabase stack, not a Supabase custom domain on
the cloud development project. Its GoTrue Site URL and redirect allowlist use
the isolated staging Worker callback. Run `31087028401` passed the resulting
real member PKCE flow, then showed that Checkout must precede the synthetic
active-subscription webhook: writing the synthetic subscription ID first makes
the application correctly fail closed when it cannot retrieve that ID from
Stripe. The repaired controller creates Checkout first while still activating
the fixture before member-link issuance. Protected package run `31089609722`
produced exact candidate `530a003b91642ebf40af01468b10e444116ef632` with
artifact SHA-256 `46de1aecaa268736a00d06e3df5bd606305089152248681943405128719b7c1d`.
After PR #289 promoted it, staging run `31089753727` deployed Worker version
`3978a4da-e488-4887-9900-34f2673f0cb6` and retained successful sanitized Gate
7 evidence as artifact `8963047777`.

The `staging-db.edstratumlabs.ai` endpoint is the Cloudflare Tunnel front door
for the self-hosted Schubert Supabase stack, not a Supabase custom domain on
the cloud development project. Its GoTrue Site URL and redirect allowlist use
the isolated staging Worker callback. Run `31087028401` passed the resulting
real member PKCE flow, then showed that Checkout must precede the synthetic
active-subscription webhook: writing the synthetic subscription ID first makes
the application correctly fail closed when it cannot retrieve that ID from
Stripe. The repaired controller creates Checkout first while still activating
the fixture before member-link issuance.

The dedicated staging Cloudflare account target is authorized by its reviewed
SHA-256 hash, while the known production account is explicitly denied. Its
protected environment credential is account-scoped to Workers and Queues, and
the staging queue plus isolated Worker are provisioned. The successful
deployment remains restricted to `vinifera-staging`, the protected `staging`
environment, and the exact immutable candidate artifact.

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
| 2 | Deploy isolated staging Worker | live-passed | Protected run `31073800654`, immutable package run `31073683792`, Worker version `b3180ad7-64d6-440d-b609-09ee6e95bac5`, retained runtime artifact `8956720306`, and independent exact-revision/configuration/database probe | Track A — staging Worker |
| 3 | Activate Supabase Auth | live-passed | Custom token hook, 900-second OTP, Google OAuth, SMTP, and staff/member callback proof retained in hosted configuration | Track A — authentication |
| 4 | Activate Stripe test catalog and webhook | live-passed | Reconciled four-price test catalog and one resent signed subscription webhook accepted exactly once | Track A — Stripe test |
| 5 | Activate EasyPost test fulfillment | live-passed | Test credential, validated winery origin, simulator disabled, and deliverable address verification with ZIP+4 | Track A — fulfillment |
| 6 | Prove Phase 2 billing lifecycle with ten members | pending; protected controller source-ready | Charge, decline, recovery, label, pack, delivery, and refund evidence for ten Stripe test members, after exact-candidate Gate 13 evidence | Track A — Phase 2 operations |
| 6 | Prove Phase 2 billing lifecycle with ten members | pending | Charge, decline, recovery, label, pack, delivery, and refund evidence for ten Stripe test members | Track A — Phase 2 operations |
| 7 | Prove hosted tenant/Auth/billing isolation | live-passed | Protected run `31089753727`, exact candidate `530a003b91642ebf40af01468b10e444116ef632`, Worker version `3978a4da-e488-4887-9900-34f2673f0cb6`, retained evidence artifact `8963047777`, and successful two-tenant native/API RLS, staff, real emailed member magic link, Checkout, webhook lifecycle, and cleanup results | Track A — hosted acceptance |
| 8 | Activate Resend | pending | Verified sending domain, signed webhook, and two real staging lifecycle triggers | Track A — communications |
| 9 | Prove hosted Phase 4 database | live-passed | Migration 015 and the current 30-version chain applied; canonical native tenant/RPC/Phase 4 assertions included in the 331/331 hosted pass | Track A — Phase 4 database |
| 10 | Validate real winery analytics | pending | Every metric and CSV reconciled to production-like operational source records | Track A — analytics |
| 11 | Qualify and promote ML | pending | Dedicated actor, required population/events, six-source reconciliation, AUC/rules comparison, 30-day A/B, and audited promotion | Track A — ML |
| 12 | Validate peer benchmarks | pending | Estate/Reserve opt-in, ten-contributor k-anonymous cohort, and quarterly delivery | Track A — benchmarks |
| 13 | Activate ShipCompliant | pending | Vendor sandbox, exact credential/contract bindings, and compliant/non-compliant/unknown/timeout/tax/fingerprint/label-recovery proof | Track A — compliance |
| 14 | Activate external integrations | pending | Credential keyring plus winery-specific Klaviyo, Avalara, Meta, and QuickBooks OAuth/token lifecycle evidence | Track A — integrations |
| 15 | Prove production-like multi-brand isolation | pending | Database and service-role isolation, shared/independent billing, and hostname-derived member context for two brands | Track A — multi-brand |
| 16 | Activate a winery custom hostname | pending | DNS ownership, active certificate, expected brand routing, and sibling/unknown-host denial | Track A — custom domains |
| 17 | Prove physical-device mobile capabilities | pending — source-ready | Default-disabled protected controller now requires signed exact-release iOS/Android physical-device matrices; real signing, push, and device evidence remain | Track A — mobile devices |
| 18 | Install internal-track signed builds | pending — source-ready | Controller requires successful same-release Gate 17 evidence plus processed TestFlight and Play internal-track installs; no live install evidence yet | Track A — store tracks |
| 19 | Perform controlled Stripe live proof | pending | Human-supervised approved live keys plus one controlled charge and refund | Track A — live billing |
| 20 | Cut production domain to Worker | pending | All hosted exit criteria passed, approved cutover, live health/routes, and rollback evidence | Track A — production cutover |
| 17 | Prove physical-device mobile capabilities | pending | APNs/FCM, signing, privacy metadata, magic link, secure storage, biometrics, push, camera, offline restore, and relock evidence | Track A — mobile devices |
| 18 | Install internal-track signed builds | pending | Successful TestFlight and Play internal-track installs from verified signed artifacts | Track A — store tracks |
| 19 | Perform controlled Stripe live proof | pending | Protected exact-main run; reviewed live account/customer/Price/plan/maximum/origin hashes; owner-completed Stripe-hosted Checkout; exactly one charge and one full refund; signed webhook replay remains idempotent; independent-brand lifecycle reaches active then canceled; subscription renewal cleanup and sanitized retained evidence | Track A — live billing |
| 20 | Cut production domain to Worker | pending | All hosted exit criteria passed, approved cutover, live health/routes, and rollback evidence | Track A — production cutover |
| 19 | Perform controlled Stripe live proof | pending | Human-supervised approved live keys plus one controlled charge and refund | Track A — live billing |
| 20 | Cut production domain to Worker | pending | All hosted exit criteria passed, approved cutover, live health/routes, and rollback evidence | Track A — production cutover |
| 20 | Attach production application hostname to Worker | pending | All hosted exit criteria passed, approved attachment of `vinifera-live.edstratumlabs.ai`, certificate readiness, live health/routes, and Pages/Worker rollback evidence; marketing hostname unchanged | Track A — production cutover |
| Gate | Description                                                   | Status                                          | Evidence required for `live-passed`                                                                                                                                                                                                                                                                                        | Owner                        |
| ---: | ------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
|    1 | Apply migrations to staging Supabase and run linked pgTAP/RLS | live-passed                                     | Authorized project hash, successful migration job, exact 30-version ledger parity, and 331/331 linked native pgTAP assertions                                                                                                                                                                                              | Track A — staging database   |
|    2 | Deploy isolated staging Worker                                | live-passed                                     | Protected run `31073800654`, immutable package run `31073683792`, Worker version `b3180ad7-64d6-440d-b609-09ee6e95bac5`, retained runtime artifact `8956720306`, and independent exact-revision/configuration/database probe                                                                                               | Track A — staging Worker     |
|    3 | Activate Supabase Auth                                        | live-passed                                     | Custom token hook, 900-second OTP, Google OAuth, SMTP, and staff/member callback proof retained in hosted configuration                                                                                                                                                                                                    | Track A — authentication     |
|    4 | Activate Stripe test catalog and webhook                      | live-passed                                     | Reconciled four-price test catalog and one resent signed subscription webhook accepted exactly once                                                                                                                                                                                                                        | Track A — Stripe test        |
|    5 | Activate EasyPost test fulfillment                            | live-passed                                     | Test credential, validated winery origin, simulator disabled, and deliverable address verification with ZIP+4                                                                                                                                                                                                              | Track A — fulfillment        |
|    6 | Prove Phase 2 billing lifecycle with ten members              | pending                                         | Charge, decline, recovery, label, pack, delivery, and refund evidence for ten Stripe test members                                                                                                                                                                                                                          | Track A — Phase 2 operations |
|    7 | Prove hosted tenant/Auth/billing isolation                    | live-passed                                     | Protected run `31089753727`, exact candidate `530a003b91642ebf40af01468b10e444116ef632`, Worker version `3978a4da-e488-4887-9900-34f2673f0cb6`, retained evidence artifact `8963047777`, and successful two-tenant native/API RLS, staff, real emailed member magic link, Checkout, webhook lifecycle, and cleanup results | Track A — hosted acceptance  |
|    8 | Activate Resend                                               | pending — acceptance controller source-complete | Successful reviewed staging run proving enabled sending, verified DKIM and SPF, every supported email event on the exact staging webhook endpoint, a matching signing secret, and real hourly-Cron delivery/reconciliation for welcome and pre-shipment; provider/DNS provisioning remains prerequisite                                                                                                            | Track A — communications     |
|    9 | Prove hosted Phase 4 database                                 | live-passed                                     | Migration 015 and the current 30-version chain applied; canonical native tenant/RPC/Phase 4 assertions included in the 331/331 hosted pass                                                                                                                                                                                 | Track A — Phase 4 database   |
|   10 | Validate real winery analytics                                | pending                                         | Every metric and CSV reconciled to production-like operational source records                                                                                                                                                                                                                                              | Track A — analytics          |
|   11 | Qualify and promote ML                                        | pending                                         | Dedicated actor, required population/events, six-source reconciliation, AUC/rules comparison, 30-day A/B, and audited promotion                                                                                                                                                                                            | Track A — ML                 |
|   12 | Validate peer benchmarks                                      | pending                                         | Estate/Reserve opt-in, ten-contributor k-anonymous cohort, and quarterly delivery                                                                                                                                                                                                                                          | Track A — benchmarks         |
|   13 | Activate ShipCompliant                                        | pending                                         | Vendor sandbox, exact credential/contract bindings, and compliant/non-compliant/unknown/timeout/tax/fingerprint/label-recovery proof                                                                                                                                                                                       | Track A — compliance         |
|   14 | Activate external integrations                                | pending                                         | Credential keyring plus winery-specific Klaviyo, Avalara, Meta, and QuickBooks OAuth/token lifecycle evidence                                                                                                                                                                                                              | Track A — integrations       |
|   15 | Prove production-like multi-brand isolation                   | pending                                         | Database and service-role isolation, shared/independent billing, and hostname-derived member context for two brands                                                                                                                                                                                                        | Track A — multi-brand        |
|   16 | Activate a winery custom hostname                             | pending                                         | DNS ownership, active certificate, expected brand routing, and sibling/unknown-host denial                                                                                                                                                                                                                                 | Track A — custom domains     |
|   17 | Prove physical-device mobile capabilities                     | pending                                         | APNs/FCM, signing, privacy metadata, magic link, secure storage, biometrics, push, camera, offline restore, and relock evidence                                                                                                                                                                                            | Track A — mobile devices     |
|   18 | Install internal-track signed builds                          | pending                                         | Successful TestFlight and Play internal-track installs from verified signed artifacts                                                                                                                                                                                                                                      | Track A — store tracks       |
|   19 | Perform controlled Stripe live proof                          | pending                                         | Human-supervised approved live keys plus one controlled charge and refund                                                                                                                                                                                                                                                  | Track A — live billing       |
|   20 | Cut production domain to Worker                               | pending                                         | All hosted exit criteria passed, approved cutover, live health/routes, and rollback evidence                                                                                                                                                                                                                               | Track A — production cutover |

See `CONTINUITY_BRIEF.md` for the authoritative gate wording and
`docs/build-specs/local-dev-notes.md` for the BS-05 local evidence and explicit
hosted boundary.
