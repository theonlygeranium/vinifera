# Runbook: Activate Phase 3 communications

**Owner:** Vinifera operations
**Scope:** Resend transactional email, winery sender DNS, and delivery webhooks
**Safety:** Never paste secret values or member email content into commits,
tickets, terminal transcripts, screenshots, or QA reports.

## Preconditions

- Phase 1 through Phase 3 migrations and automated QA pass.
- Migration `202607260014_phase_3_brand_retention_hardening.sql` is applied and
  native pgTAP includes `024_phase_3_current_stack_hardening.test.sql`.
- A staging Worker hostname is available.
- The Worker is connected to the intended non-production Supabase project.
- Test recipients have consented to receive the activation messages.

## 1. Create and verify the sending domain

Add the winery sending domain in Resend. Copy the DNS records returned for that
specific domain into the authoritative DNS provider. The generated names and
values are domain-specific; do not substitute example values from this
runbook.

At minimum, verify the Resend-provided DKIM and SPF records. If click/open
tracking is enabled, add the generated tracking CNAME as well. Wait until
Resend reports the domain as verified before using it in a production sender.

`onboarding@resend.dev` is reserved for development testing. It is not the
production sender.

Phase 5 brand senders are verified independently from the legacy/default
sender. In the staff **White-label** surface, save the exact brand sender name
and address, start domain verification, and publish the returned DNS records.
The sender remains `pending` until Resend reports both domain verification and
sending capability. Replacing the address resets verification; clearing it
disables that brand sender.

## 2. Configure repository secrets

Add the following encrypted GitHub repository secrets:

```text
EMAIL_PROVIDER=resend
EMAIL_SIMULATOR_ENABLED=false
RESEND_API_KEY
RESEND_FROM
RESEND_SENDING_DOMAIN
RESEND_DOMAIN_VERIFIED=true
RESEND_WEBHOOK_SECRET
UNSUBSCRIBE_SIGNING_SECRET
```

`RESEND_FROM` must use `RESEND_SENDING_DOMAIN`, and
`RESEND_DOMAIN_VERIFIED` must remain false until Resend reports the domain as
verified. Generate
`UNSUBSCRIBE_SIGNING_SECRET` as a high-entropy server-only value and rotate it
through an explicit token migration plan; changing it invalidates outstanding
links.

Do not expose any of these values through Vite-prefixed variables or browser
configuration.

These bindings establish provider access and the default transactional sender;
they do not mark every brand sender verified. A branded delivery must resolve a
verified, active sender identity for the message's exact brand. Missing or
pending brand verification leaves the durable email work queued.

## 3. Register the delivery webhook

Create a Resend webhook pointing to:

```text
POST https://<staging-worker>/api/webhooks/resend
```

Enable the email delivery and engagement events supported by the application,
including sent, delivered, delayed, failed, bounced, complained, opened, and
clicked where available.

Store the endpoint signing secret as `RESEND_WEBHOOK_SECRET`. Send a provider
test event and confirm:

- a valid raw-body signature is accepted;
- a modified payload or signature is rejected;
- replaying the same event changes no state a second time;
- reusing an event ID with a different message, type, timestamp, or payload is
  rejected;
- an event delivered before the email receipt is stored remains in the durable
  inbox and reconciles after the provider message ID is attached;
- a late `sent` or `failed` event cannot regress a delivered or bounced state;
- the delivery event belongs to the same organization and email log row as the
  original provider message.

## 4. Activate and verify two triggers

Enable the welcome and pre-shipment templates for the staging winery.

1. Edit both subjects and bodies, save, preview, and send a test message.
2. Create one member with a consented test address and verify one welcome
   message.
3. Create a test release inside the configured pre-shipment window and run the
   scheduled job.
4. Verify one pre-shipment message, including the correct release date.
5. Confirm each logical event has exactly one outbox row, provider identifier,
   email log entry, and delivery event history.
6. Re-run the same scheduled work and confirm no duplicate logical message is
   created.
7. Allow one claim lease to expire, reclaim it with a second Worker identity,
   and confirm the first completion token can no longer finalize the row.
8. Repeat an accepted message after simulating receipt-persistence failure and
   confirm Resend resolves the same `outbox:<uuid>` idempotency key instead of
   creating another provider message.

Repeat activation checks for decline, shipped, birthday, and re-engagement
before enabling them for a production winery.

## 5. Verify independent daily work

Temporarily make the staging Resend adapter return a controlled failure, then
invoke the hourly schedule. Confirm email delivery reports a failure while the
daily result still records churn scoring, loyalty expiration/awards,
cancel-attempt cleanup, and pause resumption.

Invoke the schedule again for the same calendar date and confirm the persisted
daily result returns with `replayed=true`. Repeat around midnight in the
configured winery brand time zone and verify birthday and pre-shipment
selection follows the brand's local date.

## 6. Verify unsubscribe behavior

Open an unsubscribe link from a test message before expiration and verify that
the member preference changes exactly once. Confirm a modified, expired, or
cross-member link is rejected.

Verify that optional messages honor the preference and that operationally
required notices follow the configured message classification.

## 7. Failure and rollback

- Disable the affected template to stop creating new deliveries.
- Leave failed outbox rows intact for diagnosis and bounded retry.
- Never retry an uncertain logical send with a new idempotency key.
- Compare the outbox, email log, provider message, webhook ledger, and audit
  entry before requeueing.
- Remove `EMAIL_PROVIDER` or the Resend key to return the Worker to its
  fail-closed activation state.
- Correct database behavior with a forward migration; do not delete delivery,
  loyalty, cancellation, or audit history.
