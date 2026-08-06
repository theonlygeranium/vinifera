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

For the protected staging environment, add the following encrypted GitHub
environment secrets (the Worker receives the unprefixed binding names):

```text
STAGING_EMAIL_PROVIDER=resend
STAGING_EMAIL_SIMULATOR_ENABLED=false
STAGING_RESEND_API_KEY
STAGING_RESEND_FROM
STAGING_RESEND_SENDING_DOMAIN
STAGING_RESEND_DOMAIN_VERIFIED=true
STAGING_RESEND_WEBHOOK_SECRET
STAGING_UNSUBSCRIBE_SIGNING_SECRET
```

`RESEND_FROM` must use `RESEND_SENDING_DOMAIN`, and
`RESEND_DOMAIN_VERIFIED` must remain false until Resend reports the domain as
verified. Generate
`UNSUBSCRIBE_SIGNING_SECRET` as a high-entropy server-only value and rotate it
through an explicit token migration plan; changing it invalidates outstanding
links.

Do not expose any of these values through Vite-prefixed variables or browser
configuration.

The protected staging deployment maps every value above into the immutable
Worker upload. `STAGING_HOSTED_GATE8_ACCEPTANCE_ENABLED` is a repository-level
Actions variable because GitHub evaluates job conditions before loading the
`staging` environment. If it is `true`, deployment fails
before deployment unless the complete binding set and
`STAGING_HOSTED_ACCEPTANCE_EMAIL_BASE` environment variable are present and
consistent.

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

### Protected one-shot Gate 8 acceptance

After the provider domain and webhook prerequisites exist, set the protected
repository Actions variable `STAGING_HOSTED_GATE8_ACCEPTANCE_ENABLED=true` for one reviewed
promotion. The controller:

1. confirms the exact Resend domain is verified with sending, DKIM, and SPF;
2. confirms the exact staging webhook is enabled for every supported event and
   that its provider signing secret matches the deployed binding;
3. creates an isolated member and release in the dedicated acceptance tenant;
4. lets the member insert enqueue welcome, replays pre-shipment twice through
   the exact organization-, brand-, member-, and release-scoped command, and
   requires exactly one logical message of each type without scanning other
   tenants' due communications;
5. waits for the actual deployed hourly Worker Cron Trigger within the
   controller-wide 70-minute pre-cleanup budget, shortening the delivery wait
   by time already spent on discovery and fixture setup;
6. requires two completed outbox records, two distinct provider messages, and
   a signed `email.delivered` webhook event for both (`email.sent` is not
   completion evidence), with every delivery table read scoped to the exact
   acceptance organization and brand; and
7. retires the member, tier, and release while retaining durable email and
   audit evidence.

The mutation runs only after the staging deployment job succeeds, in a
dedicated 100-minute job with a bounded 70-minute controller pre-cleanup
deadline. Checkout and dependency installation retain a 15-minute allowance;
runtime/provider discovery, fixture setup, and delivery polling all consume the
same 70-minute deadline, leaving the final 15 minutes for fixture retirement
and evidence upload.
While the Gate 8 toggle is active, a later staging run does not supersede the in-flight
workflow, preserving the reserved cleanup window for fixture retirement and
sanitized evidence upload.

The sanitized `vinifera-hosted-gate8-acceptance.json` artifact is necessary but
does not by itself mark the gate passed; bind it to the reviewed candidate,
Worker version, and protected staging run. Set the toggle back to `false` after
the accepted one-shot run.

Resend-domain, webhook, and DNS creation are deliberately not performed by the
acceptance controller. A future trusted provisioning operation must authorize
the exact sending-domain and Cloudflare zone hashes, run default-branch code,
write the returned webhook signing secret directly to the staging environment,
and publish only sanitized evidence. Until then, complete Sections 1–3 before
enabling acceptance.

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
