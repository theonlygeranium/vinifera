# Production Worker release and Pages rollback

The stable production application address is
`https://vinifera-live.edstratumlabs.ai`. The public
`https://vinifera.edstratumlabs.ai` hostname remains the marketing/static
rollback baseline. Production Worker creation, version deployment, live-host
attachment, application rollback, and verification are separate operations.
Routine standing delivery authority does not permit moving or deleting the
marketing/static hostname.

## Preconditions

- `main` is the protected result of a `staging → main` promotion, and its full
  40-character Git SHA is bound to the reviewed staging artifact or an
  identical verified content digest.
- The release workflow executes only the current `origin/main` control SHA and
  requires GitHub to associate it with a merged same-repository
  `staging → main` PR. It rejects the dispatch when that authorization retains
  `human-review-required` or `do-not-merge` for a forward release. A verified
  rollback to a known prior reviewed version remains available under either
  label.
- `Type, test, build, and package`, exact-comparison Octopus, source QA, hosted
  Supabase pgTAP/RLS, hosted two-tenant proof, provider
  sandboxes, physical-device QA, and store-track checks required by the Phase 5
  report have passed.
- The configured staging soak completed without critical health failure.
- Provide the successful staging deployment Actions run ID. The release
  workflow requires that run to be a completed successful `ci.yml` push on the
  reviewed staging head, with both `Type, test, build, and package` and
  `Deploy Worker when activated` successful. It verifies the production
  commit tree is identical to that reviewed staging tree and enforces
  `PRODUCTION_MINIMUM_STAGING_SOAK_SECONDS` (minimum 300 seconds) from the
  staging run completion time.
- The workflow's read-only GitHub token must include `actions: read`,
  `contents: read`, and `pull-requests: read` so it can resolve that staging run
  and both release identities without granting repository mutation.
- The protected `production` GitHub environment exists and enforces the
  owner-authorized release contract.
- Every production target hash is populated in
  `config/production-release-policy.json`.
- The Pages project `vinifera` still has an active
  `vinifera.edstratumlabs.ai` custom domain and a restorable production
  deployment.
- The known production rollback target is healthy and retained.
- Neither `human-review-required` nor `do-not-merge` is present for a forward
  production release. Exact known-good rollback is exempt.
- The production Worker uses Stripe test mode and
  `LIVE_BILLING_ENABLED=false`.
- `config/stripe-live-billing-policy.json` remains disabled; production Worker
  deployment and public-domain cutover cannot change payment authority.
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

The domain-move operations are legacy, high-risk controls for the marketing
hostname. They are outside ordinary autonomous delivery and must not be used to
replace `vinifera.edstratumlabs.ai` with the application. A future DNS/domain
ownership change requires `human-review-required` resolution and explicit
owner direction. Normal application release targets
`vinifera-live.edstratumlabs.ai` and leaves the marketing/rollback hostname
attached to Pages. The standard `Production Worker release` dispatch no longer
offers or accepts `cutover-domain` or `restore-pages`; re-enabling either
requires a separately reviewed workflow change and explicit owner direction.

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
and pass Worker-origin health. It must report the production environment marker
and reviewed build SHA/artifact digest. No custom domain is moved.

### Deferred legacy domain cutover

Immediately before mutation, capture:

- the active Worker version and domains;
- the Pages project, production branch, custom-domain status, and latest
  production deployment; and
- the expected account, zone, Pages project, hostname, Worker, and Worker
  origin through hash authorization.

This section documents the separately authorized legacy control and is not
executable from the standard production workflow. Cutover refuses a missing or
non-active Pages hostname. It removes only that
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

For an application regression with a healthy Worker control plane, dispatch the
current `main` workflow with its exact current control SHA, the prior reviewed
release SHA in `rollback_git_sha`, the prior release's successful staging run
ID, and the matching Worker version. The workflow requires the prior SHA to be
a reviewed `staging → main` ancestor with an identical staging tree, completed
soak evidence, and no emergency label. It verifies that the version annotations
match that prior SHA, that retained Cloudflare history shows it was previously
the sole 100% deployment, and that it is not already active. Immediately before
rollback it repeats the mutable current-main/PR/emergency-label, ancestry,
version-annotation, deployment-history, and current-state checks, then verifies
sole-active state and health.

Cloudflare and Wrangler expose only the ten most recent deployments through
this retained-history check. A legitimate older version therefore fails closed
and requires a separately reviewed recovery procedure rather than bypassing
the history proof.

For a domain/runtime incident, the standard workflow has no
**Restore domain to Pages** operation. The separately authorized legacy
procedure:

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

For the stable application surface, also verify the expected post-release or
rolled-back marker, SHA/digest, and API health at:

```bash
curl --fail --silent --show-error https://vinifera-live.edstratumlabs.ai/api/health
```

Do not force-push Git and do not delete the Pages project. A domain rollback
does not revert Supabase migrations, Stripe dashboard settings, provider
tokens, DNS outside Cloudflare, or already distributed mobile builds.

## Evidence

The repository-level GitHub Actions artifact/log retention is set to the
allowed 90-day maximum. Individual workflows may request a shorter 7-, 14-, or
90-day period, but must never request more than the repository maximum.

Retain workflow summaries and sanitized artifacts for:

- exact promotion PR, head SHA, base SHA, and Octopus attempt;
- reviewed artifact digest and staging soak result;
- target-policy pass;
- current-main control SHA/PR plus artifact SHA/PR and Worker version;
- retained Cloudflare deployment-history proof that a rollback target was
  previously sole-active;
- pre-mutation control-plane snapshot;
- Worker-origin health;
- public cutover or Pages-restore health;
- exact operation and actor from GitHub's audit trail; and
- any automatic restoration attempt.

After deployment, verify the production build SHA/artifact digest, environment
marker, API health contract, primary user journey, authentication boundary,
basic accessibility, and absence of critical console/server errors. An HTTP
200 or the healthy marketing surface is not application evidence. If a
critical verification fails, automatically deploy the known prior Worker
version; use the retained Pages restoration only for the separately authorized
domain path.

Record the run URL and outcome in the current phase QA report and
`CONTINUITY_BRIEF.md`. Only then may the deployment state be described as
hosted or live.

## Separate Stripe live-billing control

Moving the Worker or public domain never enables live Stripe. A future
owner-approved cutover uses the separate protected live-billing workflow only
after:

- its checked-in policy is explicitly enabled with independent authority;
- the exact Cloudflare account, Worker name/origin, Stripe test/live accounts,
  webhook endpoints, and four canonical Price contracts are hash-authorized;
- both complete test and live secret sets are present in the protected
  production environment;
- the operation is bound to an immutable `main` commit and exact confirmation;
  and
- the Worker health/configuration contract passes after the atomic secret
  update.

The revert operation restores the reviewed test bindings and disables live
billing. Neither operation is authorized while services are deferred, and a
credential's presence alone is never sufficient.

`human-review-required` pauses forward release mutation until the owner or an
explicitly trusted owner workflow removes it. `do-not-merge` remains an
absolute promotion prohibition. Neither label suppresses evidence collection,
and neither blocks an exact, verified rollback to a known prior reviewed Worker
version.
