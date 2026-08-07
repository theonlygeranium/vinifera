# Phase 2 hosted acceptance — Gate 6

This runbook closes Gate 6 only after Gate 13 has passed against the exact same
staging revision. It creates Stripe test-mode and EasyPost test-mode provider
objects and mutates only dedicated staging fixtures. Source validation, a
successful workflow, or an HTTP 200 does not by itself complete the gate.

## One-shot controls

The protected workflow is `.github/workflows/gate6-staging-acceptance.yml`.
It runs only from canonical `main`, requires the exact current `staging` SHA,
and executes in `staging-acceptance-control`.

Cloudflare Access service-token headers are attached to the exact bounded
staging Worker and Access-protected staging Supabase origins. No other origin
receives them. The Worker cookie jar honors `Max-Age` and `Expires` deletion
attributes so a cleared base cookie cannot shadow valid Supabase SSR chunks.

Keep both checked-in controls disabled until the reviewed target values and
fixtures are ready:

- `config/gate6-staging-acceptance-policy.json` has `enabled: false` and empty
  hash arrays;
- environment variable `STAGING_GATE6_ACCEPTANCE_ENABLED` is not `true`.

The environment secret `STAGING_GATE6_ACCEPTANCE_MANIFEST` is schema version 1
and contains:

```json
{
  "schemaVersion": 1,
  "candidateRevision": "<exact 40-character staging SHA>",
  "cleanupMode": "retire",
  "organizationId": "<staging UUID>",
  "brandId": "<staging UUID>",
  "crossTenantBrandId": "<sibling staging UUID>",
  "staffEmail": "owner+vinifera-g6-staff@example.test",
  "staffPassword": "<staging fixture password>",
  "tierId": "<dedicated tier UUID>",
  "releaseId": "<dedicated scheduled release UUID>",
  "members": [
    {
      "id": "<dedicated member UUID>",
      "email": "owner+vinifera-g6-member-1@example.test",
      "shipmentId": "<expected shipment UUID>",
      "declined": false
    }
  ]
}
```

Provide exactly ten member entries and mark exactly one `declined: true`.
Every member must be active, undeleted, assigned to the manifest tier, and
owned by the manifest organization and brand. Prepare the release shipments
once with the production `create_release_shipments` RPC, then record those ten
IDs in the manifest; the release is consequently `processing`. All ten pending
shipments must be dedicated to this acceptance attempt and have no prior
billing or label-attempt rows. The
winery origin, member adult-signature contact data, birthdays, and destination
addresses must satisfy the already-activated EasyPost and ShipCompliant sandbox
contracts.

The dedicated fixture staff user must be active in the manifest organization
with the `owner` or `admin` role. The controller verifies that refund authority
before creating any Stripe Customer, PaymentMethod, charge, or label so a
manager-only fixture cannot consume the one-shot lifecycle and fail at refund.

`crossTenantBrandId` must identify a real active brand in a different dedicated
staging organization. The controller proves the fixture staff row belongs only
to the declared organization before requiring an exact HTTP 403 for that brand;
a missing or random UUID is not accepted as tenant-isolation evidence.

The manifest's `candidateRevision` must be the immutable staging revision used
by the dispatch and Gate 13 evidence. After that revision exists, hash the exact
unmodified manifest bytes, including any final newline, with
`shasum -a 256 < manifest.json`. Store those same bytes as the protected
environment secret and put the digest in protected environment variable
`STAGING_GATE6_ACCEPTANCE_MANIFEST_SHA256`. The controller resolves both only
inside `staging-acceptance-control` and does not trim the bytes before comparing
the runtime digest.

The checked-in policy separately authorizes the stable fixture identity while
excluding the per-run candidate and fixture password. Generate that digest
from the normalized manifest contract:

```bash
node --input-type=module - manifest.json <<'NODE'
import { readFile } from "node:fs/promises";
import {
  fixtureContractSha256,
  validateFixtureManifest,
} from "./scripts/hosted-gate6-phase2-acceptance.mjs";
const raw = JSON.parse(await readFile(process.argv[2], "utf8"));
console.log(fixtureContractSha256(validateFixtureManifest(raw)));
NODE
```

Hash the normalized staging Worker origin, normalized staging Supabase origin,
and Stripe test account ID. Put exactly one lowercase SHA-256 value in each
checked-in `fixtureContractSha256` and provider-target policy array, set policy
`enabled: true` through a reviewed PR, and set the protected manifest digest
and environment toggle only after the immutable candidate is available. This
avoids requiring a candidate-specific manifest hash in the commit that must
precede that candidate. The Stripe credential must begin with `sk_test_`; the
controller rejects any other mode before constructing a Stripe client.

## Prerequisite Gate 13 proof

1. Promote and deploy the intended reviewed candidate to staging.
2. Run `ShipCompliant staging acceptance` against that exact staging SHA.
3. Confirm its retained artifact reports Gate 13 `passed: true`,
   `cleanup: true`, and `completionClaimed: false`.
4. Record that successful Actions run ID. Gate 6 downloads the immutable
   artifact and verifies its workflow path, conclusion, run ID, and exact
   candidate revision before creating Stripe objects.

## Dispatch

From canonical `main`, dispatch `Gate 6 staging acceptance` with:

- `control_sha`: current 40-character `main` SHA;
- `candidate_revision`: current 40-character `staging` SHA;
- `gate13_run_id`: successful exact-candidate Gate 13 run ID; and
- `confirmation`: `RUN VINIFERA GATE 6 PHASE 2 ACCEPTANCE`.

The workflow first runs `npm run qa:gate6-acceptance`, then performs the hosted
acceptance. After installing dependencies and retrieving the exact Gate 13
artifact, it re-fetches canonical `main` and `staging` and compares both heads
again immediately before invoking the provider controller. It fails closed on
any authority or target drift, missing fixture, cross-tenant
visibility, live-mode authority, simulator, prerequisite mismatch, provider
failure, missing audit row, or incomplete retirement.

## Evidence review

Download the 90-day `gate6-phase2-<candidate>-<run>-<attempt>` artifact. Accept
the run only when:

- `passed` and `cleanup` are `true`;
- all twelve checks are `true`;
- the Gate 13 run binding matches the reviewed prerequisite;
- exactly ten test Customers/PaymentMethods, ten successful PaymentIntents,
  ten EasyPost label IDs/tracking numbers, one decline/recovery path, and one
  refund ID are represented by the scoped hosted records;
- the organization audit segment has continuous sequence/hash linkage and
  contains the expected release, shipment charge/decline, label aggregate,
  packing, shipping, delivery, and refund actions for the exact fixture IDs;
- the ten dedicated members are softly retired; and
- `completionClaimed` remains `false`.

After downloading the artifact, return the environment toggle to `false` and
remove the per-run `STAGING_GATE6_ACCEPTANCE_MANIFEST_SHA256` value, then
restore the checked-in policy to its disabled empty state in a reviewed PR.
Only then reconcile the canonical activation ledger with the retained run,
candidate, Gate 13 prerequisite, and artifact identifiers.

## Local QA

```bash
npm run qa:gate6-acceptance
npm run qa:db:phase2
npm run check
```

These commands verify the controller and Phase 2 regressions without contacting
providers or claiming hosted evidence.
