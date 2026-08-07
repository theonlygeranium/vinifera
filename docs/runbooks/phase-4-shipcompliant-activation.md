# Runbook: Activate Phase 4 ShipCompliant

**Owner:** Vinifera operations

**Scope:** Sovos sandbox onboarding, versioned contract configuration,
post-charge/pre-label compliance checks, tax estimates, durable label recovery,
and production rollback

**Safety:** A local simulator proves orchestration only. It is never evidence
that a shipment is legal. Unknown, timed-out, malformed, and non-compliant
results must all block label generation.

**Current state:** The adapter, audit ledger, dashboard, shipment fingerprint,
fail-closed label guard, completed-label recovery repair, and protected hosted
acceptance controller are implemented. The checked-in acceptance policy is
disabled and contains no authorized hashes. No hosted ShipCompliant connection
or legal-decision evidence has been recorded.

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

Add the exact vendor-approved values as encrypted Worker secrets and as
GitHub environment secrets in the main-branch-only
`staging-acceptance-control` environment:

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

The environment exists with a `main`-only branch policy,
`STAGING_WORKER_ORIGIN` set to the isolated Worker, and
`STAGING_GATE13_ACCEPTANCE_ENABLED=false`. Leave that one-shot toggle false
until the exact acceptance dispatch.

The adapter requires HTTPS, an explicit contract version, an explicit check
path, and the exact vendor-approved OAuth token path. There is no default token
path. Credentials alone cannot activate a guessed contract. No value may be
Vite-prefixed or returned raw by a configuration endpoint; Gate 13 compares
only SHA-256 binding identities reported by the runtime.

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

The timeout scenario must retain a `local-timeout-*` audit identity created
only from an actual deadline abort during fetch or response-body streaming.
DNS, TLS, connection reset, authentication, HTTP, and malformed-response
failures must retain their non-timeout identity and cannot satisfy this case.

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

1. confirm acquisition uses the explicit active `brand_id` and rejects a
   same-organization shipment from another brand before any attempt lookup;
   the linked current-schema pgTAP suite supplies an independently selected
   expected brand, proves a wrong-brand call fails, and selects this overload,
   while the point-in-time Phase 4 suite retains its historical compatibility
   path;
2. confirm the external carrier shipment and rate are persisted before buy;
3. retry a completed request and confirm the stored successful attempt is
   returned without another purchase;
4. expire a lease after carrier-shipment persistence and confirm the next
   worker resumes purchase from the stored shipment;
5. simulate an indeterminate buy result and confirm the next worker receives a
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

## 7. Run the protected Gate 13 acceptance

Do not dispatch until the vendor and fixture prerequisites below are complete.
The workflow executes trusted `main` code against an exact revision already
deployed to the isolated staging Worker. It does not deploy or provision the
provider.

1. Create a dedicated staging owner using a `+vinifera-g13-` email address.
2. Create six unique, dedicated shipments for the same organization and brand:
   compliant, non-compliant, unknown, timeout, fingerprint, and recovery.
   The first five must be `charged`. The recovery shipment must be
   `label_created` with exactly one real succeeded EasyPost attempt and full
   provider label evidence. The fingerprint shipment must begin with both
   `latest_compliance_check_id` and `compliance_status` null; cleanup restores
   its original address, explicitly clears every compliance pointer,
   fingerprint, decision, reason, tax, and timestamp field, and verifies that
   exact invalidated baseline even when an interrupted attempt never changed
   the address.
3. Create one shipment in a different organization and explicit different
   brand for the cross-tenant denial.
4. Store this JSON as the protected
   `STAGING_GATE13_ACCEPTANCE_MANIFEST` secret in
   `staging-acceptance-control`. That environment must also contain the Gate 13
   Cloudflare Access client values and any staging database values not supplied
   as repository secrets:

```json
{
  "schemaVersion": 1,
  "candidateRevision": "40-character canonical staging SHA",
  "organizationId": "uuid",
  "brandId": "uuid",
  "crossTenantBrandId": "uuid",
  "crossTenantShipmentId": "uuid",
  "staffEmail": "owner+vinifera-g13-fixture@example.com",
  "staffPassword": "protected-password",
  "fingerprintMutationAddress": {
    "name": "Gate Thirteen",
    "phone": "+17075550113",
    "line1": "vendor-approved alternate address",
    "city": "Napa",
    "state": "CA",
    "postalCode": "94558",
    "country": "US"
  },
  "scenarios": {
    "compliant": { "shipmentId": "uuid" },
    "nonCompliant": { "shipmentId": "uuid" },
    "unknown": { "shipmentId": "uuid" },
    "timeout": { "shipmentId": "uuid" },
    "fingerprint": { "shipmentId": "uuid" },
    "recovery": { "shipmentId": "uuid" }
  }
}
```

5. Compute SHA-256 over each stable exact binding and place exactly one
   lowercase hash in each field of
   `config/shipcompliant-staging-acceptance-policy.json`, set its `enabled`
   field to `true`, and deliver that policy through the normal reviewed
   `dev → staging → main` path. After the candidate revision is immutable,
   compute SHA-256 over the manifest secret's exact JSON byte sequence and
   store it separately as the protected
   `STAGING_GATE13_ACCEPTANCE_MANIFEST_SHA256` secret. This per-run protected
   value preserves exact-byte authorization without creating a commit-SHA
   fixed point through the manifest's `candidateRevision`. The control suite
   accepts either the empty disabled baseline or this valid reviewed enabled
   policy, while rejecting partial hash sets in both workflows.
6. Set the protected staging variable
   `STAGING_GATE13_ACCEPTANCE_ENABLED=true` only for this acceptance attempt.
7. Confirm the deployed staging revision is also the exact canonical `staging`
   head. From canonical `main`, dispatch **ShipCompliant staging acceptance**
   with the exact current `main` control SHA, that canonical staging SHA, and
   `RUN VINIFERA GATE 13 SHIPCOMPLIANT ACCEPTANCE`.
   The controller fetches both canonical refs again after acceptance and before
   artifact upload. Any ref drift fails the run and rewrites retained evidence
   to `passed: false` before it can be uploaded.
8. Accept the result only when the workflow succeeds and the retained artifact
   has `passed: true`, all eleven checks are true, `cleanup: true`, the expected
   source/target hashes and revisions match, the deployed Worker reports the
   same hashed ShipCompliant bindings, timeout evidence is explicitly
   `local-timeout-*`, every label denial carries its expected compliance
   status and decision identity, analytics matches the exact scenario
   idempotency-key set, the recovery shipment/attempt remain unchanged, and
   `completionClaimed: false`. The controller rechecks `/api/health` and
   `/api/health/configuration` after all scenarios and audit reads, and rejects
   the evidence if the staging Worker no longer reports the exact authorized
   candidate revision, Supabase target, or ShipCompliant binding hashes.
9. Return the one-shot staging variable to `false`. A later reviewed change may
   return the policy to its empty disabled state after evidence is retained.

ShipCompliant has no webhook in Vinifera's OAuth request/response integration.
The acceptance therefore verifies append-only `compliance_checks`,
`analytics_events`, and `audit_log` evidence instead of inventing a webhook
criterion.

### External prerequisites that source cannot create

- Vendor-approved ShipCompliant sandbox account, OAuth credentials, winery
  license/account identifiers, exact sandbox origin, API paths, and contract
  version.
- Vendor-authored compliant, non-compliant, unknown, and deterministic timeout
  sandbox recipient/product cases appropriate to that winery contract.
- Complete test winery origin, products, member birthdays, and charged staging
  shipments for the dedicated fixture tenant.
- A real successful EasyPost test purchase retained as the recovery fixture.
- Protected GitHub secrets/variables and reviewed policy hashes matching the
  exact byte values above.
