# Production Worker cutover and Pages rollback

The public `vinifera.edstratumlabs.ai` hostname remains on Cloudflare Pages
until this runbook passes. Production Worker creation, version deployment,
domain cutover, and Pages restoration are separate operations.

## Preconditions

- `main` is clean, pushed, and its full 40-character Git SHA is approved.
- CI, source QA, hosted Supabase pgTAP/RLS, hosted two-tenant proof, provider
  sandboxes, physical-device QA, and store-track checks required by the Phase 5
  report have passed.
- The protected `production` GitHub environment exists and requires review.
- Every production target hash is populated in
  `config/production-release-policy.json`.
- The Pages project `vinifera` still has an active
  `vinifera.edstratumlabs.ai` custom domain and a restorable production
  deployment.
- The production Worker uses Stripe test mode and
  `LIVE_BILLING_ENABLED=false`.
- Every Phase 1–5 configuration capability reports configured before public
  domain movement.

## Operations

Use the manually dispatched **Production Worker release control** workflow.
Select only one operation at a time and enter its exact phrase:

| Operation | Exact confirmation |
| --- | --- |
| First Worker creation | `BOOTSTRAP VINIFERA PRODUCTION WORKER` |
| Upload immutable version | `UPLOAD VINIFERA PRODUCTION VERSION` |
| Deploy approved version | `DEPLOY VINIFERA PRODUCTION VERSION` |
| Roll back Worker version | `ROLL BACK VINIFERA PRODUCTION WORKER` |
| Move domain to Worker | `CUT OVER VINIFERA DOMAIN TO WORKER` |
| Restore domain to Pages | `RESTORE VINIFERA DOMAIN TO PAGES` |

### Bootstrap

Bootstrap first proves that the allowlisted Worker does not exist, then uses
the named `production` Wrangler environment to create it on `workers.dev`.
`wrangler.jsonc` contains no production route or custom domain. If the resource
already exists, bootstrap fails and the version-upload path must be used.

### Upload and deploy

Upload packages the exact Git SHA and records it in Worker version annotations.
It parses exactly one Worker version ID and preview URL, verifies the preview
health/configuration contract, and retains sanitized evidence.

Deploy accepts only a validated version ID that belongs to the approved Git
SHA. Success requires that version to become the sole version at 100% traffic
and pass Worker-origin health. No custom domain is moved.

### Domain cutover

Immediately before mutation, capture:

- the active Worker version and domains;
- the Pages project, production branch, custom-domain status, and latest
  production deployment; and
- the expected account, zone, Pages project, hostname, Worker, and Worker
  origin through hash authorization.

Cutover refuses a missing or non-active Pages hostname. It removes only that
custom-domain attachment from Pages, attaches it to the production Worker, and
polls the public health/configuration endpoints. It never deletes the Pages
project or deployment.

Public health must report all of:

```text
app
database
billing
compliance
communications
customDomains
webhook
googleOAuth
email
integrationEncryption
mobile
quickBooksOAuth
push
shipping
```

If health does not pass, the control script removes the attempted Worker domain
and reattaches the hostname to Pages. Treat the workflow as failed until the
static root and `/app/` prototype are independently reverified.

## Rollback

For an application regression with a healthy Worker control plane, deploy the
previous recorded Worker version using the rollback operation. Verify the sole
100% active version and public health.

For a domain/runtime incident, use **Restore domain to Pages**. The workflow:

1. captures current Worker and retained Pages state;
2. removes only the allowlisted Worker domain attachment;
3. reattaches the hostname to the retained Pages project;
4. verifies `/` contains the Vinifera static surface and `/app/` contains the
   accepted prototype marker; and
5. if Pages restoration fails, attempts to reattach the Worker domain so the
   hostname is not intentionally left unowned.

After any rollback, verify:

```bash
curl --fail --silent --show-error https://vinifera.edstratumlabs.ai/
curl --fail --silent --show-error https://vinifera.edstratumlabs.ai/app/
curl --fail --silent --show-error https://vinifera.edstratumlabs.ai/guide/
```

Do not force-push Git and do not delete the Pages project. A domain rollback
does not revert Supabase migrations, Stripe dashboard settings, provider
tokens, DNS outside Cloudflare, or already distributed mobile builds.

## Evidence

Retain workflow summaries and sanitized artifacts for:

- target-policy pass;
- immutable Git SHA and Worker version;
- pre-mutation control-plane snapshot;
- Worker-origin health;
- public cutover or Pages-restore health;
- exact operation and actor from GitHub's audit trail; and
- any automatic restoration attempt.

Record the run URL and outcome in the current phase QA report and
`CONTINUITY_BRIEF.md`. Only then may the deployment state be described as
hosted or live.
