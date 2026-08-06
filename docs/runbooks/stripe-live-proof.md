# Gate 19 Stripe live charge and refund proof

This runbook executes exactly one Stripe-hosted live subscription charge, one
full refund, signed webhook-idempotency proof, application lifecycle
reconciliation, and renewal cleanup. It does not activate or revert Worker
Stripe bindings; use **Stripe live billing cutover** separately.

## Preconditions

- The reviewed exact `main` release is live and its billing and webhook health
  capabilities are configured with the previously approved live bindings.
- The `production` GitHub environment retains owner protection.
- `config/stripe-live-proof-policy.json` was reviewed, explicitly enabled, and
  contains exactly one hash for each target.
- The hash-authorized brand and organization identify the one
  `independent`-billing subject for the dedicated customer, and that subject has
  no non-canceled subscription.
- The selected active recurring monthly Price has
  `metadata.vinifera_plan` on both Price and Product, uses USD, and does not
  exceed the independently reviewed maximum cent amount.
- The live webhook endpoint reaches `/api/billing/webhook` and includes
  subscription created/updated/deleted plus invoice success/failure events.
- The execution inputs and secrets listed in
  `hosted-environment-provisioning.md` are populated in `production`.

## Review target hashes

Hash the exact values locally and place one digest in each matching policy
allowlist:

```bash
node -e 'const {createHash}=require("node:crypto");process.stdout.write(createHash("sha256").update(process.argv[1].trim()).digest("hex")+"\n")' '<exact-value>'
```

Required values are the live `acct_` account ID, dedicated `cus_` customer ID,
exact brand UUID, exact organization UUID, live `price_` ID, lowercase plan
(`vine`, `cellar`, `estate`, or `reserve`), maximum amount as base-10 integer
cents, canonical production Supabase HTTPS origin, and canonical HTTPS Worker
origin.

## Prepare hosted Checkout

Generate one UUID nonce and dispatch **Stripe Gate 19 live charge and refund
proof** from exact current `main` with:

```text
operation: prepare
git_sha: <exact current main SHA>
proof_nonce: <new UUID>
checkout_session_id: <empty>
confirmation: AUTHORIZE ONE VINIFERA LIVE CHARGE AND REFUND
request_binding_reversion: true or false
```

The run verifies that the production Worker reports the exact authorized
revision and production environment, verifies every target, and creates at
most one idempotent `cs_live_`
Session for that nonce and exact main SHA. A reused Session is retrieved and
must still be open, unpaid, unexpired, tenant-bound, and contain exactly one
unit of the reviewed Price. Any other open Gate 19 Session for the dedicated
customer blocks preparation. The workflow summary presents the only payment handoff.
The owner opens that `checkout.stripe.com` link and completes payment there.
No card number, CVC, payment method token, or browser payment data enters
GitHub, Codex, the repository, or the controller.

## Finalize, refund, and clean up

After Stripe shows payment complete and the application webhook has had time
to converge, dispatch the same workflow with:

```text
operation: finalize
git_sha: <same exact authorized main SHA used by prepare>
proof_nonce: <same UUID>
checkout_session_id: <cs_live_ value from prepare>
confirmation: AUTHORIZE ONE VINIFERA LIVE CHARGE AND REFUND
request_binding_reversion: true or false
```

Finalize fails closed unless it finds the exact paid Session, one succeeded
PaymentIntent, exactly one captured Charge in the proof window, the reviewed
amount, same-main-SHA metadata, the brand-scoped application subject in
`active` state, an applied live subscription event, and duplicate responses to
two correctly signed replays. It then creates or
safely resumes exactly one full refund, cancels the subscription immediately
without proration, waits for application `canceled` state, verifies the applied
deletion event, and repeats the two signed duplicate replays.

If `main` advances between the owner completing Checkout and cleanup, finalize
still checks out and accepts the original prepare SHA only when it remains an
ancestor of current `main` and maps to its merged `staging → main`
authorization PR. This preserves the metadata-bound refund and cancellation
path without authorizing a different release.

After the exact paid subscription and Charge are identified, any later error
enters fail-safe recovery that independently attempts the same idempotent full
refund and renewal cancellation. The failure artifact records only recovery
booleans. If a prior run stopped during cleanup, rerun `finalize` with the same
inputs. It must reuse the exact refund and requires the durable applied created
event to prove prior active state; it will not invent or create another refund.
An unrelated or second refund is a hard failure.

## Evidence and optional binding reversion

Retain both workflow runs. The artifact intentionally contains only the exact
Git SHA, reviewed target hashes, provider-object hashes, proof-nonce hash,
amount, counts, booleans, application-state hashes, and timestamps. The raw
Checkout URL exists only in the prepare summary and private runner handoff,
which is deleted before artifact upload.

When `request_binding_reversion=true`, the final summary instructs the owner to
dispatch **Stripe live billing cutover** with operation `revert`, its distinct
reviewed confirmation, and the same current-main controls. Reversion is not
automatic and is not a capability of the financial-proof workflow.

Gate 19 may be marked complete only after the finalize artifact proves one
provider-derived Charge and refund counts of one, full Charge reconciliation,
four duplicate signed replays, durable active-to-canceled
application convergence, and cleanup. A prepared Session or policy enablement
alone is not completion.
