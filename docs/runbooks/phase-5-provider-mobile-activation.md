# Phase 5 provider, domain, and mobile activation

This runbook activates the Phase 5 architecture after the required provider
accounts and credentials are available. The application is safe to deploy
before activation: an unconfigured connector remains `activation_required`,
does not transmit customer data, and cannot be mistaken for a live
integration.

Never paste secret values into an issue, commit, terminal transcript, or QA
report. Record only the secret name, owner, rotation date, and the evidence
produced by the activation check.

The architecture is complete and the services in this runbook are currently
disconnected. No activation, provider retry, DNS write, filing enrollment,
live payment, or store submission is authorized merely by this document.

For Gates 14 through 16, first collect the exact-revision configuration report
described in `docs/runbooks/hosted-gates-10-16-evidence.md`. That readiness
artifact never substitutes for provider reconciliation, multi-brand isolation,
DNS ownership, or active-certificate evidence.

## 1. Shared production prerequisites

1. Apply every Supabase migration in order and run `npm run qa:db:phase5`.
2. Create the tenant-free integration wake queues referenced by
   `wrangler.jsonc` before the first Worker deployment:

   ```text
   npx wrangler queues create vinifera-integration-wake-development
   npx wrangler queues create vinifera-integration-wake-staging
   npx wrangler queues create vinifera-integration-wake-production
   ```

   Queue messages contain only a wake kind and timestamp. PostgreSQL remains
   the authoritative job/outbox store. Do not add tenant, connection, member,
   or provider identifiers to a queue message.
3. Deploy the Worker with the production Supabase bindings.
4. Configure a versioned 256-bit AES-GCM credential-wrapping key:

   - `INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS` is a JSON object whose keys are
     non-secret version names and whose values are base64-encoded 32-byte keys.
   - `INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION` identifies the version used
     for new envelopes.
   - Keep at least the active version and any version still referenced by a
     credential envelope.

5. Confirm `/api/health` returns Worker JSON rather than the static Pages
   application shell.
6. Confirm production rejects provider simulator flags.
7. Confirm a staff user without a brand grant cannot access another brand in
   the same organization.
8. Suspend one independent test brand and confirm member access, release/retry
   claims, integration work, and new charge attempts fail closed for that brand
   without suspending an active sibling brand.
9. Attempt every service-only privileged operation as a browser and ordinary
   authenticated role. Confirm each attempt is denied even with valid
   organization and brand identifiers.

Rotate the wrapping key by adding a new version, changing the active version,
authorizing the exact project/key transition in the disabled-by-default
rotation policy, rewrapping stored integration, Meta-attribution, and
mobile-push envelopes through leased resumable batches, verifying the
old-version count is zero, and only then removing the old key.

## 2. Connector activation contract

Each connector follows the same lifecycle:

1. An organization owner explicitly opts in.
2. Credentials are submitted over HTTPS to the Worker.
3. The Worker validates the provider account and stores an AES-256-GCM
   envelope. The browser receives only redacted metadata.
4. The connection becomes `configured`.
5. A scoped bootstrap sync runs through a leased, idempotent job.
6. Reconciliation must pass before the connection becomes `active`.
7. Authentication, signature, or repeated delivery failures move the
   connection to `degraded`; they never silently disable consent checks.

Disconnecting a provider stops new jobs immediately, revokes provider tokens
when the provider supports revocation, and preserves sanitized reconciliation
history for audit.

An organization that uses deployment-managed secrets may store only an exact
`env://VINIFERA_INTEGRATION_SECRET_<NAME>` reference. The referenced Worker
binding contains the credential JSON. Arbitrary vault schemes and paths are
rejected; a reference is not an activation signal.

## 3. Klaviyo

Required account material:

- a private Klaviyo API key scoped to profiles, lists, events, and the
  organization-selected capabilities;
- list IDs and the approved Vinifera-to-Klaviyo field mapping; and
- a system-webhook signing secret when that Klaviyo account supports system
  webhooks.

Activation:

1. Connect the private key in **Settings → Integrations → Klaviyo**.
2. Review and explicitly approve the outbound field mapping.
3. Map club tiers and statuses to Klaviyo lists.
4. Run the asynchronous bulk profile import and wait for its terminal status.
5. Enable signed engagement webhooks when available.
6. Leave the cursor-based Events API poller enabled as the durable fallback.

The webhook endpoint accepts Klaviyo's canonical `Klaviyo-Signature`,
`Klaviyo-Timestamp`, and `Klaviyo-Webhook-Id` headers. It verifies HMAC-SHA256
over the raw request body followed by the HTTP-date timestamp, requires the
header webhook ID to equal `meta.klaviyo_webhook_id`, and processes at most
1,000 allowlisted open/click events from the `data` batch.

Evidence:

- a 1,000-profile bulk job is accepted within 30 seconds and reaches a
  successful provider terminal state;
- one member update and one tier/status list change are visible in Klaviyo;
- one open and one click are reflected back in Vinifera;
- a tampered or stale webhook signature is rejected; and
- disconnecting the connector prevents subsequent outbound disclosure.

## 4. QuickBooks Online

Deploy-time application secrets:

- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_REDIRECT_URI`
- `QUICKBOOKS_ENVIRONMENT` (`sandbox` during activation rehearsal,
  `production` only for the approved production company)

Activation:

1. Register the exact HTTPS callback URL in the Intuit application.
2. Start OAuth from **Settings → Integrations → QuickBooks**.
3. Confirm the returned realm/company before approving the connection.
4. Map each club tier to an income item/account and choose the deposit account.
   Map the separately persisted shipping charge to its approved freight item
   or account rather than combining it with wine revenue.
5. Run the bootstrap receipt/refund sync.
6. Run monthly reconciliation and resolve every ambiguous provider outcome.

Every write uses a stable Intuit `requestid` derived from its operation identity
with SHA-256; provider transaction IDs are persisted. Access-token refresh is
serialized, and the latest rolling refresh token is durably stored before the
new access token is used.

Evidence:

- 100 sandbox transactions are accepted within 60 seconds without duplicates;
- a shipment charge appears as the expected sales receipt;
- a refund appears as the expected refund receipt;
- 4,863-cent and 4,862-cent refund increments converge to exactly 9,725 cents;
- the tax line and account mappings match the Vinifera source records;
- forced token expiry performs exactly one successful refresh; and
- reconciliation reports a zero unexplained difference.

## 5. Avalara

Required account material:

- account ID and license key;
- company code;
- the approved production or sandbox AvaTax HTTPS origin;
- product tax-code mappings; and
- nexus, exemption, and filing configuration owned by the winery's tax
  administrator.

Activation:

1. Connect the credentials and validate the company code.
2. Configure origin addresses and wine/shipping tax-code mappings.
3. Verify nexus, provider customer/exemption references, entity-use codes, and
   exemption effective dates with the winery's tax administrator.
4. Calculate a sandbox shipment before Stripe confirmation. The transaction
   must remain `Saved`.
5. Simulate a successful charge and verify the same AvaTax transaction becomes
   `Committed`.
6. Issue one partial and one completing refund. Confirm each cumulative change
   produces only the unreported refund amount, creates a committed
   `ReturnInvoice` against the original transaction, and reduces the liability
   report instead of adding positive tax.
7. Interrupt the refund flow after one of QuickBooks or Avalara acknowledges
   its write. Restart reconciliation and confirm the durable checkpoint resumes
   only the incomplete provider operation without duplicating the completed
   write.
8. Request a read-only filing-registration snapshot and review current,
   pending, inactive, and stale jurisdictions.
9. Configure auto-filing in the Avalara account for at least one approved
   state only after separate winery tax-administrator authority; Vinifera
   records status but does not silently enroll a jurisdiction.

When an organization has opted into Avalara, a calculation failure blocks the
charge. ShipCompliant remains the alcohol-shipping compliance authority.

Evidence:

- a representative calculation completes in under 500 ms at the provider
  boundary;
- jurisdiction detail, exemption, shipping tax, and total tax match AvaTax;
- no failed charge produces a committed transaction; and
- reconciliation finds no saved transaction stranded after a successful
  charge.

## 6. Meta Conversions API

Required account material:

- dataset/pixel ID;
- server access token;
- approved Graph API version; and
- an optional test-event code for activation rehearsal.

Activation:

1. Connect the dataset and token.
2. Review the consent policy and event mapping.
3. Verify browser attribution is written only after current member consent,
   uses an authenticated encrypted envelope, and never appears in Web Storage.
4. Send `Lead`, `Purchase`, `tier_upgrade`, and `referral` test events.
5. Verify each stable `event_id` in Meta Events Manager.
6. Withdraw consent and confirm the encrypted browser attribution is redacted
   while minimized campaign/response-hash audit facts remain.
7. Remove the test-event code before production activation.

Email, phone, name, address fragments, birth date, and external identifiers
are normalized and SHA-256 hashed before the network request object is
constructed. Raw identifiers are never written to the conversion ledger or
integration log.

Evidence:

- an unconsented event is suppressed;
- the transport test proves no raw identifier is present;
- a browser/server duplicate shares one `event_id`; and
- acknowledged events appear in Events Manager within five seconds.

## 7. White-label custom domains

Deploy-time secrets/configuration:

- a Cloudflare API token scoped only to custom hostnames for the service zone;
- the Cloudflare zone ID; and
- the validated fallback origin.

Activation:

1. Add the hostname to the brand.
2. Give the winery the exact CNAME and ownership-verification records returned
   by Cloudflare.
3. Poll until domain control and certificate issuance are both active.
4. Verify the hostname resolves to the intended brand and never to a sibling
   brand.
5. Verify HTTPS redirect, HSTS, no mixed content, the brand manifest/icons,
   and an unbranded authentication fallback on unknown hosts.
6. Configure at most one sender identity for the brand. Address replacement
   updates that identity and resets it to `pending`; clearing it marks it
   `disabled`. Do not send branded email until provider verification advances
   the identity to `verified`.

The staff white-label surface is the operational UI for the brand theme,
accessible foreground, HTTPS logo, portal title, custom hostname, and
transactional sender. Resend domain creation/verification is scoped to the
exact brand sender domain; a global default sender does not verify it.

Before Cloudflare receives a request, the zone and fallback origin must match
the reviewed hashes in `config/provider-target-policy.json`. Hostname creation
uses a durable attempt ledger. If the result is indeterminate, reconcile by
hostname/brand lookup; do not issue another create until the provider identity
is known. Hostname deletion has its own durable ledger. After an indeterminate
DELETE, retry through the staff surface so the server performs a GET-only
reconciliation first. Another DELETE is allowed only if that lookup proves the
provider object still exists. A provider 404 is finalized locally without
replaying DELETE.

Do not mark a hostname active based only on DNS propagation. Cloudflare
hostname status and certificate status must both be active.

## 8. Native mobile activation

The checked-in Capacitor projects wrap the same built React application. They
do not contain a separate product implementation.

Apple prerequisites:

- an Apple Developer team and signing identities;
- App Store Connect application record;
- push-notification entitlement and an APNs token-signing key; and
- `APNS_ENVIRONMENT=sandbox` for development-signed builds or
  `APNS_ENVIRONMENT=production` for distribution-signed builds.

Google prerequisites:

- a Play Console application and upload/app-signing configuration;
- a narrowly scoped service account for the internal track;
- Firebase Android configuration (`google-services.json`) for FCM push; and
- a supported Java/Android SDK toolchain.

Release sequence:

1. Run `npm run qa:mobile:identity` and `npm run build:mobile`.
2. Build and install the iOS project on a simulator and a real device.
3. Build and install the Android debug project on an emulator and a real
   device.
4. Verify magic-link deep links, Keychain/Keystore storage, biometric fallback,
   push in foreground/background, camera scanning, read-only offline data,
   network restoration, and foreground relock.
5. Create two brands with the same normalized member email. Confirm the mobile
   request requires the intended brand's normalized `clubCode`, rejects an
   invalid selector without sending mail, and returns an explicit choose-club
   conflict rather than guessing when the selector is missing or globally
   ambiguous.
6. Exercise the web magic-link flow and tamper with each organization, brand,
   redirect, and member context field. Confirm the exact-context HMAC rejects
   every mismatch before tenant or member context is accepted.
7. Archive signed release builds and upload only after store metadata, privacy
   disclosures, and the physical-goods payment explanation are reviewed.
8. Release to TestFlight and the Play internal track before any public review.

The native bundle never downloads executable web code or self-updates an APK
or IPA. The version endpoint may recommend or require a signed store update.

### Push activation by platform

iOS delivery uses APNs directly. Configure these Worker secrets as one set:

- `APNS_ENVIRONMENT` (`sandbox` or `production`);
- `APNS_BUNDLE_ID` (must exactly equal `MOBILE_IOS_BUNDLE_ID`);
- `APNS_TEAM_ID`;
- `APNS_KEY_ID`; and
- `APNS_PRIVATE_KEY`.

Confirm the signed app's `aps-environment` entitlement agrees with the Worker
environment: development/sandbox for local device rehearsal and
production/production for TestFlight or App Store builds. Send one
foreground, background, and tapped-notification test in each environment.
Never send a sandbox device token to the production APNs host.

Android delivery uses FCM, not APNs. Configure `FCM_PROJECT_ID`,
`FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY`, install the matching
`google-services.json` only through the protected build/signing environment,
then test foreground, background, and tapped-notification delivery from the
Play internal track. The service-account key and Firebase configuration are
not interchangeable.

If either platform is not yet credentialed, the whole production push queue
remains dormant and claims no messages. This joint activation rule prevents
attempts for the pending platform from being leased or burned. Missing
credentials are an activation condition, not permission to use a simulator or
route one platform through the other provider.

## 9. Production launch controls

The following actions always require a human owner:

- replacing Stripe test keys with approved live keys;
- enabling Stripe live webhooks and running a controlled real payment/refund;
- granting Avalara filing authority;
- approving customer-data mappings and consent purposes;
- changing winery DNS;
- accepting Intuit, Meta, Apple, Google, or Klaviyo production terms; and
- submitting signed binaries to an app store.

Stripe live activation additionally remains disabled in
`config/stripe-live-billing-policy.json`. It requires independent authority,
reviewed Worker/account/webhook hashes, canonical test/live Price contracts,
an immutable commit, exact protected confirmation, and post-change health
evidence. Production Worker deployment cannot turn live billing on.

The controlled charge/refund proof uses the separate, default-disabled
`config/stripe-live-proof-policy.json` and `stripe-live-proof.yml`. It requires
an owner-completed Stripe-hosted Checkout, exactly one hash-authorized live
charge and refund, signed subscription-webhook idempotency, application
active-to-canceled convergence, and subscription cleanup. It cannot upload a
Worker version or change Stripe bindings; optional reversion uses the cutover
workflow independently.

Phase 5's hosted exit criterion passes only after at least Klaviyo,
QuickBooks, and one of Avalara or Meta are verified against real provider
accounts, two brands pass isolation checks, one custom domain is serving with
an active certificate, and the signed app is installed from both TestFlight
and the Play internal track.
