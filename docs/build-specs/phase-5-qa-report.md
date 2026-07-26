# Phase 5 QA report — Scale and integrations

- **Run date:** 2026-07-26
- **Release:** 0.5.0
- **Local source architecture gate:** Passed
- **Hosted operational exit criterion:** Deferred pending provider accounts,
  hosted Supabase, winery DNS, signing, store tracks, physical devices, and
  production-payment authority

## Evidence standard

This report separates three kinds of evidence:

1. **Local architecture evidence** proves the source, embedded database
   contracts, provider boundaries, responsive application, native identity, and
   fail-closed states without requiring live credentials.
2. **Simulator evidence** proves compilation and behavior in a simulator. It
   does not prove physical-device storage, push delivery, signing, or store
   distribution.
3. **Hosted operational evidence** proves the Phase 5 exit criterion against
   hosted Supabase, real provider accounts, winery DNS, signed store builds,
   physical devices, and approved production payment controls.

A mocked provider, static Pages response, successful compilation, simulator
install, stored secret name, or credential-free timing is never counted as a
live provider or production-store result.

## Result summary

| Gate | Result | Boundary |
| --- | --- | --- |
| Phase 5 embedded database | Pass — 167/167 assertions | Hosted Supabase native pgcrypto/pgTAP remains deferred |
| Prior-phase embedded database regression | Pass — Phase 2 145/145, Phase 3 138/138, Phase 4 121/121 | Hosted Supabase remains deferred |
| Type, unit/integration, build, Worker package | Pass — `npm run check`, 115/115 tests across 9 files | No hosted Worker claim |
| Dependency audit | Pass — zero vulnerabilities in production and full audits | Snapshot from this run |
| Full responsive/axe browser suite | Pass — 122/122 in 2.5 minutes | Local browser evidence; no hosted-provider claim |
| Phase 5 visual review | Pass — six staff screenshots manually inspected | Physical-device and store screenshots remain deferred |
| Mobile identity and native sync | Pass | Store signing remains deferred |
| iOS simulator | Pass — build, install, launch, zero build warnings | Not a physical-device or TestFlight result |
| Android | Pass — local and GitHub CI lint, debug APK, and R8 release APK | Signing and FCM remain deferred |
| Static Pages rollback | Pass — unchanged | Still the public production baseline |
| Hosted providers, custom DNS, Stripe live | Deferred | External credentials or human authority required |

## Credential and deployment audit

| Capability | Verified local architecture | Credential/authority state | Hosted result |
| --- | --- | --- | --- |
| Supabase Phase 5 migration | Embedded migration and 167 assertions pass; Phase 2–4 regression gates also pass | Management credentials unavailable | Deferred |
| Cloudflare Worker | Build and production/staging dry-run package pass; isolated staging workflow configured | Workers-capable token activation not exercised | Deferred |
| Integration credential keyring | AES-256-GCM round trip, version, and authenticated context pass | Wrapping key not provisioned | `activation_required` |
| Klaviyo | Adapter, jobs, signatures, polling fallback, and request construction pass | Private key/account unavailable | `activation_required` |
| QuickBooks Online | OAuth state/refresh, SHA-256 request IDs, ambiguity handling, pagination, durable refund checkpoints, and reconciliation pass | Intuit application/company unavailable | `activation_required` |
| Avalara | Pre-charge quote, commit, durable refund checkpoint/return, liability, crash reconciliation, and fail-closed paths pass | AvaTax account/company unavailable | `activation_required` |
| Meta CAPI | Consent, hashing, event identity, and request construction pass | Dataset/token unavailable | `activation_required` |
| Custom hostname | Least-privilege client, ownership/certificate state, host routing, and theme guards pass | Zone-scoped token and winery DNS unavailable | Deferred |
| iOS | Identity, sync, simulator build/install/launch pass | Apple signing, APNs, and store authority unavailable | Deferred |
| Android | Identity, sync, lint, debug APK, and R8 release APK pass locally and in GitHub CI | Signing, FCM, and store authority unavailable | Deferred |
| Stripe live mode | Test-mode billing architecture passes | Human approval required; no automated key change | Deferred |

## Functional architecture

### Integration framework

- [x] Credential envelopes use AES-256-GCM, a random nonce, a versioned key,
      and authenticated organization/provider/target context.
- [x] Browser-readable connection metadata contains no credential material.
- [x] Missing credentials return `activation_required` and transmit no data.
- [x] Explicit opt-in is required before jobs can be claimed.
- [x] Jobs are leased, idempotent, bounded, retryable, reconcilable, and moved
      to a dead-letter outcome at the attempt ceiling.
- [x] Logs contain counts, correlation/provider IDs, and safe error codes rather
      than raw payloads or credentials.
- [x] Disconnect stops new disclosure and preserves minimized audit history.

### Klaviyo

- [x] Initial profile sync uses the revisioned asynchronous bulk-import
      contract.
- [x] Delta profile/list jobs are idempotent and bounded.
- [x] Engagement polling is cursor based.
- [x] Signed webhooks reject missing, stale, mismatched, and tampered
      signatures.
- [x] The canonical batch envelope allows only bounded open/click events.
- [x] Unsupported system-webhook accounts retain the Events API polling
      fallback.
- [x] Credential-free 1,000-profile source/request construction completes
      inside the 30-second application budget.
- [ ] Live account round trip: **Deferred**.

### QuickBooks Online

- [x] OAuth state is single-use and bound to the organization/brand.
- [x] Rolling refresh tokens are serialized and durably replaced before use.
- [x] Receipt/refund writes use deterministic Intuit `requestid` values derived
      from the operation identity with SHA-256.
- [x] Ambiguous writes query by document number before retrying.
- [x] Paginated receipt/refund sources, account mappings, exchange metadata, and
      monthly reconciliation are implemented.
- [x] Tax-inclusive, loyalty-net financial identities are shared across
      Vinifera, QuickBooks, Meta, and refund handling.
- [x] QuickBooks and Avalara share a durable per-refund checkpoint. A crash
      after either provider write is reconciled and resumes only the incomplete
      side; the 4,863-cent and 4,862-cent increments converge exactly to the
      9,725-cent cumulative refund.
- [x] Credential-free 100-transaction source/request construction completes
      inside the 60-second application budget.
- [ ] Live company round trip: **Deferred**.

### Avalara

- [x] Tax is calculated before Stripe confirmation.
- [x] An opted-in connected-provider failure blocks the charge.
- [x] The AvaTax sales transaction is `Saved` before charge and `Committed`
      only after success.
- [x] Partial and full refunds durably enqueue Avalara refund work and persist
      committed `ReturnInvoice` documents against the original transaction.
- [x] Cross-provider refund progress is checkpointed before acknowledgement so
      crash recovery reconciles QuickBooks and Avalara without skipping or
      duplicating either provider write.
- [x] Liability reporting subtracts committed return tax from sales tax.
- [x] Exemption, jurisdiction, shipping, liability, and filing states are
      represented.
- [x] ShipCompliant remains the alcohol-shipping compliance authority.
- [x] Credential-free request construction completes inside the 500 ms
      application budget.
- [ ] Live company/jurisdiction/refund round trip: **Deferred**.

### Meta Conversions API

- [x] Consent is checked before queue and immediately before transmission.
- [x] Identifiers, including date of birth, are normalized and SHA-256 hashed
      before a network request object is created.
- [x] The conversion ledger accepts hashes rather than raw identifiers.
- [x] Stable `event_id` values support deduplication.
- [x] Credential-free event construction completes inside five seconds.
- [ ] Events Manager round trip: **Deferred**.

### Multi-brand and white label

- [x] Existing organizations receive one default brand without data loss.
- [x] Every existing brand-scoped row is backfilled and future rows require a
      concrete brand.
- [x] Restricted staff cannot access a sibling brand in the same organization.
- [x] Owners/admins use explicit approved all-brand aggregates.
- [x] Member access is forced to the member's operational brand.
- [x] Suspended independent brands fail closed for member access, release
      claims, payment retries, integration access, and charge paths.
- [x] Service-role application queries validate and apply active brand context
      instead of treating RLS bypass as staff authority.
- [x] Service-only privileged RPCs have explicit coverage proving browser and
      ordinary authenticated roles cannot invoke them.
- [x] Shared and independent brand billing states are represented.
- [x] Unknown, unverified, or certificate-pending hostnames never choose tenant
      context.
- [x] Theme colors require a usable 4.5:1 foreground; unsafe logo origins,
      credentials, and custom ports are rejected.
- [x] Sender identities are unique per brand and may be safely replaced or
      disabled.
- [ ] Hosted two-brand workflow: **Deferred**.
- [ ] Live custom hostname/DNS/certificate: **Deferred**.

### Capacitor mobile

- [x] The web application remains the sole UI source of truth.
- [x] iOS and Android projects are checked in, identity-verified, and
      reproducibly synchronized.
- [x] Native secure-storage calls fail closed on web.
- [x] Refresh/session values use Keychain/Keystore-backed storage; only a
      non-sensitive presence marker may use Web Storage.
- [x] Biometric/device-credential cancellation or unavailability falls back to
      magic link.
- [x] Foreground relock hides private content until unlock completes.
- [x] Mobile magic-link exchange is single-use; rotating refresh-token reuse
      revokes the token family.
- [x] Magic-link redirects must match the canonical registered URI. A normalized
      `clubCode` selects a brand when an email belongs to multiple clubs;
      ambiguous or invalid selection fails closed.
- [x] Web magic-link state is authenticated with an exact-context HMAC before
      any organization, brand, redirect, or member context is accepted.
- [x] Push registration, foreground/background handling, camera scan, network
      restoration, minimized read-only offline data, and exact deep-link
      allowlists are wired.
- [x] App policy directs users to signed store releases and never downloads
      executable code.
- [x] iOS simulator build/install/launch evidence is recorded below.
- [x] Android CI lint/debug/R8 APK evidence is retained with the successful
      Phase 5 workflow run.
- [ ] Real iOS and Android device/store-track evidence: **Deferred**.

### Backend and security remediation regression set

The final local architecture pass includes these eleven regression groups:

1. Tenant/brand checks are repeated in service-role queries; browser-supplied
   brand identifiers never grant authority.
2. Suspended independent brands are excluded from member, charge, release,
   retry, and integration paths.
3. Release/retry claims persist explicit brand identity and use the
   tax-inclusive, loyalty-net payable amount.
4. Partial/full refund thresholds include collected tax and durably checkpoint
   both QuickBooks and Avalara work. The 4,863-cent and 4,862-cent increments
   reconcile to exactly 9,725 cents after a simulated mid-flow crash.
5. QuickBooks refresh, SHA-256-derived request IDs, ambiguous-write lookup,
   pagination, refund netting, and crash reconciliation are bounded and
   deterministic.
6. Mobile exchanges bind the exact redirect, use a disambiguating `clubCode`,
   hash tokens at rest, and revoke a reused refresh family. Web magic-link
   context is separately protected by an exact-context HMAC.
7. Meta PII is normalized and hashed before serialization; raw values cannot
   enter the conversion ledger.
8. Klaviyo raw-body signatures, timestamp replay windows, webhook IDs, event
   allowlists, and batch limits are enforced.
9. APNs environment/topic identity, AASA/Asset Links identities, push-token
   envelopes, and the joint APNs/FCM dormant state fail closed.
10. Custom-hostname least privilege, active ownership/certificate routing,
    accessible theme foregrounds, safe logo URLs, and unique sender identity
    replacement/disable behavior are enforced.
11. Service-only privilege checks deny browser and ordinary authenticated
    callers even when an organization or brand identifier is valid.

## Database gate

Command:

```text
npm run qa:db:phase5
```

Result:

```text
PASS supabase/tests/013_phase_5_schema.test.sql (36/36)
PASS supabase/tests/014_phase_5_multibrand_rls.test.sql (26/26)
PASS supabase/tests/015_phase_5_integrations_mobile.test.sql (55/55)
PASS supabase/tests/016_phase_5_backend_regressions.test.sql (50/50)
PASS Phase 5 embedded database verification (167/167)
PASS Phase 2 embedded database verification (145/145)
PASS Phase 3 embedded database verification (138/138)
PASS Phase 4 embedded database verification (121/121)
```

Measured embedded-database performance:

```text
Klaviyo 1,000-member source: 1.78 ms / 30,000 ms
QuickBooks 100-transaction source: 1.09 ms / 60,000 ms
10,000-member brand isolation query median: 4.49 ms / 2,000 ms
```

This gate uses embedded PostgreSQL compatibility. Hosted Supabase must still run
native pgcrypto, pgTAP, migration, forced-RLS, credential, and provider
verification.

## Automated application gate

| Command/check | Result |
| --- | --- |
| `npm run check` | Pass — TypeScript zero errors, 115/115 Vitest tests across 9 files, Vite build, Worker dry run |
| `npm audit --omit=dev --audit-level=moderate` | Pass — zero vulnerabilities |
| `npm audit --audit-level=moderate` | Pass — zero vulnerabilities |
| Full post-remediation browser suite | Pass — 122/122 in 2.5 minutes |
| Full-suite multi-brand performance assertion | Pass — 482.86 ms / 2,000 ms |
| Full-suite axe scans | Pass — 0 WCAG 2.1 AA violations |
| [GitHub Phase 5 workflow](https://github.com/theonlygeranium/vinifera/actions/runs/30214620782) | Pass — quality 4m08s, Android 6m44s; hosted migration/deploy skipped while activation is off |

The final complete browser rerun passed all 122 tests in 2.5 minutes after the
multi-brand locator correction. This supersedes the earlier 121-pass partial
run and its targeted-only follow-up.

## Accessibility, responsive, and visual gate

The three Phase 5 staff surfaces passed automated axe-core, horizontal-overflow,
and responsive checks at all six required widths. Mobile-width controls were
also checked for 44×44 px targets.

| Surface | 360 | 375 | 412 | 430 | 768 | 1440 | axe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Integration control center | Pass | Pass | Pass | Pass | Pass | Pass | 0 violations |
| Brands and all-brand overview | Pass | Pass | Pass | Pass | Pass | Pass | 0 violations |
| White-label controls | Pass | Pass | Pass | Pass | Pass | Pass | 0 violations |
| Full Phase 1–5 regression after locator correction | Pass | Pass | Pass | Pass | Pass | Pass | 0 violations |

Six screenshots were manually inspected for hierarchy, clipping, overflow,
legibility, dialogs, status presentation, and mobile touch layout:

- [Integrations at 375 px](../qa/phase-5/integrations-375.png)
- [Integrations at 1440 px](../qa/phase-5/integrations-1440.png)
- [Brands at 375 px](../qa/phase-5/brands-375.png)
- [Brands at 1440 px](../qa/phase-5/brands-1440.png)
- [White label at 375 px](../qa/phase-5/white-label-375.png)
- [White label at 1440 px](../qa/phase-5/white-label-1440.png)

The iOS simulator launch screenshot was separately inspected and is linked
under native evidence. It shows the member magic-link surface, including the
safe invalid-link state and optional club-code input. Simulator rendering is
not physical-device accessibility proof.

## Performance gate

| Check | Budget | Local result |
| --- | ---: | ---: |
| Integration-page LCP | < 2.5 s | Pass — 528 ms |
| Integration-page CLS | < 0.1 | Pass — 0 |
| Multi-brand dashboard usable | < 2 s | Pass — 482.86 ms |
| Klaviyo 1,000-member source/request construction | < 30 s | Pass — 1.78 ms |
| QuickBooks 100-transaction source/request construction | < 60 s | Pass — 1.09 ms |
| 10,000-member brand-isolation query median | < 2 s | Pass — 4.49 ms |
| Avalara application request construction | < 500 ms | Pass — 0.63 ms |
| Meta conversion request construction | < 5 s | Pass — 1.57 ms |
| iOS simulator cold launch tool envelope | < 3 s | Pass — 2.26 s |
| iOS simulator warm resume tool envelope | < 1 s | Pass — 0.29 s |
| Minimized offline-cache round trip | < 500 ms | Pass — unit budget assertion |

Provider figures measure local source/request construction, not provider network
completion. The iOS figures measure the simulator/tool command envelope rather
than production telemetry on physical hardware. Provider latency, physical
device launch, and production network evidence remain deferred.

## Security gate

- [x] Forced RLS, brand policies, and same-organization sibling-brand denial
      pass in the embedded gate.
- [x] Browser bundles and public connection metadata contain no server secrets
      or credential values.
- [x] Provider origins are HTTPS and allowlisted.
- [x] Webhook signatures, OAuth state, redirect binding, and replay negative
      tests pass.
- [x] Web magic-link organization, brand, redirect, and member context is
      authenticated by an exact-context HMAC.
- [x] Raw Meta identifiers are absent from serialized requests.
- [x] Stored provider credentials and push tokens use authenticated encrypted
      envelopes.
- [x] Mobile exchange/refresh tokens are hashed at rest, single-use/rotating,
      and replay-safe.
- [x] Unknown, pending, or certificate-inactive custom domains cannot select
      brand context.
- [x] Service-only privileged database operations reject browser and ordinary
      authenticated roles.
- [x] Worker security headers and local HTTPS-origin rules pass.
- [x] Android cleartext/backup hardening, narrow `FileProvider`, release R8,
      Gradle checksum, iOS privacy inventory, and build-bound APNs entitlements
      are checked by the native identity gate.
- [x] Static Pages rollback artifacts remain unchanged.
- [ ] Live custom-domain HTTPS, certificate, mixed-content, and HSTS evidence:
      **Deferred**.

## Native build evidence

### Shared identity and synchronization

```text
npm run qa:mobile:identity
npm run build:mobile
```

- [x] Canonical app ID/version, exact link allowlists, AASA/Asset Links
      identities, APNs build modes, Gradle integrity, privacy declarations, and
      non-placeholder artwork pass.
- [x] Capacitor synchronization completes for both native projects.

### iOS simulator

- [x] Xcode simulator scheme builds with zero warnings.
- [x] The app installs and launches in the iOS simulator.
- [x] The branded login shell renders without clipping in the simulator.
- [x] Cold launch tool envelope: 2.26 seconds.
- [x] Warm resume tool envelope: 0.29 seconds.

[Inspect the iOS simulator launch screenshot](../qa/phase-5/ios-simulator-member-login.jpg).

The screenshot captures the member magic-link route with a safe invalid-link
state and optional club-code input. These timings include simulator/tool
orchestration and do not replace instrumented physical-device startup
telemetry. Signing, APNs delivery, Keychain/biometric behavior on hardware,
TestFlight, and physical-device evidence remain deferred until Apple authority
is supplied.

### Android

- [x] Android identity, manifest, permission, link, `FileProvider`, artwork,
      R8, and Gradle integrity source gates pass.
- [x] Capacitor Android synchronization completes.
- [x] GitHub CI passes with Java 21, Android API 36, lint, debug APK, and R8
      release APK assembly.
- [x] The exact repository Gradle command passes locally in 2 minutes 29
      seconds with 0 lint errors and 33 non-blocking warnings:

      ```text
      ./android/gradlew -p android lintDebug assembleDebug assembleRelease --stacktrace
      ```

- [x] Debug APK SHA-256:
      `39d5f1b362eeccb89bce4137ab21d1970cb5523fcca0216073b3914bbab8b0ae`.
- [x] Unsigned R8 release APK SHA-256:
      `24c388dad8bbd579887f0cf02a4f6a044087630e9a95249c41a1c49d467daacf`.
- [x] R8 mapping SHA-256:
      `d8c36984ae93f778f168112d92e36f5a2226f950e00d64ec5570295a6f5a9192`.
- [x] GitHub artifact `android-debug-evidence` (artifact ID `8635503498`)
      contains both APKs and the lint report. The CI release APK matches the
      local SHA-256 above; the environment-specific CI debug APK SHA-256 is
      `00738f931ba0a13b7ccdee7fe194adb37eec956441467c11e586459faa7dd95b`.
- [x] The downloaded CI lint report records 0 errors and 33 warnings.
- [ ] Emulator/physical-device, FCM, signing, and Play internal-track evidence:
      **Deferred**.

## Rollback

- [x] `npm run build:pages` reproduces the static rollback artifact.
- [x] Root, original `/app/`, `/guide`, `_headers`, and `_redirects` remain
      unchanged from the accepted Pages baseline.
- [x] The public custom domain remains on the verified static Pages deployment.

Provider rollback is connector-specific: disconnect or stop jobs first,
preserve sanitized reconciliation history, revoke provider tokens, and rotate
an exposed envelope key. Brand-column migrations are forward-only after
backfill; restore a verified database backup rather than dropping populated
Phase 5 tables in place.

## Deferred activation checklist

- [ ] Apply all migrations and native pgcrypto/pgTAP checks to hosted Supabase.
- [ ] Deploy and validate the isolated staging Worker with real bindings.
- [ ] Complete Klaviyo, QuickBooks, and Avalara or Meta provider round trips.
- [ ] Prove two hosted brands, including suspended-brand and sibling isolation.
- [ ] Activate one winery custom hostname with ownership and certificate active.
- [ ] Test signed iOS and Android builds on physical devices.
- [ ] Verify APNs/FCM foreground, background, and tapped-notification delivery.
- [ ] Install from TestFlight and the Play internal track.
- [ ] Obtain human approval for Stripe live keys, webhook, charge, and refund.

## Final decision

**Local source architecture gate:** Passed. The database, application,
provider-boundary, responsive/axe, security, mobile identity/sync, iOS
simulator, and local Android lint/debug/R8 evidence above support source
completion. The successful GitHub workflow and downloaded Android artifact
provide independent CI evidence for the committed source.

**Hosted operational exit criterion:** Not met. It remains deferred until
evidence proves three live providers (Klaviyo, QuickBooks, and Avalara or Meta),
a hosted two-brand production organization, a validated custom hostname, signed
iOS and Android installs from internal store tracks, physical-device core
features, and the human-approved Stripe production transition.
