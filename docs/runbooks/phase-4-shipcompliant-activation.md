# Runbook: Activate Phase 4 ShipCompliant

**Owner:** Vinifera operations

**Scope:** Sovos sandbox onboarding, versioned contract configuration,
post-charge/pre-label compliance checks, tax estimates, durable label recovery,
and production rollback

**Safety:** A local simulator proves orchestration only. It is never evidence
that a shipment is legal. Unknown, timed-out, malformed, and non-compliant
results must all block label generation.

**Current state:** The adapter, audit ledger, dashboard, shipment fingerprint,
and fail-closed label guard are implemented locally. No hosted ShipCompliant
connection or legal-decision evidence has been recorded.

## Preconditions

- Phase 1–4 migrations and automated QA pass.
- A staging Worker is connected to the intended non-production Supabase
  project.
- The test winery has complete origin, licensing, and product data.
- Shipment fixtures contain only consented sandbox recipient data.

## 1. Obtain vendor-approved sandbox access

Register in the Sovos developer sandbox and create a sandbox app. Enable the
ShipCompliant product/resources granted to the winery account. The app produces
an API key and secret used to obtain a client-credentials access token.

Public Sovos onboarding documentation describes the developer sandbox and app
credentials, but ShipCompliant product contracts and integration payloads can
be access controlled. Contact the winery's Sovos account executive or
ShipCompliant support to obtain:

- the sandbox base URL;
- the OAuth token path;
- the shipment compliance/tax check path;
- the current request/response contract version;
- required account, license, product, and fulfillment identifiers;
- documented rate limits, decision expiry, and retry behavior.

Do not infer a production payload from examples for another Sovos product.

Official references:

- <https://docs.sovos.com/en/working-with-sovos/working-with-sovos/get-started/get-started-as-a-developer/get-started-as-a-developer/connect-to-sovos>
- <https://docs.sovos.com/en/indirect-tax/indirect-tax-products/regulated-shipping/shipcompliant/integrations/about-integrations>

## 2. Configure encrypted server bindings

Add the exact vendor-approved values as encrypted GitHub/Worker secrets:

```text
COMPLIANCE_PROVIDER=shipcompliant
COMPLIANCE_SIMULATOR_ENABLED=false
SHIPCOMPLIANT_BASE_URL
SHIPCOMPLIANT_ENDPOINT_MODE=sandbox
SHIPCOMPLIANT_TOKEN_PATH
SHIPCOMPLIANT_CHECK_PATH
SHIPCOMPLIANT_CONTRACT_VERSION
SHIPCOMPLIANT_API_KEY
SHIPCOMPLIANT_API_SECRET
SHIPCOMPLIANT_ACCOUNT_ID
SHIPCOMPLIANT_LICENSE_ID
```

The adapter requires HTTPS, an explicit contract version, an explicit check
path, and the exact vendor-approved OAuth token path. There is no default token
path. Credentials alone cannot activate a guessed contract. No value may be
Vite-prefixed or returned by a configuration endpoint.

Before the adapter sends a request, the normalized sandbox/production origin
must match the reviewed environment hash in
`config/provider-target-policy.json`. Empty hash arrays deny the request.
Production mode additionally requires the checked-in independent enable
switch. Keep it disabled while service activation is deferred.

## 3. Validate OAuth and response mapping

From the staging Worker:

1. request an OAuth client-credentials token;
2. verify the token is cached only until its provider expiry minus safety skew;
3. verify invalid credentials return a typed upstream failure without a
   shipment state change;
4. submit vendor-provided compliant, non-compliant, and unknown sandbox cases;
5. verify every usable response contains a provider response ID, decision,
   rules version, checked timestamp, and the tax result required by the active
   contract;
6. verify timeouts and unrecognized payloads map to `unknown`.

The token request and decision request share one 1.8-second request budget.
Verify a slow token response cannot receive a fresh full decision timeout.
Verify both requests reject redirects and the cached token is reused across
multiple checks until its expiry safety window.

Never log access tokens or full recipient/provider payloads.

## 4. Prove the post-charge label guard

For each sandbox shipment, complete the Stripe test-mode charge first. During
label generation, persist the ShipCompliant result immediately before invoking
EasyPost:

- `compliant`: label generation may continue;
- `non_compliant`: add a hold with the vendor reason and enqueue the configured
  member notice;
- `unknown`: add a hold and require staff recheck; do not create a label.

Replay the same provider response ID and confirm the idempotent record is
reused. A new provider decision must create a new audit record.
Change a compliance-relevant shipment field and confirm the previous decision
is no longer accepted for label generation.

Confirm the request and shipment-state SHA-256 fingerprints change when the
recipient address, validated address, winery origin, birthday/age input,
charge, loyalty discount, release/tier, or shipment items change. Confirm a
change before labeling clears the current decision and a change after labeling
is rejected.

For the EasyPost purchase boundary:

1. confirm the external carrier shipment and rate are persisted before buy;
2. retry a completed request and confirm the stored successful attempt is
   returned without another purchase;
3. expire a lease after carrier-shipment persistence and confirm the next
   worker resumes purchase from the stored shipment;
4. simulate an indeterminate buy result and confirm the next worker receives a
   reconciliation disposition rather than creating another shipment or label.

Verify the Phase 2 static state whitelist is not called when
`COMPLIANCE_PROVIDER=shipcompliant`.

## 5. Dashboard and audit proof

The staging compliance dashboard must show:

- provider health as `configured` until the first successful check, `active`
  only when the latest attempt is successful, and `degraded` when a newer
  unsuccessful/unknown attempt follows the last success;
- decision status and reason;
- tax estimate;
- checked time, the last successful provider-check time, and whether each
  decision is within the local freshness window;
- provider response identifier;
- recheck action and outcome;
- a clear activation state when the provider is disconnected.

Do not describe `lastSuccessfulCheckAt` as a provider-rules refresh time.
Recheck actions are available only while the shipment remains `charged`; later
shipment states are terminal for this operation.

Save only redacted screenshots and identifiers in the Phase 4 QA report.

## 6. Failure and rollback

- Disable label processing before changing provider configuration.
- Remove or disable `COMPLIANCE_PROVIDER` to return to a fail-closed activation
  state; do not re-enable the static whitelist as legal authority.
- Retain compliance checks and holds for audit.
- Retry uncertain calls with the same idempotency identity after comparing the
  local check ledger and vendor response.
- Apply data corrections through forward migrations or audited staff actions.
- Escalate rule disputes to the winery's compliance professional and Sovos;
  Vinifera must not override a provider hold in code.
