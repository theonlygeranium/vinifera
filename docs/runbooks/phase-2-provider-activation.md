# Runbook: Activate Phase 2 providers

**Owner:** Vinifera operations
**Scope:** Supabase, Stripe test mode, and EasyPost test mode
**Safety:** Never paste credential values into tickets, commits, terminal
transcripts, or QA reports.

## Preconditions

- Phase 2 source, migration, unit/API tests, Worker bundle, and browser QA pass.
- A non-production Supabase project is selected.
- The Worker remains on a staging hostname.
- Stripe is visibly in test mode.
- EasyPost uses a test key.

## 1. Apply the database

Add these encrypted GitHub repository secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

Run the `Quality and staging deployment` workflow. Confirm that the migration
job applies every forward migration and that the pgTAP suites pass against a
clean database.

Create two test organizations. As authenticated Org A and Org B staff, verify
that each receives zero rows belonging to the other organization for members,
tiers, releases, shipments, billing attempts, imports, and audit history.

## 2. Activate Stripe shipment billing

Keep the existing test `STRIPE_SECRET_KEY`. Register the staging webhook:

```text
POST https://<staging-worker>/api/billing/webhook
```

Subscribe to the Phase 1 subscription events and the Phase 2 payment/refund
events handled by the application. Store the signing secret as
`STRIPE_WEBHOOK_SECRET`.

For each QA member, create or attach:

- a Stripe test Customer;
- a reusable test PaymentMethod;
- that PaymentMethod as the customer's default invoice/payment method.

Store only the resulting Stripe identifiers in the member record. Include one
decline test PaymentMethod for recovery testing, then replace it with a
successful test PaymentMethod before manual retry.

## 3. Activate EasyPost

Add these encrypted repository secrets:

```text
SHIPPING_PROVIDER=easypost
EASYPOST_API_KEY=<test key>
SHIPPING_SIMULATOR_ENABLED=false
```

Configure and verify the winery origin/return address. Create one test shipment
manually through the application and confirm:

- address verification produces a provider result;
- available rates belong to the intended test carrier;
- buying the rate returns a test tracking code and label URL;
- the stored provider shipment ID, tracking code, carrier, service, and label
  reference match the EasyPost test shipment.

Never change `SHIPPING_SIMULATOR_ENABLED` to `true` in production.

## 4. Run the release proof

1. Create one tier.
2. Add or import ten members and assign the tier.
3. Create a release with wine items, tier price, processing date, and embargo.
4. Process the release.
5. Confirm successful and declined PaymentIntents are both persisted.
6. Replace the declined member's test PaymentMethod and retry successfully.
7. Generate labels for every charged shipment.
8. Generate and inspect the pick list.
9. Scan each shipment to packed.
10. Mark each shipment shipped, delivered, and complete.
11. Refund one test charge and verify both Stripe and the audit history.

Save redacted Stripe, EasyPost, database, accessibility, breakpoint, header, and
performance evidence in the Phase 2 QA report.

## 5. Failure and rollback

- Do not retry an uncertain charge with a new idempotency key.
- Inspect the shipment, billing-attempt ledger, Stripe PaymentIntent, and audit
  entry before resuming a partial batch.
- Disable provider activation variables to return routes to the fail-closed
  activation state.
- Do not delete a migration or audit entry. Correct forward with a new migration
  or compensating operation.
- Do not attach the custom domain until every hosted gate passes.
