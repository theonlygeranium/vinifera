# Changelog

## [Unreleased]

### Added
- Add the complete Cursor Pro+ integration package (22 files) enabling
  WRITER Agent to orchestrate Cursor cloud agents as code-writing workers
  via the manager-worker pattern. Includes `.cursor/rules/` (4 governance
  rules), `.cursor/hooks/` (5 security hook scripts + config), `.cursor/skills/`
  (3 Cursor skills), `.cursor/mcp.json` (3 read-only HTTP MCP servers),
  `openapi/cursor-cloud-agents-connector.json` (OpenAPI 3.0.3 spec for the
  WRITER→Cursor API bridge), `scripts/` (5 Node.js orchestration scripts),
  and `IMPLEMENTATION_GUIDE.md` (6-phase setup guide). Extends the delivery
  classifier's operator-tooling lane to recognize `.cursor/` and `openapi/`
  paths. **Deployment impact:** tooling and CI classification only; no
  application route, provider, database, credential, billing, DNS, Worker,
  or production changes.
- Document Cursor Cloud VM development setup under a new `## Cursor Cloud specific instructions` section in `AGENTS.md`: how to start the Docker daemon manually (no systemd) for the full `npm run dev` stack, the Docker 29 + fuse-overlayfs `containerd-snapshotter=false` requirement, the `ubuntu` docker-group / `sg docker` note, seeded local login accounts, and the cold-run timeout caveat for `tests/scripts/promotion-smoke.test.mjs`. **Deployment impact:** documentation only; no application route, provider, database, credential, billing, DNS, Worker activation, production/mobile approval-gate, or Cloudflare Access policy state changes.

### Changed
- Add a protected, default-disabled Gate 6 hosted acceptance controller that
  binds canonical control and staging revisions to a successful exact-candidate
  Gate 13 artifact, exactly ten tenant-scoped test members, Stripe test
  charges/decline/recovery/refund, compliant EasyPost labels, fulfillment
  transitions, durable provider IDs, audit evidence, and reversible fixture
  retirement. **Deployment impact:** source and protected workflow only; target
  hashes and the one-shot switch remain empty/disabled, no hosted workflow was
  dispatched, and Gate 6 remains pending provider evidence. Reject non-test
  Stripe credentials before client construction, hash the exact untrimmed
  fixture-manifest bytes, bind audit proof to every expected entity/action and
  sequence/hash link, and restrict Cloudflare Access transport to the hashed
  staging Worker and Access-protected Supabase origins. Require the isolation
  negative control to be a real active brand in another staging organization,
  bind the fixture staff row to its declared tenant, and accept only an exact
  403 denial rather than treating a missing UUID as isolation evidence. Reuse
  the deletion-aware hosted cookie-jar contract so cleared base cookies cannot
  shadow valid Supabase SSR chunks during staff-session verification. Remove
  the candidate-specific manifest digest from checked-in policy: retain the
  stable fixture-contract and provider-target hashes there, require the manifest
  itself to name the exact staging candidate, and authorize its exact-byte hash
  from protected environment state populated after the immutable candidate
  exists. This removes the policy/candidate fixed point while preserving exact
  runtime and Gate 13 evidence binding. Require the fixture staff principal to
  be an active owner or admin before creating provider objects, preventing a
  manager-only run from consuming the lifecycle and failing at the final
  owner/admin-only refund. Re-fetch and revalidate canonical `main` and
  `staging` after Gate 13 artifact retrieval and immediately before controller
  invocation so a branch advance during setup cannot leave stale authority to
  consume the one-shot fixtures.
- Add the opt-in hosted Gate 8 acceptance controller and its complete review
  hardening: exact paginated Resend domain/webhook inventory, verified active
  senders, Access-authenticated bounded Worker probes, an exact tenant/brand/
  member/release-scoped pre-shipment command with idempotent replay, explicitly
  tenant-scoped delivery/outbox polling, two completed provider deliveries and
  signed delivered events, and durable sanitized evidence. Reserve unique
  migration 031 for the scoped trigger so remaining gate branches can merge in
  dependency order. Run the mutation in
  a non-superseded post-deployment job with 15 minutes reserved after the
  provider wait for fixture retirement. Verification: 10/10 focused Gate 8 tests
  and 585/585 full Vitest tests, app build, and Worker dry-run. **Deployment
  impact:** adds one forward service-role-only database RPC plus protected
  staging acceptance workflow/source; no provider/DNS or production mutation,
  the repository-scoped toggle remains opt-in, the 100-minute job preserves a
  15-minute setup allowance plus the 15-minute cleanup reserve around a
  controller-wide 70-minute pre-cleanup deadline shared by provider discovery,
  fixture setup, and delivery polling; fixture dates share the trigger timestamp, the
  documented exact Vitest floor is 585, and Gate 8 remains pending until
  reviewed hosted evidence succeeds.
- Apply the shared 30-second fixture-Git budget to the promotion classifier's
  staged CLI test as well as the other repository-heavy promotion fixtures.
  This prevents a correct subprocess invocation from inheriting Vitest's
  unrelated five-second default under concurrent CI host load. **Deployment
  impact:** test timing only; no workflow, branch, deployment, or runtime
  behavior.
- Add independent opt-in Gates 10–16 staging readiness reports that bind
  allowlisted configuration state to the exact deployed candidate, retain a
  sanitized 90-day artifact, and explicitly prohibit a readiness report from
  claiming gate completion. Include the previously omitted
  `STAGING_ML_PLATFORM_ACTOR_USER_ID` binding in the atomic staging Worker
  secret bundle so Gate 11 can reach its guarded actor validation when real
  source and experiment prerequisites exist. **Deployment impact:** protected
  staging workflow, documented read-only operator command, and optional Worker
  secret binding only; no provider
  resource, winery data, fixture, model, integration, DNS, live-billing,
  mobile-store, or production mutation.
- Add the disabled-by-default trusted Gate 8 provisioning controller and its
  complete review hardening: exact hashed target policy, all-page Resend
  domain/webhook/runtime-key inventory before creation, two-stage DNS review,
  duplicate-proof exact DNS tuple-set comparison, idempotent Cloudflare
  reconciliation, asynchronous verification, exact-source
  evidence binding, and post-mutation re-inventory. Split the provisioning key
  from the domain-restricted sending-only runtime key, persist its one-time
  token in an atomic domain-bound controller recovery envelope before fallible
  postchecks or missing-ID recovery, then finalize the staging token and exact
  runtime-key ID binding; persist the webhook's one-time signing secret in an
  atomic endpoint-bound controller recovery envelope before
  provider re-read or missing-ID recovery, then finalize the staging secret
  and webhook-ID binding and remove that envelope; reject inventoried runtime
  keys without their exact persisted token binding or controlled recovery; reuse the stable controller-owned
  unsubscribe secret across retries. If either one-time secret write fails,
  delete only the resource created by that attempt so a retry can recreate it;
  if both envelope persistence and immediate ID recovery fail, allow only a
  protected confirmed bootstrap to replace the single exact unbound reserved
  webhook or runtime-key resource;
  malformed runtime-key creation responses enter the same rollback path, and
  inventoried webhooks require the persisted ID hash that binds their signing
  secret before readiness can pass;
  on other interrupted-bootstrap retries, emit the existing key's sanitized ID
  hash before rejecting incomplete policy. Secrets
  stream only over stdin and evidence retains hashes rather than raw targets or
  credentials. Run canonical-`main` provisioning through the dedicated
  `staging-acceptance-control` environment without broadening the staging
  deployment environment's branch policy. Validate an inventoried webhook's
  persisted signing-secret binding before any provider update. Keep the static secret-writer guard
  aligned with its environment-parameterized, repository-bound command.
  Verification: 21/21 focused provisioning tests and 596/596 full Vitest
  tests, app build, and Worker dry-run. **Deployment impact:** protected
  manual workflow/source only; empty policy blocks provider/DNS mutation,
  provider deletion is restricted to same-attempt one-time-secret recovery or
  protected-bootstrap replacement of one exact unbound reserved resource, and source
  completion does not change Gate 8 status.
- Remove the broad required-reviewer rule from the protected `staging` GitHub
  environment while retaining its staging-only branch policy and the
  repository's exact-candidate, provider-target, confirmation, health,
  rollback, and one-shot gate controls. Consequential production DNS,
  real-money, mobile-store, destructive, and legal-provider boundaries remain
  independently confirmed. **Deployment impact:** reversible staging workflow
  jobs no longer wait for a generic environment approval; no Worker, provider,
  database, credential, billing, DNS, mobile-store, or production mutation.
- Correct the remaining-gates execution order so hosted ShipCompliant
  activation (Gate 13) precedes the operational label proof (Gate 6), require
  executable mobile API/association routes before Gates 17–18, and record that
  the completed Gate 7 acceptance controller is disabled for unrelated staging
  promotions in favor of one-shot gate-specific switches. **Deployment
  impact:** sets the protected staging variable
  `STAGING_HOSTED_ACCEPTANCE_ENABLED=false`; no Worker, database, provider,
  billing, DNS, mobile-store, or production mutation.
- Refine the orchestration manifest so bounded implementation work may be
  delegated in isolated worktrees after read-only audits, while provider
  mutation, integration review, hosted QA, promotion, and gate-completion
  authority remain centralized with the chief orchestrator. **Deployment
  impact:** collaboration documentation only; no runtime or hosted mutation.
- Add the chief-orchestrator manifest for completing Gates 6, 8, and 10–20,
  with non-overlapping read-only subagent audits, centralized mutation
  authority, dependency-aware sequencing, and mandatory per-gate hosted QA.
  **Deployment impact:** planning documentation only; no provider, database,
  credential, billing, DNS, Worker, mobile-store, or production mutation.
- Record hosted activation Gate 7 as `live-passed` after protected staging run
  `31089753727` deployed reviewed exact candidate
  `530a003b91642ebf40af01468b10e444116ef632` as Worker version
  `3978a4da-e488-4887-9900-34f2673f0cb6` and retained successful tenant/Auth,
  Stripe test Checkout/webhook lifecycle, and fixture-cleanup evidence in
  artifact `8963047777`. **Deployment impact:** documentation-only
  reconciliation of completed isolated staging evidence; no additional
  provider, database, credential, billing, DNS, mobile-store, or production
  mutation.
- Raise the documented Vitest regression floor from 550 to the verified
  569-test hosted-acceptance and Auth-provider repair head. **Deployment
  impact:** QA and agent documentation only; no runtime, provider, database,
  credential, billing, DNS, mobile-store, or production mutation.
- Add an opt-in protected hosted Gate 7 acceptance controller that provisions
  two scoped synthetic tenants, verifies staff/member Auth and API/native RLS
  isolation, exercises Stripe test Checkout plus signed, duplicate, and forged
  webhook handling, advances grace/restriction/suspension/recovery, attempts
  complete synthetic cleanup, and retains sanitized evidence with the staging
  runtime artifact. **Deployment impact:** runs only when the protected staging
  acceptance variable is enabled; test-mode provider and synthetic staging
  data only, with no production, DNS, live-billing, or mobile-store mutation.
- Record hosted activation Gate 2 as `live-passed` after protected staging run
  `31073800654` deployed the exact immutable candidate to the dedicated
  Cloudflare staging account and retained matching revision, configuration,
  Stripe test catalog, and database-backed runtime evidence. Keep Gate 7 open
  for its complete two-tenant/Auth/billing lifecycle acceptance proof.
  **Deployment impact:** documentation-only reconciliation of already completed
  isolated staging deployment evidence; no provider, database, credential,
  billing, DNS, mobile-store, or production mutation.
- Authorize the dedicated `EdStratum Labs Staging` Cloudflare account by its
  normalized SHA-256 target hash and explicitly deny the known production
  account hash. Provision its account-scoped Workers/Queues deployment token,
  integration wake queue, and isolated `vinifera-staging` Worker bootstrap.
  Retain empty fail-closed policy for unchecked targets, route the hosted
  target-policy file through the authority-high-risk CI lane, and update the
  activation and delivery-policy regressions plus runbooks to match.
  **Deployment impact:** enables the already owner-authorized staging Worker
  boundary in a separate Cloudflare account and corrects CI classification; no
  production Worker, DNS, database, billing, or mobile-store mutation.
- Require the exact immutable release-candidate package to be created from
  trusted `main` while the reviewed `dev → staging` promotion PR remains open
  and before that PR is merged. The staging deployment then consumes the
  successful, non-expired exact-SHA artifact without rebuilding. This corrects
  the documented sequence after a staging activation attempt failed closed
  because its already-merged candidate had no eligible package. **Deployment
  impact:** release runbook and continuity guidance only; no application,
  provider, database, credential, Worker, billing, DNS, or production mutation.
- Narrow `human-review-required` from a global automation pause to a consequential-mutation stop. Exact-head review, safe repair, non-production previews, promotion readiness, and immutable artifact packaging now continue while merge/promotion/deployment boundaries remain fail closed. Verified rollback to a known prior reviewed Worker version is no longer blocked by a stop label. The ownership and agent workflow contracts now reserve additional human review for destructive, irreversible, production-data, unresolved auth/tenant, real-money, legal, credential-compromise, or DNS/domain decisions. **Deployment impact:** governance and trusted CI/release-control behavior only; no application route, provider, database, credential, billing, DNS, Worker, mobile-store, or production activation state changes.
- Reconcile the protected `staging` history back into `dev` while retaining the
  newer GitHub-owned Worker deployment model, exact neutral-branch promotion
  fixture, and current Octopus workflow formatting. This removes branch-history
  conflicts without reverting either branch's delivered behavior.
  **Deployment impact:** branch ancestry and release-control history only; no
  provider, database, Worker, billing, DNS, or production mutation.
- Preserve the reconciled `staging` revision as an explicit merge parent after
  the reviewed reconciliation PR was squash-merged. The merge keeps the already
  verified `dev` tree and restores the ancestry required by the protected
  `dev`-to-`staging` promotion comparison.
  **Deployment impact:** Git topology and promotion eligibility only; no
  application, provider, database, Worker, billing, DNS, or production change.

### Fixed
- Give the three multi-branch promotion-smoke fixture tests a 30-second local
  Git budget instead of Vitest's 5-second default. Their assertions are
  synchronous and deterministic, but concurrent full-suite filesystem load
  repeatedly exceeded five seconds while isolated 9/9 runs passed. **Deployment
  impact:** test reliability only; no runtime, workflow, provider, database,
  credential, billing, DNS, mobile-store, or production mutation.
- Stream trusted development auto-merge check-run and commit-status pages into
  runner-local JSON files instead of passing the unbounded historical response
  set through `jq --argjson`. This removes the operating-system argument-length
  failure that blocked an otherwise valid documentation PR while retaining
  exact PR/base/head evidence binding and immediate pre-merge revalidation.
  **Deployment impact:** trusted development merge-control execution only; no
  application, Worker, provider, database, credential, billing, DNS,
  mobile-store, or production mutation.
- Run the reusable Gate 7 Stripe test Checkout before injecting the synthetic
  signed `active` subscription webhook. Run `31087028401` proved the Auth and
  two-tenant segments, then exposed that the prior order wrote a synthetic
  subscription ID into the organization before Checkout; the application
  correctly refused to reconcile that non-provider ID. The active webhook
  still precedes member-link issuance so the portal authorization contract is
  exercised in `active` state. Require the resulting provider URL to use the
  exact HTTPS `checkout.stripe.com` host and a `cs_test_` Session path before
  recording it for cleanup. **Deployment impact:** protected staging acceptance
  ordering and test-mode Stripe objects only; no application runtime,
  production, live-billing, DNS, credential, or mobile-store mutation.
- Align the hosted Supabase Auth Site URL and redirect allowlist with the exact
  staging Worker callback namespace after Gate 7 run `31082627789` proved that
  Supabase was replacing the requested PKCE callback with a fallback origin.
  Keep link-context registration and `signInWithOtp` delivery failures
  indistinguishable from an unknown member; revoke only a failed provider
  attempt's database context and preserve any earlier browser link cookie.
  **Deployment
  impact:** staging Supabase Auth configuration plus member magic-link error
  handling; no production, live-billing, DNS, or mobile-store mutation.
- Publish the Gate 7 run-bound handoff identifier and ephemeral public key to
  the protected staging environment variable
  `STAGING_HOSTED_ACCEPTANCE_MAGIC_LINK_HANDOFF`, then remove it when the wait
  ends. GitHub does not expose workflow-command notices through the check-run
  annotations API until the running step completes, so a notice cannot service
  an in-step encrypted handoff. The existing notice remains as completed-run
  evidence. **Deployment impact:** protected staging orchestration metadata
  only; no credential, application runtime, database, provider, DNS, billing,
  or mobile-store mutation.
- Establish the reusable Gate 7 fixture's operational billing state through
  the real signed Stripe `active` webhook before requesting a member magic
  link. Cleanup intentionally restores `onboarding`, while the hosted
  `register_member_auth_link_context` RPC permits member access only for
  `active` or `grace`; the prior sequence requested Auth before exercising the
  activation webhook. Duplicate, forged, past-due, restriction, suspension,
  and recovery assertions remain in the same lifecycle. **Deployment impact:**
  Stripe test-mode and protected staging acceptance ordering only; no
  production, live-billing, credential, DNS, or mobile-store mutation.
- Retain the Worker's sanitized structured error code and message when a hosted
  Gate 7 HTTP assertion fails. This distinguishes the member magic-link
  rate-recording and link-context database failure branches after exact-head
  staging proved staff sessions and two-tenant isolation, without retaining
  request IDs, cookies, addresses, or provider identifiers. **Deployment
  impact:** protected hosted staging evidence only; no application runtime,
  credential, database, provider, DNS, billing, or mobile-store mutation.
- Make the hosted Gate 7 cookie jar honor browser deletion semantics for
  `Max-Age=0` and expired `Set-Cookie` values, and require a non-empty value
  before treating a staff/member cookie family as present. This prevents a
  cleared legacy base cookie from shadowing the valid Supabase SSR `.0`/`.1`
  session chunks on the next request. Preflight each reconstructed jar directly
  against Supabase and through the Worker's public staff-session route before
  testing protected tenant APIs so any remaining boundary failure is precisely
  attributable. **Deployment impact:** protected hosted
  staging acceptance transport only; no application runtime, credential,
  database, provider, DNS, billing, or mobile-store mutation.
- Recognize Supabase SSR chunked staff and member session cookies in the
  production/staging auth-presence middleware. The hosted Gate 7 controller
  correctly replayed both cookie chunks, but the early defense-in-depth gate
  accepted only the unchunked base name and rejected the authenticated request
  before the authoritative service-layer session check. Add exact-name and
  numeric-chunk regressions while rejecting similarly prefixed state cookies.
  **Deployment impact:** corrects hosted staff/member cookie authentication in
  staging and production code paths; no credential, database, provider, DNS,
  billing, or mobile-store mutation.
- Split every value returned by Node's `Headers.getSetCookie()` before merging
  the hosted Gate 7 cookie jar. Cloudflare can fold multiple Supabase SSR Auth
  cookie chunks into one header value; retaining only its first chunk allowed
  login to return 200 but caused the next authenticated request to return 401.
  The regression includes a folded header with an `Expires` comma. **Deployment
  impact:** hosted staging acceptance cookie transport only; no application
  Auth behavior, provider configuration, production, DNS, live billing, or
  mobile-store mutation.
- Publish the Gate 7 encrypted handoff identifier and ephemeral public key as
  a GitHub Actions notice as well as ordinary log output. This lets authorized
  automation retrieve the public half through the live check-run annotations
  API while the protected job is polling; GitHub does not expose ordinary job
  logs through its API until the job completes. **Deployment impact:** hosted
  staging acceptance orchestration only; no application runtime, provider,
  production, DNS, live billing, or mobile-store mutation.
- Accept both unchunked and Supabase SSR chunked staff/member Auth cookie names
  in hosted Gate 7 assertions. The first protected exact-head execution returned
  a successful staff login but exposed that the controller required only the
  unchunked base key. Add regression coverage that excludes similarly prefixed
  state cookies. **Deployment impact:** hosted staging acceptance assertions
  only; no application Auth behavior, provider configuration, production, DNS,
  live billing, or mobile-store mutation.
- Repair the hosted Gate 7 controller after exact-head review: consume the real
  emailed PKCE magic link through a run-bound encrypted handoff, retain two
  reusable audit-safe staging fixtures and restore their mutable billing state
  with cleanup failures treated as fatal, and compress lifecycle timestamps
  only on the fixture while global reconciliation uses current time. Add
  regression coverage and update the activation ADR/runbook/continuity trail.
  **Deployment impact:** changes the opt-in protected staging acceptance job and
  its synthetic test data only; no production, DNS, live billing, or
  mobile-store mutation.
- Use the protected isolated `STAGING_WORKER_ORIGIN` as the staging
  `APP_ORIGIN` and browser CORS origin until custom-hostname Gate 16 is
  activated. This keeps staff and member Auth callbacks on the same deployed
  origin that owns their cookies and prevents hosted Gate 7 flows from being
  redirected to an unattached custom domain. **Deployment impact:** changes
  only staging Worker callback/CORS variables; production and DNS remain
  untouched.
- Retry isolated staging runtime verification during the short workers.dev
  propagation window after an immutable version reaches 100% traffic. Each
  attempt rechecks health, configuration, the database-backed branding route,
  and the exact packaged Git SHA; thirteen failed attempts at five-second
  intervals still stop evidence
  publication. **Deployment impact:** prevents transient stale-placeholder or
  non-JSON responses from falsely failing an otherwise valid staging deploy;
  no production, DNS, billing, database, or mobile-store mutation.
- Accept current Wrangler `versions upload` output when it contains exactly one
  immutable Worker version ID but omits a preview URL. Staging now falls back to
  its protected, non-secret `STAGING_WORKER_ORIGIN` for post-deploy exact-SHA
  runtime verification, while the production parser continues to require an
  explicit version preview URL. **Deployment impact:** repairs the isolated
  staging Worker activation path only; no production, DNS, billing, database,
  or mobile-store mutation.
- Reconcile the hosted activation ledger with the 2026-08-05 live re-audit:
  mark Gates 1, 3, 4, 5, and 9 `live-passed`, keep repaired Worker/acceptance
  Gates 2 and 7 pending exact-candidate staging deployment, and raise every
  documented Vitest regression floor from 549 to the verified 550-test exact
  head. **Deployment impact:** documentation and merge-floor accuracy only; no
  provider, database, Worker, billing, DNS, or production mutation.
- Re-audit hosted activation Gates 1–5, 7, and 9 against current provider,
  database, and runtime evidence. Repair Cloudflare Access propagation in the
  member service, route default-brand resolution through its tenant-scoped
  admin RPC, require staging identity plus the exact promoted Git SHA in
  Worker evidence, accept immutable Wrangler preview origins, restore the
  skipped-database staging deployment path with `always()`, upload the Access
  service-token bindings, correct the Octopus health route, and replace the
  broken hosted database backup with a checked, timestamped, retained custom
  dump. Refresh native pgTAP fixtures for current template seeds, service-role
  JWT context, browser-role privilege denial, active ML actor attribution,
  source-qualified 500-member/50-outcome training, and production-only alert
  semantics. Add negative browser-role RPC privilege assertions and a member
  service Access-transport regression. Add forward migrations that disambiguate
  release shipment creation and carry selected-brand scope through every
  shipment query, make the email outbox digest portable and schema-qualified,
  and restore early provider-webhook reconciliation after the hashed-token
  rewrite. Require the complete staging Access pair and a successful
  database-backed Worker route before recording live deployment evidence. Load
  the complete 30-migration chain in Phase 5 QA and
  make promotion-smoke fixtures independent of the operator's Git default
  branch.
  **Deployment impact:** staging Worker release control, hosted backup
  operations, and staging database/runtime verification; no production, live
  billing, DNS, or mobile-store activation.
- CF Access service-token headers now injected into all outbound Supabase requests via custom fetch wrapper AND client-level `global.headers`. The `@supabase/supabase-js` `global.fetch` option alone does not reliably propagate to PostgREST database queries in the Cloudflare Workers runtime. A custom `fetch` wrapper using the `Headers` API ensures CF-Access-Client-Id and CF-Access-Client-Secret reach both GoTrue and PostgREST endpoints, and `global.headers` provides a second propagation path at the client level.
- `activeBrandId` brand resolution now uses a `resolve_default_brand_id` RPC (migration 024) via the admin client instead of a direct PostgREST column query on the surface client. The surface client (`@supabase/ssr` `createServerClient`) cannot inject CF Access headers into PostgREST requests in the Workers runtime, causing brand resolution to return the CF Access login page HTML. RPCs bypass the query chain modeler and use `this.admin` (which propagates CF Access headers correctly).
- Stripe webhook signature verification switched from synchronous `stripe.webhooks.constructEvent()` to `await stripe.webhooks.constructEventAsync()` — the synchronous `SubtleCryptoProvider` cannot be used in the Cloudflare Workers runtime.
- Added `stripeCredentialMode` activation guard before `createStripe` call in `handleStripeWebhook` to satisfy fail-closed provider activation requirements.
- Added `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` to `WorkerEnv` type.

### Added

- Migration 024: `public.resolve_default_brand_id(p_organization_id uuid)` RPC — a SECURITY DEFINER wrapper around `private.default_brand_for_org`. Granted execute to both `service_role` and `anon` (PostgREST builds its schema cache as the `anon` role; without the `anon` grant, the RPC is invisible to PostgREST and returns 404).

### Fixed

- Restore `.octopus/runbooks/pr-quality-gates/runbook.ocl` directory structure so CI policy tests can locate the embedded quality-gate runbook (22 test failures on `main`).

### Fixed

- Fix the automated staging deployment pipeline in `ci.yml`: (1) the `deploy-staging` job's `if` condition referenced `vars.STAGING_CLOUDFLARE_DEPLOY_ENABLED`, but this variable was set as a staging _environment_ variable, which is invisible to job-level `if` conditions (environment-level variables are only available on the runner after the job starts, per GitHub's context availability rules). Moved the variable to the repository level so it is visible in the `vars` context at job-evaluation time. (2) The `deploy-staging` job required `needs.database.result == 'success'`, but the `database` job is gated by `vars.STAGING_SUPABASE_MIGRATION_ENABLED == 'true'` (not set), so it is always `skipped`. A skipped job has `result == 'skipped'`, not `'success'`, which blocked `deploy-staging` unconditionally. Updated the condition to accept `skipped` since staging migrations are applied manually on the self-hosted Supabase stack, not via `supabase link`/`supabase db push` which targets Supabase Cloud. **Deployment impact:** CI/release-control pipeline only; no application route, provider, database, credential, billing, DNS, Worker activation, production/mobile approval-gate, or Cloudflare Access policy state changes.

### Fixed

- Add CF Access service token headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) to the `staging-rest-pre` and `staging-rest-pre-merge` REST probe jobs in `promote-dev-to-staging.yml`. Without these headers, the probes receive 302 redirects from the Cloudflare Access protection on `staging-db.edstratumlabs.ai` and cannot verify staging Supabase REST health during the dev→staging promotion pipeline. The `promotion-control` environment already has `STAGING_CF_ACCESS_CLIENT_ID` and `STAGING_CF_ACCESS_CLIENT_SECRET` secrets configured. **Deployment impact:** CI/release-control pipeline only; no application route, provider, database, credential, billing, DNS, Worker activation, production/mobile approval-gate, or Cloudflare Access policy state changes.

### Changed

- Added `workers_dev` and `preview_urls` flags to the staging Wrangler environment so the isolated staging Worker receives a public preview URL for health verification during Gate 2 activation.

### Fixed

- Resolve 15 pgTAP test failures on staging database: add migration 023 (87 missing FK indexes across all phases), update 4 stale test files for renamed constraints/indexes, RPC signature change, and service-role-only security boundary. pgTAP suite now passes 258/258. **Deployment impact:** database schema (87 new non-unique indexes) and test files only; no application route, provider, credential, billing, DNS, Worker activation, production/mobile approval-gate, or Cloudflare Access policy state changes.

### Changed

- Reconcile Octopus↔Cloudflare deployment model (ADR: `2026-08-05-octopus-cloudflare-deployment-reconciliation.md`). Correct `AppHealthUrl` in `.octopus/variables.ocl` from `http://localhost:3000/health` to the real Worker health endpoint `https://vinifera-development.jeff-f69.workers.dev/health`. Deprecate PM2 `restart-application` step in `.octopus/deployment_process.ocl`, replacing it with a `verify-worker-health` evidence probe that checks the deployed Cloudflare Worker; merge the former `smoke-test` step into the probe. Reduce `.github/workflows/octopus-main-deploy.yml` to evidence-only — remove the non-functional "Deploy to Development" step and keep Octopus release creation as an audit record. Octopus now serves as review/orchestration and release-audit ledger; GitHub Actions owns Worker deployment via Wrangler. **Deployment impact:** CI/release-control and Octopus process configuration only; no application route, provider, database, credential, billing, DNS, Worker activation, production/mobile approval-gate, or Cloudflare Access policy state changes.

### Fixed
- Give the promotion-smoke local-drill fixture the same 30-second bounded Git
  operation budget as the three multi-branch fixture tests. This prevents
  full-suite host contention from exhausting Vitest's unrelated 5-second
  default while preserving every assertion and command. **Deployment impact:**
  test timing only; no application route, provider, database, credential,
  billing, DNS, Worker activation, or production/mobile approval-gate state
  changes.
- Conclude OIDC service-account migration investigation: `OctopusDeploy/login@v2` OIDC exchange targets `localhost:8080/token/v1`, a sidecar provisioned only on Octopus Cloud-hosted runners. Self-hosted Octopus with GitHub-hosted runners cannot satisfy this requirement. Reverted both `octopus-main-deploy.yml` and `octopus-pr-quality-gates.yml` to the verified `api_key:` login path; retained `vinifera-gha` service account, dedicated Octopus team (`Teams-21`), Build Server role (`ScopedUserRoles-21`), and `OCTOPUS_SERVICE_ACCOUNT_ID` secret as prerequisites for a future attempt when a compatible token-exchange mechanism ships. **Deployment impact:** CI/release-control authentication behavior only; no application route, provider, database, credential, billing, DNS, Worker activation, production/mobile approval-gate, or Cloudflare Access policy state changes.
- Split protected full-lane browser QA and database architecture checks into
  path-aware jobs so full validation still runs the common app/package gate but
  only pays for Playwright or Phase 1-5 database checks when the exact diff
  touches browser- or database-relevant paths. **Deployment impact:**
  CI/release-control performance only; no application route, provider,
  database, credential, billing, DNS, Worker activation, production/mobile
  approval-gate, or Cloudflare Access policy state changes.
- Pin the npm package manager metadata so dependency/toolchain promotion tests
  can prove the `dependency-tooling-tested` lane without touching application
  runtime code. **Deployment impact:** package-manager metadata only; no
  application route, provider, database, credential, billing, DNS, Worker
  activation, production/mobile approval-gate, or Cloudflare Access policy
  state changes.
- Reconcile protected `dev`/`staging` package metadata with `main` after the
  dependency/tooling fast lane landed, preventing branch drift from forcing
  noisy future promotion diffs. **Deployment impact:** package-manager metadata
  only; no application route, provider, database, credential, billing, DNS,
  Worker activation, production/mobile approval-gate, or Cloudflare Access
  policy state changes.
- Align `staging` package metadata with the verified `dev` dependency/tooling
  state so future dev-to-staging promotions do not carry stale lockfile or
  package-manager drift. **Deployment impact:** package-manager metadata only;
  no application route, provider, database, credential, billing, DNS, Worker
  activation, production/mobile approval-gate, or Cloudflare Access policy
  state changes.
- Add a protected-branch `dependency-tooling-tested` lane for package
  dependency and toolchain metadata changes so `package.json`/`package-lock.json`
  updates validate audit, typecheck, app build, Worker build, and shared mobile
  web output without running database architecture checks, browser QA, Android
  assembly, or Octopus Development releases for package-only main merges.
  Playwright's browser cache is restored for the remaining full browser-QA lane.
  **Deployment impact:** CI/release-control performance and package governance
  only; no application route, provider, database, credential, billing, DNS,
  Worker activation, production/mobile approval-gate, or Cloudflare Access
  policy state changes.
- Keep protected-branch `ci-script-tested` controller/script patches on the
  focused release-control lane instead of escalating to full package, browser,
  and Android validation; pin the two remaining Octopus checkout steps to the
  repo's maintained checkout action and restore a zero-vulnerability production
  dependency audit with targeted `brace-expansion` and `undici` overrides.
  Dependency metadata changes remain high-risk/full-validation work, but no
  longer force Android unless native/mobile paths change or `full_mobile` is
  explicitly dispatched.
  **Deployment impact:** CI/release-control classification, action-runtime
  hygiene, and dependency-audit stability only; no application route, provider,
  database, credential, billing, DNS, Worker activation, Cloudflare Access
  policy, or production/mobile approval-gate state changes.
- Restore Octopus main deploy and PR quality-gate workflows to the verified
  `OctopusDeploy/login@v2` API-key path through the Cloudflare Access proxy
  after the OIDC service-account exchange reached Octopus but was rejected by
  the self-hosted identity matcher. **Deployment impact:** CI/release-control
  authentication behavior only; no application route, provider, database,
  billing, DNS, Worker activation, production/mobile approval-gate, or
  Cloudflare Access policy state changes.
- Strip upstream `Transfer-Encoding` from buffered Cloudflare Access proxy
  responses before setting `Content-Length`, preventing Node/undici parse errors
  during Octopus OIDC discovery. **Deployment impact:** CI/release-control
  authentication behavior only; no application route, provider, database,
  billing, DNS, Worker activation, production/mobile approval-gate, or
  Cloudflare Access policy state changes.
- Rewrite the self-hosted Octopus OIDC discovery `token_endpoint` inside the
  Cloudflare Access proxy so `OctopusDeploy/login@v2` exchanges GitHub OIDC
  tokens through the runner-local proxy instead of following Octopus's internal
  `localhost:8080` advertisement. **Deployment impact:** CI/release-control
  authentication behavior only; no application route, provider, database,
  billing, DNS, Worker activation, production/mobile approval-gate, or
  Cloudflare Access policy state changes.
- Correct the Octopus OIDC migration to use the `OctopusDeploy/login@v2`
  `access_token` output instead of the API-key output, and let the shared
  Octopus runbook bridge authenticate with either an OIDC bearer token or the
  legacy API key. **Deployment impact:** CI/release-control authentication
  behavior only; no application route, provider, database, billing, DNS, Worker
  activation, production/mobile approval-gate, or Cloudflare Access policy
  state changes.
- Add a scheduled/manual Octopus access smoke workflow that verifies the
  browser bypass, Octopus-native authentication boundary, and GitHub Actions
  machine credential path without creating releases or deploying application
  artifacts; update the Octopus/Cloudflare ADR with the confirmed Access policy
  shape, OIDC migration prerequisites, and branch hygiene guidance.
  **Deployment impact:** CI/release-control observability only; no application
  route, provider, database, billing, DNS, Worker activation,
  production/mobile approval-gate, or Cloudflare Access policy state changes.
- Stop the Octopus main development deployment workflow from running on hidden
  promotion-smoke HTML artifacts and `public/_redirects` tombstone-only
  cleanup changes; document the Cloudflare Access OTP diagnosis and the
  Octopus OIDC/service-token optimization path. **Deployment impact:**
  CI/release-control behavior and Octopus deploy noise reduction only; no
  application route, provider, database, credential, billing, DNS, Worker
  activation, production/mobile approval-gate, or Cloudflare Access policy
  state changes.
- Stop the Octopus main development deployment workflow from running on
  test-only changes; this prevents release-control support tests from creating
  unnecessary Octopus releases after merge. **Deployment impact:**
  CI/release-control behavior and Octopus deploy noise reduction only; no
  application route, provider, database, credential, billing, DNS, Worker
  activation, production/mobile approval-gate, or Cloudflare Access policy
  state changes.
- Let the `release-control-tested` fast lane include companion documentation
  updates for workflow/controller changes, preventing safe controller
  promotions with `AGENTS.md` or ADR evidence from falling back to the full app
  and mobile validation lane, and align the protected-branch CI allowlist with
  that classifier rule. **Deployment impact:** CI/release-control
  classification behavior only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or production/mobile
  approval-gate state changes.
- Auto-merge owner-authorized `dev` to `staging` promotions after exact
  head/base, CI, Octopus, Supabase, label, and active-review revalidation;
  remove staging reviewer approval from the read-only hosted readiness probe;
  and route Stripe catalog `probe`/`verify` operations through unprotected
  `promotion-control` while keeping catalog `bootstrap`, production, and
  mobile release gates protected. **Deployment impact:** CI/release-control
  behavior only; no application route, provider, database, credential, billing,
  DNS, Worker activation, or production/mobile approval-gate state changes.
- Let Octopus PR Quality Gates fall back to GitHub's exact pull-request
  `updated_at` timestamp when a direct `dev`→`staging` promotion PR does not
  include a `Review attempt:` marker, while still honoring and rechecking the
  marker when one is present. This prevents missing body boilerplate from
  creating immediate failed Octopus runs. **Deployment impact:**
  CI/release-control behavior only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or activation-gate state
  changes.
- Replaced the dev `operator-tooling-tested` package-script guard heredoc with
  a `node -e` invocation matching staging, preventing indentation-sensitive
  workflow syntax failures and keeping dev→staging smoke promotions on the
  intended fast lane. **Deployment impact:** CI/release-control behavior only;
  no application route, provider, database, credential, billing, DNS, Worker
  activation, or activation-gate state changes.
- Added a staging-only `operator-tooling-tested` fast lane for repository
  operator helpers and npm-script-only `package.json` changes, preventing
  dev→staging promotions of promotion tooling from falling into full package
  and Android validation. The lane validates exact path scope, requires
  `CHANGELOG.md`, rejects dependency or install metadata changes, and maps
  back to full validation for production/main. **Deployment impact:**
  staging CI/release-control behavior only; no application route, provider,
  database, credential, billing, DNS, Worker activation, or activation-gate
  state changes.
- Added a protected-branch `release-control-tested` lane for narrow workflow,
  trusted controller, and script-test changes so staging/main promotions can
  validate release-control tooling with focused policy and script tests instead
  of the full app, browser, and Android package suite. Release-control fast
  lane changes now fail classification without `CHANGELOG.md`, and Octopus PR
  review triggers no longer fire on unlabeled or closed events that only
  produced skipped noise during promotions. **Deployment impact:**
  CI/release-control behavior only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or activation-gate state
  changes.
- Added repository-native promotion smoke helpers for fast, repeatable
  operator drills: hosted marker probing, compact Actions status summaries,
  local delivery-policy CLI classification, and a single `drill` command that
  creates and validates hidden smoke artifacts before PR work begins. Octopus
  runbook failures now include task IDs in trusted-bridge logs once this
  controller update reaches protected branches. **Deployment impact:**
  CI/release-control observability and operator tooling only; no application
  route, provider, database, credential, billing, DNS, Worker activation, or
  activation-gate state changes.
- Allow promotion-smoke cleanup to delete a hidden smoke artifact when its
  exact extensionless redirect tombstone already exists in `public/_redirects`,
  preventing protected branch reconciles from leaving stale `.html` artifacts
  or falling back to the full validation lane for cleanup-only diffs.
  **Deployment impact:** CI/release-control behavior only; no application
  route, provider, database, credential, billing, DNS, Worker activation, or
  activation-gate state changes.
- Allow redirect-only protected-branch cleanup pushes to satisfy the
  `static-routing` lane by validating promotion-smoke tombstones dynamically
  instead of requiring a companion changelog diff or a hardcoded retired-slug
  list. **Deployment impact:** CI/release-control behavior only; no
  application route, provider, database, credential, billing, DNS, Worker
  activation, or activation-gate state changes.
- Added a dedicated `promotion-smoke-cleanup` validation lane for deleting
  hidden smoke artifacts when the matching extensionless redirect tombstone is
  added, keeping the final drill cleanup out of the full promotion suite while
  still proving the artifact disappeared and the tombstone is present.
  **Deployment impact:** CI/release-control behavior only; no application
  route, provider, database, credential, billing, DNS, Worker activation, or
  activation-gate state changes.
- Added a dedicated `static-routing` validation lane for reviewed
  `public/_redirects` smoke-route tombstones, preventing tiny cache-retirement
  route changes from falling into the 7-minute full promotion lane on staging
  and main. Development validation now also keeps those route-only changes out
  of browser smoke and frontend preview publication. **Deployment impact:**
  CI/release-control behavior only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or activation-gate state
  changes.
- Route retired extensionless promotion-smoke URLs away from cached static
  smoke pages so artifact cleanup removes the public marker even when
  Cloudflare Pages still has an older extensionless asset cached. **Deployment
  impact:** static routing cleanup only; no application route, provider,
  database, credential, billing, DNS, Worker activation, or activation-gate
  state changes.
- Treat preview metadata for not-yet-ready development candidates as
  non-applicable instead of passing an empty JSON value to jq, preventing early
  pull-request event races from leaving red `Feature preview decision` and
  `Dev fast checks` runs. Removed hidden promotion-smoke HTML artifacts after
  the end-to-end drill completed. **Deployment impact:** CI controller cleanup
  and test-artifact removal only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or activation-gate state changes.
- Treat trusted preview dispatches for closed or moved dev PRs as ineligible
  instead of failed, preventing successful fast auto-merges from leaving a late
  red repository-dispatch run. **Deployment impact:** CI controller repair
  only; no application route, provider, database, credential, billing, DNS,
  Worker activation, or activation-gate state changes.
- Added promotion-smoke operator tooling for repeatable hidden artifact drills:
  branch-alignment preflight, production artifact-only preflight, deterministic
  hidden artifact generation, and hosted marker probing with extensionless
  redirect and propagation retries. The preflight also performs dry-run
  `git merge-tree` checks so stale protected-branch ancestry is caught before
  dispatching a promotion controller. Trusted development auto-merge now uses
  the event-producing promotion token for the final merge so downstream dev
  push evidence, including `Development deployment candidate`, is emitted for
  automerged candidates. **Deployment impact:** CI/release-control behavior
  only; no application route, provider, database, credential, billing, DNS,
  Worker activation, or activation-gate state changes.
- Make trusted development auto-merge fail closed on malformed candidate
  context evaluation instead of concluding success while skipping the merge.
  The controller now uses portable jq object syntax for required-context state
  resolution and explicitly propagates jq/Node evaluation failures. **Deployment
  impact:** CI controller repair only; no application route, provider,
  database, credential, billing, DNS, Worker activation, or activation-gate
  state changes.
- Make trusted development auto-merge wait for freshly-triggered development
  validation components before calling the GitHub merge API, avoiding a race
  where label-triggered automerge can see an older successful `Dev fast checks`
  run while branch protection is still expecting the new one. **Deployment
  impact:** CI controller repair only; no application route, provider,
  database, credential, billing, DNS, Worker activation, or activation-gate
  state changes.
- Treat pull requests that close before trusted frontend preview publication
  as preview non-applicable, preventing successful protected reconciles from
  leaving a late red `Frontend preview evidence` status after merge.
  **Deployment impact:** CI evidence publishing only; no application route,
  provider, database, credential, billing, DNS, Worker activation, or
  activation-gate state changes.
- Added faster, explicit delivery-control paths for protected branch
  reconciles and narrow CI-script/test patches. Development validation now
  recognizes `protected-reconcile` and `ci-script-tested` lanes, avoids
  unnecessary browser smoke and preview publication, suppresses redundant
  preview failures for superseded dev runs, and publishes trusted Octopus
  non-applicability for protected `main/staging -> dev` reconciles.
  **Deployment impact:** CI/release-control behavior only; no application
  route, provider, database, credential, billing, DNS, Worker activation, or
  activation-gate state changes.
- Treat empty exact diffs from protected-branch ancestry reconciles as an
  explicit `noop` validation lane, allowing `Vinifera Promotion Gate` to pass
  only when every validation job is skipped instead of blocking production
  promotions on no-op staging/main merge commits. **Deployment impact:**
  CI/release-control behavior only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or activation-gate state
  changes.
- Treat protected-branch reconciliation PRs as frontend-preview
  non-applicable after live PR identity validation, avoiding failed trusted
  preview publication runs for `main -> dev` policy reconciles. **Deployment
  impact:** CI evidence publishing only; no application route, provider,
  database, credential, billing, DNS, Worker activation, or activation-gate
  state changes.
- Streamlined routine publishing and promotion gates so hidden smoke artifacts
  and documentation-only promotions no longer run the full release pipeline:
  `ci.yml` now honors fast `docs` and `promotion-smoke` lanes on staging/main,
  publishes one canonical `Vinifera Promotion Gate`, and validates hidden smoke
  artifacts with noindex/nofollow, `build:pages`, copied-dist, secret-scan, and
  no-link checks. The `dev → staging` promotion controller now waits only for
  that canonical gate, exact Octopus evidence, staging REST probes, and no
  active requested-changes review, ignoring stale unresolved comment threads
  and unrelated optional check noise. Trusted dev auto-merge follows the same
  active requested-changes rule. The Octopus PR bridge also accepts timestamp
  `Review attempt:` markers for manually opened promotion PRs, matching its
  existing validation contract. **Deployment impact:** CI/release-control
  behavior only; no application route, provider, database, credential, billing,
  DNS, Worker activation, or activation-gate state changes.
- Made the trusted development auto-merge controller tolerate GitHub branch
  protection context lookup denial by falling back to the versioned delivery
  contract defaults only when the protected-context API response is unavailable
  or malformed. This prevents a `Resource not accessible by integration`
  response from being concatenated with fallback JSON and silently making an
  otherwise eligible candidate unmergeable. **Deployment impact:** CI
  controller repair only; no application route, provider, database,
  credential, billing, DNS, Worker activation, or activation-gate state
  changes. **Verification:** Ran
  `node --test .github/scripts/dev-automerge-policy.policy.mjs`,
  `npm run build:pages`, and `git diff --check`; then promoted hidden artifact
  `public/vinifera-promotion-smoke-2026-08-02.html` through dev PR #103,
  staging PR #104, and production PR #105 with exact-head Full promotion
  validation, Octopus PR Quality Gates, Direct Push Guard where applicable,
  staging URL marker checks, and production URL marker checks.
- Kept trusted development auto-merge fallback notices out of the captured
  candidate decision channel by writing the branch-protection fallback notices
  to stderr, and documented the fallback authorization in the principal
  orchestrator ADR. **Deployment impact:** CI controller policy record only; no
  application route, provider, database, credential, billing, DNS, Worker
  activation, or activation-gate state changes. **Verification:** Ran
  `node --test .github/scripts/dev-automerge-policy.policy.mjs`,
  `npm run build:pages`, and `git diff --check` locally for PR #106; PR #106
  then passed Development fast validation, Frontend preview evidence, and
  Octopus PR Quality Gates at head `ffc3f75ce1c4`.
- Added a separate second-pass promotion verification record for the
  auto-merge stderr repair and hidden artifact drill. **Deployment impact:**
  Audit trail only; no application route, provider, database, credential,
  billing, DNS, Worker activation, or activation-gate state changes.
  **Verification:** PR #107 passed the `dev → staging` promotion controller
  readiness workflow, staging Supabase pre-flight and pre-merge probes,
  exact-head Full promotion validation, Octopus PR Quality Gates, no unresolved
  review threads, and staging push Full promotion validation at merge
  `956425679a45`. PR #108 passed Direct Push Guard, Octopus PR Quality Gates,
  and exact-head Full promotion validation; production hidden-artifact URL
  checks stayed green on `vinifera.pages.dev`, `vinifera.edstratumlabs.ai`, and
  `vinifera-live.edstratumlabs.ai`.
- Replaced indented Node heredocs in the trusted development auto-merge
  controller with `node --eval` calls so the controller can revalidate and
  merge eligible exact-head candidates instead of failing on Bash heredoc
  parsing before its policy decision. **Deployment impact:** CI controller
  repair only; no application route, provider, database, credential, billing,
  DNS, or activation-gate state changes. **Verification:** Ran
  `npm run build:pages`, confirmed
  `dist/vinifera-promotion-smoke-2026-08-01.html` is absent, and ran
  `git diff --check`; the updated cleanup PR then passed Development fast
  validation, Octopus PR Quality Gates, Cloudflare Pages preview publication,
  and Frontend preview evidence at head `a0405daf7707b3e8029ac2498bb22ec9f35d688e`.
- Reconciled current `staging` ancestry back into `dev` after the hidden
  promotion smoke artifact reached staging, preserving the subsequent
  touch-target repair on `dev` while restoring a clean graph for the next
  protected `dev → staging → main` promotion attempt. **Deployment impact:**
  Branch history and documentation only; no application route, provider,
  database, credential, billing, DNS, or activation-gate state changes.
- Scoped hosted development runtime E2E to the protected development Worker
  release lane with an explicit opt-in marker, so local/full promotion
  Playwright QA does not fail on intentionally absent protected credentials
  while the actual hosted deploy verification still fails closed when its
  origin, candidate SHA, or QA credentials are missing. **Deployment impact:**
  CI/development-release verification wiring only; no application code,
  provider, DNS, database, billing, production, hosted-data, credential, or
  activation-gate state changes.
- Reconciled current `main` ancestry back through `dev` so the protected
  `dev → staging → main` promotion path can fast-forward through the audited
  Octopus proxy, direct-push guard, promotion-control, and delivery-gate
  fixes without reintroducing older split-history workflow variants.
  **Deployment impact:** Branch history repair and release-control metadata
  only; no application code, provider, DNS, database, billing, production,
  hosted-data, credential, or activation-gate state changes.
- Hardened delivery-control gates after the workflow smoke audit: the main
  direct-push guard now runs for privileged users and automation, the trusted
  `dev` automerge controller accepts required check-runs only when they belong
  to the live PR/base/head tuple, and hosted development runtime verification
  fails closed when the protected origin, candidate SHA, or QA credentials are
  absent. The direct-push guard policy tests now match the current six-attempt,
  15-second associated-PR indexing window. **Deployment impact:** Changes
  GitHub CI and merge/deployment guardrails only; no application code,
  provider, DNS, database, billing, production, hosted-data, credential, or
  activation-gate state changes.

### Removed

- Removed the temporary hidden promotion smoke artifact at
  `public/vinifera-promotion-smoke-2026-08-01.html` after the publishing drill
  reached production and its marker was verified on `vinifera.pages.dev`,
  `vinifera.edstratumlabs.ai`, and `vinifera-live.edstratumlabs.ai`.
  **Deployment impact:** Static cleanup only; no visible navigation, provider,
  database, credential, billing, DNS, or activation-gate state changes.
  **Verification:** Ran `npm run build:pages`, confirmed
  `dist/vinifera-promotion-smoke-2026-08-01.html` is absent, and ran
  `git diff --check`.

### Added

- Added an unlinked, noindex static promotion smoke artifact at
  `public/vinifera-promotion-smoke-2026-08-02.html` so the protected
  `dev -> staging -> main` publishing workflow can be exercised again with a
  harmless hidden asset. The page uses semantic landmarks, contains no
  navigation entry points or touch targets, and includes the unique
  `VINIFERA_PROMOTION_SMOKE_2026_08_02_MARKER` marker for hosted
  verification. **Deployment impact:** Static asset only; no visible
  navigation, app route, API, provider, database, credential, billing, DNS,
  Worker activation, or activation-gate state changes.
- Added an unlinked, noindex static promotion smoke artifact at
  `public/vinifera-promotion-smoke-2026-08-01.html` so the
  protected `dev → staging → main` publishing workflow can be exercised with a
  harmless hidden asset before the artifact is removed through the same path.
  The page includes standalone HTML landmarks for accessibility validation.
  **Deployment impact:** Static asset only; no visible navigation, app route,
  API, provider, database, credential, billing, DNS, or activation-gate state
  changes.

- Promotion smoke coverage now checks the documented branch path, manual
  promotion controls, staging Octopus requirement, production authorization
  boundary, and safe main-to-development Octopus deploy target so the delivery
  workflow can be exercised end to end with a harmless test-only artifact.
  **Deployment impact:** Adds CI contract coverage only; no application code,
  hosted provider, database, DNS, billing, production, or activation-gate state
  changes.
- Prepared protected development deployment and consolidated release control:
  an unprivileged `dev` merge marker wakes a trusted default-branch controller
  that remains disabled until the isolated Worker, scoped protected
  credentials, rollback version, and two synthetic QA tenants are verified.
  When enabled, it builds one preprocessed Worker/assets package, verifies a
  deterministic SHA-256 manifest, uploads the same bundle with Wrangler
  `--no-bundle`, deploys one Cloudflare version, proves exact
  revision/environment health, configuration readiness, staff authentication,
  a tenant-scoped member journey, cross-tenant denial, the member-auth
  boundary, desktop and 375-pixel rendering, and critical browser/server
  errors, then
  rolls back automatically on failure. The selected release-candidate
  packager accepts only the current maintained `dev → staging` PR after full
  CI and Octopus and retains one immutable artifact. Protected staging
  resolves and verifies that exact package before a no-bundle version upload;
  production bootstrap/upload requires the same package run, source tree, and
  digest rather than rebuilding. The protected production entry now summarizes commit, changes,
  risk, validation, staging evidence, artifact digest, target, rollback, and
  caveats before its existing environment approval. One scheduled Delivery
  Control Center issue separates implemented, CI-verified, deployed, and
  live-verified state. The 20 pending activation gates are sequenced into
  private synthetic beta, restricted live winery pilot, and GA without
  changing any status. **Deployment impact:** Adds a distinct
  `vinifera-development` Wrangler environment and protected workflow
  definitions, but hosted mutation is disabled and no Worker version,
  provider, credential, DNS, database, billing, production, or activation-gate
  change occurs.
- Risk-based autonomous delivery to `dev`: added the machine-readable
  `.github/delivery-risk-contract.json`, a pure policy evaluator with contract
  tests, and a trusted default-branch auto-merge workflow. The workflow
  resolves one live same-repository PR, reclassifies the exact diff from
  trusted code, requires current `dev` base/head identity,
  `codex-auto-merge`, low/medium risk, every canonical and live protected
  context, applicable `Frontend preview evidence`, and zero unresolved review
  threads. It rejects drafts, forks, high/unknown risk, emergency labels,
  missing/pending/skipped/neutral/cancelled/failed evidence, and paginated
  review state, then repeats the complete decision immediately before an
  exact-SHA squash merge. Successful trusted frontend publication wakes the
  controller through an exact-identity repository dispatch because ordinary
  token-created status events do not reliably trigger another workflow. The
  GitHub governance snapshot defines reversible
  `dev` PR protection and read-only default Actions permissions without
  changing production controls. Trusted merge and preview publishers retain
  their scoped checkout credentials only for authenticated private-repository
  object fetches and never execute PR-head code. **Deployment impact:** Changes non-production
  repository governance and prepares trusted automatic merges. The workflow
  does not activate until it reaches the repository default branch and this
  PR performs no deployment, provider activation, credential rotation, DNS
  change, hosted-data mutation, production action, or activation-gate
  completion.
- Principal-orchestrator candidate delivery governance and fast CI: ready
  pull-request heads now drive the exact `Dev fast checks` candidate while
  feature pushes and draft WIP avoid expensive cloud validation. The
  fail-closed classifier reports exact base/head, low/medium/high risk,
  execution surface, focused tests, browser applicability, and preview
  applicability; unknown paths are invalid and authority-high-risk candidates
  require the trusted Octopus boundary. Backend, workflow, test-only, and documentation candidates
  avoid Playwright unless a risk rule requires it. Every candidate records an
  always-present `Feature preview decision`. Frontend candidates retain a
  prebuilt Pages artifact for a trusted default-branch publisher that
  independently reclassifies the live exact diff before publishing
  `Frontend preview evidence` to preview branches of `vinifera-dev`, without
  executing PR-head code beside Cloudflare credentials, trusting
  artifact-supplied applicability, accepting reserved environment branch
  names, or deploying to the public `vinifera` project. Applying or removing
  `octopus-review-required` now retriggers the same exact candidate, and manual
  candidates resolve that boundary from the one live exact-head PR rather than
  an absent dispatch payload.
  Manual exact-candidate evidence uses a distinct check context and must be
  dispatched from the candidate head. Governance, prior delivery ADRs, the PR template,
  continuity, workflow documentation, and contract tests now use one logical
  PR changelog entry, batched findings, and at most two substantive
  repair/re-review cycles. **Deployment impact:** Changes development CI and
  defines a protected preview-publication transition. The direct Pages
  integration remains enabled until the trusted publisher reaches `main` and
  passes frontend/applicability bootstrap proofs. This PR performs no Worker or
  production deployment, provider activation, DNS change, billing action,
  credential rotation, hosted-data mutation, or activation-gate completion.
- Two-speed development and release delivery: added the exact-diff
  `Dev fast checks` lane with focused tests, TypeScript/Worker validation,
  production builds, credential and whitespace checks, a mobile accessibility
  browser smoke, cancellable branch concurrency, and independent Cloudflare
  preview evidence; retained the exact `Type, test, build, and package`
  promotion aggregate with complete Vitest, Phase 1–5 database,
  Playwright/axe, Pages, Worker, selective Android, and nightly native drift
  validation. Promotion is now deliberate instead of running after every
  `dev` push; Octopus is required for exact-comparison promotions and
  explicitly requested high-risk feature review, while CodeRabbit is
  non-blocking while rate-limited. Promotion secrets are isolated behind a
  main-only `promotion-control` environment, emergency labels fail closed
  throughout readiness, and production release now requires the current
  `main` SHA from a merged `staging → main` PR without either emergency label.
  Production also requires a successful exact-staging deployment run, an
  identical staging/production Git tree, and the configured staging soak
  before revalidating authorization immediately ahead of Worker mutation.
  The standard production dispatch no longer accepts legacy marketing-domain
  cutover or Pages-restore operations, preserving the static rollback hostname.
  Updated the delivery governance, continuity
  brief, PR template, runbooks, contract tests, implementation manifest, and
  ADR for one changelog entry per logical PR, isolated-branch WIP commits, and
  squash merge into `dev`. **Deployment impact:** Changes CI, review,
  promotion-readiness, and production-release authorization behavior, including
  staging evidence/soak/tree-equality enforcement and the available standard
  release operations. This PR itself performs no branch merge, environment
  promotion, provider activation, deployment, DNS change, database mutation, or
  production resource change.

### Fixed

- Reconciled `staging` ancestry back into `dev` after the Octopus workflow
  repair sequence so the next `dev → staging` promotion has a clean merge base
  instead of re-conflicting on already-reviewed deployment workflow files.
  **Deployment impact:** Branch-history repair and documentation only; no
  runtime, hosted provider, database, DNS, billing, production, or
  activation-gate state changes.
- The main Octopus deployment workflow now rejects manual dispatches unless
  they run from `refs/heads/main`, before checkout or Octopus/Cloudflare
  credentialed steps execute. Cloudflare Access service-token values are scoped
  to the proxy startup step instead of job-level environment, preserving the
  trusted main-only deployment boundary while still allowing push and manual
  main smoke runs to create and deploy an Octopus release to Development.
  **Deployment impact:** Tightens the existing Octopus Development deploy
  control only; no Worker, provider, database, DNS, billing, production, or
  activation-gate state changes.
- Nightly Octopus security-audit diagnostics now reuse the trusted PR bridge's
  credential-shape validation and safe HTTP response provenance, identifying
  the exact method/path and responder class for the current first-request 403
  without logging credential values, response bodies, or query data. The
  shared request path supplies a stable CI user-agent so Cloudflare does not
  reject Node's default browser signature. The nightly runner now uses the Git
  Config-as-Code `refs/heads/main` preview, snapshot-template, and grouped-run
  endpoints instead of the obsolete database-backed runbook route, and it
  shares one executor with the PR bridge for lookup, sensitive form resolution,
  template validation, grouped submission, polling, and timeout cancellation. The
  workflow pins the repository-standard checkout action, and focused tests
  cover the Cloudflare-shaped rejection, request identity, and successful
  Config-as-Code run. Current governance, setup,
  architecture, rollback, activation, delivery-performance, and continuity
  documentation now distinguishes the `dev`-only principal-orchestrator
  controls, the inactive hosted boundary, the current branch revisions, and
  the credential-independent rehearsal from deployment or activation proof.
  The rehearsal passed 512 Vitest cases, all five database phases, deterministic
  seed/reseed validation, 155 Playwright/axe cases with three hosted-only
  skips, mobile identity and release contracts, compile-only Capacitor sync,
  production-release contracts, Pages packaging, all three Worker dry runs,
  and a zero-vulnerability production dependency audit.
  Operationally, the existing Octopus service token was renewed and
  synchronized to GitHub and the private vault. The stale audit-specific
  GitHub credential was replaced in both locations with the separately
  documented repository PAT after successful GitHub API validation. Browser
  Integrity Check was
  disabled only for the Octopus hostname and Bot Fight Mode was disabled on
  `schubert.life` so CI can reach the still-required Access service-token
  policy. A real Security Audit runbook invocation then passed. AI-bot
  protection and the public `edstratumlabs.ai` zone were unchanged.
  The zone-wide Bot Fight Mode change was owner-authorized for failed-Actions
  remediation, affects proxied `*.schubert.life` hosts only, and has an
  explicit API rollback to `fight_mode=true`; the Octopus-only Browser
  Integrity Check rule remains independently reversible. Exact-head PR #67
  fast CI and the `dev`-ref PR Quality Gates runbook passed, while the trusted
  main-ref status remains blocked until `PR Quality Gates` is present on
  `main` through the normal promotion path.
  **Deployment impact:** Repairs the CI-to-Octopus access path and documents
  its external Cloudflare/credential reconciliation. No Worker, Pages,
  application provider, database, DNS, billing, branch promotion, or
  activation-gate mutation occurs, and the public static prototype is
  unchanged.
- Octopus PR bridge failures now report secret-safe credential shape and HTTP
  response provenance, distinguishing Cloudflare Access rejection from
  Octopus API authorization without logging credential values, response
  bodies, query strings, or redirect paths. Non-ASCII header credentials fail
  before network access. **Deployment impact:** Trusted PR-review diagnostics
  only; no application deployment, provider activation, DNS change, database
  mutation, or production action occurs.
- Restored the flat `.octopus/runbooks/pr-quality-gates.ocl` layout that
  Octopus Config as Code actually loads, aligned contract tests to that
  canonical path, and changed the trusted bridge from snapshot endpoints to
  Git-ref-qualified preview/template/run-v1 endpoints. Config-as-Code now
  defines the five non-secret exact-PR inputs as required prompts while the
  GitHub PAT remains an Octopus database-backed sensitive prompt. The bridge
  recognizes Octopus's `Octopus.ControlType` sensitive marker and submits the
  PAT only through the masked form-value channel; it is never stored in Git or
  logged. The runbook constructs GitHub's Basic `x-access-token` smart-HTTP
  header in memory for the private-repository fetch and unsets it immediately;
  GitHub API requests retain Bearer authentication. The prior nested path
  passed local tests but left `PR Quality Gates` absent from every live
  Git-backed runbook list. **Deployment impact:** Repairs trusted high-risk PR
  review once the bridge, prompts, and flat OCL reach the default branch; no
  application deployment, provider activation, DNS change, database mutation,
  or production action occurs.
- Octopus Rule 3 now requires a provider-token boundary and at least 16
  credential payload characters, so ordinary identifiers such as
  `pre_shipment` and `store_meta_attribution_touchpoint` no longer fail the
  full-source scan while realistic `re_`, Stripe, EasyPost, and restricted-key
  tokens remain blocking. Positive and negative embedded-runbook fixtures
  cover both paths. **Deployment impact:** High-risk review precision only; no
  application deployment, provider activation, DNS change, database mutation,
  or production action occurs.
- Review-gate permissions and Worker rollback authorization now fail closed
  without becoming unusable: Octopus can read PR metadata, promotion and
  production gates can read exact Actions run/job evidence, and rollback keeps
  current `main` as the trusted control SHA while independently verifying a
  prior reviewed release SHA, matching staging tree/run/soak, version
  annotations, and previously sole-active Cloudflare deployment history.
  Current and prior release identities are revalidated immediately before
  mutation. **Deployment impact:** Tightens protected review/promotion/release
  authorization only; no merge, promotion, deployment, DNS, database, provider,
  or production mutation occurs.
- Cloudflare preview evidence now prefers the `vinifera-dev` project check when
  present and falls back to the actual `vinifera` feature-preview check. Live
  PR evidence showed that feature heads receive `Cloudflare Pages: vinifera`,
  while the `dev` branch itself receives `Cloudflare Pages: vinifera-dev`;
  previously the evidence job waited four minutes for a check that could not
  appear on the feature head. **Deployment impact:** CI evidence discovery only;
  no Pages deployment, branch merge, DNS change, or hosted mutation occurs.
- - `promote-dev-to-staging.yml` (jq suite iterator typo | [] vs | .[]): Fixed `| []` (empty array constructor, always emits literal string `[]`) to `| .[]` (array iterator) in the check-suite ID extraction jq expression. The typo caused `gh api repos/.../check-suites/[]` to be called on every iteration, returning HTTP 404 under `set -e` and crashing both the `wait-for-gates` and `ready` jobs within 1 second of startup.
- - `promote-dev-to-staging.yml` (null check_suite id → HTTP 404): Added `| select(. != null)` to the jq filter that collects check-suite IDs before fetching their `created_at` timestamps. When a check-run has no associated suite, `.check_suite.id` is null; jq emitted the literal string 'null', which bypassed the empty-string guard and caused `gh api repos/.../check-suites/null` to return HTTP 404 under `set -e`, immediately crashing both the `wait-for-gates` and `ready` jobs on the first poll iteration.
- - `promote-dev-to-staging.yml` (gh CLI --slurp/--jq incompatibility): Replaced four `gh api --paginate --slurp ... --jq` call-sites with `gh api --paginate ... | jq --slurp '...'`. The `--slurp` and `--jq` flags are mutually exclusive in the current gh CLI version; the combination caused an immediate exit-1 on the first poll iteration of both the `wait-for-gates` and `ready` jobs, preventing the promotion workflow from ever completing.
- - `octopus-security-audit.yml` / `octopus-security-audit.mjs` (nightly security audit): Replaced broken `OctopusDeploy/run-runbook-action@v1` (tag `v1` does not exist; latest is `v4.0.3`) with a checkout-and-run step that executes the new `.github/scripts/octopus-security-audit.mjs` script. The script mirrors the CF-aware HTTP infrastructure from `octopus-runbook.mjs` — passing `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on every Octopus API request — while requiring only the four non-PR secrets. The old action made direct HTTPS calls without CF Access headers, causing a Cloudflare 302 redirect on the first request regardless of tag version.
- - `ci/octopus-pr-quality-gates.yml` (Cloudflare Access service token): Created service token `vinifera-github-actions-octopus` (expires 2027-07-29) for the `Octopus Deploy — Schubert` Access application. Installed four GitHub repository secrets — `OCTOPUS_URL`, `OCTOPUS_API_KEY`, `OCTOPUS_CF_ACCESS_CLIENT_ID`, `OCTOPUS_CF_ACCESS_CLIENT_SECRET` — required by `octopus-runbook.mjs` to authenticate through the Cloudflare Access proxy to the self-hosted Octopus Deploy instance on Schubert V2. Previously the quality gate workflow failed because the secrets were absent; the runbook now has all credentials to connect via HTTPS.
- `promote-dev-to-staging.yml` (staging REST probe endpoint): Changed from
  `/health` to `/auth/v1/health`. The self-hosted Kong gateway on Schubert
  requires auth credentials on the `/health` route (returns 401) but serves
  `/auth/v1/health` openly (returns 200). No gate logic affected.
- `promote-dev-to-staging.yml` (staging REST pre-flight and re-check probes):
  Changed probe endpoint from `/rest/v1/` to `/health`. Supabase restricts
  `/rest/v1/` to `service_role` credentials; the anon key returns HTTP 401,
  causing the pre-flight job to fail closed on every run. The `/health`
  endpoint returns HTTP 200 without credentials and accurately confirms that
  the Supabase project is reachable. No functional change to any gate logic.
- `promote-dev-to-staging.yml` (both readiness-attempt sites): Fetch each
  check-run's parent check-suite via `gh api repos/$REPO/check-suites/$sid`
  to obtain the real `created_at` timestamp. The GitHub check-runs API does
  not return `created_at` on run objects; filtering by the missing field
  silently discarded every check-run, making all promotion gates
  un-passable. The fix builds an in-memory `suite_map` indexed by suite id,
  substitutes `$suite_map[(.check_suite.id | tostring)]` for the direct
  field access, and removes the now-redundant `.created_at` fallback from
  `sort_by`. Updated `promote-dev-to-staging.test.mjs` to assert the new
  suite-map pattern instead of the removed `select(.created_at …)` guard.
  **Deployment impact:** Promotion readiness gates can now evaluate
  attempt-bound check runs; no environment or provider activation occurs.
- Final owner-approved PR #51 correction: make Octopus tracked-source scans
  distinguish “no matches” from operational failures; resolve relative
  cross-layer imports against their tracked source paths; require promotion
  check runs to be both created and started during the current readiness
  attempt; preserve valid encoded fragment navigation and history; and
  self-host the pinned Lucide 1.27.0 bundle with its license so the Worker can
  restore `script-src 'self'`. Added adversarial regressions for corrupted Git
  state, nested relative-import bypasses, bundle integrity, exact CSP, and
  attempt-bound check creation. **Deployment impact:** Static marketing,
  guide, and rollback-prototype icons load from the first-party origin;
  promotion and Octopus gates fail closed on additional stale/error paths. No
  provider activation, environment promotion, merge, or deployment occurs.
- Controlled PR #51 audit: Honor reduced-motion preferences for scripted card
  reveals and anchor scrolling; restore focus to the selected in-page mobile
  destination; align the Worker CSP with the landing page's legacy inline CSS;
  pin the allowed Lucide bundle to 1.27.0 with SHA-384 integrity; make Octopus
  Rules 1–3 fail closed on missing task state and inspect only tracked files;
  refresh workflow counts, staging-isolation state, evidence timestamps, actor
  handoff, and merge/readiness terminology across governance documentation.
  **Deployment impact:** The Worker-served landing page regains its intended
  styling and 44-pixel mobile targets; marketing behavior changes for
  reduced-motion and mobile-keyboard users; Octopus remains blocked until its
  trusted default-branch workflow and runnable snapshot are bootstrapped. No
  environment or provider activation occurs.
- `.github/workflows/octopus-pr-quality-gates.yml`,
  `.github/scripts/octopus-runbook.mjs`, and the Octopus runbook contract:
  Bind each queued review to the event's base ref and base SHA as well as its
  head SHA, include the base SHA in the published status attestation, and make
  promotion capture and revalidate that base through readiness reporting. A temporary or
  later base-branch change can no longer produce a reusable success status for
  an unreviewed comparison.
- `.github/workflows/promote-dev-to-staging.yml` and governance documentation:
  Removed the automatic PR merge after exact-head review found that GitHub's
  merge API has no atomic expected-base guard. Automation now captures and
  validates both revisions, runs every readiness gate, and leaves the PR open
  for a human to re-check and merge.
- `.github/workflows/promote-dev-to-staging.yml` and its contract test:
  Revalidate the captured head/base, exact CI and status set, CodeRabbit review,
  Octopus attestation, and unresolved threads after the second provider probe
  for both normal and dry-run readiness. Dry-run now skips only mutation, not
  evidence validation.
- `.github/workflows/promote-dev-to-staging.yml`: Bracket the final evidence
  refresh with head/base reads and reject readiness if either revision changes
  while checks, statuses, reviews, or threads are queried.
- `.github/workflows/promote-dev-to-staging.yml`: Start each readiness attempt
  with a unique timestamped PR-body marker, require CI check associations to
  name the captured head and base, and accept statuses and CodeRabbit reviews
  only when they were created during that attempt. A prior review of the same
  head against an older staging base cannot satisfy readiness.
- `.github/workflows/ci.yml` and the promotion contract: Handle the readiness
  marker's pull-request `edited` event so every attempt creates a fresh,
  base-bound quality run even when the `dev` head has not changed.
- `.octopus/runbooks/pr-quality-gates/runbook.ocl` and its contract test:
  Persist the resolved merge-base SHA in task-scoped state before the separate
  Rules 4–10 action sources it. Without this transfer, strict shell mode
  stopped the mandatory change-aware Octopus gate before any rule executed.
- `index.html` and `tests/e2e/phase1.spec.ts`: Restored all six marketing
  free-trial CTA capability paths while retaining the four canonical pricing
  tiers, and restored the staff skip-link regression assertion. The prior
  direct PR #30 resolution had replaced later landing-page behavior and deleted
  both previously merged tests.
- `tests/e2e/phase5.spec.ts`: Recombined PR #35's HTTPS-logo validation coverage
  with the previously merged mobile select sizing, portal status, manager role
  gate, and branded document-title assertions. The direct resolution had
  silently replaced those tests rather than resolving them together.
- `.github/workflows/promote-dev-to-staging.yml`: Open the promotion PR before
  provider probes, use an event-producing token so pull-request CI and Octopus
  actually run and so the merged staging push invokes deployment workflows,
  exclude the promotion run from its own exact-SHA polling, require aggregate
  CI, Octopus, CodeRabbit, the latest registered statuses, and zero unresolved
  threads, and report an exact-head/base readiness result for human merge. This removes
  the original self-deadlock, missing-label failure, suppressed staging event,
  and false-success merge path.
- `tests/scripts/promote-dev-to-staging.test.mjs`: Added source-contract coverage
  for PR ordering, event triggering, self-run exclusion, review gates,
  credential documentation, and exact-head/base readiness confirmation.
- `.github/workflows/promote-dev-to-staging.yml`: Granted the polling token
  explicit check/status read permissions and excluded every promotion job name,
  including prior attempts on the same commit, so credential repair or a
  transient-provider retry cannot be poisoned by an older failed run.
- `.github/workflows/promote-dev-to-staging.yml`: Explicitly request a
  CodeRabbit review on the non-default staging base and accept its nominally
  successful status only when the description is exactly `Review completed`;
  skipped and rate-limited reviews otherwise report misleading success states.
- `CONTINUITY_BRIEF.md`: Replaced the stale pre-merge UI mission state with the
  audited merge-cleanup outcome, including the direct-resolution regressions,
  remaining remote branches, default-branch Octopus bootstrap gap, and
  isolated-staging credential blocker.
- `.coderabbit.yaml`, `AGENTS.md`, and `docs/agent-workflow.md`: Added
  version-controlled automatic review coverage for PRs targeting `dev` and
  `staging`, with incremental review enabled and a ten-commit pause threshold.
  This replaces the default-branch-only behavior observed on PR #51.
- `CONTINUITY_BRIEF.md`: Recorded verified deletion of the stale merged PR
  #49/#50 remote branches after the strategist's three-branch cleanup claim was
  found to be premature.
- `index.html`, `tests/e2e/phase1.spec.ts`, and
  `tests/scripts/landing-static.test.mjs`: Trial CTAs now fail safely to the
  pricing section on static Pages and switch to `/app/signup` only after the
  same-origin `/api/health` response proves the Vinifera Worker runtime.
  Marketing interactions moved from CSP-blocked inline blocks to the
  self-hosted `public/marketing.js`, preserving signup enhancement, smooth
  scrolling, motion, and the mobile menu under the Worker's `script-src
'self'` policy.
- `CONTINUITY_BRIEF.md`: Pinned the Octopus bootstrap finding to the audited
  GitHub default-branch SHA and distinguished `main` runtime workflow code from
  the corrected but not-yet-promoted `dev` definition.
- `.github/workflows/promote-dev-to-staging.yml`: Set workflow token permissions
  to empty by default, scoped check/status/thread reads to the polling job, and
  made required aggregate CI pass only on an exact `success` conclusion.
  Skipped, neutral, cancelled, or failed required checks now fail immediately
  instead of passing or waiting until timeout.
- `CONTINUITY_BRIEF.md`: Updated CodeRabbit state after adding automatic
  `dev`/`staging` reviews and retained explicit review requests plus exact
  completion-description enforcement as defense-in-depth.
- `public/marketing.js` and `tests/e2e/phase1.spec.ts`: Closing the marketing
  mobile menu with Escape now restores focus from a hidden menu link to the
  hamburger control, with a 375px keyboard regression test.
- `public/marketing.js`, `tests/e2e/phase1.spec.ts`, and
  `tests/scripts/landing-static.test.mjs`: Marketing trial CTAs now require
  both database and authentication-email readiness from the Worker
  configuration report before linking to staff signup; generic API health or a
  partially configured runtime retains the safe pricing fallback.
- `.github/workflows/octopus-pr-quality-gates.yml`,
  `.github/workflows/promote-dev-to-staging.yml`, and the promotion contract:
  The trusted Octopus bridge now publishes its runbook outcome on the exact PR
  head SHA, so promotion no longer waits for a `pull_request_target` check that
  GitHub attaches only to the base revision. Promotion also binds checks and
  statuses to the current PR number and readiness-attempt time so a recreated PR at the
  same commit cannot reuse stale approvals.
- `CONTINUITY_BRIEF.md`: Recorded completion of the approved Cloudflare Access
  Service Auth policy and encrypted GitHub Actions credential transfer for the
  Octopus application without storing credential values in the repository.
- `.github/workflows/promote-dev-to-staging.yml` and its contract tests:
  Paginate every exact-head check and status query and revalidate CI, Octopus,
  CodeRabbit, and unresolved review threads before reporting readiness. The
  required aggregate must succeed, while intentionally skipped or neutral
  non-required GitHub job checks remain valid.
- `.github/workflows/octopus-pr-quality-gates.yml`,
  `.github/scripts/octopus-runbook.mjs`, and the PR quality-gates runbook:
  Pass the event head as a required `ExpectedHeadSHA` prompt and reject live PR
  metadata that names another commit before Octopus checks out or reviews code.
  Generate the aggregate and per-commit diffs locally from the immutable
  merge-base/head objects, so the published status cannot claim success for a
  different or mid-review rewritten revision. Per-commit generation uses
  first-parent semantics so merge commits remain visible to the Rule 9
  changelog requirement.
- `public/marketing.js`, `tests/e2e/phase1.spec.ts`, and
  `tests/scripts/landing-static.test.mjs`: Require the application capability,
  including `APP_ORIGIN`, in addition to database and authentication-email
  readiness before marketing trial CTAs expose staff signup.

### Changed

- `docs/build-specs/merge-cleanup-regression-audit-2026-07-28.md`,
  `docs/build-specs/README.md`, and `CONTINUITY_BRIEF.md`: Added an
  authoritative cross-agent handoff identifying each actor, authority,
  strategist-report correction, repair group, evidence boundary, one-PR
  CodeRabbit waiver, active blockers, and recommended release sequence.
- **Governance safety amendment:** `dev → staging` readiness is automated via
  `promote-dev-to-staging.yml`. The workflow opens or updates a promotion PR,
  probes authenticated staging Supabase REST availability twice, waits for
  exact-head/base CI and review gates, and reports readiness without merging.
  Both environment-branch merges remain human-triggered.
- `staging → main` promotion remains exclusively human-initiated.
- `AGENTS.md`, `docs/agent-workflow.md`, and the promotion ADR now describe the
  implemented order, exact gates, token-trigger requirement, and the current
  missing staging-probe credentials instead of claiming they are installed.

**Deployment impact:** The landing page routes trial traffic to signup only
when the same-origin Worker reports every required signup capability configured.
No provider, branch, Pages project, or production environment is mutated by
the UI repair commit. The promotion workflow remains intentionally fail-closed
until an isolated staging Supabase target exists and its URL/anon-key secrets
are installed. **Verification:** Run `npm run check`,
`npx playwright test tests/e2e/phase1.spec.ts tests/e2e/phase5.spec.ts`, and
`git diff --check`; validate the workflow with `actionlint`; run
`npm run test -- --run tests/scripts/promote-dev-to-staging.test.mjs`; then
require fresh PR CI, Octopus, CodeRabbit, and zero unresolved review threads.

## [Unreleased] — 2026-07-28 (Octopus Dev PR Gate)

### Fixed

- `.octopus/runbooks/pr-quality-gates/runbook.ocl`: Resolves immutable PR base
  and head commits from GitHub, authenticates fetches with an ephemeral HTTP
  header, removes the authenticated remote before inspection, and enforces
  change-aware Rules 4–10—including tenant-isolation Rule 8—against GitHub's
  merge-base-aware PR diff. Multiline source windows distinguish safe
  idempotency, tenant filters, and native bearer handling from violations.
  Tenant safety now requires an actual query predicate rather than a nearby
  identifier or comment, and every commit is checked for its own changelog
  update. Concurrent pull-request runs use task-scoped state and
  no longer cancel or overwrite one another. GitHub credentials are supplied
  through stdin or process environment rather than process arguments.
- `.github/workflows/octopus-pr-quality-gates.yml` and `.octopus/runbooks/`:
  Retired the secret-bearing AI-comment and auto-fix failure path. Pull-request
  dependencies and formatter binaries are no longer executed on the
  self-hosted Octopus server, and a PR failure cannot place a GitHub PAT near
  untrusted lifecycle scripts.
- `tests/scripts/octopus-runbook.test.mjs`: Added regression coverage requiring
  the ephemeral authenticated checkout, complete Rule 8 enforcement, and the
  absence of the retired auto-fix dispatch.
- Branch history: Reconciled the existing `staging` ancestry into `dev` before
  promotion so the three-tier branches can advance through reviewable merge
  commits without force-pushes or discarded governance history.
- `.github/scripts/octopus-runbook.mjs` and
  `tests/scripts/octopus-runbook.test.mjs`: Corrected the run-creation field
  to `RunbookSnapshotId` and ensured a failed timeout-cancellation request
  cannot mask the actionable runbook timeout error.
- `.github/scripts/octopus-runbook.mjs`: Added a fail-closed sensitive-control
  check so `GitHubPAT` is never submitted to an Octopus prompt that the
  preview identifies as plain text or leaves untyped.
- `.github/workflows/octopus-pr-quality-gates.yml` and
  `tests/scripts/octopus-runbook.test.mjs`: Moved the secret-bearing Octopus
  jobs to `pull_request_target`, pinned checkout to the trusted default branch,
  disabled persisted credentials, removed unused write permissions, and added
  a regression test that rejects pull-request-head execution.
- `.github/workflows/octopus-pr-quality-gates.yml`: Added an unprivileged
  source-validation job that rejects forks and shell-capable branch names
  before any Octopus, GitHub, or Access secret can enter a job.
- `.github/workflows/octopus-pr-quality-gates.yml`: Made rejected source
  validation produce an explicit failed quality-gate job rather than a skipped
  reviewer state.
- `.github/workflows/octopus-pr-quality-gates.yml`: Added the `edited` PR
  activity so base-branch retargeting always receives a fresh Octopus review.
- `.github/workflows/ci.yml`: Retained post-merge quality validation on `main`
  while explicitly restricting staging migration and Worker deployment jobs
  to `refs/heads/staging`.
- `.github/workflows/ci.yml`,
  `.github/workflows/stripe-test-catalog.yml`, and hosted activation
  documentation: Aligned staging mutations and Stripe test-catalog operations
  with the three-tier promotion model. Staging now runs from the immutable
  `staging` head instead of `main`, while production controls remain
  `main`-bound.
- `docs/runbooks/phase-1-hosted-activation.md`: Reconciled the remaining
  environment-policy and Stripe bootstrap examples with the staging-only
  control boundary.
- `.github/workflows/octopus-pr-quality-gates.yml`: Routed Octopus PR quality
  gates to the `dev`, `staging`, and `main` PR bases and added
  `ready_for_review` activity. The prior `main`-only filter prevented
  agent-authored product PRs from invoking the required reviewer; retaining
  all three bases ensures promotion PRs are reviewed too.
- `.github/workflows/octopus-pr-quality-gates.yml`: Replaced the nonexistent
  `run-runbook-action@v1` reference with a tested REST bridge. The self-hosted
  server predates the v4 Executions API and its legacy CLI is incompatible
  with GitHub's Ubuntu 24 OpenSSL runtime, so the bridge implements the
  documented prompted-runbook flow and bounded task polling without a legacy
  binary.
- `.github/scripts/octopus-runbook.mjs` and
  `tests/scripts/octopus-runbook.test.mjs`: Added the HTTPS-only, fail-closed
  bridge and focused coverage for URL normalization, prompt mapping, required
  prompt enforcement, run creation, and successful task completion.
- `.github/workflows/octopus-pr-quality-gates.yml`: Added encrypted
  `OCTOPUS_CF_ACCESS_CLIENT_ID` and `OCTOPUS_CF_ACCESS_CLIENT_SECRET` inputs
  so the hosted runner can authenticate through the Octopus hostname's
  Cloudflare Access Service Auth policy before using the Octopus API key.
- `.github/pull_request_template.md` and `docs/agent-workflow.md`: Replaced
  stale Greptile and direct-to-`main` instructions with the current
  Octopus/CodeRabbit review loop and `dev` PR routing.
- `docs/decisions/2026-07-28-switch-greptile-to-octopus.md`: Reconciled the
  ADR with current repository governance and recorded the human-authorized,
  one-time bootstrap exception for this workflow correction.

### Deployment impact

- No application, routing, database, provider, Pages, or Worker resource is
  changed by this commit. The published Octopus `PR Quality Gates` snapshot
  must be updated before the GitHub gate is re-triggered. Future PR failures
  remain visible in the Octopus task and GitHub check logs; no self-hosted
  auto-fix or AI-comment runbook is dispatched.

### Verification

- Validate workflow syntax, run the repository docs-only CI lane, confirm
  CodeRabbit and zero unresolved review threads on the bootstrap PR, merge it
  to `dev`, then reopen the pending product PRs and require successful Octopus
  runs before merge.
- Run the focused Octopus bridge tests and confirm the hosted workflow waits
  for the self-hosted runbook result.
- Confirm the published runbook resolves the exact PR commits, removes its
  authenticated remote, passes all ten rules for a clean PR, and fails a
  tenant-unscoped added service query.
- Promote an immutable `dev` head to `staging`, verify the quality workflow
  triggers on the resulting `staging` push, and confirm the read-only readiness
  and Stripe test-catalog workflows reject non-`staging` refs.

## [Unreleased] — 2026-07-28 (UI Testing Work Manifest)

### Added

- `docs/build-specs/ui-test-manifest-2026-07-28.md`: Recorded SA-01 through
  SA-12 test-domain assignments, isolated worktree paths, sequencing,
  single-defect fix-branch conventions, baseline evidence, and activation
  safety boundaries before subagent dispatch.

### Verification

- `npm run check`: 448/448 Vitest tests passed with TypeScript, Worker type,
  Vite build, and Worker dry-run checks successful.
- `npm run qa:e2e`: 145/145 Playwright/axe tests passed.

### Deployment impact

- Documentation only. No runtime, routing, provider, hosted environment, or
  activation-gate state changed.

## [Unreleased] — 2026-07-28 (Release Schedule Tier Visibility)

### Fixed

- `src/client/staff/phase2/ReleasesPage.tsx`: Release schedule cards now name
  every participating club tier alongside their date, status, wine, member,
  and embargo metadata so staff can identify the targeted tier without opening
  each release.

### Tests

- `tests/e2e/phase2.spec.ts`: Added a focused browser regression asserting
  that the Fall 2026 schedule card exposes its Founders Circle tier.

### Deployment impact

- Staff UI only. No API contract, database, provider, routing, hosted
  environment, or activation-gate state changed.

## [Unreleased] — 2026-07-28 (Comprehensive UI Test Report)

### Added

- **What changed:** Added the consolidated UI test report with workstream
  results, defect-to-PR traceability, integrated verification, evidence
  boundaries, open decisions, a pinned-base immutable integration
  reconstruction manifest, explicit missing-Octopus status, and the untouched
  activation-gate statement; synchronized `CONTINUITY_BRIEF.md` with the
  mission results.
  **Why:** The mission requires a durable handoff that distinguishes browser,
  automated, fixture, static-fallback, and hosted-CI evidence. **Deployment
  impact:** Documentation only; application code, routing, headers, providers,
  hosted data, and activation gates are unchanged. **Verification:** Review
  `docs/build-specs/ui-test-report-2026-07-28.md`, confirm each linked PR
  targets `dev`, run `git diff --check`, and validate the docs-only CI lane.

## [Unreleased] — 2026-07-28 (UI Testing Spec Formatting Fix)

### Fixed

- `docs/build-specs/vinifera-ui-testing-doc.md`: Stripped trailing whitespace from 5 lines (lines 2, 3, 4, 786, 788) to satisfy CI docs-lane `git diff --check` policy. No content change.

## [Unreleased] — 2026-07-28 (Three-Tier Environment)

### Added

- Three-tier deployment architecture: `vinifera-dev` (dev branch), `vinifera-staging` (staging branch), `vinifera-live` (main branch).
- `staging` branch created from `dev` at `f530c46deb1a`.
- `vinifera-staging` Cloudflare Pages project provisioned at `vinifera-staging.edstratumlabs.ai` with CNAME + Cloudflare-proxied SSL.
- Supabase staging project blocked by free plan 2-project limit — staging Pages project provisioned but temporarily shares dev Supabase project (`cfrqrllmyquggqjkzifs`) until Pro plan upgrade.

### Changed

- `AGENTS.md`: Added three-tier environment model with mandatory PR routing rules (`dev` only for all agents). Updated deployment topology table (4 Cloudflare Pages projects). Updated agent coordination model with Prime Directive-level PR routing constraint.
- `docs/build-specs/CODEX-DISPATCH-GUIDE.md`: All 6 session PR targets updated from `main` → `dev`. All Greptile references replaced with Octopus. Added three-tier environment model header with explicit routing rule. Merge order updated to reference `dev` checks.

### Architecture

- Promotion pipeline: `feature/* → PR to dev → human promotes dev→staging → human approves staging→main`
- Agents never open PRs against `staging` or `main` — enforced in AGENTS.md Section 7 and Section 9.
- Supabase staging DB: upgrade to Pro plan at supabase.com/dashboard to provision a third isolated project.

## [Unreleased] — 2026-07-28

### Added

- `dev` branch created from `main` at `d5b0e02d` as the primary integration branch for active development.
- Two Cloudflare Pages projects provisioned: `vinifera-dev` (branch: `dev`) and `vinifera-live` (branch: `main`).
- Custom domains configured: `vinifera-dev.edstratumlabs.ai` and `vinifera-live.edstratumlabs.ai` with Cloudflare-proxied DNS CNAMEs.
- SSL certificates initializing automatically via Cloudflare Universal SSL.
- All 22 database migrations applied to both Supabase projects (`cfrqrllmyquggqjkzifs` dev, `lefbjbulzmtgidjbemzb` prod). 97 tables, RLS enabled, all required extensions loaded.
- `.env.example` updated with dedicated section documenting `vinifera-dev` and `vinifera-live` Cloudflare Pages environment variables and build configuration.

### Infrastructure

- Build command for both Pages projects: `npm run build:pages` (`CF_PAGES=1 npm run build`)
- Output directory: `dist/`
- `scripts/build.mjs` confirmed to copy `/app` static prototype into `dist/` when `CF_PAGES=1`, preserving demo site at root domain.
- Supabase Dev project: `Vinifera Dev` (`cfrqrllmyquggqjkzifs`, us-east-1, ACTIVE_HEALTHY)
- Supabase Prod project: `Project Vinifera` (`lefbjbulzmtgidjbemzb`, ACTIVE_HEALTHY)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

- **What changed:** Made the restored dark outer keyboard-focus ring override
  component-specific button shadows, with a source regression protecting that
  cascade behavior. **Why:** Otherwise the white inner outline could remain
  while the contrasting dark ring was overridden on primary navigation and
  pricing buttons, making focus unreliable on white surfaces. **Deployment
  impact:** Static focus styling and its regression test only. **Verification:**
  Run the focused focus-indicator test, `npm run check`, and keyboard-tab
  through the landing-page primary controls.
- **What changed:** Restored the marketing landing page's three-pixel
  `:focus-visible` indicator and desktop navigation's 44px minimum target
  heights after the canonical-pricing integration replaced `index.html` with
  an older version. **Why:** Keyboard users otherwise received no visible
  focus ring, while desktop navigation links and buttons could render below
  the repository's WCAG target-size requirement. **Deployment impact:** Static
  landing-page CSS only; pricing content, navigation destinations, routing,
  authentication, billing, and provider activation are unchanged.
  **Verification:** Run the focused focus-indicator and landing-static tests,
  `npm run check`, `npm run qa:e2e`, axe-core, and inspect keyboard focus and
  target dimensions at 1440px and 375px.

- Hardened Octopus Rule 8 to check operation-only query builders supplied by callers and to compare legacy query fingerprints against the pull request's actual merge base rather than the moving base-branch tip.

### Fixed

- **What changed:** Octopus Rule 8 now models assigned descendants of a shared
  `.from(...)` table builder as independent leaf chains. A regression combines
  a scoped select and unscoped delete from the same root and verifies the delete
  fails. **Why:** Merging forked descendants let one branch's tenant predicate
  satisfy a different unscoped operation. **Deployment impact:** PR security
  analysis only; application runtime and environment activation are unchanged.
  **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, `npm run check`,
  `npm run build:worker`, and `git diff --check`.
- **What changed:** Octopus Rule 8 now refuses to grandfather unscoped queries
  whose receiver is a call, computed property, parenthesized expression, or
  other form that cannot be normalized into a stable member identity. A
  call-receiver privilege-change regression covers the fail-closed behavior.
  **Why:** Collapsing unknown receivers to `.from(...)` could make distinct
  tenant and admin clients share a legacy fingerprint. **Deployment impact:** PR
  security analysis only; application runtime and environment activation are
  unchanged. **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, `npm run check`,
  `npm run build:worker`, and `git diff --check`.
- **What changed:** Octopus Rule 8 now accepts tracked predicates only from
  unconditional same-scope assignments or returns and preserves complete member
  receiver chains such as `ctx.admin` in query fingerprints. Regressions cover
  conditional predicates and receiver changes between member expressions.
  **Why:** A false branch could leave a query unscoped, while truncating both
  receivers to `admin` could grandfather a privilege-boundary change.
  **Deployment impact:** PR security analysis only; application runtime and
  environment activation are unchanged. **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, `npm run check`,
  `npm run build:worker`, and `git diff --check`.
- **What changed:** Octopus Rule 8 query fingerprints now include the database
  receiver, and builder dataflow stops at the enclosing block. Statement
  splitting ignores semicolons inside parentheses, while base-source lookup is
  timeout-bounded and emits a fail-closed diagnostic. Regressions cover
  RLS-to-admin receiver changes and same-named builders in adjacent functions.
  **Why:** Receiver-free fingerprints could grandfather a move to privileged
  access, and brace-depth equality alone could borrow a predicate from another
  function. **Deployment impact:** PR security analysis only; application
  runtime and environment activation are unchanged. **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, `npm run check`, and
  `git diff --check`.
- **What changed:** Octopus Rule 8 now consumes grandfathered unscoped query
  fingerprints one-to-one and follows builder variables when `.from(...)`, the
  database operation, and its tenant predicate are split across same-scope
  assignments. Documentation and regressions cover duplicate legacy
  fingerprints and pre-operation builder splits. **Why:** Set membership could
  grandfather unlimited new duplicates, while discarding an operation-free
  `.from(...)` statement could miss a later unscoped `.select()`. **Deployment
  impact:** PR security analysis only; application runtime and environment
  activation are unchanged. **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, `npm run check`, and
  `git diff --check`.
- **What changed:** Octopus Rule 8 now models complete queries in the trusted
  base and current head, including multiline predicates and later
  query-variable assignments. New or newly unscoped surviving queries fail;
  unchanged legacy unscoped operations remain grandfathered, and fully deleted
  queries are ignored. Known JavaScript utility constructors such as
  `Array.from()` are excluded as query boundaries without restricting dynamic
  Supabase table arguments. Documentation and regressions cover every reviewed
  case. **Why:** Source-line proximity could miss distant or multiline predicate
  deletion, reject valid later assignments, or block removal of an entire safe
  query. **Deployment impact:** PR security analysis only; application runtime
  and environment activation are unchanged. **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, `npm run check`, and
  `git diff --check`.
- **What changed:** The Octopus Rule 8 deletion regression now models a pure
  predicate-line deletion from a valid automatic-semicolon-insertion query
  chain, with no compensating added line. **Why:** The fixture must prove the
  deletion anchor itself triggers re-evaluation. **Deployment impact:** Test
  evidence only; the gate implementation and application runtime are unchanged.
  **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`.
- **What changed:** Octopus Rule 8 now re-evaluates tenant query chains touched
  by additions or deletions and binds each `brand_id`/`organization_id`
  predicate to its individual database chain. The Rule 8 documentation now
  states those change-aware and per-chain semantics, and regression fixtures
  cover deleted tenant predicates and adjacent scoped/unscoped queries.
  **Why:** A deleted predicate was invisible to the added-line scanner, and a
  nearby scoped query could incorrectly satisfy a separate unscoped operation.
  **Deployment impact:** PR security analysis only; application runtime,
  routing, providers, and environment activation are unchanged. **Verification:** Run
  `npx vitest run tests/scripts/octopus-runbook.test.mjs`, the embedded Bash
  syntax test, `npm run typecheck`, `npm run build`, and `git diff --check`.

### Changed

- Replaced Greptile with Octopus as the AI code review tool (self-hosted). Greptile removed
  as a required GitHub branch protection check. Branch protection now requires only
  `Type, test, build, and package` and `Block direct push to main`.
- Migrated `.greptile/` config directory to `.octopus/`. Architectural boundary rules
  (`rules.md`) are preserved; `config.json` updated to add `excludeAuthors` for bot
  accounts; `files.json` unchanged.
- Updated `AGENTS.md` Section 8 to reference Octopus instead of Greptile and updated
  directory tree, ownership table, and tool registry accordingly.

### Added

- ADR `docs/decisions/2026-07-28-switch-greptile-to-octopus.md` documenting the
  transition rationale, self-hosting approach, and rollback path.

### Removed

- **Greptile GitHub App and `.greptile/` configuration directory.** Greptile has
  been replaced by Octopus Deploy for deployment automation and code quality gate
  enforcement. The 10 architectural rules from `.greptile/rules.md` have been
  preserved verbatim in the Octopus `Vinifera` project `PR Quality Gates` runbook.
  CodeRabbit remains active and unaffected for PR review.

### Added

- **What changed:** Rewrote `AGENTS.md` to correct stale workflow names
  (`hosted-readiness.yml`, `production-worker-release.yml`,
  `stripe-test-catalog.yml`, `stripe-live-billing-cutover.yml`,
  `credential-envelope-rotation.yml`, `mobile-release.yml`,
  `direct-push-guard.yml`, `ci.yml`), updated verified test counts to
  448 Vitest / 250 / 199 / 158 / 513 DB / 145 Playwright-axe, added explicit
  `dev:frontend` documentation, corrected Sentry description to
  "integrated, secret-gated," and added Section 9 (Agent Collaboration
  Architecture) and Section 10 (Contact and Authorization). Introduced ADR
  `docs/decisions/2026-07-28-agents-md-governance-update.md` recording the
  ownership policy update from "Human owner only" to "Any agent via PR —
  human owner must review and merge." Updated `CODEX-PROMPT.md` to v0.5.0,
  corrected gate order (Auth = Gate 3, Stripe reconciliation = Gate 4 per
  `CONTINUITY_BRIEF.md`), and fixed the pre-activation audit prompt to
  clarify that the audit produces a report document and does not modify
  application source. Updated `README.md` Production Build badge to v0.5.0
  and Phase 2 quality row to 250 database assertions. **Why:** Eleven
  unresolved review threads from Greptile (P1: wrong workflow names, missing
  CHANGELOG, gate order, test counts) and CodeRabbit (Major: version
  inconsistency, assertion count, prompt contradiction; Minor: Sentry wording,
  dev command clarity) blocked merge of PR #21 under the zero-unresolved-thread
  requirement. **Deployment impact:** Documentation and governance only;
  application code, build output, routes, provider activation, hosted data, and
  all 20 activation gates are unchanged. **Verification:** Review corrected
  workflow names against `.github/workflows/` directory, verify gate order
  against `CONTINUITY_BRIEF.md` activation gates 3 and 4, run
  `npm run check` to confirm 448 Vitest and 145 Playwright/axe counts,
  inspect ADR and updated ownership table in `AGENTS.md`.

### Added

- **What changed:** Established mandatory end-to-end PR ownership for agents,
  a label-scoped 15-minute Codex safety monitor, explicit human-escalation and
  merge-authority rules, required review-thread disposition, and GitHub
  enforcement for current branches, required checks, direct-push prevention,
  and zero unresolved conversations. Canonical workflow references replace
  duplicated completion instructions in Codex dispatch prompts. **Why:** PR
  creation alone left review comments, CI failures, and post-merge state
  vulnerable to abandonment or inconsistent handling. **Deployment impact:**
  Repository governance and external GitHub/Codex automation only; application
  code, build output, routes, providers, hosted data, and activation gates are
  unchanged. **Verification:** Inspect the five governance labels, branch
  protection, automation definition, prompt references, PR template, review
  threads, required checks, and post-merge `main` run; run `git diff --check`.
- **What changed:** Added the CodeRabbit pull-request review badge to the
  README's repository status badges and linked it to this repository's
  CodeRabbit-reviewed pull requests. **Why:** Make the repository's automated
  pull-request review coverage visible and directly discoverable to visitors
  and contributors.
  **Deployment impact:** Documentation only; application code, build output,
  routes, provider activation, and the live Pages baseline are unchanged.
  **Verification:** Render the README badge URL, confirm the badge targets
  `theonlygeranium/vinifera`, run `npm run check`, `npm run qa:e2e`, and
  `git diff --check`.

### Fixed

- **What changed:** Routed all six marketing free-trial calls to action to the
  staff workspace signup page and added an exact six-link end-to-end inventory
  check for every link.
  **Why:** The visible trial buttons previously jumped to pricing or used empty
  placeholder links, preventing prospective winery teams from starting
  signup. **Deployment impact:** Marketing navigation only; authentication,
  billing, application data, provider activation, routing rules, and headers
  are unchanged. **Verification:** Run the focused Phase 1 CTA test,
  `npm run check`, `npm run qa:e2e`, and confirm the links at desktop and
  375px widths open `/app/signup`.

- **What changed:** Made the horizontally scrollable CSV import preview
  keyboard-focusable, gave it an accessible label, and added focus plus
  axe-core regression coverage after preview generation. **Why:** Keyboard
  users could not reach or scroll wide valid and invalid CSV previews, and
  axe-core reported `scrollable-region-focusable` at desktop and 375px.
  **Deployment impact:** Staff import presentation only; CSV parsing, mapping,
  validation, commit behavior, APIs, provider activation, routing, and headers
  are unchanged. **Verification:** Run the focused Commerce7 import test,
  `npm run check`, `npm run qa:e2e`, and verify the preview at 1440px and 375px
  in the Jeff - Pro Chrome profile.

- **What changed:** Increased every visible desktop marketing-header link and
  button to at least a 44px target height and added a source regression that
  preserves the target CSS for links and buttons. **Why:** The
  navigation links measured 34–42px tall in the Jeff - Pro Chrome profile,
  below the repository's required 44×44px interaction target. **Deployment
  impact:** Static marketing header spacing only; navigation destinations,
  authentication, application data, provider activation, routing, and headers
  are unchanged. **Verification:** Run the focused Phase 1 desktop-header
  target test, `npm run check`, `npm run qa:e2e`, and inspect the header at
  1440px and 375px in Jeff - Pro Chrome.

- **What changed:** Added the trained model's AUC-ROC score to the churn
  intelligence metric grid and extended the Phase 4 browser regression to
  require its label and formatted value. **Why:** The API already supplied
  `aucRoc`, but the staff UI exposed only accuracy, leaving model-ranking
  quality invisible. **Deployment impact:** Churn intelligence presentation
  only; scoring, training, A/B validation, alerts, APIs, provider activation,
  routing, and headers are unchanged. **Verification:** Run the focused Phase
  4 churn-intelligence test, `npm run check`, `npm run qa:e2e`, and inspect the
  metric at 1440px and 375px in Jeff - Pro Chrome.

- **What changed:** Restricted brand creation and editing controls to Owner and
  Admin sessions while preserving read access and brand switching for Manager
  and Staff roles, with a Phase 5 manager regression. **Why:** Managers could
  discover and open `Add brand`, `Create brand`, and `Edit` mutation controls
  even though brand administration is owner/admin-only. **Deployment impact:**
  Staff brand-management presentation only; server authorization, brand data,
  billing, providers, routing, and headers are unchanged. **Verification:** Run
  the focused manager role-gating test, `npm run check`, `npm run qa:e2e`, and
  inspect Owner and Manager sessions at 1440px and 375px in Jeff - Pro Chrome.

- **What changed:** Applied a validated custom member-portal title to the
  browser document while the branded member surface is mounted, restored the
  prior title on provider cleanup without recapturing the custom title during
  branding refreshes, and added a verified-host browser regression that also
  checks the title after SPA navigation back to staff login.
  **Why:** Custom branding appeared in the wordmark but left the browser and
  assistive document context generically titled `Vinifera Club Management`.
  **Deployment impact:** Member-portal document metadata only; staff titles,
  branding validation, member data, APIs, provider activation, routing, and
  headers are unchanged. **Verification:** Run the focused verified-host
  branding test, `npm run check`, `npm run qa:e2e`, and inspect the custom
  title at 1440px and 375px in Jeff - Pro Chrome.

- **What changed:** Added each managed brand's portal-domain status to its
  portfolio card and extended the Phase 5 brand workflow regression for
  pending-validation and unconfigured states. **Why:** Non-default brand cards
  exposed name and member count but no status, leaving staff unable to
  distinguish activation readiness. **Deployment impact:** Staff brand-card
  presentation only; brand domains, SSL, billing, APIs, provider activation,
  routing, and headers are unchanged. **Verification:** Run the focused
  all-brand workflow test, `npm run check`, `npm run qa:e2e`, and inspect both
  status states at 1440px and 375px in Jeff - Pro Chrome.

- **What changed:** Made `FormFeedback` return no DOM node for null or empty
  messages while preserving alert/status semantics for real feedback, with
  focused component coverage. The existing live-region spacing is now reserved
  by its wrapper rather than by the feedback child, preserving the stable page
  geometry while the child is absent. **Why:** Empty feedback created a blank
  assertive live region that could announce meaningless updates to assistive
  technology, while removing its layout footprint pushed the loyalty tablet
  surface above the CLS budget. Dashboard and Team success feedback retain
  persistent outer polite live regions so text inserted later is announced.
  **Deployment impact:** Shared form-feedback presentation only; submissions,
  APIs, provider activation, routing, and headers are unchanged.
  **Verification:** Run the focused FormFeedback tests, the repeated
  loyalty/tablet Playwright performance case, `npm run check`,
  `npm run qa:e2e`, and inspect empty/error/success states in Jeff - Pro Chrome.

- **What changed:** Exposed the visible `LoadingScreen` label as a polite
  `role="status"` and moved the busy state to its sibling progress mark so the
  busy subtree cannot defer the announcement, with focused component coverage.
  **Why:** The loading label was visible but lacked a
  status semantic, so assistive technology could miss the initial application
  state. **Deployment impact:** Shared loading-screen semantics only; session
  checks, APIs, provider activation, routing, and headers are unchanged.
  **Verification:** Run the focused LoadingScreen test, `npm run check`,
  `npm run qa:e2e`, and inspect staff/member loading states in Jeff - Pro
  Chrome.

- **What changed:** Added the exact staff-workspace skip link, a focusable
  `main` target, visible-on-focus styling above the mobile update banner, an
  explicit card-surface background, and a mobile keyboard regression.
  **Why:** Every authenticated staff route omitted the accessibility sweep's
  required `Skip to main content` bypass control. **Deployment impact:** Staff
  shell markup and styling only; navigation, APIs, hosted data, providers,
  routes, and activation gates are unchanged. **Verification:** Run
  `npm run check`, `npm run qa:e2e`, and confirm the skip link can be focused
  and activated at 375px and 1440px.

- **What changed:** Added a three-pixel, high-visibility keyboard focus ring
  for every interactive marketing control and for focusable application
  regions such as dashboard notices, analytics data regions, and the member
  ledger; only application regions receive a forced outer contrast ring so
  later component shadows cannot hide focus without replacing standard-control
  shadows; added source-contract tests for both surfaces. **Why:** The
  accessibility sweep found absent landing focus indicators and one-pixel
  browser-default outlines on focusable application regions. **Deployment
  impact:** CSS focus presentation only; APIs, navigation, hosted data,
  providers, routes, and activation gates are unchanged. **Verification:** Run
  `npm run check`, `npm run qa:e2e`, and measure focused controls at 375px and
  1440px.

- **What changed:** Increased the mobile staff brand-context select text to
  16px and added a 375px computed-style regression. **Why:** The responsive
  sweep found 11px select text on every authenticated staff route, which can
  trigger automatic zoom in iOS form controls and violates the mobile input
  criterion. **Deployment impact:** Mobile staff-header typography only;
  brand selection behavior, APIs, hosted data, providers, routes, and
  activation gates are unchanged. **Verification:** Run `npm run check`,
  `npm run qa:e2e`, and measure the select at 375px, 412px, and 430px.
- **What changed:** Daily portal-login recording now stores the real occurrence
  timestamp. A same-member, same-day retry accepts only the database's exact
  activity-idempotency conflict, verifies the existing organization-, brand-,
  member-, source-, and metadata-scoped event, and reuses its original
  timestamp for the analytics replay. **Why:** Midnight UTC normalization
  shifted brand-local daily analytics and backdated portal-login recency used
  by churn calculations. **Deployment impact:** Portal activity and analytics
  timestamps remain truthful while daily retries stay idempotent; no schema,
  hosted provider, secret, Pages, DNS, or production-data mutation occurs.
  **Verification:** Run the portal-login identity/replay tests, focused BS-05
  suite, full repository checks, and `git diff --check`.

### Security

- **What changed:** Final review follow-up pins both the integrated local build
  and Vite server to browser mode and the loopback Worker API origin,
  preserves explicit browser/mobile API-origin policy errors through request
  and download helpers, and makes hosted callback/return origin resolution
  require a valid configured `APP_ORIGIN`; request-header fallback requires
  explicit `development` or `test`, is normalized before use, and missing or
  unknown environment modes fail closed. Configured and request-derived HTTP
  origins are accepted only for loopback development/test; hosted and
  non-loopback origins require HTTPS. **Why:** CodeRabbit, hosted Codex, and
  independent review identified ambient-build, mobile-mode, error-reporting,
  hosted HTTP, and fallback paths that could produce a misrouted bundle,
  conceal unsafe configuration, or trust request-derived callback origins.
  **Deployment impact:** Local builds deterministically call port 8788 in
  browser mode and staging/production fail closed without canonical
  `APP_ORIGIN`; no hosted migration, provider, secret, Pages, DNS, or data
  mutation is performed. **Verification:** Run the browser and foundation
  origin regressions, launcher tests, native stack smoke, full repository
  checks, production Worker dry run, and `git diff --check`.
- **What changed:** Review follow-up now binds local staff Auth callback and
  billing return URLs to canonical `APP_ORIGIN` instead of a cross-origin Vite
  request header, asserts the seeded brand on the primary cookie-based member
  session, and scopes final seed shipment transitions by organization as well
  as deterministic ID. **Why:** Hosted Codex and Greptile reviews identified
  callback routing and tenant-proof gaps that could hide a broken hot-reload
  Auth flow or weaken fixture isolation checks. **Deployment impact:** Local
  callbacks now route through the Worker on port 8788; production keeps its
  configured canonical origin. No hosted migration, provider, secret, Pages,
  DNS, or production-data change is performed. **Verification:** Run the
  application-origin regressions, local seed replay, native authenticated
  smoke, full TypeScript/Vitest/build checks, and `git diff --check`.
- **What changed:** Review follow-up made the staging guard-order test require
  both workflow markers before comparing them, centralized the configuration
  test on the isolated security fixture, and added a recursive source-policy
  test that confines direct binding access to the Worker type and neutral
  security-secret owner. Templates and deployment guidance now state the
  whitespace rule consistently, the staging health capability uses its exact
  `billing` name, and the ADR describes behavior-level fallback proof instead
  of a narrow regex. **Why:** Hosted and independent reviews identified places
  where a missing marker, duplicated fixture, or imprecise wording could weaken
  future regression detection or operator understanding. **Deployment impact:**
  No runtime, route, schema, provider, Pages, or secret-value change; the
  existing fail-closed deployment contract is documented and tested more
  precisely. **Verification:** Run the focused security/configuration/activation
  suites, `npm run check`, `npm run qa:production-release`,
  `npm run build:worker:production`, `npm audit --audit-level=moderate`, and
  `git diff --check`.
- **What changed:** Rate-limit IP hashing and member-brand context signing now
  require separate `RATE_LIMIT_PEPPER` and `MEMBER_BRAND_CONTEXT_SECRET`
  bindings. A neutral runtime validator rejects missing, whitespace-padded,
  shorter-than-32-byte, or equal values; the configuration health report
  exposes a sanitized `security` capability; staging and production release
  guards enforce the same contract; templates, setup/runbook guidance, and
  explicit test fixtures document the deployment boundary. **Why:** Reusing a
  Supabase credential, a static fallback, or one application secret for both
  cryptographic purposes created avoidable coupling and could conceal an
  incomplete deployment. **Deployment impact:** Staging and production Worker
  deployments must provide independently generated values for both bindings.
  Existing deployments that relied on fallback behavior now fail closed with
  a sanitized configuration error until the dedicated secrets are installed;
  Pages, routes, database schema, and provider endpoints are unchanged.
  **Verification:** Run `npm run check`, the focused runtime and release-guard
  suites, `npm run qa:production-release`, `npm audit --audit-level=moderate`,
  and the fallback/secret scans documented in the security-secret separation
  ADR.

### Refactored

- **What changed:** Exact-head review cleanup moved the shared bounded
  concurrency helper, integration UUID/Klaviyo patterns, and Supabase admin
  client into `server/lib/concurrency.ts`,
  `server/lib/integration-constants.ts`, and
  `server/lib/supabase-admin.ts`. The extracted analytics, communications,
  integration-runtime, member, order, foundation, retention, Stripe, and
  webhook services now reuse those neutral owners without introducing a
  service cycle; the Stripe compatibility export remains available. Three
  caller-free release helpers were removed, and webhook serialization helpers
  were renamed to make their redaction behavior explicit. **Why:** CodeRabbit
  identified duplicate primitives, ambiguous redaction names, and dead
  post-extraction code that could drift independently. **Deployment impact:**
  Internal service organization only; no route, database migration, provider
  activation, secret, Pages, or hosted state changes. **Verification:**
  TypeScript, 386/386 Vitest tests, Vite and Worker builds, `git diff --check`,
  18-service/37-edge graph audit with zero cycles, and zero route imports from
  the compatibility integration barrel.
- **What changed:** Integrated the verified review-hardening `main` baseline
  into BS-03 and transplanted its release-wine identity/replay update from the
  retired service monolith into `server/services/orders.ts`, while keeping
  `core-club.ts` re-export-only. **Why:** BS-03 must preserve the review fixes
  without reversing the behavior-preserving service decomposition.
  **Deployment impact:** The pending forward release-identity migration and
  hardened route/guard behavior are preserved; no provider, hosted database,
  Worker, Pages, secret, or activation mutation is performed by this
  integration. **Verification:** Direct-push policy, dependency audit,
  generated Worker bindings, TypeScript, Vitest, all embedded database phases,
  Pages and Worker builds/dry runs, Playwright/axe, and structural service
  audits are rerun on the integrated head before publication.
- Decomposed `core-club.ts` into domain-scoped member, club, order, Stripe,
  and EasyPost services while preserving its prior public API through re-exports.
- Decomposed `integrations.ts` into communications and webhook services, with
  an unchanged shared provider-runtime extraction that prevents circular
  imports between those domains.
- Added the complete `server/services/index.ts` barrel and moved internal
  service consumers and BS-02 system route to their direct domain imports.
- Remapped architecture, tenancy-audit, setup, and automated-review guidance
  from the historical service monoliths to the extracted domain owners while
  preserving the original audit revision as provenance.
- Extracted all 129 Express route registrations from `server/app.ts` into
  domain-scoped modules under `server/routes/`, preserving the original route
  paths, middleware order, schemas, service calls, and response behavior.
- Reduced `server/app.ts` to the 82-line global middleware and route-mounting
  entry point, with `server/routes/index.ts` owning the ordered public,
  protected, fallback, and error-handler mounts.
- Integrated the BS-02 route mounts with BS-04 observability and rate
  limiting: all rate-limit middleware runs before public/raw-webhook and
  protected handlers, while the shared BS-04 error handler remains last after
  the `/api` 404 boundary.

### Fixed

- **What changed:** `server/lib/concurrency.ts` now rejects non-positive,
  fractional, and non-finite concurrency limits and passes `undefined` array
  elements to the operation instead of treating them as worker exhaustion.
  `tests/unit/concurrency.test.ts` proves validation, complete processing, and
  result ordering. `server/services/index.ts` now explicitly resolves the two
  member symbols also re-exported by Stripe to their canonical member binding,
  with a runtime identity assertion in the Phase 5 service suite. The service
  ADR now defines its dependency arrows against the implemented import graph
  and includes explicit deployment and verification sections. **Why:** Fresh
  exact-head reviews found that invalid limits could silently skip a batch,
  `undefined` data could truncate one worker, the original ADR arrow direction
  was ambiguous, and relying on star-export resolution made two public barrel
  symbols unnecessarily subtle. Explicit exports remove that ambiguity.
  **Deployment impact:** Worker batch helpers now fail fast on programmer
  configuration errors, while the public service barrel retains its intended
  names deterministically; routes, database migrations, provider activation,
  secrets, Pages, and hosted state are unchanged.
  **Verification:** Concurrency unit tests 2/2, TypeScript, full Vitest
  388/388, public-barrel binding identity, `git diff --check`, and fresh
  exact-head review.
- **What changed:** Exact-head review hardening now defers mobile push only for
  `activation_required` and surfaces APNs configuration mismatches; requires
  EasyPost recovery to find the exact persisted rate; rejects invalid
  QuickBooks refresh-lease generations; passes the authenticated Supabase user
  ID to the member-address command; and records a structured error when an
  integration-health downgrade fails without blocking job completion. Focused
  regressions were added to `tests/server/core-club.test.ts`,
  `tests/server/phase4-services.test.ts`, and
  `tests/server/phase5-integrations.test.ts`. **Why:** CodeRabbit found five
  fail-open, reconciliation, identity, or observability defects in the
  extracted owners. **Deployment impact:** Worker error handling and
  fail-closed provider behavior change for misconfiguration and invalid
  recovery state; no migration, secret value, provider activation, Pages
  route, or hosted mutation is required. **Verification:** Focused service
  tests 114/114, full Vitest 386/386, TypeScript, Vite build, Worker dry run,
  and fresh exact-head automated reviews.
- Updated the preserved BS-02 route manifest to include BS-04's path-specific
  rate-limit layer in registration order, and added an explicit BS-03 change
  record to the compatibility-barrel Greptile guidance.
- **What changed:** Direct-router retention coverage now proves malformed-token
  POST responses retain `no-store` and `no-referrer` before the service is
  invoked, and the agent workflow records the reason, operational impact, and
  focused verification for bounded GitHub evidence requests. **Why:** Final
  exact-head CodeRabbit review identified an unproved unsubscribe error path
  and incomplete local workflow rationale. **Deployment impact:** Test and
  workflow documentation only; the already-implemented POST headers, guard,
  application, database, Pages, providers, secrets, and activation state are
  unchanged. **Verification:** Retention HTTP contracts 31/31, direct-push
  policy 12/12, TypeScript, `git diff --check`, and fresh exact-head review.
- **What changed:** The release command RPC now scopes allowed payload fields by
  operation: only create accepts `initial_status`, update accepts aggregate
  fields without create-only state, and schedule requires an empty payload.
  pgTAP proves rejected surplus fields leave no command result. **Why:** Hosted
  CodeRabbit found that the shared allowlist could silently ignore fields on
  update or schedule. **Deployment impact:** The stricter contract ships in the
  pending release-identity migration; no new migration, Pages, provider,
  secret, or activation change is introduced. **Verification:** Phase 2 and
  Phase 5 current-stack pgTAP, `git diff --check`, and fresh exact-head reviews.
- **What changed:** Both the GET confirmation and POST mutation responses for
  token-bearing unsubscribe URLs now set route-owned `Cache-Control: no-store`
  and `Referrer-Policy: no-referrer` headers before token handling; direct-router
  tests cover the POST response without relying on global middleware. The
  Phase 2 ADR now states the required forward-migration deployment impact, and
  setup guidance distinguishes ignored local environment files from the
  tracked `.env.example` exception. **Why:** Hosted Greptile and unresolved
  CodeRabbit threads identified the POST privacy gap and two documentation
  ambiguities. **Deployment impact:** Worker response headers change on the
  unsubscribe POST; the existing pending release-identity migration remains
  required, with no additional migration, Pages, provider, secret, or
  activation change. **Verification:** Focused retention HTTP contracts,
  TypeScript, `git diff --check`, and fresh exact-head reviews.
- **What changed:** The forward release-identity command migration now rejects
  JSON `null` required scalars, tier prices, wine quantities, and wine prices
  before mutation, with pgTAP proving that rejected commands leave no replay
  record. **Why:** Authenticated CodeRabbit review found that a direct
  service-role caller could otherwise bypass SQL three-valued comparisons and
  surface a low-level not-null constraint error. **Deployment impact:** The
  validation ships within pending migration
  `202607260022_release_wine_identity_replay.sql`; no additional migration,
  Pages, provider, secret, or activation change is introduced.
  **Verification:** Phase 2 and Phase 5 current-stack pgTAP, `git diff --check`,
  and a fresh authenticated CodeRabbit review on the committed head.
- **What changed:** Draft release updates now carry each validated existing
  release-wine UUID into the transactional command, and a forward-only database
  migration preserves those UUIDs while rebuilding the aggregate. The command
  rejects IDs during create, duplicate IDs, and IDs outside the exact
  organization/brand/release boundary; new explicitly priced wines still
  receive database-generated IDs. **Why:** An exact idempotent retry after a
  lost PATCH response could previously carry the pre-update wine ID, fail
  service reconciliation after the first rebuild replaced that ID, and never
  reach the database command ledger's stored replay. **Deployment impact:** The
  Worker RPC payload adds optional `wine_id`, and Supabase must apply migration
  `202607260022_release_wine_identity_replay.sql`; Pages, providers, secrets,
  and activation state are unchanged. **Verification:** Stateful service retry
  tests, Phase 2 command-ledger pgTAP identity/tenant/mismatch assertions,
  TypeScript, 382/382 Vitest tests, database gates
  92/250/199/158/513, all Pages and Worker dry-run builds, and 145/145
  Playwright/axe checks. Authenticated CodeRabbit review is rerun on the
  committed head before merge.
- **What changed:** Review follow-up keeps both the GitHub response and its JSON
  body parsing inside the direct-push guard's per-request timeout, aligns the
  guard ADR with the ten-page implementation limit, and proves an invalid
  unsubscribe token cannot invoke the mutation service. **Why:** A response
  body can stall after headers arrive, and the security regression should
  explicitly cover the non-mutation boundary. Timeout tests also assert that
  every request receives the configured 25 ms deterministic test deadline.
  **Deployment impact:** Guard availability and test/documentation evidence
  only; application routes, database state, Pages, providers, and activation
  remain unchanged. **Verification:** direct-push policy tests (12/12),
  focused retention tests, TypeScript, and authenticated CodeRabbit review.
- **What changed:** Local setup now begins from `.dev.vars.example`, gives an
  exact selective merge sequence from the comprehensive `.env.example`
  inventory, keeps the tracked Sentry placeholder blank, and requires separate
  environment-scoped Sentry secret commands for staging and production.
  **Why:** The previous copy command contradicted the minimal Worker template
  and the unscoped secret command could target the wrong Worker environment.
  **Deployment impact:** Documentation and tracked local template only; no
  secret is created, no hosted environment is mutated, and runtime behavior is
  unchanged until an operator follows the activation steps. **Verification:**
  setup/template review, `git diff --check`, and the full
  credential-independent repository gate recorded in the continuity brief.
- **What changed:** The direct-push guard now gives every GitHub
  associated-pull-request request a five-second `AbortController` deadline,
  treats request timeouts as bounded evidence attempts with the existing
  ten-second backoff, and fails closed after three timeouts. Two deterministic
  policy tests cover timeout recovery and exhaustion, and checkout no longer
  persists its GitHub credential. **Why:** An indefinitely pending GitHub
  request could consume the entire workflow without a policy result, while
  persisted checkout credentials exceeded this read-only job's needs.
  **Deployment impact:** GitHub Actions enforcement only; application,
  database, Worker, Pages, and provider behavior are unchanged.
  **Verification:** `node --test
.github/scripts/direct-push-guard.policy.mjs` (11 tests) and
  `git diff --check`.
- **What changed:** Release PATCH requests now reject empty bodies, direct
  status changes, ambiguous tier aliases, and unpaired tier IDs/prices; omit
  absent nested fields; and reconcile an omitted existing-wine price only by
  its stable wine ID before rebuilding the release aggregate. New or unknown
  wines still require an explicit price, while an explicit zero remains zero.
  The token-bearing unsubscribe confirmation route now owns
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer` before token
  parsing and verification. **Why:** Review identified silent aggregate
  rewrites, undefined tier inputs, destructive zero-price defaults, and
  route-local privacy headers that depended on global middleware.
  **Deployment impact:** Worker API request validation and response headers
  change; no database migration, provider activation, Pages route, or static
  asset changes are required. **Verification:** `npm run typecheck` and
  `npx vitest run tests/server/app.test.ts tests/server/core-club.test.ts
tests/server/retention.test.ts` (106 tests).
- Hardened extracted route boundaries after review: release tier/price sets and
  wine names now fail closed when inconsistent, partial email-template updates
  no longer inject `enabled: true`, padded emails normalize before validation,
  and staff callback redirects reject control-character and backslash authority
  forms.
- Preserve explicit `null` canonical member aliases over legacy alias values
  and keep member/release PATCH service inputs genuinely partial.
- Require actual raw `Buffer` bodies before webhook provider dispatch, provide
  an explicit non-zero loyalty-adjustment error, reuse the shared UUID schema,
  and document the order-sensitive intelligence/member mounts.
- Trust Cloudflare's edge-managed client-address header only in staging and
  production; direct local/test requests now use Express's socket-derived
  address for audit fields and rate-limit actor keys.
- Hardened the Worker-compatible multipart CSV parser with bounded MIME
  boundaries, exact CRLF/header framing, bounded field counts, and line-framed
  delimiter recognition. Focused API regressions cover malformed bodies and
  delimiter-like bytes inside CSV content without introducing a Node stream
  middleware dependency.

### Added

- **What changed:** Added the BS-05 local-development harness with pinned
  Supabase CLI, fail-fast Supabase/Worker/Vite orchestration, loopback-only
  Auth bootstrap, synthetic two-tenant fixtures, authenticated smoke checks,
  deterministic double-seed verification, a local quickstart, and a 20-gate
  readiness ledger. A shared readiness helper requires simultaneous Worker
  health and Vite `/app/` responses, bounds every probe and the wall-clock
  startup window, rechecks both services after smoke, and fails immediately if
  either process exits. A dated ADR records the loopback, ephemeral-secret,
  contributor-file, process-cleanup, and Auth boundaries. Browser-origin
  regressions cover same-origin production,
  loopback HTTP, credential-free HTTPS, invalid credentials/path/query/URL,
  and the unchanged stricter Capacitor policy. `test:e2e` aliases the canonical
  `qa:e2e` command. **Why:** Contributors need a reproducible local application
  path without hosted/provider credentials, and CI must prevent fixture or
  browser-origin policy drift. **Deployment impact:** CI gains a Docker-free
  22-migration seed gate; no hosted database, provider, Worker, Pages, secret,
  DNS, or activation mutation occurs. **Verification:** `npm ci`, dependency
  audit, script syntax checks, TypeScript, Vitest 448/448, focused BS-05 tests
  74/74, and `npm run qa:local-seed`.
- **What changed:** Added the domain-service decomposition ADR and linked
  architecture/service-manifest guidance, documenting extracted ownership,
  import direction, neutral shared primitives, compatibility barrels, and the
  requirement to review behavioral changes separately from structural moves.
  **Why:** The decomposition establishes a durable architecture and therefore
  requires a canonical decision record beyond the implementation manifest.
  **Deployment impact:** Documentation only; routes, Worker bindings, database
  migrations, providers, secrets, Pages, and activation state are unchanged.
  **Verification:** ADR link review, implemented import-graph comparison,
  18-service/37-edge zero-cycle audit, `git diff --check`, and exact-head
  automated review.
- Added the BS-03 `server/services/` extraction skeleton for members, clubs,
  orders, Stripe, EasyPost, communications, webhooks, and the service barrel;
  the pre-existing analytics module remains intact.
- Added the BS-03 service decomposition manifest, documenting every exported
  function, public service method, cross-domain dependency,
  provider-activation guard, and tenant-scoping boundary before extraction.
- Added architecture context for the current Pages/Worker/Supabase topology,
  explicit tenant boundary, service request path, provider activation status,
  all 20 pending gates, and the canonical file-ownership table so automated
  reviewers receive current system context.
- Added repository-wide CODEOWNERS, a pull-request template aligned with the
  actual test commands, governance risk notes, Greptile learning guidance, and
  an exhaustive service-layer tenancy audit to route ownership and make the
  remaining self-review risk explicit without claiming enforced approval.
- Added a focused mobile-bootstrap isolation test that requires member,
  shipment, and loyalty queries to use the authenticated organization and
  brand, closing the confirmed Rule 8 defense-in-depth gap.
- Added the route-layer decomposition ADR documenting domain router
  boundaries, the public/protected/fallback mount-order contract, and the
  request-scoped `RouteContext` service-selector pattern.
- Added the BS-02 route manifest covering all 129 Express route registrations,
  middleware chains, inline-logic flags, direct-database-access audit, and
  domain extraction ownership before route code is moved.
- Added `@sentry/cloudflare` at the Worker entry boundary, gated on the
  server-only `SENTRY_DSN` secret and configured to exclude request PII,
  bodies, query strings, database query data, stack-frame variables, and
  exception/log messages.
- Added `server/lib/error-handler.ts` with request-correlated structured logs,
  safe Zod/auth/authz/not-found/unknown mappings, a consistent JSON envelope,
  and Sentry capture for 5xx exceptions.
- Added `server/lib/rate-limit.ts` and four native Cloudflare Rate Limiting
  bindings for auth, general API, webhook, and admin routes. Policies consume
  both normalized route/tenant and route/hashed-actor counters and fail closed
  when a production binding is unavailable.
- Added `.dev.vars.example`, focused Sentry/error/rate-limit unit tests, the
  observability and rate-limiting ADR, and a BS-04 QA report recording audit 0,
  aggregate checks, TypeScript and generated bindings, 367/367 Vitest tests,
  Vite/Pages and all Worker dry runs, 145/145 Playwright/axe cases, and a clean
  changed-file credential scan.
- `.greptile/rules.md`: 10 architectural boundary rules encoding vinifera's service, security, and tenancy patterns
- `.greptile/files.json`: Greptile context files for every PR review
- `docs/build-specs/phase-5-qa-report.md`: Phase 5 closure evidence with all 20 activation gates listed as pending
- Added tenant-free Cloudflare Queue wake signals with PostgreSQL-authoritative
  claiming, duplicate-safe consumers, independent immediate-continuation and
  delayed-retry scheduling, hourly recovery, isolated environment bindings,
  and generated Worker type verification in CI.
- Added migration 017 and a service-role-only custom-hostname deletion ledger.
  Ambiguous DELETE results are lookup-gated, retries require proof the provider
  target still exists, provider absence/local disable complete atomically, and
  a deleted hostname generation can be safely reused.
- Added Phase 5 provider-completion migration 016 with tenant-safe Klaviyo
  field/list and QuickBooks account mapping commands, same-brand composite
  integrity, database-backed QuickBooks refresh leases and credential
  generations, persisted per-job attempt ceilings, and 35 focused pgTAP
  assertions.
- Wired the existing Integration page save contract to executable provider
  mappings. Klaviyo bulk execution now uses configured profile properties,
  churn score/level, provider profile IDs, and list add/remove transitions;
  QuickBooks defaults produce persisted membership and shipping mappings.
- Added cross-isolate QuickBooks refresh coordination tests and focused
  Klaviyo mapping/list execution tests without contacting any provider.
- Added the Phase 4 final-stack hardening migration and 37 current-stack
  assertions: brand-local operational analytics, true all-time ranges,
  refund-net LTV, de-duplicated engagement, all-brand benchmark authorization,
  qualified temporal ML provenance, concurrent shadow scoring, actor-audited
  promotion, and ShipCompliant-to-EasyPost evidence binding.
- Added the no-network/connected `ops:phase4:qualify-ml` operator command. It
  validates the six-source 95 percent reconciliation contract, requires an
  active platform automation actor, calls only the guarded five-argument RPC,
  and leaves the immutable evidence hash to PostgreSQL.
- Added shared CSV formula-injection hardening, calibrated churn uncertainty
  language, non-color chart differentiation, truthful compliance-rules
  evidence, and refreshed Phase 4 visual captures at 375, 768, and 1440.
- Phase 4 architecture closure commit `623dd2a` passed GitHub Actions run
  [`30232327146`](https://github.com/theonlygeranium/vinifera/actions/runs/30232327146):
  quality/browser QA completed in 6m49s, Android lint/debug/minified release
  completed in 4m19s, QA/native evidence uploaded, the Pages rollback artifact
  validated, and hosted migration/deployment skipped while activation remains
  off. The resulting static Pages deployment serves CSP, COOP, HSTS,
  frame-deny, and MIME-sniffing protections at `/` and `/app/`; `/api/health`
  remains static HTML until the Worker is activated.
- Added the Phase 3 final-stack retention hardening migration: brand-scoped
  defaults and time zones, same-brand composite integrity, lease-token email
  completion, a durable provider-event inbox, command result fingerprints,
  immutable cancel snapshots, stale-attempt cleanup, pause resumption, and a
  UTC/global plus brand-local daily retention ledger.
- Added 61 current-stack Phase 3 database assertions and wired them into both
  the Phase 3 and Phase 5 embedded PostgreSQL gates.
- Added paginated staff/member loyalty ledgers, current-tier downgrade
  comparison, unsaved-draft email tests, direct rules-based churn coverage, and
  tenant-scoped session-retained UUID commands for cancellation and loyalty
  mutations.
- Added the Phase 3 retention integrity hardening ADR and expanded activation
  diagnostics for lease expiry, uncertain provider receipts, early webhooks,
  monotonic events, daily replay, and brand-local dates.
- Added the Phase 2 transactional command ledger and leased provider outbox:
  UUID/SHA-256 replay protection, atomic business/audit/result persistence,
  privacy-preserving browser resumption, supersession, and bounded recovery.
- Added same-brand composite foreign keys, complete release-aggregate
  validation, immutable Stripe event convergence, stale-refund recovery leases,
  and a final provider-identity deletion reference check.
- Added the Phase 2 data-integrity hardening ADR and expanded QA evidence.
- Added the Phase 1 owner/admin Team invitation surface, role-aware
  manager/staff denial, session-backed invite/reset completion, a dedicated
  92-assertion Phase 1 database gate, and retained login/signup visual evidence
  at 375, 768, and 1440.
- Added recoverable organization signup billing with immediate idempotent
  Stripe Customer creation when connected and explicit `ready`, `deferred`,
  and `reconciliation_required` states when services are connected later.
- Added the signup billing recovery ADR covering ambiguous database responses,
  uncertain provider writes, identity retention, and just-in-time
  reconciliation.
- Completed the credential-independent production architecture with Stripe
  billing-subject locks and webhook-wait reconciliation, consent-gated
  encrypted Meta attribution, resumable envelope rotation, separately
  persisted QuickBooks shipping, Avalara mappings/exemptions/filing snapshots,
  per-brand Resend activation, provider target policies, a retry-safe hostname
  ledger, and staff white-label controls.
- Added independently protected, default-deny credential-rotation and Stripe
  live-billing controls plus restricted
  `env://VINIFERA_INTEGRATION_SECRET_*` runtime references.
- Added the deferred-service activation ADR and aligned setup, architecture,
  environment, activation, QA, and continuity documentation with the
  connect-services-later operating model.
- Added a protected Stripe test-catalog workflow with a read-only account
  fingerprint probe, tracked SHA-256 account authorization, exact typed
  confirmations, idempotent Product/Price creation, drift verification, and
  sanitized non-secret Price evidence.
- Expanded the integrated application/control suite to 189/189 tests across 16
  files.
- Added a GET-only hosted-readiness workflow that classifies staging versus
  generic Cloudflare, Supabase, and Stripe test credentials without retaining
  values, provider bodies, URLs, or identifiers.
- Added hashed staging and production target policies whose empty unresolved
  arrays block mutation before any provider write.
- Added linked hosted Supabase pgTAP/RLS execution and a sanitized staging
  Worker verifier for the core app, database, Stripe test billing, and webhook
  capabilities.
- Added a protected manual production Worker controller for first bootstrap,
  immutable version upload/deploy, full-capability domain cutover, Worker
  rollback, and non-destructive Pages restoration.
- Added a protected signed mobile-release controller for ephemeral Android/iOS
  signing, signature verification, Google Play internal edit transactions, and
  internal-only TestFlight upload.
- Added the credential-gated release ADR plus Phase 1, Phase 4, environment
  provisioning, production cutover/rollback, and signed mobile runbooks.

### Changed

- **What changed:** Vinifera JWT helpers and all migration/test references now
  use the application-owned `private` schema, migration 020 revokes the
  correct text-argument function signature, local seed application is
  idempotent, staff login/invite resolution reuses the response-owning
  Supabase client, member portal relationship embeds name their brand-scoped
  foreign keys, and daily portal-login analytics preserve the first real
  occurrence timestamp while replaying idempotently.
  The BS-05 readiness ledger records partial local prerequisite evidence for
  Gates 1, 7, and 15 while keeping all 20 composite activation gates `pending`.
  Local fixture brands now use fixed IDs verified across independent clean
  databases, local URL parsing rejects credentials and non-origin components,
  shared local-config and PostgreSQL-bootstrap modules prevent verifier drift
  across the local seed and Phase 3–5 database gates,
  and single-result roster/import feedback uses the correct singular label.
  **Why:** The native local stack and independent review exposed
  managed-schema, replay, response-cookie, ambiguous relationship,
  duplicate-idempotency, fixture-reproducibility, URL-boundary, readiness
  semantics, and UI-copy defects that embedded or mocked checks did not.
  **Deployment impact:** Local replay, Worker behavior, fixture identity,
  loopback validation, and member-count copy are corrected, but no hosted
  schema/provider state is changed. **Verification:** Native and embedded
  22-migration seed replay, independent clean-database brand identity,
  authenticated two-tenant Worker/Auth smoke, TypeScript, Vitest 448/448,
  focused BS-05 tests 74/74, Playwright 145/145, real desktop/375px axe-core
  with zero violations, 375px touch targets, and fail-closed shutdown cleanup.
- BS-06 review follow-up clarifies that CODEOWNERS routes review but is not
  currently branch-protection enforced, expands the pull-request checklist to
  cover dependency, database, and package gates, pins the tenancy audit to its
  exact code and repository-migration evidence, and strengthens the isolation
  fixture with same-organization/wrong-brand rows while retaining
  cross-organization rows. The governance note now also records explicit
  change, rationale, deployment-impact, and verification evidence for the
  observed GitHub controls. This improves review evidence only and changes no
  runtime or deployment state. Verify with read-only GitHub branch/environment
  API inspection, the repository governance files, TypeScript, the focused
  Phase 5 integration test, and the full 378-test suite.
- Integrated BS-06 with the repaired direct-push guard and completed BS-02/
  BS-04 route and observability baseline from `main`. Architecture and
  governance documentation now match the extracted route tree and current
  protected-branch controls while preserving the mobile-bootstrap tenant
  predicates and cross-brand regression. This merge changes no provider,
  hosted-database, Worker, or production activation state. Verify with the
  exact integrated evidence recorded in `CONTINUITY_BRIEF.md`.
- Updated README developer context with the current v0.5.0 status, existing
  local development commands, agent workflow, and architecture links.
- Integrated the repaired direct-push guard from `main` into the BS-04 branch
  while preserving the observability and rate-limit implementation. This merge
  changes no runtime route or activation state; verify with the guard policy
  tests and the complete BS-04 quality suite before merge.
- Review follow-up hashes complete rate-limit composites into Cloudflare's
  64-byte key maximum, derives tenant budgets from the edge-routed host instead
  of client-selected brand or forwarded-host headers, uses the Cloudflare
  connecting IP instead of rotatable authorization/cookie input for the actor
  budget, and narrows the reflective Worker secret lookup to explicit
  `unknown`.
- Registered specialized rate limits before API handlers and the centralized
  error handler last. Wrangler development, staging, and production
  environments now declare the four native rate-limit bindings. This changes
  Worker build/runtime configuration but does not deploy the Worker, activate
  Sentry, change static Pages routing, or contact a provider. Verify with
  Worker type generation, TypeScript, unit/browser tests, dependency audit,
  Vite/Pages and Worker builds, secret scanning, and middleware-order review.
  Existing API fixtures now inject deterministic allow-only rate-limit
  bindings so production-mode route assertions continue exercising their
  intended auth and activation behavior.
- Reworked the direct-push guard to produce its required check on pull
  requests and to verify `main` updates using the exact merge result returned
  by GitHub's associated-pull-request API. Conventional commit messages no
  longer bypass the guard; merge, squash, and rebase strategies remain
  supported, and focused policy tests fail closed on forced pushes, missing
  evidence, or API errors. Associated-PR lookup follows bounded, validated
  same-origin pagination and retries routine indexing delay twice before its
  final rejection.
- Local `typecheck`, `lint`, and aggregate `check` commands now regenerate the
  ignored Worker binding declaration before TypeScript reads it, so a fresh
  checkout no longer depends on a previously generated local file.
- Migrated Greptile configuration from `greptile.json` to `.greptile/` folder format with per-directory overrides for `server/services/`, `supabase/migrations/`, and `tests/`
- Removed committed generated artifact `worker-configuration.d.ts` (552 KB); CI now generates it pre-typecheck
- This repository-hygiene change does not alter runtime routes, build output,
  provider activation, or the static production baseline. Validate it with
  JSON parsing, Git tracking checks, Worker type generation/verification,
  TypeScript typecheck, and a Worker dry-run build.
- Aggregated organization-wide analytics from raw per-brand numerators and
  denominators, including email, loyalty, shipment-value, and shipping-cost
  rates, instead of weighting unrelated percentages.
- Hardened provider transports with bounded response bodies, timeouts,
  redirect rejection, fixed target validation, safe error classes, and
  constant-time fixed-size secret comparisons.
- Recorded the final credential-independent Phase 5 gate: audit 0, generated
  Worker types and TypeScript green, Vitest 352/352, database gates
  92/231/199/158/494, Playwright 145/145 with zero axe violations, 416 ms LCP,
  CLS 0, 920 ms multi-brand readiness, 444.6 ms 100-member roster, Vite/Pages
  and development/staging/production Worker dry runs, mobile identity/release
  controls, compile-only preparation, and Android/iOS Capacitor sync.
- Recorded Phase 5 architecture closure commit `5d3dadd` and GitHub Actions
  run
  [`30235083942`](https://github.com/theonlygeranium/vinifera/actions/runs/30235083942):
  quality/database/browser/Pages rollback passed in 5m39s, Android
  lint/debug/minified release passed in 4m10s, evidence uploaded, and
  credential-gated migration/deployment skipped.
- Integration enqueue/runtime/claim paths now exclude inactive or suspended
  brands, expired final-attempt jobs are dead-lettered during recovery, and
  Avalara quote adjustment replaces only same-shipment temporary facts while
  preserving provider-code uniqueness and committed immutability.
- QuickBooks OAuth authorization, exchange, and worker runtime now share the
  canonical HTTPS redirect assertion, and rolling token persistence uses a
  database generation compare-and-swap before any refreshed access token is
  used.
- Made the staff tenant boundary remount brand-scoped operational state,
  preserve explicit `scope=all` analytics URLs, suppress stale resource
  responses, and fail closed behind a retryable brand-catalog gate. Native
  member cold starts can now unlock minimized cached data in read-only mode
  when token rotation is offline, refresh-token rotation is single-flight, and
  sender verification persists the current draft before DNS activation.
- Recorded the Phase 4 credential-independent gate: audit 0, TypeScript green,
  Vitest 323/323, database gates 92/231/199/158/438, Playwright 143/143
  (Phase 4 20/20) with zero axe violations, 13,846.77 ms 10,000-member
  scoring, 58.40 ms 365-day analytics, 24.20 ms chart rendering, Pages
  rollback validation, Worker dry run, and compile-only Android/iOS sync.
- Made ML creation, registration, and promotion service-only; a missing active
  actor, source qualification, completed experiment metric, or fresh stable
  drift record now fails closed. Client-authored analytics events are denied,
  and organization-wide benchmark access requires an active all-brand actor at
  both service and database boundaries.
- Required an explicit vendor-approved ShipCompliant token path, shared the
  OAuth/check timeout budget, rejected redirects, preserved the token cache,
  and added CSP/COOP/HSTS to the Pages rollback header contract.
- Replaced composition-dependent email batch idempotency with one stable
  provider key per outbox row and bounded delivery concurrency of eight.
- Isolated email enqueue/delivery from daily churn, loyalty, cancellation, and
  pause-resume work so a configured provider outage cannot suppress unrelated
  retention jobs.
- Changed loyalty history from offset paging to an immutable-sequence snapshot
  cursor, blocked unverified sender claims without consuming attempts, and
  aligned retention analytics with completed decisions and real client events.
- Recorded the Phase 3 credential-independent gate: audit 0, TypeScript green,
  Vitest 301/301, database gates 92/231/199/121/401, Playwright 141/141
  (Phase 3 27/27) with zero axe violations, 155.11 ms scoring, 7.48 ms email
  claim, 436 ms LCP, CLS 0, Pages/Worker dry runs, and compile-only Android/iOS
  synchronization.
- Recorded Phase 3 architecture closure commit `3b01c3a` and GitHub Actions run
  `30229260377`: quality passed in 6m22s, Android in 4m25s, QA/native evidence
  uploaded, the Pages rollback artifact validated, and credential-gated
  Supabase/Worker mutation jobs skipped.
- Recorded Phase 2 architecture closure commit `15c9942` and GitHub Actions run
  `30226397256`: quality passed in 5m15s, Android in 3m39s, evidence uploaded,
  and credential-gated Supabase/Worker mutation jobs skipped.
- Recorded the current credential-independent gate: audit 0, TypeScript green,
  Vitest 290/290 (focused Phase 2 72/72), database gates
  92/231/138/121/340, Playwright 136/136 (Phase 2 38/38) with zero axe
  violations, 941.7 ms single-worker roster, 712 ms LCP, CLS 0,
  release/mobile/catalog
  controls 14/7/16, Pages/Worker dry runs, and compile-only Android/iOS sync.
- Split Phase 2 database evidence into 170 point-in-time and 61 current-stack
  transactional assertions, with 10.76 ms release and 338.85 ms import proof.
- Recorded Phase 1 architecture closure commit `a27f078` and GitHub Actions run
  `30223237016`: quality passed in 5m43s, Android in 4m44s, 90-day Playwright
  evidence uploaded, and hosted mutation jobs skipped while activation is off.
- Enforced restricted/suspended staff workspaces as billing-recovery-only,
  while keeping Subscription and sign-out available and blocking operational
  navigation and server services.
- Extended CI to run Phase 1 through Phase 5 database architecture, retain
  Playwright evidence for 90 days, and exercise explicit Tab-order plus
  Space/Enter activation.
- Updated the current local gate to TypeScript green, Vitest 256/256, Phase 1
  PostgreSQL 92/92, Phase 1 Playwright 30/30, and the full Playwright inventory
  at 132 tests.
- Raised the GitHub Actions artifact/log retention setting from 1 day to the
  repository's allowed 90-day maximum so QA, native-build, rollback, and
  protected activation evidence follows the workflow retention contracts.
- Pinned Android setup in CI and signed mobile release to
  `android-actions/setup-android` v4.0.1, whose action runtime is Node 24,
  removing the runner's Node 20 compatibility warning.
- Recorded the final local architecture gate: dependency audit 0, TypeScript
  green, Vitest 245/245, Phase 2/3/4 database regressions 145/138/121, Phase 5
  migrations 001–012 and pgTAP suites 013–022 at 279/279, Playwright 123/123
  with zero axe violations, LCP 476 ms, CLS 0, Pages/Worker/production dry-run
  builds, production release 14/14, mobile release 7/7, Stripe catalog 16/16,
  mobile identity, compile-only Capacitor preparation, and Android sync.
- Recorded architecture commit `5d36471` and GitHub Actions run `30221722696`:
  the quality job passed in 5m23s, the Java 21 Android lint/debug/minified
  release job passed in 4m37s, and credential-gated migration/deployment jobs
  skipped as designed. The local Mac still has no Java runtime.
- Requested Product expansion on newly created Stripe Prices so the controller
  can validate the Product contract in the same response. Protected bootstrap
  run `30218801133` failed closed after the first provider create because the
  initial response returned only a Product ID; the stable lookup and
  idempotency keys make the retry safe.
- Authorized the reviewed Stripe test account fingerprint after successful
  read-only run `30218422165`; the fingerprint is a one-way target binding and
  the canonical Product/Price catalog remains uncreated pending a separately
  reviewed bootstrap operation.
- Removed the implicit native production-origin fallback. Compile-only,
  isolated staging, and explicitly authorized production builds now have
  distinct fail-closed profiles and artifact labels.
- Made hosted migration success contingent on the repository's native pgTAP
  suites and made staging Worker success contingent on the JSON configuration
  contract, not only an HTTP 200 health response.
- Added a named route-free `vinifera-production` Wrangler environment that
  stays on `workers.dev` until the separate domain operation is approved.
- Made Android `bundleRelease` require complete environment-backed signing
  while retaining unsigned `assembleRelease` for compile-only CI.
- Aligned the Phase 5 build specification with the implemented source
  architecture, including credential ownership, additive non-null brand
  backfill, and signed-store mobile updates.
- Standardized the checked-in Apple association template on the canonical
  `MOBILE_APPLE_TEAM_ID` activation variable.
- Replaced the Phase 5 QA placeholders with traceable local architecture,
  database, browser, visual, security, iOS simulator, and local Android
  lint/debug/R8 evidence while keeping hosted providers, signing/FCM, store
  tracks, and live payments explicitly deferred.
- Recorded the final Phase 5 gates: 174/174 application tests, 167/167 Phase 5
  database assertions plus complete Phase 2–4 database regressions, 122/122
  browser tests with zero axe violations, and the reproducible Android debug,
  unsigned release, and R8 mapping hashes.
- Replaced a timer-dependent Phase 5 loading assertion with a controlled
  request gate, then passed the complete 122-test browser suite with retries
  disabled.
- Closed the Android lint/R8 gates by declaring camera hardware optional,
  supplying ionbarcode's Gson 2.10.1 runtime dependency, modernizing Gradle
  assignments, and bounding release-build memory and worker concurrency.
- Recorded the successful GitHub Phase 5 quality and Android jobs plus the
  retained debug/release APK and lint artifact; credential-gated Supabase and
  Worker jobs remained deliberately inactive.
- Recorded the successful post-hardening GitHub quality/Android run and
  GET-only hosted-readiness audit. Existing Supabase and Stripe test
  credentials are reachable, while staging credentials, database migrations,
  Stripe Prices/webhook, and Workers-capable Cloudflare authority remain
  intentionally unresolved.

### Fixed

- Removed a README link to the not-yet-committed BS-05 local quickstart so
  repository navigation points only to files and commands that exist today.
- Added explicit `organization_id` and `brand_id` predicates to every mobile
  offline-bootstrap profile, shipment, and loyalty query instead of relying
  only on member RLS and `member_id`.
- Restored unauthenticated browser bootstrap for the existing member
  magic-link, callback, session, and logout routes while keeping protected APIs
  behind the production credential-presence gate.
- Updated Phase 1 authenticated-shell mocks for the fail-closed brand catalog
  and corrected the Phase 2 performance fixture's organization-overview shape,
  preventing setup errors from being misreported as browser regressions.
- Prevented an indeterminate custom-hostname deletion from being replayed
  blindly, prevented a provider-adjusted Avalara temporary quote from
  conflicting with its stable provider transaction code, and preserved each
  integration job's configured attempt ceiling beyond eight tries.
- Fixed older Phase 2 browser fixtures to cross the new fail-closed brand
  boundary without weakening production tenant isolation.
- Prevented stale email Workers from finalizing reclaimed work, accepted-email
  retries from changing provider identity, early webhooks from being discarded,
  and out-of-order events from regressing terminal delivery state.
- Prevented live cancel configuration edits from changing an in-flight
  attempt, unsafe confirm-step configurations, permanently pinned stale
  attempts, duplicate manual loyalty adjustments, referral first-delivery
  races, and all-time analytics from being truncated to the newest events.
- Completed Phase 3 multi-brand isolation, made birthday/pre-shipment calendar
  selection brand-time-zone aware, and kept final-stack test fixtures aligned
  with automatic retention seeding.
- Prevented cross-brand Phase 2 references, incomplete scheduled releases,
  conflicting command replays, duplicate active charges/refunds, mutable Stripe
  event replays, abandoned stale refunds, and member-auth deletion races.
- Made completed staff refunds replay their recorded terminal result before the
  refunded-shipment guard, without another Stripe or ledger call, and retained
  client command UUIDs across retryable HTTP 408/425/429 responses.
- Kept marketing text fully opaque during scroll motion so axe never evaluates
  transient low-contrast blends, and aligned the canonical local Playwright
  gate with CI's single-worker performance environment.
- Fixed Supabase PKCE reset and invitation completion so the established
  HTTP-only session is authoritative and optional invite metadata uses the API
  contract.
- Fixed signup rollback safety so an ambiguous committed organization is
  reconciled by owner identity before cleanup and no post-bootstrap Stripe or
  session failure deletes the tenant.

### Security

- Kept queue messages free of tenant, connection, provider, and customer
  identifiers; all authoritative work and leases remain in PostgreSQL.
- Required same-brand composite integrity and authorized mapping commands for
  Klaviyo/QuickBooks configuration, and blocked suspended/inactive tenants at
  enqueue, runtime credential resolution, and claim boundaries.
- Preserved the server-BFF boundary by keeping every Phase 3 mutation,
  analytics, scheduler, and provider-reconciliation RPC service-role-only in
  the final stack.
- Required exact UUID/SHA-256 command intent for cancellation, loyalty
  adjustment, reservation, and redemption replay, and enforced organization,
  brand, and member identity through composite foreign keys.
- Restricted Phase 2 security-definer command/recovery functions to the service
  role, bound results to same-brand audit evidence, and kept member PII out of
  resumable browser command storage.
- Required stable Stripe Customer/session idempotency, one nonterminal Checkout
  per immutable billing subject, and an `awaiting_webhook` state that prevents
  replacement Checkout creation before signed subscription reconciliation.
- Required current consent and encrypted-at-rest browser attribution for Meta,
  redaction on consent withdrawal, bounded verified envelope rotation, and
  normalized target hashes for Cloudflare custom hostnames, FCM, and
  ShipCompliant.
- Kept live Stripe independent from Worker deployment and default-denied behind
  disabled policy, separate authority, reviewed account/webhook/Worker/Price
  targets, immutable commit binding, and exact protected confirmations.
- Restricted catalog bootstrap to `sk_test_*`, the canonical four monthly plan
  contracts, an immutable `main` commit, an allowlisted account fingerprint,
  stable lookup/idempotency keys, and a workflow that cannot create customers,
  subscriptions, charges, refunds, portals, or webhooks.
- Made staging Worker deployment verify the configured Price IDs against the
  allowlisted Stripe test catalog before uploading any Worker version.
- Enforced Secure cookies in hosted staging as well as production.
- Rejected Stripe live credentials outside production and required the
  independent, default-off `LIVE_BILLING_ENABLED` authority for every Checkout
  and shipment charge/refund/retry/schedule path.
- Rejected QuickBooks production, Avalara production, and APNs production
  endpoints outside `APP_ENV=production`; Avalara now accepts only canonical
  sandbox or production origins.
- Kept production release Stripe test-only, required all 14 configuration
  capabilities before domain movement, retained an active Pages rollback
  target, and added automatic inverse restoration on failed cutover.
- Bound signed mobile artifacts to an immutable commit on `main`, validated the
  Android upload certificate fingerprint, restricted store delivery to fixed
  internal targets, and removed decoded signing material in always-run cleanup.
- Pinned every CI, readiness, production-control, and mobile-release GitHub
  Action to an immutable commit.
- Provisioned `staging`, `production`, and `mobile-release` GitHub environments
  with `main`-only deployment policies; production and mobile release require
  repository-owner review.
- Added repository-owner review to `staging`, covering catalog activation,
  hosted readiness, Supabase migration, and isolated Worker deployment.
- Added durable QuickBooks/Avalara refund checkpoints and crash reconciliation,
  including exact 4,863 + 4,862 = 9,725 cent convergence and SHA-256-derived
  Intuit request IDs.
- Expanded regression coverage for service-only privileges and exact-context
  HMAC authentication of web magic-link organization, brand, redirect, and
  member context.

### Deferred

- All external services remain disconnected by owner direction. No hosted,
  provider, DNS, store, or live-payment exit criterion is claimed.
- Phase 3 still requires hosted migration/pgTAP proof, a verified Resend domain,
  signed webhook round trips, real tenant triggers, hosted churn/cancel/loyalty
  records, and a Stripe test redemption before its operational exit can pass.
- Protected Stripe bootstrap run `30218801133` left its first test Price
  created-or-unknown before failing closed. No retry was attempted; activation
  must later reconcile the fixed lookup key before any create.
- The Stripe test account fingerprint is tracked from the completed read-only
  probe. Catalog reconciliation/bootstrap, Price-secret promotion, and staging
  webhook registration remain deferred activation steps.
- Hosted target IDs/hashes, staging-scoped provider credentials, production
  control-plane credentials, native signing credentials, store authority,
  provider round trips, physical-device QA, and Stripe live approval remain
  external activation work. The new workflows intentionally fail closed until
  each input is supplied and reviewed.

## [0.5.0] — 2026-07-26

### Added

- Multi-brand tenancy with additive default-brand backfill, brand-scoped staff
  grants, explicit privileged all-brand aggregates, brand-bound member access,
  shared or independent billing state, and forced PostgreSQL RLS.
- A server-only integration framework with versioned AES-256-GCM credential
  envelopes, explicit opt-in, leased/idempotent jobs, reconciliation, sanitized
  attempt logs, and fail-closed activation states.
- Klaviyo profile/list/engagement synchronization, QuickBooks Online OAuth and
  accounting synchronization, Avalara pre-charge tax calculation and
  reconciliation, and consent-gated Meta Conversions API delivery.
- White-label themes and Cloudflare for SaaS custom-hostname lifecycle with
  ownership/certificate gating and server-derived hostname-to-brand resolution.
- Capacitor 8 iOS and Android projects with secure mobile magic-link exchange,
  rotating server-revocable sessions, biometric/device-credential relock, APNs
  and FCM delivery adapters, barcode scanning, network recovery, minimized
  read-only offline data, allowlisted deep links, and store-directed updates.
- Phase 5 database migrations and pgTAP suites, service and browser tests,
  responsive/axe evidence, native security documentation, an architecture ADR,
  activation runbook, and QA report.
- A canonical mobile identity manifest, deterministic Vinifera native artwork
  generator, and drift gate for package/native versions, IDs, deep links, APNs
  modes, Gradle integrity, privacy declarations, and placeholder artwork.

### Changed

- Advanced the current source release to 0.5.0 with aligned web, Android, and
  iOS version identifiers and a Node 22.12-or-newer engine contract.
- Extended GitHub CI through the Phase 5 database gate and an Android API 36
  lint/debug build using Node 22.22.0 and Java 21.
- Pinned Supabase CLI 2.109.1 and isolated optional Worker deployment to the
  `vinifera-staging` environment. Available secrets are attached atomically to
  the version, and production custom-domain cutover remains human-controlled.
- Kept winery Klaviyo, Avalara, and Meta credentials in encrypted database
  envelopes. QuickBooks application OAuth configuration remains in Worker
  secrets while per-connection OAuth tokens use the same encrypted envelope
  boundary.
- Enabled Android Release R8 minification/resource shrinking, pinned the
  Gradle distribution checksum, replaced default native artwork, narrowed the
  `FileProvider`, and fixed the generated instrumentation identity test.

### Security

- Required tenant and brand authorization in both database policies and
  service-role application queries; a browser-supplied brand identifier never
  grants access.
- Rechecked marketing consent immediately before provider disclosure, hashed
  Meta identifiers before transport construction, and kept provider payloads,
  mobile tokens, and credentials out of browser-readable logs and storage.
- Kept native sessions in Keychain/Keystore-backed storage, made refresh-token
  reuse revoke its token family, disabled Android cleartext traffic and broad
  backup, and constrained native web connectivity with a build-time CSP.
- Bound one-time mobile exchanges to the registered redirect URI, verified
  Klaviyo's canonical signed batch envelope, enforced tax-inclusive shipment
  billing identities, and limited each brand to one safely replaceable or
  disableable sender identity.
- Bound APNs to an explicit sandbox/production host and the signed iOS bundle
  identity; aligned native deep links to one exact scheme/host/route contract
  and completed the iOS privacy plus native permission/data inventory.

### Deferred

- Hosted Supabase migration, live/sandbox provider account validation, custom
  winery DNS and certificates, Stripe live-mode transition, signed
  physical-device push testing, App Store/TestFlight distribution, and Play
  internal-track distribution require external credentials or human authority.
- The public custom domain remains the verified static Cloudflare Pages
  rollback baseline until the hosted activation and regression gates pass.

## [0.4.0] — 2026-07-26

### Added

- Tenant-scoped analytics event, daily aggregate, cohort, dashboard-layout,
  and scheduled-report architecture backed only by production operational
  facts.
- Responsive revenue, member, shipment, engagement, cohort, LTV, and
  acquisition dashboards with accessible chart tables and CSV exports.
- Deterministic L2 logistic churn trainer with immutable snapshots, temporal
  holdout, five expanding folds, calibration, confusion matrix, rules
  baseline, heuristic model score bands, feature attribution, drift
  monitoring, and nightly batch scoring architecture.
- Fail-closed model lifecycle gates for production provenance, minimum data
  volume, ROC AUC, rules-baseline superiority, and a completed 30-day A/B test.
- Estate/Reserve benchmark opt-in, progressively coarsened k-anonymous peer
  groups, percentile comparisons, and polished quarterly PDF/email reports.
- Connection-ready ShipCompliant OAuth adapter, auditable compliance ledger,
  tax estimates, provider response IDs, provider-health states, dashboard, and
  mandatory post-charge/pre-label checks.
- Compliance input fingerprints and durable EasyPost label attempts that
  persist the carrier shipment before purchase, reuse successful outcomes, and
  support resume or reconciliation without blind duplicate purchases.
- Phase 4 ADR, model card, ShipCompliant activation runbook, database verifier,
  browser QA, and visual/PDF evidence.
- A passing Phase 4 local architecture gate with 121/121 embedded database
  assertions, a keyboard-only browser workflow, deterministic sub-500ms chart
  rendering evidence, and measured database scale checks. Hosted real-data,
  model-accuracy, peer-cohort, and ShipCompliant activation remain deferred.

### Changed

- Routed the implemented label path through the Phase 4 provider-backed
  fail-closed boundary. The Phase 2 whitelist remains historical code and is
  not legal authority; hosted ShipCompliant activation is still pending.
- Made the keyboard-only analytics QA use portable native-select key navigation
  so Linux Chromium cannot interpret Enter as an early form submission.
- Extended the Worker schedule for daily analytics/features/predictions,
  monthly candidate training, scheduled summaries, and quarterly benchmarks.
- Extended setup, architecture, CI, secret contracts, and configuration health
  for credential-deferred compliance activation.

### Security

- Forced row-level security across every Phase 4 tenant table and restricted
  cross-tenant aggregation/model lifecycle RPCs to the service role.
- Rejected identifying analytics payload fields, suppressed peer metrics below
  ten wineries, prevented synthetic model promotion, and kept all
  ShipCompliant credentials server-side.

## [0.3.0] — 2026-07-26

### Added

- Tenant-owned transactional email templates, durable outbox claims, delivery
  log, six lifecycle triggers, preview/test sends, and signed unsubscribe links.
- Fail-closed Resend batch adapter with idempotency and raw-body Svix webhook
  verification; test-only deterministic delivery remains unavailable in
  production.
- Explainable rules-based churn scoring with nightly snapshots, risk queue,
  filters, and contributing-factor detail.
- Configurable four-step cancellation interception with pause, downgrade,
  shipment swap, final cancellation, and outcome analytics.
- Append-only loyalty lots and ledger with shipment, referral, event, birthday,
  anniversary, manual adjustment, 24-month expiration, and FIFO redemption.
- Loyalty-adjusted Stripe shipment charge, retry, and refund convergence.
- Phase 3 ADR, Resend activation runbook, QA report, visual evidence, and
  reproducible embedded database verification in CI.

### Changed

- Added birthday and same-tenant referrer data to member management.
- Extended the hourly Worker schedule for email, churn, and loyalty maintenance.
- Made Phase 2 and Phase 3 embedded database gates locked, repeatable CI steps.
- Extended setup, architecture, continuity, and secret contracts for Phase 3.

### Security

- Forced row-level security across every Phase 3 tenant table.
- Restricted scheduled and redemption-finalization RPCs to the service role.
- Sanitized email HTML, kept provider secrets server-side, replay-protected
  delivery events, and rejected production simulators.

## [0.2.0] — 2026-07-26

### Added

- React 19 + Tailwind/Vite staff and member applications with code-split `/app/*` and `/portal/*` routes.
- Express 5 backend-for-frontend packaged with static assets in one Cloudflare Worker.
- Secure staff password, reset, Google OAuth, invitation, and protected-route flows.
- Passwordless member magic-link flow with isolated staff/member HTTP-only cookie sessions.
- Supabase foundation migration with forced RLS, server-derived JWT claims, super-admin access, tenant indexes, atomic invitation consumption, and pgTAP suites.
- Stripe test-mode Checkout, Customer Portal, signed webhook processing, idempotency, out-of-order protection, and seven/fourteen-day access reconciliation.
- Configuration health and typed activation gates so real provider connections can be enabled later without production mocks.
- GitHub-hosted CI for dependency audit, type-checking, unit/integration tests, Worker packaging, Playwright/axe QA, conditional Supabase migration, and Worker deployment.
- Phase 1 architecture ADR and QA report.
- Reproducible Phase 2 embedded database verification with plan-balanced
  schema, tenant-RLS, server-RPC assertions, and measured 50-shipment and
  1,000-row import performance gates.
- Phase 2 tenant-owned club tiers, release snapshots, shipments, billing attempts, durable CSV imports, and tamper-evident audit chain.
- Member CRM, tier management, release calendar, decline recovery, fulfillment station, import workflow, and data-connected member shipment portal.
- Stripe off-session shipment PaymentIntents, partial-success release batches, manual and automatic retries, refunds, and signed webhook convergence.
- EasyPost address verification and adult-signature label adapter behind a fail-closed shipping provider boundary.
- Hourly due-release processing, retry claiming, in-flight attempt recovery, and idempotent resume behavior.
- Phase 2 ADR, provider activation runbook, QA report, embedded performance gates, and breakpoint visual evidence.

### Changed

- Required a nonblank winery name/company and phone in shipping-origin addresses used for adult-signature labels.
- Replaced the static `/app` deployment artifact with a production React shell while retaining the original `app` file as the visual reference.
- Moved runtime configuration from Pages `wrangler.toml` to Worker `wrangler.jsonc`.
- Stopped tracking generated `dist/` output; CI and deployments now build it from source.
- Updated setup, architecture, continuity, rollback, and repository documentation for the Phase 1 production foundation.
- Extended the Worker API, cron, CI secret contract, and operational documentation for the Phase 2 core club loop.

### Fixed

- Replaced the accidentally Base64-encoded `.gitignore` with active ignore rules that prevent local environment files, Worker secrets, dependencies, build output, and QA artifacts from being committed.
- Removed a timer-based Express rate-limit middleware that is incompatible with Cloudflare Worker global scope; member magic-link limits are enforced atomically in PostgreSQL.
- Normalized database RPC and API session contracts, including Stripe event return shapes and camel-cased browser payloads.
- Refreshed newly bootstrapped Supabase sessions so database-derived tenant claims are immediately available.
- Made disconnected session probes fail closed without producing noisy browser errors.
- Gated Worker deployment behind an explicit activation flag after the existing Cloudflare token proved to lack Workers Scripts permission.
- Updated GitHub checkout, Node setup, and artifact actions to their Node 24-based v7 releases.
- Preserved the verified static `/app` prototype in Cloudflare Pages builds while keeping Worker builds on the React application.

---

## [0.1.0] — 2026-07-26

### Added

- Initial repository created from `github-deploy-template`
- `AGENTS.md` — agent collaboration guide
- `CONTINUITY_BRIEF.md` — drop-in context for new agent sessions
- `CHANGELOG.md` — this file
- `REVERT.md` — stable baseline and rollback guide
- `.env.example` — non-secret environment variable template
- `docs/architecture.md` — system architecture documentation
- `docs/setup.md` — setup and deployment guide
- `docs/decisions/` — ADR directory
- `docs/runbooks/` — runbooks directory
- `.github/workflows/deploy.yml` — CI/CD pipeline
- Cloudflare Pages project `vinifera` created and configured
- Custom domain `vinifera.edstratumlabs.ai` with SSL
- GitHub Secrets injected: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `SCHUBERT_SSH_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Landing page (`index.html`) with hero vineyard illustration, feature grid, workflow illustrations, pricing, CTA sunset gradient
- App prototype (`app`) with 13 functional areas, 27 KPI cards, sidebar navigation, KPI watermarks, empty-state illustration
- Investor's guide (`guide`) with 8-part content, sticky TOC sidebar, reading progress bar, scroll-spy navigation, feature grid, tech stack, timeline, pricing, stats strip
- Four hero animations: vine line drawing, gold glow pulse, grape cluster sway, CTA shimmer sweep
- `prefers-reduced-motion` fallback for all animations (CSS + SVG SMIL)
- Extensionless `app` and `guide` files for Cloudflare Pages routing
- `_redirects` routing rules for `/app/*` and `/guide/*`
- `_headers` security headers and Content-Type overrides
- "Investor's Guide" nav links in desktop nav, mobile drawer, and footer

### Fixed

- Mobile navigation: hamburger visibility, positioning, and drawer functionality
- Landing page CTA links pointing to `index.html` instead of `/app/`
- App hamburger menu not opening on mobile
- App mobile pipeline overflow at 375px viewport
- Hero illustration visibility — gradient too dramatic, SVG opacities too low
- Grape cluster rendering — CSS `transform: rotate()` overriding SVG `transform="translate()"` attribute, switched to SVG `<animateTransform additive="sum">`
- Mobile grape cluster overlap with hero-proof text
- WCAG 2.1 AA color-contrast violations across landing, app, and guide pages (20+ elements)
- WCAG 1.4.3 `btn-gold` contrast: white text on gold (2.59:1) → wine-dark text (6.47:1)
- Guide page ARIA table role violations (`aria-required-children`, `aria-required-parent`)
- Guide page `--text-3` color contrast: `#9C8C78` (3.26:1) → `#6B5D4A` (6.38:1)
- Guide page gold stat-value contrast: `#C9993A` (2.59:1) → `#9A7510` (3.5:1)
- Missing `<main>` and `<header>` HTML landmarks
- Touch targets below 44px (WCAG 2.5.5) — 16 elements fixed
- Footer color contrast on dark background
- Guide page `aria-label` on divs without valid ARIA roles — added `role="group"`

### Changed

- Hero gradient from dramatic near-black-to-gold to uniform deep burgundy for SVG illustration visibility
- `--text-3` from `#9C8C78` to `#6B5D4A` for WCAG 2.1 AA compliance
- `--text-muted` from `#9CA3AF` to `#5B6470` for WCAG 2.1 AA compliance
- `--success` from `#16A34A` to `#15803D` for WCAG 2.1 AA compliance
- `--danger` from `#DC2626` to `#B91C1C` for WCAG 2.1 AA compliance
- `.btn-gold` text color from `--white` to `--wine-dark` for WCAG 1.4.3 compliance
- Template files updated with actual vinifera project details (replaced all `[REPO-NAME]` placeholders)
- README.md rewritten with professional project overview, features, tech stack, and EdStratum Labs about section
