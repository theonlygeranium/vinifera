# Phase 5: Scale & Integrations

**Duration:** Year 2
**Status:** Source architecture implemented; hosted provider, DNS, signing,
store, and production-payment activation deferred
**Exit Criterion:** At least three third-party integrations are live in production (Klaviyo, QuickBooks, and one of Avalara/Meta), multi-brand tenancy supports a winery operating two distinct wine clubs from one account, and the Capacitor.js mobile wrapper builds and installs on iOS and Android with all core features functional.

---

## Objective

Scale Vinifera from a single-product platform to an integration-rich, multi-brand, mobile-capable system. This phase addresses the operational gaps that emerge once wineries are running real clubs at volume: marketing automation, accounting sync, tax compliance, ad attribution, multi-brand management, and mobile app distribution.

This phase delivers: Klaviyo bidirectional sync, QuickBooks revenue sync, Avalara tax compliance, Meta Conversions API, multi-brand tenancy, white-label portals, and a Capacitor.js mobile wrapper.

---

## Prerequisites

- Phase 4 complete: analytics, ML churn scoring, benchmarking, and ShipCompliant all functional
- At least 3 wineries actively using the platform in production
- QA gate for Phase 4 passed

---

## Scope

### 5.1 Klaviyo Bidirectional Sync

- Sync member data to Klaviyo as contacts (email, name, club tier, status, lifetime value)
- Sync segment data: churn risk level, engagement tier, membership duration band
- Bidirectional: member updates in Vinifera push to Klaviyo; member email engagement (opens, clicks) pulls back from Klaviyo to enrich Vinifera's churn model
- Webhook: Klaviyo sends engagement events to Vinifero via webhook
- Field mapping: configurable mapping between Vinifera member fields and Klaviyo custom properties
- Sync frequency: real-time for status changes, hourly batch for engagement metrics
- Klaviyo list management: auto-add/remove members from Klaviyo lists based on club tier and status
- Wineries can use Klaviyo for marketing email campaigns (broadcasts, flows) while Vinifera handles transactional email (from Phase 3)

### 5.2 QuickBooks Revenue Sync

- Sync shipment charges as sales receipts in QuickBooks Online
- Map Vinifera club tiers to QuickBooks income accounts (configurable per organization)
- Map Vinifera shipping charges to a shipping income account
- Map refunds to QuickBooks refund receipts
- Sync frequency: daily batch, or real-time per transaction (Codex evaluates tradeoffs)
- Tax line items: sync ShipCompliant tax estimates as QuickBooks tax line items
- Reconciliation: monthly reconciliation report comparing Vinifera revenue to QuickBooks revenue
- Multi-currency support: if winery charges in non-USD, sync with exchange rate recording

### 5.3 Avalara Tax Compliance

- Replace ShipCompliant's basic tax estimate (Phase 4) with Avalara's full tax engine
- Real-time tax calculation at charge time (not just estimate at compliance check)
- Tax jurisdiction resolution: address → jurisdiction → tax rate
- Product taxability: wine has specific taxability rules per state (some states tax by volume, some by price, some exempt)
- Tax exemption handling: tax-exempt customers (rare for wine, but exists for wholesale)
- Tax filing: Avalara can auto-file returns in supported states
- Tax audit trail: every tax calculation logged with jurisdiction, rate, and basis
- Winery dashboard: tax liability summary by state, by period

### 5.4 Meta Conversions API

- Server-side conversion tracking (more reliable than pixel-based, survives ad blockers)
- Track conversion events:
  - Member signup (Lead)
  - First shipment purchase (Purchase)
  - Club tier upgrade (Custom: tier_upgrade)
  - Referral completed (Custom: referral)
- Send via Meta Conversions API with user data hashing (PII hashed with SHA-256)
- Event deduplication: event_id prevents double-counting when both pixel and CAPI fire
- Attribution: link conversions to ad campaigns for ROAS reporting
- Privacy: comply with ATT (iOS) and consent management — only send data for users who have consented

### 5.5 Multi-Brand Tenancy

- A single organization (winery) can operate multiple distinct wine clubs (brands)
- Each brand has its own:
  - Club tiers (independent pricing, frequencies, benefits)
  - Member list (members belong to a brand, not just an organization)
  - Release schedule
  - Email templates and branding
  - Compliance settings (different shipping states for different brands)
- Brand switching: staff can switch between brands in the UI (dropdown in header)
- Cross-brand analytics: organization-level dashboard aggregates across all brands
- Independent billing: each brand can have its own Stripe subscription, or share one
- Use case: a winery operates a premium reserve club and a casual monthly club as separate brands

### 5.6 White-Label Portals

- Enterprise tier (Reserve, $1,500+/mo) wineries can white-label the member portal
- Custom domain: member portal served at `club.{winerydomain}.com` instead of `portal.vinifera.ai`
- Custom branding: winery logo, colors, fonts applied to member portal
- Custom email: transactional emails sent from winery's domain (already supported via Resend in Phase 3 — extend to per-brand sender identity)
- Custom subdomain: staff portal can also be white-labeled
- DNS configuration: automated CNAME verification for custom domains
- SSL: automated certificate provisioning via Cloudflare for custom domains

### 5.7 Capacitor.js Mobile Wrapper

- Wrap the existing web application in a native mobile shell using Capacitor.js
- iOS and Android builds from a single codebase
- Native features:
  - Push notifications (member: shipment shipped, release reminder, decline notice)
  - Biometric authentication (Face ID / fingerprint for member login)
  - Camera (staff: scan barcodes at pack station)
  - Offline mode: member portal caches recent shipments and loyalty ledger
- App store distribution:
  - iOS: TestFlight for beta, App Store for production
  - Android: internal testing track, Play Store for production
- Deep linking: `vinifera.ai://portal` opens the app to the member portal
- Signed-store update policy: the app checks minimum/latest supported versions
  and directs the user to an App Store or Play Store release. It never downloads
  or executes replacement web code after signing. This security and store-policy
  decision supersedes the original Capacitor live-update proposal; see
  [the Phase 5 ADR](../decisions/2026-07-26-phase-5-scale-integrations.md).

### 5.8 Database Schema (Phase 5 Tables)

```
integrations
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - integration_type (enum: klaviyo, quickbooks, avalara, meta, shipcompliant)
  - status (enum: connected, disconnected, error)
  - credentials (jsonb, encrypted)  -- API keys, OAuth tokens
  - last_sync_at (timestamptz, nullable)
  - sync_config (jsonb)  -- field mappings, frequency, filters
  - created_at, updated_at (timestamptz)

sync_log
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - integration_id (uuid, FK → integrations)
  - sync_type (text)
  - records_synced (integer)
  - records_failed (integer)
  - error_details (jsonb, nullable)
  - created_at (timestamptz)

brands
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - name (text)
  - description (text, nullable)
  - logo_url (text, nullable)
  - primary_color (text, nullable)
  - custom_domain (text, nullable)
  - stripe_customer_id (text, nullable)  -- independent billing if separate
  - created_at, updated_at (timestamptz)

-- Modify existing tables through an additive migration:
-- 1. add brand_id as nullable;
-- 2. create one default brand per organization and backfill every row;
-- 3. enforce brand_id NOT NULL once the backfill is complete.
-- members: brand_id (uuid, FK → brands, NOT NULL after backfill)
-- club_tiers: brand_id (uuid, FK → brands, NOT NULL after backfill)
-- releases: brand_id (uuid, FK → brands, NOT NULL after backfill)
-- shipments: brand_id (uuid, FK → brands, NOT NULL after backfill)

meta_conversion_events
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members, nullable)
  - event_name (text)
  - event_id (text, unique)  -- for deduplication
  - event_data (jsonb)
  - user_data_hashed (jsonb)  -- SHA-256 hashed PII
  - sent_at (timestamptz, nullable)
  - status (enum: pending, sent, failed)
  - created_at (timestamptz)

mobile_devices
  - id (uuid, PK)
  - member_id (uuid, FK → members)
  - device_token (text)  -- push notification token
  - platform (enum: ios, android)
  - app_version (text)
  - last_active_at (timestamptz)
  - created_at (timestamptz)
```

---

## Implementation Instructions for Codex

### Build Order

1. **Integration framework** — generic integration connector pattern (auth, sync, logging)
2. **Klaviyo** — bidirectional sync, field mapping, webhook receiver
3. **QuickBooks** — OAuth, sales receipt sync, account mapping, reconciliation
4. **Avalara** — tax calculation, jurisdiction resolution, filing integration
5. **Meta CAPI** — server-side conversion tracking, PII hashing, deduplication
6. **Multi-brand** — brand model, modify existing tables, brand switching UI, cross-brand analytics
7. **White-label** — custom domain, branding, DNS verification, SSL
8. **Capacitor.js** — mobile wrapper, native plugins, push notifications, biometric auth
9. **App store** — TestFlight and Play Store internal track submission
10. **QA Gate** — run full QA suite
11. **Deploy** — production (this phase goes to production, not just staging)

### Subagent Delegation

Codex should spawn subagents for:
- Backend: integration framework, Klaviyo API client, QuickBooks API client, Avalara API client, Meta CAPI client
- Frontend: integration settings UI, brand switcher, white-label theming, mobile-responsive adjustments
- Database: multi-brand schema migration (additive — must not break existing data)
- Mobile: Capacitor.js setup, native plugin configuration, push notification setup, app store submission
- QA: integration sync verification, mobile app testing, multi-brand isolation testing

### Integration Priority

If time or scope requires prioritization, implement in this order:
1. Klaviyo (highest user demand — marketing automation is table stakes)
2. QuickBooks (accounting sync eliminates manual bookkeeping)
3. Avalara (replaces Phase 4's basic tax estimate with full compliance)
4. Multi-brand (unlocks enterprise customers)
5. Meta CAPI (ad attribution — important but not blocking daily operations)
6. White-label (nice-to-have for top-tier customers)
7. Capacitor.js (mobile app — extends reach but web is fully functional)

---

## QA Gate (Phase 5)

### Functional Tests

#### Klaviyo
- [ ] Member data syncs to Klaviyo on create/update
- [ ] Segment data (churn risk, engagement) syncs to Klaviyo
- [ ] Klaviyo engagement events (opens, clicks) sync back to Vinifera
- [ ] Field mapping is configurable and persists
- [ ] Status changes sync in real-time; engagement syncs hourly
- [ ] Klaviyo list management adds/removes members based on tier and status
- [ ] Sync log records every sync with record counts and errors

#### QuickBooks
- [ ] Shipment charges sync as sales receipts in QuickBooks
- [ ] Club tiers map to correct QuickBooks income accounts
- [ ] Shipping charges map to shipping income account
- [ ] Refunds sync as refund receipts
- [ ] Tax line items sync correctly
- [ ] Daily batch sync runs on schedule
- [ ] Monthly reconciliation report matches Vinifera revenue to QuickBooks

#### Avalara
- [ ] Real-time tax calculation at charge time
- [ ] Address → jurisdiction → tax rate resolution works
- [ ] Wine-specific taxability rules applied per state
- [ ] Tax-exempt customers handled correctly
- [ ] Tax audit trail logs every calculation
- [ ] Tax liability summary displays by state and period
- [ ] Avalara auto-filing configured for at least one state

#### Meta CAPI
- [ ] Member signup sends Lead event to Meta
- [ ] First shipment sends Purchase event
- [ ] Tier upgrade sends Custom event
- [ ] PII is SHA-256 hashed before sending
- [ ] Event deduplication prevents double-counting
- [ ] Consent management: events only sent for consented users
- [ ] Conversion events visible in Meta Events Manager

#### Multi-Brand
- [ ] Create a second brand within an organization
- [ ] Each brand has independent tiers, members, releases
- [ ] Brand switcher in UI works correctly
- [ ] Cross-brand analytics aggregates across brands
- [ ] RLS enforces brand isolation (brand A staff cannot see brand B data within same org)
- [ ] Independent billing: brand can have separate Stripe subscription

#### White-Label
- [ ] Custom domain serves member portal at `club.{domain}.com`
- [ ] Custom branding (logo, colors) applied
- [ ] DNS CNAME verification works
- [ ] SSL certificate auto-provisioned
- [ ] Transactional emails sent from winery's domain

#### Capacitor.js Mobile
- [ ] iOS build installs via TestFlight
- [ ] Android build installs via Play Store internal track
- [ ] Push notifications delivered (shipment shipped, release reminder)
- [ ] Biometric authentication (Face ID / fingerprint) works
- [ ] Camera barcode scanning works at pack station
- [ ] Offline mode caches recent shipments and loyalty ledger
- [ ] Deep linking opens app to correct screen
- [ ] Store-version policy recommends or requires the latest signed release
      without downloading executable code

### Accessibility (axe-core)

- [ ] 0 axe-core WCAG 2.1 AA violations on integration settings, brand switcher, white-label config pages
- [ ] Mobile app: 0 axe-core violations on all screens
- [ ] Brand switcher dropdown is keyboard accessible
- [ ] Integration connection/disconnection flows have clear status feedback (aria-live)
- [ ] Color contrast ≥ 4.5:1 including white-labeled themes (winery custom colors must meet contrast)
- [ ] Push notification content is accessible (text-based, no image-only notifications)

### Visual / Layout

- [ ] Integration settings page renders correctly at all breakpoints
- [ ] Brand switcher visible and functional at 375px
- [ ] White-labeled portal renders correctly with custom branding
- [ ] Mobile app screens render correctly on iPhone SE (375px) and iPhone 15 Pro Max (430px)
- [ ] Mobile app screens render correctly on common Android sizes (360px, 412px)
- [ ] Touch targets ≥ 44×44px on mobile app (iOS HIG and Android Material guidelines)
- [ ] `visual_qa` passes on all screenshots

### Performance

- [ ] Klaviyo sync: 1000 members syncs < 30s
- [ ] QuickBooks sync: 100 transactions syncs < 60s
- [ ] Avalara tax calculation: < 500ms per transaction
- [ ] Meta CAPI: events sent within 5s of conversion
- [ ] Multi-brand dashboard loads < 2s with multiple brands
- [ ] Mobile app: cold start < 3s, warm start < 1s
- [ ] Mobile app: offline cache loads < 500ms

### Security

- [ ] All integration credentials encrypted at rest (AES-256)
- [ ] OAuth tokens (QuickBooks) refreshed automatically before expiry
- [ ] Klaviyo webhook verifies request signature
- [ ] Meta CAPI: PII hashed before any network transmission
- [ ] Consent state verified before sending data to any third party
- [ ] White-label custom domains: SSL enforced, no mixed content
- [ ] Mobile app: no sensitive data stored in device storage unencrypted
- [ ] Mobile app: biometric auth uses platform secure enclave/keychain
- [ ] Push notification tokens stored securely

### Mobile

- [ ] Mobile app tested on real iOS device (or BrowserStack iOS)
- [ ] Mobile app tested on real Android device (or BrowserStack Android)
- [ ] Push notifications received when app is in background and foreground
- [ ] Biometric auth falls back to magic-link if biometric unavailable
- [ ] Offline mode: app functions without network for cached data
- [ ] App handles network restoration gracefully (sync queued actions)
- [ ] App handles background → foreground transition correctly

### Exit Criterion Verification

- [ ] Klaviyo: connect a test Klaviyo account, sync members, verify engagement flows back
- [ ] QuickBooks: connect a test QuickBooks account, process a shipment, verify sales receipt appears
- [ ] Avalara: process a shipment, verify real-time tax calculation (not just estimate)
- [ ] Meta CAPI: trigger a member signup, verify event appears in Meta Events Manager
- [ ] Multi-brand: create a second brand, verify isolation, verify cross-brand analytics
- [ ] White-label: configure a custom domain, verify portal serves at custom domain with branding
- [ ] Capacitor.js: install app on iOS and Android, verify core features (login, shipment view, loyalty, push)

---

## Deliverables

- Three+ third-party integrations live in production (Klaviyo, QuickBooks, Avalara or Meta)
- Multi-brand tenancy
- White-label portal capability
- Capacitor.js mobile app (iOS + Android, TestFlight + Play Store internal track)
- Integration framework (extensible pattern for future integrations)
- QA test report (saved as `docs/build-specs/phase-5-qa-report.md`)
- ADRs for architectural decisions
- Mobile app store listings (App Store and Play Store)
- Updated CHANGELOG.md

---

## Pre-Provisioned Credentials

Phase 5 builds on Phases 1–4 credentials. The following additional credentials
and account authority are not pre-provisioned and must be obtained before hosted
activation:

| Credential or authority | Purpose | How to obtain |
|-------------------------|---------|---------------|
| Klaviyo private API key (per winery connection) | Klaviyo marketing automation | Register at https://klaviyo.com, create private API key |
| `QUICKBOOKS_CLIENT_ID` | QuickBooks OAuth client | Register app at https://developer.intuit.com |
| `QUICKBOOKS_CLIENT_SECRET` | QuickBooks OAuth secret | Same as above |
| Avalara account ID and license key (per winery connection) | Avalara tax compliance | Register at https://developer.avalara.com |
| Meta dataset ID and access token (per winery connection) | Meta Conversions API | Register at https://developers.facebook.com |
| `MOBILE_APPLE_TEAM_ID` | iOS association and distribution identity | Apple Developer Program ($99/yr) |
| Google Play service-account authority | Android distribution | Google Play Developer account ($25 one-time) |

The initial shared-variable proposals `KLAVIYO_API_KEY`, `AVALARA_API_KEY`,
`META_APP_ID`, `META_APP_SECRET`, `APPLE_DEVELOPER_TEAM_ID`, and
`GOOGLE_PLAY_SERVICE_ACCOUNT` are superseded by the implemented security
boundary. Winery-specific Klaviyo, Avalara, and Meta credentials are submitted
only to the server and stored as encrypted per-connection envelopes. QuickBooks
uses the application variables above plus `QUICKBOOKS_ENVIRONMENT`,
`QUICKBOOKS_REDIRECT_URI`, and `QUICKBOOKS_STATE_SIGNING_SECRET`; returned
winery tokens use the encrypted envelope boundary. Apple association generation
uses `MOBILE_APPLE_TEAM_ID`. Google Play authority remains outside the runtime,
while Android push uses the separate `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and
`FCM_PRIVATE_KEY` Worker bindings. The complete non-secret contract is in
[`.env.example`](../../.env.example).

**App store credentials** require paid developer accounts. If these are not available, Codex should build and test the mobile app via local builds and emulators, and escalate to the human supervisor for store submission.

**Stripe production keys** — Phase 5 is the transition from test mode to production. The `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` GitHub repo secrets must be updated from `sk_test_*`/`pk_test_*` to `sk_live_*`/`pk_live_*` before production launch. Codex should escalate to the human supervisor for this transition — it should not be automated.

---

## Constraints

- **Integrations are opt-in.** Wineries must explicitly connect each integration. No data leaves Vinifera without explicit consent.
- **PII must be hashed.** Meta CAPI and any integration receiving user data must receive SHA-256 hashed PII, never raw.
- **Multi-brand migration is additive.** Adding `brand_id` to existing tables
  must not break existing single-brand data. The migration adds the column as
  nullable, creates one default brand per organization, backfills every existing
  row, validates the result, and only then enforces `NOT NULL`.
- **White-label requires custom domain DNS.** Wineries must configure DNS (CNAME). Document the setup process clearly.
- **Mobile app is a wrapper, not a rewrite.** The web application is the source of truth. Capacitor.js wraps it. Do not build separate native screens unless a native feature (camera, biometrics, push) requires it.
- **This phase goes to production.** Phases 1–4 can use staging/test mode. Phase 5 integrations must work with real third-party accounts in production. Use sandbox/test accounts for third-party APIs during development, but verify against production APIs before exit.
- **App store guidelines.** iOS App Store and Google Play have specific guidelines for subscription apps. Review and comply with:
  - Apple: Subscription terms must be clearly disclosed. No external payment links in app (Apple's payment system required for digital subscriptions) — wine club memberships may qualify as physical goods (exempt from Apple IAP requirement). Codex should verify this interpretation.
  - Google: Similar rules. Physical goods are exempt from Google Play billing requirement.
