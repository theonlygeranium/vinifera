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
- `PRODUCTION_STRIPE_LIVE_PROOF_HANDOFF_CERTIFICATE_BASE64` contains a
  base64-encoded PEM X.509 encryption certificate whose private key is held
  only by the owner and whose validity extends beyond the Checkout handoff.

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
customer blocks preparation. The workflow encrypts the private handoff as CMS
`owner-handoff.p7m` to the configured owner certificate before artifact
upload. The summary never contains the URL, Session ID, or proof nonce.

The owner downloads the prepare artifact and decrypts locally with the
matching certificate and private key:

```bash
openssl cms -decrypt -binary -inform DER \
  -in owner-handoff.p7m \
  -recip owner-certificate.pem \
  -inkey owner-private-key.pem \
  -out gate19-handoff.json
```

The owner opens the decrypted `checkoutUrl` on `checkout.stripe.com`, retains
the decrypted `sessionId`, and completes payment there.
No card number, CVC, payment method token, or browser payment data enters
GitHub, Codex, the repository, or the controller.

Immediately before either protected operation reaches Stripe, the workflow
force-fetches current `main` and revalidates the exact merged `staging → main`
authorization PR and emergency labels. `prepare` still requires the release to
be current `main`; `finalize` requires the original release to remain an
ancestor of current `main`. Authority drift during dependency installation or
controller QA therefore stops before any financial mutation.

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

Finalize fails closed unless it finds the exact paid Session, that Session's
immutable initial invoice, one succeeded PaymentIntent, exactly one captured
Charge in the proof window, the reviewed
amount, same-main-SHA metadata, the brand-scoped application subject in
`active` state, an applied live subscription event, and duplicate responses to
two correctly signed replays. It then creates or
safely resumes exactly one full refund, cancels the subscription immediately
without proration, waits for application `canceled` state, verifies the applied
deletion event, and repeats the two signed duplicate replays.

The customer PaymentIntent inventory is queried at Stripe with the Checkout
proof-window lower bound only after the exact invoice PaymentIntent and
captured Charge have established refund eligibility. A concurrent or duplicate
proof-window payment therefore still fails closed, but cannot strand the
authorized Charge outside the idempotent refund-and-cancel recovery path.
Mutable Session and subscription metadata are certified only after that same
recovery boundary, so post-payment metadata drift fails the proof while still
refunding the exact Charge and canceling renewal.
If delayed finalization finds additional captured payments in the proof window,
it validates each invoice against the exact proof subscription and refunds all
of them before failing the one-charge gate. Cleanup attempts every validated
payment refund even when an earlier refund remains pending or fails, then
cancels renewal and reports the combined recovery failures. An unrelated
customer payment is never treated as proof-subscription recovery and cannot
discard renewal payments already validated for cleanup.
The initial Checkout payment remains pre-armed for recovery while later
subscription payments are discovered independently, so a transient repeated
lookup cannot remove the already-proven initial Charge from cleanup.
Proof-window PaymentIntent discovery fixes both the Checkout-relative start and
controller-observed end, follows at most ten provider pages, and retains each
validated subscription payment as it goes. An invalid or runaway later page
therefore fails the proof without discarding known cleanup targets.
Immediately after renewal is canceled, the controller re-scans through a new
fixed end. A subscription payment that succeeded across the cancellation
boundary is added to recovery, refunded, and fails the one-charge proof.
If an upstream proof check fails first, fail-safe cleanup uses the same order:
confirm renewal is canceled, re-scan the bounded payment window even on an
already-canceled retry, then attempt every retained refund while aggregating
provider, inventory-validation, and cleanup errors.
PaymentIntents that remain capable of settling block certification. After
application cancellation and webhook replay converge, the controller repeats
the bounded payment inventory immediately before emitting verified evidence;
any newly settled subscription payment is retained for refund and fails the
one-charge proof.
Subscription event pagination stops when the event for the exact subscription
is found, so unrelated high-volume account history cannot invalidate an
otherwise exact lifecycle proof.

Declined or otherwise failed Charge attempts associated with the one
PaymentIntent do not prevent cleanup. Finalize selects exactly one successful,
paid, captured Charge from the bounded attempt inventory and refunds that
Charge; zero or multiple successful captured Charges fail closed.

If `main` advances between the owner completing Checkout and cleanup, finalize
still checks out and accepts the original prepare SHA only when it remains an
ancestor of current `main` and maps to its merged `staging → main`
authorization PR. This preserves the metadata-bound refund and cancellation
path without authorizing a different release.

After the exact paid subscription and Charge are identified, any later error,
including current Price/Product drift after the owner paid,
enters fail-safe recovery that independently attempts the same idempotent full
refund and renewal cancellation. The failure artifact records only recovery
booleans. If a prior run stopped during cleanup, rerun `finalize` with the same
inputs. It must reuse the exact refund and requires the exact durably applied
subscription-created, subscription-updated, or invoice-payment event that
advanced the tenant-scoped subject to active. An older created event may be
`ignored` when a later applied event performed that transition; canceled
recovery uses the latest qualifying applied activation before cancellation.
Because Stripe timestamps have one-second resolution, canceled recovery also
accepts a qualifying activation at the same timestamp as the canceled subject;
event type and lifecycle validation exclude the deletion transition.
A pending exact refund is resumed. One
terminally failed or canceled exact refund attempt may be replaced under a new
idempotency key; more than one terminal failure or more than one recoverable or
successful refund is ambiguous and fails closed. Evidence counts only the one
successful full refund as the financial mutation. An unrelated refund is a
hard failure.

## Evidence and optional binding reversion

Retain both workflow runs. The artifact intentionally contains only the exact
Git SHA, reviewed target hashes, provider-object hashes, proof-nonce hash,
amount, counts, booleans, application-state hashes, and timestamps. The raw
Checkout URL is retained only inside the encrypted prepare artifact; the
plaintext runner handoff is deleted before upload and the Actions summary
contains decryption instructions only.

When `request_binding_reversion=true`, the final summary instructs the owner to
dispatch **Stripe live billing cutover** with operation `revert`, its distinct
reviewed confirmation, and the same current-main controls. Reversion is not
automatic and is not a capability of the financial-proof workflow.

Gate 19 may be marked complete only after the finalize artifact proves one
provider-derived Charge and refund counts of one, full Charge reconciliation,
four duplicate signed replays, durable active-to-canceled
application convergence, and cleanup. A prepared Session or policy enablement
alone is not completion.
