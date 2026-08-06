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
- The Pages project `vinifera-live` still has an active
  `vinifera-live.edstratumlabs.ai` custom domain and a restorable production
  deployment. The separate `vinifera` Pages project and
  `vinifera.edstratumlabs.ai` marketing hostname are not release targets.
- The known production rollback target is healthy and retained.
- Neither `human-review-required` nor `do-not-merge` is present for a forward
  production release. Exact known-good rollback is exempt.
- The production Worker uses Stripe test mode and
  `LIVE_BILLING_ENABLED=false`.
- `config/stripe-live-billing-policy.json` remains disabled; production Worker
  deployment and live-application hostname attachment cannot change payment
  authority.
- Every Phase 1–5 configuration capability reports configured before public
  domain movement.
- `config/hosted-activation-gates.json` records Gates 1–19 as `live-passed`
  with retained evidence, and a successful exact-current-`main` **Hosted
  activation exit evidence** run ID is available for `attach-live-domain`.

## Operations

Use the manually dispatched **Production Worker release control** workflow.
Select only one operation at a time and enter its exact phrase:

| Operation                                | Exact confirmation                      |
| ---------------------------------------- | --------------------------------------- |
| First Worker creation                    | `BOOTSTRAP VINIFERA PRODUCTION WORKER`  |
| Upload immutable version                 | `UPLOAD VINIFERA PRODUCTION VERSION`    |
| Deploy approved version                  | `DEPLOY VINIFERA PRODUCTION VERSION`    |
| Roll back Worker version                 | `ROLL BACK VINIFERA PRODUCTION WORKER`  |
| Attach live application domain           | `ATTACH VINIFERA LIVE DOMAIN TO WORKER` |
| Restore live application domain to Pages | `RESTORE VINIFERA LIVE DOMAIN TO PAGES` |

The two domain operations target only `vinifera-live.edstratumlabs.ai` and its
`vinifera-live` Pages project. The checked-in raw topology plus hashed target
allowlists must agree before either operation runs. The marketing hostname
`vinifera.edstratumlabs.ai` is a distinct immutable baseline and is never
accepted by this controller. Domain attachment and restoration retain the
production environment review and exact operation confirmation.

`attach-live-domain` requires `activation_exit_evidence_run_id`. The protected
workflow validates that the run used `hosted-activation-exit.yml`, succeeded on
the exact current `main` SHA, still has the unexpired named artifact, and that
the artifact matches the exact checked-in ledger digest. `restore-live-pages`
does not require staging or release-package artifacts; it derives recovery
identity from the currently active Worker version.

### Bootstrap

Bootstrap first proves that the allowlisted Worker does not exist, then uses
the named `production` Wrangler environment to create it on `workers.dev`.
`wrangler.jsonc` contains no production route or custom domain. If the resource
already exists, bootstrap fails and the version-upload path must be used.
Bootstrap and pre-cutover uploads set `APP_ORIGIN` to the exact protected
`PRODUCTION_WORKER_ORIGIN` and permit both that origin and the future live
hostname through browser CORS. This keeps mobile magic-link callbacks
executable during Gates 17 and 18.

### Upload and deploy

Upload packages the exact Git SHA and records it in Worker version annotations.
It parses exactly one Worker version ID and preview URL, verifies the preview
health/configuration contract, and retains sanitized evidence.

Deploy accepts only a validated version ID that belongs to the approved Git
SHA. Success requires that version to become the sole version at 100% traffic
and pass Worker-origin health. It must report the production environment marker
and reviewed build SHA/artifact digest. No custom domain is moved.

### Live application domain attachment

Immediately before mutation, capture:

- the active Worker version and domains;
- the Pages project, production branch, custom-domain status, and latest
  production deployment; and
- the expected account, zone, Pages project, hostname, Worker, and Worker
  origin through hash authorization.

The protected controller refuses a missing or non-active `vinifera-live` Pages
hostname, a Worker version that does not match the exact reviewed artifact, or
a Worker version that is not already the sole 100% deployment. It removes only
the `vinifera-live.edstratumlabs.ai` attachment from the `vinifera-live` Pages
project, attaches that hostname to `vinifera-production`, waits until the
Cloudflare domain record matches the exact hostname, zone, service, and
environment, and then polls bounded, no-redirect HTTPS public probes. Those
probes, rather than a nonexistent Workers Domains `cert_id`, prove certificate
readiness. A repeated dispatch resumes safely if
the Worker is already exact or if an interrupted run left neither service
attached. It rejects a both-attached topology. It never deletes either Pages
project or any deployment.

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

The same public proof requires `environment=production`, the exact artifact
Git SHA, the root surface, `/app/`, `/portal/`, and exact Apple and Android
association payloads for the signed identities. The separate marketing root,
app, and guide body digests must remain unchanged.

If domain attachment, HTTPS health verification, or the final independent
marketing-content invariant does not pass, the control script removes the
attempted Worker domain and reattaches the live hostname to its Pages project.
Treat the workflow as failed until the restored live Pages root and `/app/`
prototype are independently reverified. The marketing hostname is checked
separately and must remain unchanged throughout.

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

Both `deploy-version` and `rollback-worker` capture the prior sole-active
version and its annotated Git SHA. A failed mutation command or failed smoke
automatically reconverges to that prior version and verifies its exact revision
and core health before the run reports failure.

Cloudflare and Wrangler expose only the ten most recent deployments through
this retained-history check. A legitimate older version therefore fails closed
and requires a separately reviewed recovery procedure rather than bypassing
the history proof.

For a domain/runtime incident, dispatch `restore-live-pages`. The protected
operation:

1. captures current Worker and retained Pages state;
2. removes only the allowlisted Worker domain attachment;
3. reattaches the hostname to the retained Pages project;
4. verifies the retained project production branch and current production
   deployment URL, then exact SHA-256 content contracts for `/` and `/app/`;
   and
5. if Pages restoration fails, reattaches the prior Worker domain and verifies
   its certificate, exact revision, capabilities, application routes, and
   mobile associations before reporting the failed restore; when the captured
   topology had neither owner, removes any partial Pages claim and verifies the
   hostname remains unowned instead of attaching a new Worker owner.

Restoration is resumable when Pages is already active or neither service is
attached. It rejects an ambiguous both-attached state.

After any rollback, verify the marketing baseline remains unchanged:

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

After `restore-live-pages`, verify the live Pages fallback itself:

```bash
curl --fail --silent --show-error https://vinifera-live.edstratumlabs.ai/
curl --fail --silent --show-error https://vinifera-live.edstratumlabs.ai/app/
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
- issued custom-domain certificate identity hash and public attach or
  Pages-restore health;
- exact operation and actor from GitHub's audit trail; and
- any automatic restoration attempt.

After deployment, verify the production build SHA/artifact digest, environment
marker, API health contract, primary user journey, authentication boundary,
basic accessibility, and absence of critical console/server errors. An HTTP
200 or the healthy marketing surface is not application evidence. If a newly
deployed Worker fails its post-deploy smoke, the workflow automatically rolls
back to the captured prior sole-active version and verifies health. If
live-domain certificate or full health fails, attachment automatically restores
the `vinifera-live` Pages hostname.

Record the run URL and outcome in the current phase QA report and
`CONTINUITY_BRIEF.md`. Only then may the deployment state be described as
hosted or live.

## Separate Stripe live-billing control

Deploying the Worker or attaching the live application hostname never enables
live Stripe. A future
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
