# Vinifera — Agent Continuity Brief

**Last updated:** 2026-08-07
**Purpose:** Current handoff for any engineer or agent continuing the production build.

## 2026-08-07 Automated approvals — LOCKED owner decision

The owner explicitly authorized automating reversible delivery approvals and
reducing human gates to an alert-only model. See ADR
`docs/decisions/2026-08-07-automated-approval-delegation.md` and `AGENTS.md` §11.
`dev → staging` is now auto-dispatched by
`.github/workflows/promote-dev-to-staging-auto.yml` (the fail-closed
`promote-dev-to-staging.yml` is unchanged); `.github/workflows/escalation-alert.yml`
pings the owner only on emergency labels or consequential protected workflow
requests. The reversible environments (`promotion-control`, `staging`,
`development-worker`) are intended to carry zero required reviewers;
`production` and `mobile-release` stay human-gated. **Do not reverse or
re-tighten this without the owner's explicit approval and a superseding ADR** —
a future agent may misread it as a security regression, but it is intentional.
Like the other controllers, the two new workflows are inert until they reach the
default branch and their secrets/environment settings are provisioned.

## Project identity

- Owner: EdStratum Labs
- Repository: `https://github.com/theonlygeranium/vinifera`
- Default branch: `main`
- Public domain: `https://vinifera.edstratumlabs.ai`
- Build specifications: `docs/build-specs/`

Read `AGENTS.md`, the phase specification, and this brief before editing.

## 2026-08-06 Gate 15 core evidence repair

Gate 15 core implementation is now integrated into the canonical Gates 10–16
collector and its required 90-day artifact under the existing one-shot Gate 15
toggle. It authorizes the exact staging Worker and a separately reviewed
Supabase-origin hash before constructing clients, then exercises a run-scoped
two-brand organization across restricted staff/member RLS, owner aggregation,
independent sibling suspension, integration job claims, and ambiguous
same-email handling. Its cleanup ledger is registered before mutation, targets
exact organization/brand keys, attempts every dependency phase, and blocks the
report on any cleanup failure.

Cleanup independently reconciles the generated fixture emails to tagged hosted
Auth users before deletion, so a committed create with a lost response cannot
orphan an acceptance identity. Forward migration `202608060034` also rejects
null required scoped-claim arguments before any integration-job lease mutation.
The fixture job retains its historical queue timestamp only for deterministic
ordering and is leased at the current run time so the normal drain cannot
immediately reclaim it.

The checked-in Supabase-origin staging and production-deny hash lists remain
empty, so hosted Gate 15 execution is deliberately blocked until those exact
targets are reviewed. No variable was set and no hosted controller was run.
Successful future core evidence remains partial and records
`completionClaimed=false`; Gate 16 hostname-derived context is still required.

The trusted development auto-merge evaluator now stores paginated check-run
and commit-status responses in runner-local JSON files before exact evidence
selection. This fixes the runner argument-length failure observed on PR #291
without weakening PR/base/head binding or the immediate pre-merge check.

Promotion-smoke tests that create and compare three local Git branches use a
30-second per-test budget. The local-drill fixture uses the same bounded budget.
Their logic is unchanged; the prior 5-second default repeatedly timed out only
under concurrent full-suite filesystem load while the isolated suite passed
9/9.

## 2026-08-06 Gates 10-16 acceptance foundation

The protected staging deployment now supports independent opt-in readiness
reports for Gates 10 through 16. Each report verifies the exact deployed
candidate and only its gate's required configuration groups, retains a
sanitized 90-day artifact, and fixes `completionClaimed=false`. It does not
create or qualify the real winery, model, cohort, provider, multi-brand, or DNS
evidence required to change a gate status.

Gate 11's previously missing staging deployment binding is corrected:
`STAGING_ML_PLATFORM_ACTOR_USER_ID` is uploaded atomically as
`ML_PLATFORM_ACTOR_USER_ID`. Presence alone remains insufficient; the guarded
qualification path must prove that it identifies an active platform
super-admin. See `docs/runbooks/hosted-gates-10-16-evidence.md` and ADR
`docs/decisions/2026-08-06-hosted-gates-readiness-evidence.md`.

## 2026-08-05 hosted activation re-audit

The canonical Gate 1–5, 7, and 9 evidence was rechecked against the live
staging providers, database, and Worker rather than accepted from the prior
review. Gates 1, 3, 4, 5, and 9 are currently verified: all 30 migrations are in
the repaired Supabase migration ledger with a clean dry run; Auth retains the
custom hook, 900-second OTP, Google provider, and SMTP configuration; Stripe
accepted a resent signed subscription event exactly once; and EasyPost test
address verification remains deliverable with ZIP+4.

Gate 2 is live-passed. Protected run `31073800654` deployed immutable candidate
`f3512e7f36df7bc332ec3e59bca33c4153a835d4` as Worker version
`b3180ad7-64d6-440d-b609-09ee6e95bac5` in the dedicated staging account. The
retained runtime artifact and an independent live probe passed staging identity,
exact revision, core configuration, Stripe test catalog, and database-backed
branding checks. Gate 7 remains pending for the complete hosted acceptance
lifecycle. Before the repair, the stable staging Worker reported
`environment=production` and no revision;
member/tier requests failed because one Supabase client factory omitted the
Cloudflare Access service token; and native current-stack pgTAP files contained
stale JWT, seed-count, privilege, ML-attribution, qualification, and alert
assumptions. The repaired canonical native set passes 331/331 against the
hosted database. Forward migrations also repair release-shipment overload
resolution with end-to-end brand scoping, email-claim digest resolution, and
early-webhook reconciliation.
The staging deploy now requires `environment=staging` plus the exact promoted SHA,
and the service-token bindings are included in the atomic Worker secret upload.
The Gate 7 prerequisite repair also uses the protected isolated `workers.dev`
origin for staging Auth callbacks and CORS; the unattached custom hostname is
not used before Gate 16.
An opt-in protected hosted-acceptance step now exercises the complete Gate 7
two-tenant, member Auth, Stripe test Checkout/webhook, and access-lifecycle
contract with uniquely scoped synthetic fixtures and cleanup. Its retained
artifact, rather than source presence, determines Gate 7 status.

The Gate 7 controller uses two reusable acceptance-only tenants, restores their
mutable billing state after every run, and fails if that restoration fails. It
consumes the real emailed PKCE link through a run-bound encrypted handoff and
uses only the current database time for global lifecycle reconciliation; only
fixture-local timestamps are compressed. This closes the review defects around
admin-minted non-PKCE links, audit-blocked deletion, and premature transitions
for unrelated staging tenants. Gate 7 remains pending until this repaired exact
head passes the protected staging run.

Protected staging run `31076438060` deployed the repaired candidate but stopped
at its first staff-cookie assertion: hosted Supabase SSR returned its valid
chunked cookie family while the controller checked only the unchunked base key.
The follow-up repair recognizes base and dot-suffixed chunks for staff/member
sessions without confusing the member-link state cookie. This is controller QA,
not evidence of an application login failure; Gate 7 remains pending a fresh
exact-head run.

The subsequent exact-head staging run `31077316417` was deliberately canceled
before its encrypted email wait. GitHub exposes completed job logs through the
API but not live ordinary log text, so the handoff public key was not observable
during the polling window. The controller now emits the same non-secret,
run-bound handoff payload as a live Actions notice for API retrieval. A fresh
exact-head package and staging run remain required.

Exact-head staging run `31077844811` then proved the base/dot-suffix assertion
repair but returned 401 on the next authenticated member-list request. The
hosted response folded both SSR cookie chunks into one `getSetCookie()` entry;
the controller retained only chunk zero. The follow-up repair splits every
entry before merging the jar, including safe handling of an `Expires` comma.
Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31081854654` reached the encrypted email wait, proving
the Stripe activation ordering and member magic-link request. It was canceled
after the live check-run annotations remained empty: GitHub publishes the
workflow-command notice only after the running step ends. The job now upserts
its run-bound identifier and ephemeral public key into the protected staging
variable `STAGING_HOSTED_ACCEPTANCE_MAGIC_LINK_HANDOFF`, polls the separate
encrypted-envelope variable as before, and removes the public handoff variable
when the wait ends. Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31078478629` proved that the controller now replays
both folded SSR cookie chunks, then exposed the application-side counterpart:
the production/staging auth-presence middleware recognized only the unchunked
base cookie name and rejected numeric `.0`/`.1` chunks before the authoritative
service-layer session validation. The follow-up repair parses cookie names and
accepts only the exact staff/member base names or numeric Supabase chunk
suffixes, with regressions rejecting similarly prefixed state cookies. Gate 7
remains pending a fresh exact-head run.

Exact-head staging run `31080464430` then passed both staff-session preflights,
the protected member-list request, and two-tenant native/API RLS isolation. It
stopped at the member magic-link request with HTTP 503 before an email handoff.
Because the endpoint intentionally maps two database failure branches to the
same status and error code, the controller now retains the sanitized structured
message as well as the code on failed HTTP assertions. Gate 7 remains pending
a fresh exact-head run that identifies and repairs the specific hosted RPC.

Exact-head staging run `31081178042` identified that branch as
`register_member_auth_link_context`: cleanup correctly restores the dedicated
fixture to `onboarding`, but member-link registration permits only `active` or
`grace` operational billing state. The controller now delivers and verifies
its already-required signed Stripe `active` event before requesting the member
magic link; the remaining duplicate/forged and degradation/recovery assertions
retain their existing order. Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31079570728` deployed the application-side chunk-cookie
repair but reproduced the service-layer 401. The remaining discrepancy is in
the controller's browser emulation: it retained `Set-Cookie` deletion records
as empty cookies, allowing a cleared legacy base cookie to shadow the valid
numeric session chunks during Supabase SSR reconstruction. The follow-up repair
honors `Max-Age=0` and expired deletion attributes and no longer counts empty
cookie values as an Auth family. Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31082627789` passed runtime, staff Auth, and two-tenant
RLS, then correctly rejected the emailed member action because Supabase had
replaced the requested staging Worker PKCE callback with its fallback origin.
The staging database hostname tunnels to the self-hosted Supabase stack on
Schubert, so its GoTrue `SITE_URL` and `ADDITIONAL_REDIRECT_URLS` now use the
exact `STAGING_WORKER_ORIGIN` callback namespace. The application also fails
closed on an explicit `signInWithOtp` provider error by revoking the failed
context while retaining the generic anonymous response.

Run `31087028401` then passed runtime, staff Auth, two-tenant RLS, and the real
emailed member PKCE callback/session. It exposed an acceptance-order defect:
the synthetic signed `active` webhook installed a non-provider subscription ID
before Checkout, so the application correctly rejected reconciliation. The
controller now creates and records the real Stripe test Checkout first, then
delivers the active webhook before member-link issuance and the remaining
billing lifecycle.

Gate 7 is now **live-passed**. Reviewed candidate
`530a003b91642ebf40af01468b10e444116ef632` was packaged by protected run
`31089609722` with artifact SHA-256
`46de1aecaa268736a00d06e3df5bd606305089152248681943405128719b7c1d`, promoted
to staging by PR #289, and deployed at 100% as Worker version
`3978a4da-e488-4887-9900-34f2673f0cb6`. Protected staging run `31089753727`
passed runtime identity/configuration, staff Auth, native/API two-tenant RLS,
real emailed member PKCE callback and cookie session, Stripe test Checkout,
signed webhook idempotency and lifecycle transitions, and reusable-fixture
cleanup. Sanitized evidence artifact `8963047777` records all six acceptance
checks plus cleanup as successful.

After retaining that evidence, the protected staging variable
`STAGING_HOSTED_ACCEPTANCE_ENABLED` was returned to `false`. Future staging
promotions must not rerun Gate 7 or request another member-email handoff unless
its evidence is being deliberately revalidated. Remaining hosted controllers
use one-shot gate-specific switches. The remaining-gates dependency audit also
confirmed Gate 13 must precede Gate 6: the real label path invokes the
fail-closed compliance adapter, and its test-only simulator is not valid hosted
compliance authority.

Gate 13 preparation now includes a main-only protected sandbox acceptance
controller, disabled empty exact-hash policy, dedicated fixture contract, and a
repair allowing `label_created` shipments to reach the database's existing
completed-attempt recovery disposition even if purchase-only provider/origin
configuration is unavailable. The controller now binds the candidate to
canonical `staging`, compares deployed runtime binding hashes, brand-scopes the
cross-tenant fixture, and requires structured timeout-specific evidence that
cannot be satisfied by a generic transport failure. Local QA passed 588/588 Vitest tests,
the 31-case delivery-policy suite, the production client build, and Worker
dry-run packaging. No ShipCompliant account, credential, fixture, provider
call, workflow dispatch, or hosted Gate 13 completion evidence was created.
The repository now has a separate `staging-acceptance-control` environment
restricted to `main`; Gate 13 uses it without broadening the staging deployment
environment's branch policy. Its Worker-origin variable is populated and its
one-shot Gate 13 toggle is `false`; external secrets are not yet provisioned.

The staging GitHub environment's global required-reviewer rule was removed on
2026-08-06. Its staging-only branch policy and all workflow-level
exact-candidate, target-policy, explicit-confirmation, health, rollback, and
one-shot gate controls remain active. Independent confirmation still applies
at production DNS, real-money, mobile-store, destructive, and legal-provider
boundaries.

The host backup command was also replaced with
`scripts/staging-db-backup.sh`. Its prerequisite check and a real custom-format
dump completed on 2026-08-05; the existing daily cron continues to call the
installed `/opt/supabase-staging/vinifera_backup.sh` path.

## Current production state

The public custom domain still serves the verified static Cloudflare Pages
prototype. A 2026-07-26 probe returned static HTML from `/api/health` rather
than the Worker JSON health contract, so the production application has not
replaced that baseline. Version 0.5.0 contains the complete Phase 1–5
connection-ready source architecture:

- The trusted Octopus PR bridge reports credential-value-free diagnostics for
  Access/API failures: visible-ASCII validation and character counts for the
  three authentication headers, plus the Octopus hostname and sanitized
  response provenance (`server`, `cf-ray` presence, media type, and redirect
  hostname). It never logs secret values, response bodies, query strings, or
  redirect paths. This preserves the trusted default-branch execution boundary
  and changes no hosted activation gate.
- Runtime signing/hash material is purpose-separated: rate-limit hashing and
  member-brand context signing require distinct, independently generated
  32-byte-or-longer secrets. Runtime configuration, staging activation, and
  production release guards all fail closed when either binding is missing,
  weak, whitespace-padded, or equal; no Supabase or static fallback remains.
- React 19 + Tailwind/Vite staff and member applications
- Express 5 API in a Cloudflare Worker with Static Assets
- Supabase Auth/PostgreSQL migration with forced tenant RLS
- Stripe test-mode subscription and webhook adapters
- Tenant-owned tiers, member CRM, release snapshots, shipments, recovery, fulfillment, and durable CSV import
- Stripe test-mode shipment PaymentIntents, retries, refunds, and an hourly resumable release runner
- Transactional UUID/SHA-256 command replay protection with atomic business,
  audit, result, and leased provider-outbox persistence; browser resumption
  stores no raw PII
- Same-brand composite integrity, complete scheduled-release aggregates,
  immutable Stripe event convergence, and bounded stale-refund recovery leases
- A final live-reference check before member provider-identity deletion
- EasyPost address/label adapter with fail-closed activation and a test-only deterministic simulator
- Durable Resend email outbox with lease-token completion, one stable provider
  key per logical message, bounded concurrency, early-webhook inbox,
  monotonic delivery convergence, six lifecycle triggers, and deterministic
  signed unsubscribe handling
- Explainable nightly churn snapshots, immutable/expiring four-step
  cancellation attempts, resumable pauses, command-idempotent loyalty
  mutations, paginated ledgers, and FIFO point lots
- Brand-complete Phase 3 defaults, composite organization/brand/member
  integrity, validated winery time zones, and an independent durable daily
  retention scheduler
- Operational-fact analytics, saved dashboard layouts, CSV exports, and
  scheduled summary reports
- A guarded L2 logistic training, scoring, A/B, drift, promotion, and
  rules-fallback lifecycle that cannot activate from synthetic evidence
- Estate/Reserve benchmark consent, k-anonymous aggregate publication, and
  quarterly report generation
- A ShipCompliant provider adapter, audit ledger, post-charge/pre-label guard,
  compliance-input fingerprints, and durable EasyPost label recovery
- Brand-scoped tenancy with forced RLS, restricted staff grants, explicit
  privileged all-brand aggregates, member brand binding, and shared or
  independent billing state; the client tenant boundary remounts operational
  state on scope changes, keeps explicit all-brand analytics in the URL, and
  rejects late responses from a prior brand
- A common leased/idempotent connector framework for Klaviyo, QuickBooks,
  Avalara, and Meta with encrypted credential envelopes, reconciliation, and
  sanitized attempt logs; database generations serialize QuickBooks rolling
  refresh tokens across Worker isolates, while authorized same-brand mapping
  commands drive Klaviyo churn/list execution and QuickBooks membership and
  shipping references from the existing Integration page
- Stripe billing-subject Customer locks, opaque idempotent Checkout/portal
  attempts, one nonterminal Checkout per subject, and signed-webhook
  reconciliation from `awaiting_webhook`
- Recoverable signup bootstrap plus organization Customer creation when Stripe
  is connected; disconnected and uncertain writes remain explicit and use the
  same idempotent path later
- Owner/admin Team invitations with role-aware manager/staff denial and
  session-backed invite acceptance
- Consent-gated encrypted Meta attribution with withdrawal redaction and
  resumable integration/attribution/push envelope rotation
- Separately persisted QuickBooks shipping, Avalara wine/shipping mappings,
  exemptions, and filing snapshots
- Cloudflare for SaaS custom-hostname lifecycle and WCAG-validated white-label
  portal themes, a retry-safe hostname write ledger, staff brand controls, and
  per-brand Resend sender verification
- Capacitor iOS/Android projects with secure mobile magic-link exchange,
  rotating sessions, biometric relock, APNs/FCM adapters, barcode scanning,
  network recovery, single-flight token rotation, biometric offline cold-start
  access to minimized read-only data, and store-directed updates
- GitHub-hosted CI with conditional migrations, an isolated
  `vinifera-staging` Worker deployment, Android lint/debug/minified-release,
  and Playwright/axe QA
- Credential-independent hosted release controls: GET-only readiness, hashed
  staging/production target authorization, linked hosted pgTAP/RLS, a retained
  Pages rollback controller, and ephemeral signed mobile/internal-track
  workflows
- A Stripe test-only catalog controller that probes an account fingerprint
  without writes, then creates or verifies the four canonical recurring Prices
  only after tracked account authorization and exact confirmation
- Restricted environment credential references, provider target hash policies,
  and independently disabled credential-rotation and Stripe live-billing
  controls

The Worker is connection-ready but must not replace the Pages custom-domain
baseline until the hosted Supabase, Stripe, provider, DNS, physical-device, and
store activation checks in the phase QA reports pass.

## 2026-07-30 principal-orchestrator candidate delivery

The owner accepted the candidate-based delivery model in
`docs/decisions/2026-07-30-principal-orchestrator-candidate-delivery.md`.
This source branch makes it canonical and implements its first bounded unit:

- feature-branch pushes no longer trigger fast CI;
- draft PRs record terminal `draft_not_candidate` failure without dependency,
  build, test, browser, or preview work, preventing stale same-head success;
- ready, non-draft new PR heads retain the required `Dev fast checks` name and
  cancellable per-PR concurrency; exact manual candidates use the distinct
  `Manual exact candidate checks` context and must dispatch from their head;
- the classifier reports exact base/head, risk, surface, focused tests,
  browser applicability, and preview applicability;
- unknown paths are invalid, while authority-high-risk candidates require the
  trusted `octopus-review-required` boundary before the aggregate can pass;
- browser smoke runs only for frontend, routing, shared-client,
  accessibility-sensitive, or explicitly browser-risk paths;
- every candidate has an always-present `Feature preview decision`;
- frontend candidates retain a prebuilt artifact for trusted
  default-branch publication as exact-head `Frontend preview evidence`;
- the privileged publisher independently reclassifies the live exact diff,
  targets only preview branches of the non-production `vinifera-dev` Pages
  project, and never executes PR-head source beside Cloudflare credentials,
  trusts artifact applicability, targets the public `vinifera` project, or
  accepts reserved environment branch names;
- the Octopus bridge now uses Git-ref-qualified Config-as-Code routes and the
  flat `runbooks/pr-quality-gates.ocl` resource layout that the live project
  enumerates; five non-secret exact-PR inputs are prompted from Git-backed
  variables while `GitHubPAT` remains database-backed and sensitive; and
- review repairs are collected and batched for no more than two substantive
  repair/re-review cycles.

The pre-change external-control snapshot found zero open PRs, no rulesets, and
only `main` protected. The owner-authorized non-production update now protects
`dev` with strict `Dev fast checks`, PR-only updates, resolved conversations,
linear history, administrator enforcement, and no force-push or deletion.
Default Actions permissions are read-only and workflow tokens cannot approve
reviews. `main`, `staging`, and protected environment settings were not
changed; the exact before/after payloads and rollback procedure are recorded
in `docs/build-specs/github-governance-snapshot-2026-07-30.md`.

The trusted preview publisher cannot receive `workflow_run` events until the
reviewed definition reaches the default branch. Therefore the direct
Cloudflare Pages preview integration remains enabled as a bootstrap fallback.
After one ready frontend candidate proves an immutable preview and one backend
candidate proves non-applicability, disable automatic Pages preview
deployments and then require `Frontend preview evidence`. Do not reverse that
order.

Current remote evidence on 2026-07-31 is `dev` at `55449cbe53e5`, `staging`
at `c3b9df3dac84`, and `main` at `3a688968a1e3`, with no open pull requests.
The principal-orchestrator candidate, trusted development auto-merge, and
immutable release controls are source-complete on `dev` but remain inactive
until their trusted controllers reach the default branch and their protected
environments are provisioned.

The original nightly Octopus failure (`30606684736`) was a first-request HTTP
403. Redacted reproduction identified Cloudflare browser heuristics and stale
repository credentials. The already-scoped service token was renewed, GitHub
and the private vault were synchronized, a hostname-only rule disabled Browser
Integrity Check for `octopus.schubert.life`, and zone Bot Fight Mode was
disabled because this plan cannot bypass it for machine traffic. Access logs
and direct probes now prove the non-identity policy reaches Octopus; Access and
AI-bot controls remain active.

The next trusted `main` rerun (`30626572282`) crossed that boundary and exposed
HTTP 400 on the obsolete database-backed
`/projects/Projects-1/runbooks` route. The pending repair uses the exact
Config-as-Code `refs/heads/main` preview, snapshot-template, and grouped-run
contract. A real local invocation queued and passed the Security Audit
runbook. Scheduled GitHub execution remains pending until this trusted bridge
repair reaches `main`; Pages checks remain static build evidence only, and
Worker activation jobs remain disabled or skipped.

PR #67 (`ci/octopus-audit-readiness-reconcile → dev`) was first reviewed at
head `0a12bce`.
Exact-head fast run `30627097438` passed. Trusted Octopus run `30627097321`
crossed Access but failed because the main-ref inventory does not expose `PR
Quality Gates`; the same exact review passed from the maintained `dev` ref.
The PR remains human-review required and must not be treated as merge- or
promotion-ready until the trusted main-ref status is green.

This governance and CI work does not deploy a Worker, change DNS, activate a
provider, mutate hosted data, enable billing, access production customer data,
or mark any activation gate complete. All 20 gates below remain pending.

## 2026-07-29 two-speed delivery governance

The current delivery contract is defined by
`docs/decisions/2026-07-29-two-speed-delivery-governance.md`. It supersedes
older process descriptions below where they say every feature PR requires full
CI, Octopus, CodeRabbit, or automatic `dev → staging` readiness after each
`dev` push.

- Routine feature branches and PRs to `dev` use the always-present
  `Dev fast checks` aggregate. The fail-closed classifier selects
  documentation, routine, or high-risk focused work.
- Cloudflare Pages preview runs independently and records a branch alias plus
  immutable deployment URL. Preview evidence is not stable-dev, staging,
  production, database, or provider evidence.
- Consolidated `dev → staging`, `staging → main`, protected releases, and
  explicit full runs retain the exact
  `Type, test, build, and package` aggregate.
- `dev → staging` promotion starts manually or through an explicitly
  owner-authorized workflow. It does not start after every `dev` push.
- Octopus is required for the promotion comparison and available by request
  for high-risk feature work. It does not run automatically for every routine
  `dev` PR.
- CodeRabbit is optional and non-blocking while unavailable or rate-limited.
  Any substantive findings it does produce still require disposition.
- One logical PR or promotion receives one consolidated changelog entry. WIP
  commits are allowed only on an isolated feature branch and are squash-merged
  into `dev`; the final logical commit records a substantive body and exact
  verification.
- ADRs are required only for architectural, security, deployment,
  database-policy, or governance decisions.
- Staging and production remain exact-revision, protected operations.
  Standing owner authorization does not bypass environment controls, target
  hashes, confirmations, privacy, rollback, or a stop label at the exact
  consequential boundary. `human-review-required` does not suppress safe
  diagnosis, repair, review, preview, or evidence collection;
  `do-not-merge` remains an absolute merge prohibition.

Evidence must be reported as one of: local validation, fast GitHub validation,
full GitHub validation, preview deployment, staging deployment, production
deployment, or hosted/provider readiness. An HTTP 200 or healthy static page is
not sufficient environment evidence; hosted verification requires the expected
marker, build SHA/artifact digest, and API health contract.

Stable addresses remain:

- Dev: `https://vinifera-dev.edstratumlabs.ai`
- Staging: `https://vinifera-staging.edstratumlabs.ai`
- Live: `https://vinifera-live.edstratumlabs.ai`
- Marketing/static rollback: `https://vinifera.edstratumlabs.ai`

Feature preview URLs supplement the stable addresses. Cloudflare Access must
protect dev or preview surfaces that expose non-public application or test
data. Development and staging cannot use production credentials or production
customer data.

This implementation changes source governance and delivery workflow only. It
does not merge or promote an environment branch, provision a hosted target,
activate a provider, deploy an environment, move DNS, enable billing, or mark
any of the 20 activation gates complete.

## 2026-07-28 comprehensive UI testing mission

The original UI evidence is in
`docs/build-specs/ui-test-report-2026-07-28.md`. The authoritative cross-agent
attribution, merge audit, repair chronology, verification, waiver, blockers,
and next-step handoff is
`docs/build-specs/merge-cleanup-regression-audit-2026-07-28.md`. The mission
opened manifest PR #27, fifteen isolated defect PRs #28–#42, and report PR #43,
all against `dev`. PRs #27–#28, #31–#34, and #36–#43 were squash-merged. PRs
#30 and #35 were closed after direct resolution commits.

- Baseline `dev` at `4d0ba11` passed 448/448 checks and 145/145 Playwright
  tests.
- Local integrated snapshot `72d85f82d96384334f066763f5a2ee5d31744699`
  passed 454/454 checks and a final complete 149/149 Playwright run.
- Authenticated Jeff - Pro Chrome spot checks at mobile and desktop reported
  zero axe violations, horizontal overflow, or console errors.
- The 14 squash merges are patch-identical to their reviewed PR diffs. The
  direct PR #30/#35 resolutions were not: they replaced current files, restored
  six obsolete marketing CTA destinations, and deleted merged Phase 1/5
  regression assertions. PR #49 repaired the WCAG focus/touch-target source;
  PR #51 restores the remaining signup behavior and recombines all deleted
  assertions with the intended pricing and HTTPS-logo changes. The restored
  trial links remain on pricing unless `/api/health/configuration` reports
  application-origin, database, and authentication-email readiness; generic
  runtime health alone cannot expose a signup route that is guaranteed to fail.
- Octopus still does not run on `dev` PRs because `pull_request_target` loads
  the workflow from GitHub's default branch. The current remote `main` head
  (`c5639547746a` at the 2026-07-29 audit) retains the old
  `pull_request`/main-only
  workflow and nonexistent action reference; the corrected
  `pull_request_target` definition visible on `dev` is not default-branch
  runtime code. The secure workflow and runbook bridge must be promoted to
  `main` before Octopus can be a real dev/staging gate. This implementation
  does not perform that promotion: after its feature PR is merged to `dev`,
  the owner must use the existing protected/manual path to place the reviewed
  bridge on `staging` and then `main`, configure the main-only
  `promotion-control` environment, and only then require the new contexts.
  The environment was created on 2026-07-29 with owner review and a custom
  `main`-only deployment branch policy, but its promotion PAT and staging
  probe secrets remain unset until the owner moves them from repository scope.
  The corrected bridge
  publishes its trusted runbook outcome as an explicit status on the PR head,
  because `pull_request_target` check runs attach to the base revision. The
  promotion gate additionally requires check-run association with the current
  PR, evidence timestamps no older than the current readiness attempt, and an
  Octopus description naming that PR. These bindings prevent a recreated PR
  at the same SHA from inheriting stale results. CodeRabbit is no longer part
  of this required evidence boundary under the 2026-07-29 policy. The
  runbook receives the event head SHA, base ref, and base SHA as required
  prompts and refuses checkout if GitHub's live PR metadata differs. Its
  aggregate and per-commit diffs are generated from the fetched immutable
  merge-base/head objects rather than mutable PR API artifacts. The published
  status attests the base SHA, which promotion captures and revalidates through
  its final readiness check. Rules 1–3 now require the task state and inspect
  tracked TypeScript with `git grep`, preventing missing-state false success
  and symlink traversal into the Octopus host.
  Octopus Deploy's authenticated `main` project view also shows no published
  runbook.
- Cloudflare Access now has one scoped `Vinifera GitHub Actions — Octopus`
  Service Auth policy on the Octopus application, selecting only the
  `Vinifera GitHub Actions` service token. The token has a one-year duration,
  and its client ID and one-time secret are installed as the encrypted
  `OCTOPUS_CF_ACCESS_CLIENT_ID` and `OCTOPUS_CF_ACCESS_CLIENT_SECRET` GitHub
  Actions secrets; neither value is recorded in source. The existing human OTP
  policy is unchanged.
- `.coderabbit.yaml` enables CodeRabbit auto-review for `dev` and `staging`,
  but the service is rate-limited. CodeRabbit is now optional and non-blocking;
  available substantive findings still require disposition. Full CI, Octopus
  promotion review, staging, and production controls remain independent.
- Remote branch cleanup was initially incomplete: the merged governance and
  WCAG branches remained after the report claimed only `main`, `dev`, and
  `staging`. The audit verified PRs #49/#50 were merged and then deleted both
  stale remote branches; only the active repair branch now supplements the
  three environment branches.
- Automated `dev → staging` readiness remains fail-closed because the isolated
  staging Supabase target and `STAGING_SUPABASE_URL` /
  `STAGING_SUPABASE_ANON_KEY` Actions secrets do not yet exist. Exact-head
  review also proved GitHub's merge API cannot atomically bind an expected base
  SHA, so the workflow now leaves every validated promotion PR open for a human
  merge. Normal and dry-run readiness both refresh the complete head/base,
  CI/status, review, and thread evidence after the second provider probe. Each
  readiness attempt has a timestamped PR marker; CI must name the captured base
  and head, and statuses/reviews must be newer than that attempt. Quality CI
  handles the marker's `edited` event, guaranteeing a fresh run when the
  promotion head itself has not changed.
- GitHub Actions run `30407043361` passed the full and Android lanes plus the
  required aggregate for controlled-review-freeze head `8c7341e`. An earlier exact-head Codex
  review found that checkout did not persist `MERGE_BASE_SHA` for the isolated
  Rules 4–10 Octopus action; the follow-up repair persists it in task-scoped
  state. The following review also found that an unchanged head could be
  reviewed against a temporarily switched base; the bridge now requires the
  event's base ref and SHA to match live metadata. The controlled audit then
  found reduced-motion, hidden-focus, Worker marketing-CSP, and Rules 1–3
  host-boundary defects;
  their consolidated repair passed 490 Vitest tests, all five embedded
  database suites, 153 Playwright/axe tests, Worker and Pages builds, mobile
  identity, compile-only mobile-web preparation, actionlint 1.7.12, and a
  manual 375-pixel check in the Jeff Pro Chrome profile. Exact-head CI run
  `30408522282` passed, but the final Codex review correctly
  found that Rules 1 and 3 still converted operational `git grep` errors into
  false passes. The owner authorized one bounded correction batch. That local
  batch now preserves operational failures, resolves Rule 2 imports relative
  to tracked source blobs, binds check creation as well as start time to the
  readiness attempt, self-hosts Lucide under `script-src 'self'`, and hardens
  fragment navigation. The final local matrix passed 492 Vitest tests, all
  five embedded database suites, the independent clean-seed check, 153
  Playwright/axe tests, both static and Worker builds, mobile identity,
  Android synchronization, actionlint, and a fresh desktop/375-pixel Jeff Pro
  Chrome inspection. One final exact-head CI/Codex review remains mandatory
  after the single authorized push. Octopus has not run, so PR #51 is not yet
  merge-ready.
- Open product/API decisions include the retention attempt list, a staff
  loyalty Redeem action, Team roster data, the Owner invitation security
  contract, the single-brand switcher, mobile dashboard spacing, CSV browser
  transport proof, and the `/app/signup` cutover boundary.

All 20 activation gates remain pending. No provider, hosted-data, migration,
billing, email, push, deployment, or merge activation occurred.

## Runtime architecture

| Route | Implementation |
|---|---|
| `/`, `/guide/*` | Existing static marketing and guide assets |
| `/app/*` | React staff application |
| `/portal/*` | React member portal |
| `/api/*` | Express backend-for-frontend |
| `/.well-known/*` | Worker-generated Apple/Android app association documents |
| hourly cron | access reconciliation, releases/retries, email claims, churn, loyalty, analytics, connector sync/reconciliation, and mobile push |

Web staff and member JWTs live only in distinct secure HTTP-only cookies.
Winery Klaviyo, Avalara, and Meta credentials and QuickBooks connection tokens
are authenticated encrypted database envelopes whose wrapping key remains a
Worker secret. Production dashboards contain no mock rows.

## Source map

```text
web/                    Vite entry
src/client/             React application
server/                 Express API, provider adapters, Worker entry
server/integrations/    Provider, domains, mobile auth, and push transports
server/services/        Domain services plus compatibility and public barrels
supabase/migrations/    PostgreSQL source of truth
supabase/tests/         pgTAP schema, RLS, and RPC suites
tests/server/           API integration tests
tests/e2e/              Playwright/axe browser QA
android/                Capacitor Android source shell
ios/                    Capacitor iOS source shell
mobile/                 Native security and deep-link documentation
mobile/app-identity.json Canonical cross-platform ID and version contract
docs/decisions/         Architecture decisions
docs/build-specs/       Sequential phase specifications and QA reports
wrangler.jsonc          Worker/static assets/cron/queue configuration
```

The extensionless root `app` file is the accepted visual prototype. It is
copied only when Cloudflare Pages injects `CF_PAGES=1`, preserving the public
rollback baseline; Worker builds omit it and serve React at `/app/*`.

## Release evidence

- The previous docs/full classifier and full aggregate on routine PRs are
  historical. The 2026-07-29 two-speed contract now gives routine feature PRs
  `Dev fast checks`, preserves `Type, test, build, and package` for promotion,
  and selects Android only for mobile-relevant or explicitly scheduled/full
  work. Required aggregates remain `if: always()` fail-closed policy gates;
  skipped optional work cannot leave them pending, and skipped required work
  cannot be treated as success.
- PR ownership remains a terminal agent condition, but the applicable gate now
  depends on delivery level. Five precedence-ordered labels scope recurring
  monitoring; `human-review-required` pauses merge, promotion, deployment,
  and the specific owner decision while safe repair/evidence work continues;
  `do-not-merge` is an absolute merge prohibition. Standing owner authority
  covers routine reversible delivery through protected controls but cannot
  bypass a stop label at its consequential boundary.
- Risk-based development merge source is defined by
  `.github/delivery-risk-contract.json`,
  `.github/scripts/dev-automerge-policy.mjs`, and
  `.github/workflows/dev-automerge.yml`. It accepts only current-base,
  same-repository, low/medium-risk `dev` PRs with `codex-auto-merge`, exact
  successful required/preview contexts, and zero unresolved threads, then
  repeats the decision before exact-SHA squash merge. It remains inactive
  until the trusted workflow reaches the default branch.
- The pre-change GitHub configuration and rollback are recorded in
  `docs/build-specs/github-governance-snapshot-2026-07-30.md`. `dev`
  protection and read-only default Actions permissions are the intended live
  non-production settings; production controls are unchanged.
- Development Worker automation is source-complete but
  `prepared_disabled`. `Development deployment candidate` is unprivileged;
  `Development Worker release` runs trusted default-branch code, builds one
  immutable prebuilt bundle/assets package, requires a known rollback version,
  deploys only `vinifera-development`, verifies exact health/configuration,
  staff/member/tenant boundaries and desktop/375 rendering, and rolls back on
  failure. Activation blockers and rollback are in
  `docs/runbooks/development-worker-release.md`.
- `Package selected release candidate` packages one current `dev` head only
  after the maintained `dev → staging` PR has exact full CI and Octopus
  evidence and while that promotion PR remains open. The exact package must
  succeed before the promotion merge; a closed promotion PR is deliberately
  ineligible for later packaging. The protected staging and production upload
  paths consume that exact manifest-bound bundle/assets package with
  `--no-bundle`; no rebuild is allowed during deployment.
  `Delivery Control Center` maintains one low-noise GitHub issue and separates
  implemented, CI-verified, deployed, and live-verified state.
- The 20 pending activation gates are sequenced into private synthetic beta,
  restricted live winery pilot, and GA without changing any gate status.
- The repository README now displays the CodeRabbit pull-request review badge,
  making automated review coverage visible without changing application,
  deployment, provider, or activation behavior.
- BS-03 decomposes the two service monoliths into member, club, order,
  analytics, Stripe, EasyPost, communications, webhook, and shared
  provider-runtime modules. `core-club.ts` and `integrations.ts` are now
  re-export-only compatibility barrels, and internal runtime consumers plus
  the system association route use direct domain imports. The integration
  preserves the complete 129-route BS-02 manifest, BS-04 Sentry/rate-limit
  middleware boundaries, and BS-06 mobile-bootstrap organization/brand
  predicates. This extraction changes no provider activation, deployment
  configuration, or static production surface. The integrated branch passes
  the direct-push policy 12/12, dependency audit 0, generated Worker type check,
  TypeScript, Vitest 388/388, database gates 92/250/199/158/513, Vite and Pages
  builds, default/staging/production Worker dry runs, Playwright/axe 145/145,
  mobile identity, mobile-release controls 7/7, and a non-routable compile-only
  Capacitor web bundle plus Android sync. Exact-head review additionally
  centralizes neutral concurrency, integration-pattern, and Supabase-admin
  primitives; narrows APNs activation deferral; binds EasyPost recovery to the
  persisted rate; validates QuickBooks lease generations; corrects the member
  address auth-user identity; and preserves integration-job completion while
  logging health-update failures. Focused review regressions pass 114/114 and
  the shared concurrency helper now rejects invalid limits without skipping
  `undefined` inputs. The 18-service/37-edge graph remains acyclic. This Mac has
  no Java runtime, so Android lint/assemble remains CI evidence rather than a
  local claim.
- The review-hardening branch closes the remaining aggregate-integrity,
  unsubscribe-privacy, direct-push timeout, checkout-credential, and setup
  documentation findings without changing provider activation. Release PATCH
  retries now preserve validated existing `release_wines.id` values through
  forward migration `202607260022_release_wine_identity_replay.sql`, allowing
  an exact lost-response retry to reach the durable command replay while
  rejecting create-time, duplicate, cross-brand, cross-release, or otherwise
  foreign wine IDs. The current branch passes the direct-push policy 12/12,
  dependency audit 0, generated Worker bindings, TypeScript, Vitest 382/382,
  database gates 92/250/199/158/513, focused production/mobile/catalog
  controls 14/7/16, mobile identity, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
  Hosted Supabase native pgcrypto/pgTAP verification and all provider-backed
  activation evidence remain pending by design.
- BS-06 audits every database-calling function in `server/services/` against
  its then-current 21-migration tenancy model. It adds explicit organization
  and brand predicates to all mobile offline-bootstrap reads, a focused cross-brand
  query assertion, CODEOWNERS, a PR template, governance and Greptile guidance,
  and current architecture documentation with all 20 activation gates pending
  at that review point. The branch is integrated with the direct-push guard and
  BS-02/BS-04
  route and observability baseline. The integrated branch passes the direct-push
  policy 9/9, dependency audit 0, Worker type generation, TypeScript, Vitest
  378/378, database gates 92/231/199/158/494, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
  No provider, hosted database, Worker, or production activation state changed.
- BS-02 decomposes all 129 Express registrations from the monolithic
  `server/app.ts` into domain-scoped `server/routes/` modules. The 82-line app
  entry point now retains only global middleware and ordered route mounting.
  BS-04 rate limits execute before every public/raw-webhook and protected route,
  and the centralized BS-04 error handler is the final middleware after the
  `/api` 404 boundary. Mechanical route/schema/handler comparison and the full
  credential-independent verification suite pass with no route, deployment, or
  provider activation behavior change. As of 2026-07-27, the current integrated
  BS-02 review branch passed the direct-push policy 9/9, dependency audit 0,
  generated Worker binding check, TypeScript, Vitest 377/377, database gates
  92/231/199/158/494, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
- The BS-02 review follow-up adds the route-decomposition ADR and closes
  route-boundary findings for release consistency, partial template defaults,
  email normalization, callback redirects, raw webhook bodies, explicit
  loyalty validation, shared UUID schemas, order-sensitive mounts, and bounded
  multipart CSV framing. Cloudflare client-address headers are trusted only in
  staging/production for route audit fields and rate-limit actor keys; direct
  development/test requests use the socket address. The multipart path remains
  pre-buffered and Cloudflare Worker-compatible; no unproved Node stream
  middleware was added.
- Direct-push governance now supplies the required
  `Block direct push to main` context on pull requests and verifies each
  resulting `main` push against GitHub's associated-pull-request evidence. It
  requires the exact recorded merge result for a closed PR targeting `main`,
  supports merge, squash, and rebase strategies, and rejects forced updates,
  conventional-commit heuristics, missing evidence, and API errors. Branch
  protection remains the pre-push enforcement boundary. Associated-PR lookup
  follows up to ten validated same-origin pages and retries missing index
  evidence twice over 20 seconds before failing closed.
- BS-01 repository hygiene migrates Greptile review policy from the legacy
  root JSON file to scoped `.greptile/` configuration and rules, removes the
  generated Worker declaration from version control while regenerating it
  before CI verification/typecheck, and records the Phase 5 closure evidence
  plus all 20 activation gates, which were pending at that review point. These
  changes do not alter runtime routes, provider activation, or the static
  production baseline.
- BS-04 adds a credential-independent error-observability and API-abuse
  boundary: optional PII-minimized Sentry capture at the Worker entry point, a
  centralized request-correlated Express error handler registered last, and
  native Cloudflare rate limits scoped by normalized route plus tenant and
  hashed actor. Sentry remains inactive without its Worker secret; the static
  production baseline remains unchanged.
  Its pre-BS-02 historical local verification passed audit 0, generated Worker
  types, TypeScript,
  367/367 Vitest tests, Vite and Pages builds, development/staging/production
  Worker dry runs, and 145/145 Playwright/axe cases including 375-pixel and
  touch-target coverage.
- The BS-01 review follow-up makes fresh-checkout local validation
  self-generating, restores public browser bootstrap for the existing member
  authentication endpoints without weakening protected-route enforcement, and
  aligns the Phase 1–2 browser fixtures with the current brand/overview
  contracts.
- BS-05 provides a pinned, single-command local Supabase/Worker/Vite workflow,
  schema-valid synthetic two-tenant fixtures, loopback-only Auth bootstrap,
  authenticated isolation smoke checks, and the 20-gate readiness ledger.
  The integrated 22-migration chain and deterministic seed replay twice, the
  full Vitest suite passes 448/448, and TypeScript passes. The same integrated
  head also passes the native Supabase CLI 2.109.1 reset/seed and real
  Worker/Auth flow with a populated nine-member Sunrise roster,
  Pacific-to-Sunrise 403, member session, local magic-link callback with an
  HTTP-only cookie, populated portal shipment history, desktop/375px UI, touch
  targets, zero axe-core violations, and fail-closed shutdown cleanup. That is
  partial local prerequisite evidence for Gates 1, 7, and 15; all 20 composite
  activation gates remain `pending` until their complete hosted or provider
  criteria are proved.
- Phase 1–4 local architecture gates and the 94-test browser regression were
  recorded as passing in their phase QA reports.
- Version 0.5.0 aligns the package, Android, and iOS source release and contains
  Phase 5 database, service, client, responsive/axe, and native-shell test
  coverage.
- `npm run qa:mobile:identity` enforces cross-platform application IDs,
  versions, link allowlists, APNs entitlement modes, Gradle integrity, privacy
  declarations, and replacement of the default Capacitor artwork.
- CI is configured for Node 22.22.0, Phase 1–5 embedded database gates,
  generated Worker type validation, Worker dry-run, browser QA, Java 21/Android
  API 36 lint plus debug/R8 release APK assembly, and pinned Supabase CLI
  2.109.1.
- Optional Worker deployment targets only the isolated `vinifera-staging`
  environment, requires hash-authorized targets, runs hosted pgTAP/RLS, attaches
  available secrets atomically, and requires the core configuration report.
- Production Worker bootstrap/version/deploy/Worker rollback is wired as a
  protected manual workflow. The standard dispatch no longer exposes legacy
  domain cutover or Pages restoration. Rollback keeps current `main` as the
  control authorization and independently verifies a prior reviewed release
  SHA plus a previously sole-active Worker version. Account and Worker-origin
  hashes remain empty, so no production mutation can run yet.
- Signed Android/iOS build and Play internal/TestFlight delivery are wired as a
  protected manual workflow. Normal CI remains explicitly compile-only.
- Commit `5cc1bda` passed the complete GitHub quality and Android run
  `30217201984`. The mutation jobs skipped because staging activation remains
  off.
- Read-only hosted run `30217462802` confirmed the generic Supabase and Stripe
  test credentials are reachable. The Supabase Phase 1/5 tables do not yet
  exist, Stripe still needs all four test Prices and its webhook secret, and
  the current Cloudflare token is valid but lacks Workers read capability.
- Stripe test-catalog probe
  [`30218422165`](https://github.com/theonlygeranium/vinifera/actions/runs/30218422165)
  passed against the generic test credential without a provider write. Its
  sanitized account SHA-256 fingerprint is now tracked. Protected bootstrap
  [`30218801133`](https://github.com/theonlygeranium/vinifera/actions/runs/30218801133)
  failed closed after its first idempotent provider create because the create
  response did not expand the Product; the controller now requests that
  expansion. Treat the first Price as created-or-unknown. Service connections
  are deferred, so no retry was attempted; reconcile the fixed lookup key only
  when activation is explicitly resumed.
- The historical pre-BS-01/BS-02 credential-independent architecture gate
  passed: dependency
  audit 0, generated Worker types and TypeScript green, Vitest 354/354,
  database gates 92/231/199/158/494, and Playwright 145/145 with zero axe
  violations and 360/375/412/430/768/1440 Phase 5 coverage. The single-worker
  100-member roster renders in 444.6 ms, Phase 5 LCP is 416 ms, CLS is 0, and
  multi-brand readiness is 920 ms. Phase 4 scores 10,000 members inside its
  five-minute gate, renders its 365-day dashboard inside two seconds, and
  renders five charts 24.20 ms after the response. Pages plus
  development/staging/production Worker dry-run builds pass, as do production
  release 14/14, mobile release 7/7, Stripe catalog 16/16, mobile identity, and
  compile-only Capacitor Android/iOS sync. Provider transports remained
  injected; no provider was contacted.
- Architecture commit `5d36471` passed GitHub Actions run
  [`30221722696`](https://github.com/theonlygeranium/vinifera/actions/runs/30221722696):
  quality completed in 5m23s, Java 21 Android lint/debug/minified release
  assembly completed in 4m37s, and credential-gated migration/deployment jobs
  skipped. This Mac still has no local Java runtime.
- Phase 1 architecture closure commit `a27f078` passed GitHub Actions run
  [`30223237016`](https://github.com/theonlygeranium/vinifera/actions/runs/30223237016):
  quality completed in 5m43s, Android lint/debug/minified release completed in
  4m44s, the 90-day `playwright-evidence` artifact was retained through
  2026-10-24, and hosted migration/deployment skipped while activation remains
  off.
- Phase 2 architecture closure commit `15c9942` passed GitHub Actions run
  [`30226397256`](https://github.com/theonlygeranium/vinifera/actions/runs/30226397256):
  quality completed in 5m15s, Android lint/debug/minified release completed in
  3m39s, QA/native evidence uploaded, and hosted migration/deployment skipped
  while activation remains off.
- Phase 3 architecture closure commit `3b01c3a` passed GitHub Actions run
  [`30229260377`](https://github.com/theonlygeranium/vinifera/actions/runs/30229260377):
  quality completed in 6m22s, Android lint/debug/minified release completed in
  4m25s, QA/native evidence uploaded, the Pages rollback artifact validated,
  and hosted migration/deployment skipped while activation remains off.
- Phase 4 architecture closure commit `623dd2a` passed GitHub Actions run
  [`30232327146`](https://github.com/theonlygeranium/vinifera/actions/runs/30232327146):
  quality/browser QA completed in 6m49s, Android lint/debug/minified release
  completed in 4m19s, the Pages rollback artifact validated, and hosted
  migration/deployment skipped while activation remains off. The static custom
  domain now returns CSP, COOP, HSTS, frame-deny, and MIME-sniffing headers;
  `/api/health` still returns the static HTML shell until Worker activation.
- Phase 5 architecture closure commit `5d3dadd` passed GitHub Actions run
  [`30235083942`](https://github.com/theonlygeranium/vinifera/actions/runs/30235083942):
  quality/database/browser/Pages rollback completed in 5m39s, Java 21 Android
  lint/debug/minified release completed in 4m10s, QA/native evidence uploaded,
  and hosted migration/Worker deployment skipped because activation remains
  off.
- GitHub Actions artifact/log retention is configured at the allowed 90-day
  maximum, and Playwright login/signup captures at 375, 768, and 1440 are
  explicitly retained for 90 days. Android setup is pinned to v4.0.1/Node 24
  in normal CI and the protected mobile-release workflow.
- The GitHub `staging` environment is restricted to the `staging` branch;
  `production` and `mobile-release` remain restricted to `main`. All three
  require review by `theonlygeranium`; self-review is currently allowed
  because no second human reviewer is configured.
- The current Phase 5 evidence and any remaining local checks belong in
  `docs/build-specs/phase-5-qa-report.md`; do not copy pending checks here as
  passes.

The Phase 1–5 source architecture is complete. Hosted Supabase native
pgcrypto/pgTAP, provider round trips, real-data model/benchmark results, custom
DNS/certificates, Stripe live mode, signed physical devices, push delivery, and
internal store-track evidence remain required before the hosted operational exit
criterion can pass.

## Activation gates

Gate 16 now has a source-complete protected custom-hostname acceptance
controller. Its checked-in policy and one-shot switch remain disabled. It
requires exact target hashes and active Cloudflare ownership/certificate
evidence, then probes the intended brand plus distinct sibling and unknown
hosts; neither denied host may select any custom brand. The exact manifest hash
is supplied through protected state only after the candidate is immutable, so
candidate binding does not require a self-referential commit SHA.

The code must remain fail-closed until these external connections are active:

1. Add staging-environment Supabase management credentials, then set the
   exact project hash and repository variable
   `STAGING_SUPABASE_MIGRATION_ENABLED=true` to apply `supabase/migrations/`
   and run `supabase test db --linked`.
2. **Live-passed 2026-08-06:** the reviewed account hash, protected credential,
   immutable package, isolated `vinifera-staging` deployment, and exact runtime
   readiness contract passed in run `31073800654`.
3. Enable the custom access-token hook, 900-second email OTP expiry, Google OAuth, and SMTP.
4. When service activation is explicitly resumed, reconcile the
   created-or-unknown Stripe test Price from run `30218801133`, then
   bootstrap/verify the four recurring Prices without a blind retry, register
   `/api/billing/webhook`, and add its signing secret.
5. Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled.
6. Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof.
7. **Live-passed 2026-08-06:** protected run `31089753727` passed the complete
   hosted two-tenant RLS, staff, real emailed member magic-link, Stripe test
   Checkout, signed-webhook lifecycle, grace/restriction/suspension/recovery,
   and reusable-fixture cleanup contract for exact candidate
   `530a003b91642ebf40af01468b10e444116ef632`.
8. Verify a Resend sending domain, signed webhook, and at least two real staging triggers.
9. Apply Phase 4 migration 15 to hosted Supabase and run the 37 current-stack
   pgTAP assertions plus native tenant/RPC tests.
10. Connect a winery with real Phase 2/3 operations and verify every analytics
    metric and CSV export against source records.
11. Configure a dedicated active `ML_PLATFORM_ACTOR_USER_ID`, accumulate at
    least 500 labeled members and 50 cancellations, reconcile all six source
    families, dry-run and execute `ops:phase4:qualify-ml`, train on production
    history, meet held-out AUC-ROC 0.82 without underperforming rules, and
    complete the superior 30-day A/B gate before actor-audited promotion.
12. Opt an Estate/Reserve winery into a peer cohort with at least ten
    contributors and verify the quarterly report delivery.
13. Obtain vendor-approved ShipCompliant sandbox access, set the server-only
    credential and contract bindings, and prove compliant, non-compliant,
    unknown, timeout, tax, fingerprint invalidation, and label recovery cases.
    A default-disabled protected acceptance controller and its empty exact-hash
    policy are source-complete on the Gate 13 preparation branch. It also fixes
    the service guard that previously prevented the existing completed-label
    recovery RPC from being reached. No vendor account, fixture, dispatch, or
    hosted completion evidence exists yet.
14. Provision the integration credential keyring, then validate winery-specific
    Klaviyo, Avalara, and Meta envelopes and the QuickBooks application OAuth
    plus encrypted per-connection token lifecycle.
15. Create two production-like brands and prove database plus service-role
    cross-brand isolation, shared/independent billing, and hostname-derived
    member context.
16. Add one winery custom hostname, complete DNS ownership and certificate
    activation, and verify sibling/unknown hosts cannot select its brand.
17. Configure APNs and FCM, Apple/Google signing, privacy/store metadata, and
    prove magic links, secure storage, biometrics, push, camera, offline restore,
    and relock on physical devices.
18. Install signed builds from TestFlight and the Play internal track.
19. Replace Stripe test keys with approved live keys only under human
    supervision and run one controlled charge/refund.
20. Move the production custom domain only after every hosted exit criterion is
    evidenced.

Credential and target setup details are in
`docs/runbooks/hosted-environment-provisioning.md`. Domain rollback is in
`docs/runbooks/production-cutover-rollback.md`; signed distribution is in
`docs/runbooks/mobile-store-release.md`.

See `.env.example` and `docs/setup.md` for exact variable names. Never print or commit values.

## Build and QA

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run build:worker:production
npm run qa:mobile-release
npm run qa:production-release
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:db:phase5
npm run qa:mobile:identity
npm run qa:e2e
npm run build:mobile:web
npm run build:mobile:android
```

The human supervisor directed the team to complete architecture now and connect
services later. Keep every deferred provider fail-closed; do not retry the
uncertain Stripe catalog write, populate target policies, dispatch provider
mutations, or describe a hosted exit criterion as passed without explicit
activation authority and redacted runtime evidence.
# Vinifera — Agent Continuity Brief

**Last updated:** 2026-08-07
**Purpose:** Current handoff for any engineer or agent continuing the production build.

## 2026-08-07 Automated approvals — LOCKED owner decision

The owner explicitly authorized automating reversible delivery approvals and
reducing human gates to an alert-only model. See ADR
`docs/decisions/2026-08-07-automated-approval-delegation.md` and `AGENTS.md` §11.
`dev → staging` is now auto-dispatched by
`.github/workflows/promote-dev-to-staging-auto.yml` (the fail-closed
`promote-dev-to-staging.yml` is unchanged); `.github/workflows/escalation-alert.yml`
pings the owner only on emergency labels or consequential protected workflow
requests. The reversible environments (`promotion-control`, `staging`,
`development-worker`) are intended to carry zero required reviewers;
`production` and `mobile-release` stay human-gated. **Do not reverse or
re-tighten this without the owner's explicit approval and a superseding ADR** —
a future agent may misread it as a security regression, but it is intentional.
Like the other controllers, the two new workflows are inert until they reach the
default branch and their secrets/environment settings are provisioned.

## Project identity

- Owner: EdStratum Labs
- Repository: `https://github.com/theonlygeranium/vinifera`
- Default branch: `main`
- Public domain: `https://vinifera.edstratumlabs.ai`
- Build specifications: `docs/build-specs/`

Read `AGENTS.md`, the phase specification, and this brief before editing.

## 2026-08-06 Gate 15 core evidence repair

Gate 15 core implementation is now integrated into the canonical Gates 10–16
collector and its required 90-day artifact under the existing one-shot Gate 15
toggle. It authorizes the exact staging Worker and a separately reviewed
Supabase-origin hash before constructing clients, then exercises a run-scoped
two-brand organization across restricted staff/member RLS, owner aggregation,
independent sibling suspension, integration job claims, and ambiguous
same-email handling. Its cleanup ledger is registered before mutation, targets
exact organization/brand keys, attempts every dependency phase, and blocks the
report on any cleanup failure.

Cleanup independently reconciles the generated fixture emails to tagged hosted
Auth users before deletion, so a committed create with a lost response cannot
orphan an acceptance identity. Forward migration `202608060034` also rejects
null required scoped-claim arguments before any integration-job lease mutation.
The fixture job retains its historical queue timestamp only for deterministic
ordering and is leased at the current run time so the normal drain cannot
immediately reclaim it.

The checked-in Supabase-origin staging and production-deny hash lists remain
empty, so hosted Gate 15 execution is deliberately blocked until those exact
targets are reviewed. No variable was set and no hosted controller was run.
Successful future core evidence remains partial and records
`completionClaimed=false`; Gate 16 hostname-derived context is still required.

The trusted development auto-merge evaluator now stores paginated check-run
and commit-status responses in runner-local JSON files before exact evidence
selection. This fixes the runner argument-length failure observed on PR #291
without weakening PR/base/head binding or the immediate pre-merge check.

Promotion-smoke tests that create and compare three local Git branches use a
30-second per-test budget. The local-drill fixture uses the same bounded budget.
Their logic is unchanged; the prior 5-second default repeatedly timed out only
under concurrent full-suite filesystem load while the isolated suite passed
9/9.

## 2026-08-06 Gates 10-16 acceptance foundation

The protected staging deployment now supports independent opt-in readiness
reports for Gates 10 through 16. Each report verifies the exact deployed
candidate and only its gate's required configuration groups, retains a
sanitized 90-day artifact, and fixes `completionClaimed=false`. It does not
create or qualify the real winery, model, cohort, provider, multi-brand, or DNS
evidence required to change a gate status.

Gate 11's previously missing staging deployment binding is corrected:
`STAGING_ML_PLATFORM_ACTOR_USER_ID` is uploaded atomically as
`ML_PLATFORM_ACTOR_USER_ID`. Presence alone remains insufficient; the guarded
qualification path must prove that it identifies an active platform
super-admin. See `docs/runbooks/hosted-gates-10-16-evidence.md` and ADR
`docs/decisions/2026-08-06-hosted-gates-readiness-evidence.md`.

## 2026-08-05 hosted activation re-audit

The canonical Gate 1–5, 7, and 9 evidence was rechecked against the live
staging providers, database, and Worker rather than accepted from the prior
review. Gates 1, 3, 4, 5, and 9 are currently verified: all 30 migrations are in
the repaired Supabase migration ledger with a clean dry run; Auth retains the
custom hook, 900-second OTP, Google provider, and SMTP configuration; Stripe
accepted a resent signed subscription event exactly once; and EasyPost test
address verification remains deliverable with ZIP+4.

Gate 2 is live-passed. Protected run `31073800654` deployed immutable candidate
`f3512e7f36df7bc332ec3e59bca33c4153a835d4` as Worker version
`b3180ad7-64d6-440d-b609-09ee6e95bac5` in the dedicated staging account. The
retained runtime artifact and an independent live probe passed staging identity,
exact revision, core configuration, Stripe test catalog, and database-backed
branding checks. Gate 7 remains pending for the complete hosted acceptance
lifecycle. Before the repair, the stable staging Worker reported
`environment=production` and no revision;
member/tier requests failed because one Supabase client factory omitted the
Cloudflare Access service token; and native current-stack pgTAP files contained
stale JWT, seed-count, privilege, ML-attribution, qualification, and alert
assumptions. The repaired canonical native set passes 331/331 against the
hosted database. Forward migrations also repair release-shipment overload
resolution with end-to-end brand scoping, email-claim digest resolution, and
early-webhook reconciliation.
The staging deploy now requires `environment=staging` plus the exact promoted SHA,
and the service-token bindings are included in the atomic Worker secret upload.
The Gate 7 prerequisite repair also uses the protected isolated `workers.dev`
origin for staging Auth callbacks and CORS; the unattached custom hostname is
not used before Gate 16.
An opt-in protected hosted-acceptance step now exercises the complete Gate 7
two-tenant, member Auth, Stripe test Checkout/webhook, and access-lifecycle
contract with uniquely scoped synthetic fixtures and cleanup. Its retained
artifact, rather than source presence, determines Gate 7 status.

The Gate 7 controller uses two reusable acceptance-only tenants, restores their
mutable billing state after every run, and fails if that restoration fails. It
consumes the real emailed PKCE link through a run-bound encrypted handoff and
uses only the current database time for global lifecycle reconciliation; only
fixture-local timestamps are compressed. This closes the review defects around
admin-minted non-PKCE links, audit-blocked deletion, and premature transitions
for unrelated staging tenants. Gate 7 remains pending until this repaired exact
head passes the protected staging run.

Protected staging run `31076438060` deployed the repaired candidate but stopped
at its first staff-cookie assertion: hosted Supabase SSR returned its valid
chunked cookie family while the controller checked only the unchunked base key.
The follow-up repair recognizes base and dot-suffixed chunks for staff/member
sessions without confusing the member-link state cookie. This is controller QA,
not evidence of an application login failure; Gate 7 remains pending a fresh
exact-head run.

The subsequent exact-head staging run `31077316417` was deliberately canceled
before its encrypted email wait. GitHub exposes completed job logs through the
API but not live ordinary log text, so the handoff public key was not observable
during the polling window. The controller now emits the same non-secret,
run-bound handoff payload as a live Actions notice for API retrieval. A fresh
exact-head package and staging run remain required.

Exact-head staging run `31077844811` then proved the base/dot-suffix assertion
repair but returned 401 on the next authenticated member-list request. The
hosted response folded both SSR cookie chunks into one `getSetCookie()` entry;
the controller retained only chunk zero. The follow-up repair splits every
entry before merging the jar, including safe handling of an `Expires` comma.
Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31081854654` reached the encrypted email wait, proving
the Stripe activation ordering and member magic-link request. It was canceled
after the live check-run annotations remained empty: GitHub publishes the
workflow-command notice only after the running step ends. The job now upserts
its run-bound identifier and ephemeral public key into the protected staging
variable `STAGING_HOSTED_ACCEPTANCE_MAGIC_LINK_HANDOFF`, polls the separate
encrypted-envelope variable as before, and removes the public handoff variable
when the wait ends. Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31078478629` proved that the controller now replays
both folded SSR cookie chunks, then exposed the application-side counterpart:
the production/staging auth-presence middleware recognized only the unchunked
base cookie name and rejected numeric `.0`/`.1` chunks before the authoritative
service-layer session validation. The follow-up repair parses cookie names and
accepts only the exact staff/member base names or numeric Supabase chunk
suffixes, with regressions rejecting similarly prefixed state cookies. Gate 7
remains pending a fresh exact-head run.

Exact-head staging run `31080464430` then passed both staff-session preflights,
the protected member-list request, and two-tenant native/API RLS isolation. It
stopped at the member magic-link request with HTTP 503 before an email handoff.
Because the endpoint intentionally maps two database failure branches to the
same status and error code, the controller now retains the sanitized structured
message as well as the code on failed HTTP assertions. Gate 7 remains pending
a fresh exact-head run that identifies and repairs the specific hosted RPC.

Exact-head staging run `31081178042` identified that branch as
`register_member_auth_link_context`: cleanup correctly restores the dedicated
fixture to `onboarding`, but member-link registration permits only `active` or
`grace` operational billing state. The controller now delivers and verifies
its already-required signed Stripe `active` event before requesting the member
magic link; the remaining duplicate/forged and degradation/recovery assertions
retain their existing order. Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31079570728` deployed the application-side chunk-cookie
repair but reproduced the service-layer 401. The remaining discrepancy is in
the controller's browser emulation: it retained `Set-Cookie` deletion records
as empty cookies, allowing a cleared legacy base cookie to shadow the valid
numeric session chunks during Supabase SSR reconstruction. The follow-up repair
honors `Max-Age=0` and expired deletion attributes and no longer counts empty
cookie values as an Auth family. Gate 7 remains pending a fresh exact-head run.

Exact-head staging run `31082627789` passed runtime, staff Auth, and two-tenant
RLS, then correctly rejected the emailed member action because Supabase had
replaced the requested staging Worker PKCE callback with its fallback origin.
The staging database hostname tunnels to the self-hosted Supabase stack on
Schubert, so its GoTrue `SITE_URL` and `ADDITIONAL_REDIRECT_URLS` now use the
exact `STAGING_WORKER_ORIGIN` callback namespace. The application also fails
closed on an explicit `signInWithOtp` provider error by revoking the failed
context while retaining the generic anonymous response.

Run `31087028401` then passed runtime, staff Auth, two-tenant RLS, and the real
emailed member PKCE callback/session. It exposed an acceptance-order defect:
the synthetic signed `active` webhook installed a non-provider subscription ID
before Checkout, so the application correctly rejected reconciliation. The
controller now creates and records the real Stripe test Checkout first, then
delivers the active webhook before member-link issuance and the remaining
billing lifecycle.

Gate 7 is now **live-passed**. Reviewed candidate
`530a003b91642ebf40af01468b10e444116ef632` was packaged by protected run
`31089609722` with artifact SHA-256
`46de1aecaa268736a00d06e3df5bd606305089152248681943405128719b7c1d`, promoted
to staging by PR #289, and deployed at 100% as Worker version
`3978a4da-e488-4887-9900-34f2673f0cb6`. Protected staging run `31089753727`
passed runtime identity/configuration, staff Auth, native/API two-tenant RLS,
real emailed member PKCE callback and cookie session, Stripe test Checkout,
signed webhook idempotency and lifecycle transitions, and reusable-fixture
cleanup. Sanitized evidence artifact `8963047777` records all six acceptance
checks plus cleanup as successful.

After retaining that evidence, the protected staging variable
`STAGING_HOSTED_ACCEPTANCE_ENABLED` was returned to `false`. Future staging
promotions must not rerun Gate 7 or request another member-email handoff unless
its evidence is being deliberately revalidated. Remaining hosted controllers
use one-shot gate-specific switches. The remaining-gates dependency audit also
confirmed Gate 13 must precede Gate 6: the real label path invokes the
fail-closed compliance adapter, and its test-only simulator is not valid hosted
compliance authority.

Gate 13 preparation now includes a main-only protected sandbox acceptance
controller, disabled empty exact-hash policy, dedicated fixture contract, and a
repair allowing `label_created` shipments to reach the database's existing
completed-attempt recovery disposition even if purchase-only provider/origin
configuration is unavailable. The controller now binds the candidate to
canonical `staging`, compares deployed runtime binding hashes, brand-scopes the
cross-tenant fixture, and requires structured timeout-specific evidence that
cannot be satisfied by a generic transport failure. Local QA passed 588/588 Vitest tests,
the 31-case delivery-policy suite, the production client build, and Worker
dry-run packaging. No ShipCompliant account, credential, fixture, provider
call, workflow dispatch, or hosted Gate 13 completion evidence was created.
The repository now has a separate `staging-acceptance-control` environment
restricted to `main`; Gate 13 uses it without broadening the staging deployment
environment's branch policy. Its Worker-origin variable is populated and its
one-shot Gate 13 toggle is `false`; external secrets are not yet provisioned.

The staging GitHub environment's global required-reviewer rule was removed on
2026-08-06. Its staging-only branch policy and all workflow-level
exact-candidate, target-policy, explicit-confirmation, health, rollback, and
one-shot gate controls remain active. Independent confirmation still applies
at production DNS, real-money, mobile-store, destructive, and legal-provider
boundaries.

The host backup command was also replaced with
`scripts/staging-db-backup.sh`. Its prerequisite check and a real custom-format
dump completed on 2026-08-05; the existing daily cron continues to call the
installed `/opt/supabase-staging/vinifera_backup.sh` path.

## Current production state

The public custom domain still serves the verified static Cloudflare Pages
prototype. A 2026-07-26 probe returned static HTML from `/api/health` rather
than the Worker JSON health contract, so the production application has not
replaced that baseline. Version 0.5.0 contains the complete Phase 1–5
connection-ready source architecture:

- The trusted Octopus PR bridge reports credential-value-free diagnostics for
  Access/API failures: visible-ASCII validation and character counts for the
  three authentication headers, plus the Octopus hostname and sanitized
  response provenance (`server`, `cf-ray` presence, media type, and redirect
  hostname). It never logs secret values, response bodies, query strings, or
  redirect paths. This preserves the trusted default-branch execution boundary
  and changes no hosted activation gate.
- Runtime signing/hash material is purpose-separated: rate-limit hashing and
  member-brand context signing require distinct, independently generated
  32-byte-or-longer secrets. Runtime configuration, staging activation, and
  production release guards all fail closed when either binding is missing,
  weak, whitespace-padded, or equal; no Supabase or static fallback remains.
- React 19 + Tailwind/Vite staff and member applications
- Express 5 API in a Cloudflare Worker with Static Assets
- Supabase Auth/PostgreSQL migration with forced tenant RLS
- Stripe test-mode subscription and webhook adapters
- Tenant-owned tiers, member CRM, release snapshots, shipments, recovery, fulfillment, and durable CSV import
- Stripe test-mode shipment PaymentIntents, retries, refunds, and an hourly resumable release runner
- Transactional UUID/SHA-256 command replay protection with atomic business,
  audit, result, and leased provider-outbox persistence; browser resumption
  stores no raw PII
- Same-brand composite integrity, complete scheduled-release aggregates,
  immutable Stripe event convergence, and bounded stale-refund recovery leases
- A final live-reference check before member provider-identity deletion
- EasyPost address/label adapter with fail-closed activation and a test-only deterministic simulator
- Durable Resend email outbox with lease-token completion, one stable provider
  key per logical message, bounded concurrency, early-webhook inbox,
  monotonic delivery convergence, six lifecycle triggers, and deterministic
  signed unsubscribe handling
- Explainable nightly churn snapshots, immutable/expiring four-step
  cancellation attempts, resumable pauses, command-idempotent loyalty
  mutations, paginated ledgers, and FIFO point lots
- Brand-complete Phase 3 defaults, composite organization/brand/member
  integrity, validated winery time zones, and an independent durable daily
  retention scheduler
- Operational-fact analytics, saved dashboard layouts, CSV exports, and
  scheduled summary reports
- A guarded L2 logistic training, scoring, A/B, drift, promotion, and
  rules-fallback lifecycle that cannot activate from synthetic evidence
- Estate/Reserve benchmark consent, k-anonymous aggregate publication, and
  quarterly report generation
- A ShipCompliant provider adapter, audit ledger, post-charge/pre-label guard,
  compliance-input fingerprints, and durable EasyPost label recovery
- Brand-scoped tenancy with forced RLS, restricted staff grants, explicit
  privileged all-brand aggregates, member brand binding, and shared or
  independent billing state; the client tenant boundary remounts operational
  state on scope changes, keeps explicit all-brand analytics in the URL, and
  rejects late responses from a prior brand
- A common leased/idempotent connector framework for Klaviyo, QuickBooks,
  Avalara, and Meta with encrypted credential envelopes, reconciliation, and
  sanitized attempt logs; database generations serialize QuickBooks rolling
  refresh tokens across Worker isolates, while authorized same-brand mapping
  commands drive Klaviyo churn/list execution and QuickBooks membership and
  shipping references from the existing Integration page
- Stripe billing-subject Customer locks, opaque idempotent Checkout/portal
  attempts, one nonterminal Checkout per subject, and signed-webhook
  reconciliation from `awaiting_webhook`
- Recoverable signup bootstrap plus organization Customer creation when Stripe
  is connected; disconnected and uncertain writes remain explicit and use the
  same idempotent path later
- Owner/admin Team invitations with role-aware manager/staff denial and
  session-backed invite acceptance
- Consent-gated encrypted Meta attribution with withdrawal redaction and
  resumable integration/attribution/push envelope rotation
- Separately persisted QuickBooks shipping, Avalara wine/shipping mappings,
  exemptions, and filing snapshots
- Cloudflare for SaaS custom-hostname lifecycle and WCAG-validated white-label
  portal themes, a retry-safe hostname write ledger, staff brand controls, and
  per-brand Resend sender verification
- Capacitor iOS/Android projects with secure mobile magic-link exchange,
  rotating sessions, biometric relock, APNs/FCM adapters, barcode scanning,
  network recovery, single-flight token rotation, biometric offline cold-start
  access to minimized read-only data, and store-directed updates
- GitHub-hosted CI with conditional migrations, an isolated
  `vinifera-staging` Worker deployment, Android lint/debug/minified-release,
  and Playwright/axe QA
- Credential-independent hosted release controls: GET-only readiness, hashed
  staging/production target authorization, linked hosted pgTAP/RLS, a retained
  Pages rollback controller, and ephemeral signed mobile/internal-track
  workflows
- A Stripe test-only catalog controller that probes an account fingerprint
  without writes, then creates or verifies the four canonical recurring Prices
  only after tracked account authorization and exact confirmation
- Restricted environment credential references, provider target hash policies,
  and independently disabled credential-rotation and Stripe live-billing
  controls

The Worker is connection-ready but must not replace the Pages custom-domain
baseline until the hosted Supabase, Stripe, provider, DNS, physical-device, and
store activation checks in the phase QA reports pass.

## 2026-07-30 principal-orchestrator candidate delivery

The owner accepted the candidate-based delivery model in
`docs/decisions/2026-07-30-principal-orchestrator-candidate-delivery.md`.
This source branch makes it canonical and implements its first bounded unit:

- feature-branch pushes no longer trigger fast CI;
- draft PRs record terminal `draft_not_candidate` failure without dependency,
  build, test, browser, or preview work, preventing stale same-head success;
- ready, non-draft new PR heads retain the required `Dev fast checks` name and
  cancellable per-PR concurrency; exact manual candidates use the distinct
  `Manual exact candidate checks` context and must dispatch from their head;
- the classifier reports exact base/head, risk, surface, focused tests,
  browser applicability, and preview applicability;
- unknown paths are invalid, while authority-high-risk candidates require the
  trusted `octopus-review-required` boundary before the aggregate can pass;
- browser smoke runs only for frontend, routing, shared-client,
  accessibility-sensitive, or explicitly browser-risk paths;
- every candidate has an always-present `Feature preview decision`;
- frontend candidates retain a prebuilt artifact for trusted
  default-branch publication as exact-head `Frontend preview evidence`;
- the privileged publisher independently reclassifies the live exact diff,
  targets only preview branches of the non-production `vinifera-dev` Pages
  project, and never executes PR-head source beside Cloudflare credentials,
  trusts artifact applicability, targets the public `vinifera` project, or
  accepts reserved environment branch names;
- the Octopus bridge now uses Git-ref-qualified Config-as-Code routes and the
  flat `runbooks/pr-quality-gates.ocl` resource layout that the live project
  enumerates; five non-secret exact-PR inputs are prompted from Git-backed
  variables while `GitHubPAT` remains database-backed and sensitive; and
- review repairs are collected and batched for no more than two substantive
  repair/re-review cycles.

The pre-change external-control snapshot found zero open PRs, no rulesets, and
only `main` protected. The owner-authorized non-production update now protects
`dev` with strict `Dev fast checks`, PR-only updates, resolved conversations,
linear history, administrator enforcement, and no force-push or deletion.
Default Actions permissions are read-only and workflow tokens cannot approve
reviews. `main`, `staging`, and protected environment settings were not
changed; the exact before/after payloads and rollback procedure are recorded
in `docs/build-specs/github-governance-snapshot-2026-07-30.md`.

The trusted preview publisher cannot receive `workflow_run` events until the
reviewed definition reaches the default branch. Therefore the direct
Cloudflare Pages preview integration remains enabled as a bootstrap fallback.
After one ready frontend candidate proves an immutable preview and one backend
candidate proves non-applicability, disable automatic Pages preview
deployments and then require `Frontend preview evidence`. Do not reverse that
order.

Current remote evidence on 2026-07-31 is `dev` at `55449cbe53e5`, `staging`
at `c3b9df3dac84`, and `main` at `3a688968a1e3`, with no open pull requests.
The principal-orchestrator candidate, trusted development auto-merge, and
immutable release controls are source-complete on `dev` but remain inactive
until their trusted controllers reach the default branch and their protected
environments are provisioned.

The original nightly Octopus failure (`30606684736`) was a first-request HTTP
403. Redacted reproduction identified Cloudflare browser heuristics and stale
repository credentials. The already-scoped service token was renewed, GitHub
and the private vault were synchronized, a hostname-only rule disabled Browser
Integrity Check for `octopus.schubert.life`, and zone Bot Fight Mode was
disabled because this plan cannot bypass it for machine traffic. Access logs
and direct probes now prove the non-identity policy reaches Octopus; Access and
AI-bot controls remain active.

The next trusted `main` rerun (`30626572282`) crossed that boundary and exposed
HTTP 400 on the obsolete database-backed
`/projects/Projects-1/runbooks` route. The pending repair uses the exact
Config-as-Code `refs/heads/main` preview, snapshot-template, and grouped-run
contract. A real local invocation queued and passed the Security Audit
runbook. Scheduled GitHub execution remains pending until this trusted bridge
repair reaches `main`; Pages checks remain static build evidence only, and
Worker activation jobs remain disabled or skipped.

PR #67 (`ci/octopus-audit-readiness-reconcile → dev`) was first reviewed at
head `0a12bce`.
Exact-head fast run `30627097438` passed. Trusted Octopus run `30627097321`
crossed Access but failed because the main-ref inventory does not expose `PR
Quality Gates`; the same exact review passed from the maintained `dev` ref.
The PR remains human-review required and must not be treated as merge- or
promotion-ready until the trusted main-ref status is green.

This governance and CI work does not deploy a Worker, change DNS, activate a
provider, mutate hosted data, enable billing, access production customer data,
or mark any activation gate complete. All 20 gates below remain pending.

## 2026-07-29 two-speed delivery governance

The current delivery contract is defined by
`docs/decisions/2026-07-29-two-speed-delivery-governance.md`. It supersedes
older process descriptions below where they say every feature PR requires full
CI, Octopus, CodeRabbit, or automatic `dev → staging` readiness after each
`dev` push.

- Routine feature branches and PRs to `dev` use the always-present
  `Dev fast checks` aggregate. The fail-closed classifier selects
  documentation, routine, or high-risk focused work.
- Cloudflare Pages preview runs independently and records a branch alias plus
  immutable deployment URL. Preview evidence is not stable-dev, staging,
  production, database, or provider evidence.
- Consolidated `dev → staging`, `staging → main`, protected releases, and
  explicit full runs retain the exact
  `Type, test, build, and package` aggregate.
- `dev → staging` promotion starts manually or through an explicitly
  owner-authorized workflow. It does not start after every `dev` push.
- Octopus is required for the promotion comparison and available by request
  for high-risk feature work. It does not run automatically for every routine
  `dev` PR.
- CodeRabbit is optional and non-blocking while unavailable or rate-limited.
  Any substantive findings it does produce still require disposition.
- One logical PR or promotion receives one consolidated changelog entry. WIP
  commits are allowed only on an isolated feature branch and are squash-merged
  into `dev`; the final logical commit records a substantive body and exact
  verification.
- ADRs are required only for architectural, security, deployment,
  database-policy, or governance decisions.
- Staging and production remain exact-revision, protected operations.
  Standing owner authorization does not bypass environment controls, target
  hashes, confirmations, privacy, rollback, or a stop label at the exact
  consequential boundary. `human-review-required` does not suppress safe
  diagnosis, repair, review, preview, or evidence collection;
  `do-not-merge` remains an absolute merge prohibition.

Evidence must be reported as one of: local validation, fast GitHub validation,
full GitHub validation, preview deployment, staging deployment, production
deployment, or hosted/provider readiness. An HTTP 200 or healthy static page is
not sufficient environment evidence; hosted verification requires the expected
marker, build SHA/artifact digest, and API health contract.

Stable addresses remain:

- Dev: `https://vinifera-dev.edstratumlabs.ai`
- Staging: `https://vinifera-staging.edstratumlabs.ai`
- Live: `https://vinifera-live.edstratumlabs.ai`
- Marketing/static rollback: `https://vinifera.edstratumlabs.ai`

Feature preview URLs supplement the stable addresses. Cloudflare Access must
protect dev or preview surfaces that expose non-public application or test
data. Development and staging cannot use production credentials or production
customer data.

This implementation changes source governance and delivery workflow only. It
does not merge or promote an environment branch, provision a hosted target,
activate a provider, deploy an environment, move DNS, enable billing, or mark
any of the 20 activation gates complete.

## 2026-07-28 comprehensive UI testing mission

The original UI evidence is in
`docs/build-specs/ui-test-report-2026-07-28.md`. The authoritative cross-agent
attribution, merge audit, repair chronology, verification, waiver, blockers,
and next-step handoff is
`docs/build-specs/merge-cleanup-regression-audit-2026-07-28.md`. The mission
opened manifest PR #27, fifteen isolated defect PRs #28–#42, and report PR #43,
all against `dev`. PRs #27–#28, #31–#34, and #36–#43 were squash-merged. PRs
#30 and #35 were closed after direct resolution commits.

- Baseline `dev` at `4d0ba11` passed 448/448 checks and 145/145 Playwright
  tests.
- Local integrated snapshot `72d85f82d96384334f066763f5a2ee5d31744699`
  passed 454/454 checks and a final complete 149/149 Playwright run.
- Authenticated Jeff - Pro Chrome spot checks at mobile and desktop reported
  zero axe violations, horizontal overflow, or console errors.
- The 14 squash merges are patch-identical to their reviewed PR diffs. The
  direct PR #30/#35 resolutions were not: they replaced current files, restored
  six obsolete marketing CTA destinations, and deleted merged Phase 1/5
  regression assertions. PR #49 repaired the WCAG focus/touch-target source;
  PR #51 restores the remaining signup behavior and recombines all deleted
  assertions with the intended pricing and HTTPS-logo changes. The restored
  trial links remain on pricing unless `/api/health/configuration` reports
  application-origin, database, and authentication-email readiness; generic
  runtime health alone cannot expose a signup route that is guaranteed to fail.
- Octopus still does not run on `dev` PRs because `pull_request_target` loads
  the workflow from GitHub's default branch. The current remote `main` head
  (`c5639547746a` at the 2026-07-29 audit) retains the old
  `pull_request`/main-only
  workflow and nonexistent action reference; the corrected
  `pull_request_target` definition visible on `dev` is not default-branch
  runtime code. The secure workflow and runbook bridge must be promoted to
  `main` before Octopus can be a real dev/staging gate. This implementation
  does not perform that promotion: after its feature PR is merged to `dev`,
  the owner must use the existing protected/manual path to place the reviewed
  bridge on `staging` and then `main`, configure the main-only
  `promotion-control` environment, and only then require the new contexts.
  The environment was created on 2026-07-29 with owner review and a custom
  `main`-only deployment branch policy, but its promotion PAT and staging
  probe secrets remain unset until the owner moves them from repository scope.
  The corrected bridge
  publishes its trusted runbook outcome as an explicit status on the PR head,
  because `pull_request_target` check runs attach to the base revision. The
  promotion gate additionally requires check-run association with the current
  PR, evidence timestamps no older than the current readiness attempt, and an
  Octopus description naming that PR. These bindings prevent a recreated PR
  at the same SHA from inheriting stale results. CodeRabbit is no longer part
  of this required evidence boundary under the 2026-07-29 policy. The
  runbook receives the event head SHA, base ref, and base SHA as required
  prompts and refuses checkout if GitHub's live PR metadata differs. Its
  aggregate and per-commit diffs are generated from the fetched immutable
  merge-base/head objects rather than mutable PR API artifacts. The published
  status attests the base SHA, which promotion captures and revalidates through
  its final readiness check. Rules 1–3 now require the task state and inspect
  tracked TypeScript with `git grep`, preventing missing-state false success
  and symlink traversal into the Octopus host.
  Octopus Deploy's authenticated `main` project view also shows no published
  runbook.
- Cloudflare Access now has one scoped `Vinifera GitHub Actions — Octopus`
  Service Auth policy on the Octopus application, selecting only the
  `Vinifera GitHub Actions` service token. The token has a one-year duration,
  and its client ID and one-time secret are installed as the encrypted
  `OCTOPUS_CF_ACCESS_CLIENT_ID` and `OCTOPUS_CF_ACCESS_CLIENT_SECRET` GitHub
  Actions secrets; neither value is recorded in source. The existing human OTP
  policy is unchanged.
- `.coderabbit.yaml` enables CodeRabbit auto-review for `dev` and `staging`,
  but the service is rate-limited. CodeRabbit is now optional and non-blocking;
  available substantive findings still require disposition. Full CI, Octopus
  promotion review, staging, and production controls remain independent.
- Remote branch cleanup was initially incomplete: the merged governance and
  WCAG branches remained after the report claimed only `main`, `dev`, and
  `staging`. The audit verified PRs #49/#50 were merged and then deleted both
  stale remote branches; only the active repair branch now supplements the
  three environment branches.
- Automated `dev → staging` readiness remains fail-closed because the isolated
  staging Supabase target and `STAGING_SUPABASE_URL` /
  `STAGING_SUPABASE_ANON_KEY` Actions secrets do not yet exist. Exact-head
  review also proved GitHub's merge API cannot atomically bind an expected base
  SHA, so the workflow now leaves every validated promotion PR open for a human
  merge. Normal and dry-run readiness both refresh the complete head/base,
  CI/status, review, and thread evidence after the second provider probe. Each
  readiness attempt has a timestamped PR marker; CI must name the captured base
  and head, and statuses/reviews must be newer than that attempt. Quality CI
  handles the marker's `edited` event, guaranteeing a fresh run when the
  promotion head itself has not changed.
- GitHub Actions run `30407043361` passed the full and Android lanes plus the
  required aggregate for controlled-review-freeze head `8c7341e`. An earlier exact-head Codex
  review found that checkout did not persist `MERGE_BASE_SHA` for the isolated
  Rules 4–10 Octopus action; the follow-up repair persists it in task-scoped
  state. The following review also found that an unchanged head could be
  reviewed against a temporarily switched base; the bridge now requires the
  event's base ref and SHA to match live metadata. The controlled audit then
  found reduced-motion, hidden-focus, Worker marketing-CSP, and Rules 1–3
  host-boundary defects;
  their consolidated repair passed 490 Vitest tests, all five embedded
  database suites, 153 Playwright/axe tests, Worker and Pages builds, mobile
  identity, compile-only mobile-web preparation, actionlint 1.7.12, and a
  manual 375-pixel check in the Jeff Pro Chrome profile. Exact-head CI run
  `30408522282` passed, but the final Codex review correctly
  found that Rules 1 and 3 still converted operational `git grep` errors into
  false passes. The owner authorized one bounded correction batch. That local
  batch now preserves operational failures, resolves Rule 2 imports relative
  to tracked source blobs, binds check creation as well as start time to the
  readiness attempt, self-hosts Lucide under `script-src 'self'`, and hardens
  fragment navigation. The final local matrix passed 492 Vitest tests, all
  five embedded database suites, the independent clean-seed check, 153
  Playwright/axe tests, both static and Worker builds, mobile identity,
  Android synchronization, actionlint, and a fresh desktop/375-pixel Jeff Pro
  Chrome inspection. One final exact-head CI/Codex review remains mandatory
  after the single authorized push. Octopus has not run, so PR #51 is not yet
  merge-ready.
- Open product/API decisions include the retention attempt list, a staff
  loyalty Redeem action, Team roster data, the Owner invitation security
  contract, the single-brand switcher, mobile dashboard spacing, CSV browser
  transport proof, and the `/app/signup` cutover boundary.

All 20 activation gates remain pending. No provider, hosted-data, migration,
billing, email, push, deployment, or merge activation occurred.

## Runtime architecture

| Route | Implementation |
|---|---|
| `/`, `/guide/*` | Existing static marketing and guide assets |
| `/app/*` | React staff application |
| `/portal/*` | React member portal |
| `/api/*` | Express backend-for-frontend |
| `/.well-known/*` | Worker-generated Apple/Android app association documents |
| hourly cron | access reconciliation, releases/retries, email claims, churn, loyalty, analytics, connector sync/reconciliation, and mobile push |

Web staff and member JWTs live only in distinct secure HTTP-only cookies.
Winery Klaviyo, Avalara, and Meta credentials and QuickBooks connection tokens
are authenticated encrypted database envelopes whose wrapping key remains a
Worker secret. Production dashboards contain no mock rows.

## Source map

```text
web/                    Vite entry
src/client/             React application
server/                 Express API, provider adapters, Worker entry
server/integrations/    Provider, domains, mobile auth, and push transports
server/services/        Domain services plus compatibility and public barrels
supabase/migrations/    PostgreSQL source of truth
supabase/tests/         pgTAP schema, RLS, and RPC suites
tests/server/           API integration tests
tests/e2e/              Playwright/axe browser QA
android/                Capacitor Android source shell
ios/                    Capacitor iOS source shell
mobile/                 Native security and deep-link documentation
mobile/app-identity.json Canonical cross-platform ID and version contract
docs/decisions/         Architecture decisions
docs/build-specs/       Sequential phase specifications and QA reports
wrangler.jsonc          Worker/static assets/cron/queue configuration
```

The extensionless root `app` file is the accepted visual prototype. It is
copied only when Cloudflare Pages injects `CF_PAGES=1`, preserving the public
rollback baseline; Worker builds omit it and serve React at `/app/*`.

## Release evidence

- The previous docs/full classifier and full aggregate on routine PRs are
  historical. The 2026-07-29 two-speed contract now gives routine feature PRs
  `Dev fast checks`, preserves `Type, test, build, and package` for promotion,
  and selects Android only for mobile-relevant or explicitly scheduled/full
  work. Required aggregates remain `if: always()` fail-closed policy gates;
  skipped optional work cannot leave them pending, and skipped required work
  cannot be treated as success.
- PR ownership remains a terminal agent condition, but the applicable gate now
  depends on delivery level. Five precedence-ordered labels scope recurring
  monitoring; `human-review-required` pauses merge, promotion, deployment,
  and the specific owner decision while safe repair/evidence work continues;
  `do-not-merge` is an absolute merge prohibition. Standing owner authority
  covers routine reversible delivery through protected controls but cannot
  bypass a stop label at its consequential boundary.
- Risk-based development merge source is defined by
  `.github/delivery-risk-contract.json`,
  `.github/scripts/dev-automerge-policy.mjs`, and
  `.github/workflows/dev-automerge.yml`. It accepts only current-base,
  same-repository, low/medium-risk `dev` PRs with `codex-auto-merge`, exact
  successful required/preview contexts, and zero unresolved threads, then
  repeats the decision before exact-SHA squash merge. It remains inactive
  until the trusted workflow reaches the default branch.
- The pre-change GitHub configuration and rollback are recorded in
  `docs/build-specs/github-governance-snapshot-2026-07-30.md`. `dev`
  protection and read-only default Actions permissions are the intended live
  non-production settings; production controls are unchanged.
- Development Worker automation is source-complete but
  `prepared_disabled`. `Development deployment candidate` is unprivileged;
  `Development Worker release` runs trusted default-branch code, builds one
  immutable prebuilt bundle/assets package, requires a known rollback version,
  deploys only `vinifera-development`, verifies exact health/configuration,
  staff/member/tenant boundaries and desktop/375 rendering, and rolls back on
  failure. Activation blockers and rollback are in
  `docs/runbooks/development-worker-release.md`.
- `Package selected release candidate` packages one current `dev` head only
  after the maintained `dev → staging` PR has exact full CI and Octopus
  evidence and while that promotion PR remains open. The exact package must
  succeed before the promotion merge; a closed promotion PR is deliberately
  ineligible for later packaging. The protected staging and production upload
  paths consume that exact manifest-bound bundle/assets package with
  `--no-bundle`; no rebuild is allowed during deployment.
  `Delivery Control Center` maintains one low-noise GitHub issue and separates
  implemented, CI-verified, deployed, and live-verified state.
- The 20 pending activation gates are sequenced into private synthetic beta,
  restricted live winery pilot, and GA without changing any gate status.
- The repository README now displays the CodeRabbit pull-request review badge,
  making automated review coverage visible without changing application,
  deployment, provider, or activation behavior.
- BS-03 decomposes the two service monoliths into member, club, order,
  analytics, Stripe, EasyPost, communications, webhook, and shared
  provider-runtime modules. `core-club.ts` and `integrations.ts` are now
  re-export-only compatibility barrels, and internal runtime consumers plus
  the system association route use direct domain imports. The integration
  preserves the complete 129-route BS-02 manifest, BS-04 Sentry/rate-limit
  middleware boundaries, and BS-06 mobile-bootstrap organization/brand
  predicates. This extraction changes no provider activation, deployment
  configuration, or static production surface. The integrated branch passes
  the direct-push policy 12/12, dependency audit 0, generated Worker type check,
  TypeScript, Vitest 388/388, database gates 92/250/199/158/513, Vite and Pages
  builds, default/staging/production Worker dry runs, Playwright/axe 145/145,
  mobile identity, mobile-release controls 7/7, and a non-routable compile-only
  Capacitor web bundle plus Android sync. Exact-head review additionally
  centralizes neutral concurrency, integration-pattern, and Supabase-admin
  primitives; narrows APNs activation deferral; binds EasyPost recovery to the
  persisted rate; validates QuickBooks lease generations; corrects the member
  address auth-user identity; and preserves integration-job completion while
  logging health-update failures. Focused review regressions pass 114/114 and
  the shared concurrency helper now rejects invalid limits without skipping
  `undefined` inputs. The 18-service/37-edge graph remains acyclic. This Mac has
  no Java runtime, so Android lint/assemble remains CI evidence rather than a
  local claim.
- The review-hardening branch closes the remaining aggregate-integrity,
  unsubscribe-privacy, direct-push timeout, checkout-credential, and setup
  documentation findings without changing provider activation. Release PATCH
  retries now preserve validated existing `release_wines.id` values through
  forward migration `202607260022_release_wine_identity_replay.sql`, allowing
  an exact lost-response retry to reach the durable command replay while
  rejecting create-time, duplicate, cross-brand, cross-release, or otherwise
  foreign wine IDs. The current branch passes the direct-push policy 12/12,
  dependency audit 0, generated Worker bindings, TypeScript, Vitest 382/382,
  database gates 92/250/199/158/513, focused production/mobile/catalog
  controls 14/7/16, mobile identity, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
  Hosted Supabase native pgcrypto/pgTAP verification and all provider-backed
  activation evidence remain pending by design.
- BS-06 audits every database-calling function in `server/services/` against
  its then-current 21-migration tenancy model. It adds explicit organization
  and brand predicates to all mobile offline-bootstrap reads, a focused cross-brand
  query assertion, CODEOWNERS, a PR template, governance and Greptile guidance,
  and current architecture documentation with all 20 activation gates pending
  at that review point. The branch is integrated with the direct-push guard and
  BS-02/BS-04
  route and observability baseline. The integrated branch passes the direct-push
  policy 9/9, dependency audit 0, Worker type generation, TypeScript, Vitest
  378/378, database gates 92/231/199/158/494, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
  No provider, hosted database, Worker, or production activation state changed.
- BS-02 decomposes all 129 Express registrations from the monolithic
  `server/app.ts` into domain-scoped `server/routes/` modules. The 82-line app
  entry point now retains only global middleware and ordered route mounting.
  BS-04 rate limits execute before every public/raw-webhook and protected route,
  and the centralized BS-04 error handler is the final middleware after the
  `/api` 404 boundary. Mechanical route/schema/handler comparison and the full
  credential-independent verification suite pass with no route, deployment, or
  provider activation behavior change. As of 2026-07-27, the current integrated
  BS-02 review branch passed the direct-push policy 9/9, dependency audit 0,
  generated Worker binding check, TypeScript, Vitest 377/377, database gates
  92/231/199/158/494, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
- The BS-02 review follow-up adds the route-decomposition ADR and closes
  route-boundary findings for release consistency, partial template defaults,
  email normalization, callback redirects, raw webhook bodies, explicit
  loyalty validation, shared UUID schemas, order-sensitive mounts, and bounded
  multipart CSV framing. Cloudflare client-address headers are trusted only in
  staging/production for route audit fields and rate-limit actor keys; direct
  development/test requests use the socket address. The multipart path remains
  pre-buffered and Cloudflare Worker-compatible; no unproved Node stream
  middleware was added.
- Direct-push governance now supplies the required
  `Block direct push to main` context on pull requests and verifies each
  resulting `main` push against GitHub's associated-pull-request evidence. It
  requires the exact recorded merge result for a closed PR targeting `main`,
  supports merge, squash, and rebase strategies, and rejects forced updates,
  conventional-commit heuristics, missing evidence, and API errors. Branch
  protection remains the pre-push enforcement boundary. Associated-PR lookup
  follows up to ten validated same-origin pages and retries missing index
  evidence twice over 20 seconds before failing closed.
- BS-01 repository hygiene migrates Greptile review policy from the legacy
  root JSON file to scoped `.greptile/` configuration and rules, removes the
  generated Worker declaration from version control while regenerating it
  before CI verification/typecheck, and records the Phase 5 closure evidence
  plus all 20 activation gates, which were pending at that review point. These
  changes do not alter runtime routes, provider activation, or the static
  production baseline.
- BS-04 adds a credential-independent error-observability and API-abuse
  boundary: optional PII-minimized Sentry capture at the Worker entry point, a
  centralized request-correlated Express error handler registered last, and
  native Cloudflare rate limits scoped by normalized route plus tenant and
  hashed actor. Sentry remains inactive without its Worker secret; the static
  production baseline remains unchanged.
  Its pre-BS-02 historical local verification passed audit 0, generated Worker
  types, TypeScript,
  367/367 Vitest tests, Vite and Pages builds, development/staging/production
  Worker dry runs, and 145/145 Playwright/axe cases including 375-pixel and
  touch-target coverage.
- The BS-01 review follow-up makes fresh-checkout local validation
  self-generating, restores public browser bootstrap for the existing member
  authentication endpoints without weakening protected-route enforcement, and
  aligns the Phase 1–2 browser fixtures with the current brand/overview
  contracts.
- BS-05 provides a pinned, single-command local Supabase/Worker/Vite workflow,
  schema-valid synthetic two-tenant fixtures, loopback-only Auth bootstrap,
  authenticated isolation smoke checks, and the 20-gate readiness ledger.
  The integrated 22-migration chain and deterministic seed replay twice, the
  full Vitest suite passes 448/448, and TypeScript passes. The same integrated
  head also passes the native Supabase CLI 2.109.1 reset/seed and real
  Worker/Auth flow with a populated nine-member Sunrise roster,
  Pacific-to-Sunrise 403, member session, local magic-link callback with an
  HTTP-only cookie, populated portal shipment history, desktop/375px UI, touch
  targets, zero axe-core violations, and fail-closed shutdown cleanup. That is
  partial local prerequisite evidence for Gates 1, 7, and 15; all 20 composite
  activation gates remain `pending` until their complete hosted or provider
  criteria are proved.
- Phase 1–4 local architecture gates and the 94-test browser regression were
  recorded as passing in their phase QA reports.
- Version 0.5.0 aligns the package, Android, and iOS source release and contains
  Phase 5 database, service, client, responsive/axe, and native-shell test
  coverage.
- `npm run qa:mobile:identity` enforces cross-platform application IDs,
  versions, link allowlists, APNs entitlement modes, Gradle integrity, privacy
  declarations, and replacement of the default Capacitor artwork.
- CI is configured for Node 22.22.0, Phase 1–5 embedded database gates,
  generated Worker type validation, Worker dry-run, browser QA, Java 21/Android
  API 36 lint plus debug/R8 release APK assembly, and pinned Supabase CLI
  2.109.1.
- Optional Worker deployment targets only the isolated `vinifera-staging`
  environment, requires hash-authorized targets, runs hosted pgTAP/RLS, attaches
  available secrets atomically, and requires the core configuration report.
- Production Worker bootstrap/version/deploy/Worker rollback is wired as a
  protected manual workflow. The standard dispatch no longer exposes legacy
  domain cutover or Pages restoration. Rollback keeps current `main` as the
  control authorization and independently verifies a prior reviewed release
  SHA plus a previously sole-active Worker version. Account and Worker-origin
  hashes remain empty, so no production mutation can run yet.
- Signed Android/iOS build and Play internal/TestFlight delivery are wired as a
  protected manual workflow. Normal CI remains explicitly compile-only.
- Commit `5cc1bda` passed the complete GitHub quality and Android run
  `30217201984`. The mutation jobs skipped because staging activation remains
  off.
- Read-only hosted run `30217462802` confirmed the generic Supabase and Stripe
  test credentials are reachable. The Supabase Phase 1/5 tables do not yet
  exist, Stripe still needs all four test Prices and its webhook secret, and
  the current Cloudflare token is valid but lacks Workers read capability.
- Stripe test-catalog probe
  [`30218422165`](https://github.com/theonlygeranium/vinifera/actions/runs/30218422165)
  passed against the generic test credential without a provider write. Its
  sanitized account SHA-256 fingerprint is now tracked. Protected bootstrap
  [`30218801133`](https://github.com/theonlygeranium/vinifera/actions/runs/30218801133)
  failed closed after its first idempotent provider create because the create
  response did not expand the Product; the controller now requests that
  expansion. Treat the first Price as created-or-unknown. Service connections
  are deferred, so no retry was attempted; reconcile the fixed lookup key only
  when activation is explicitly resumed.
- The historical pre-BS-01/BS-02 credential-independent architecture gate
  passed: dependency
  audit 0, generated Worker types and TypeScript green, Vitest 354/354,
  database gates 92/231/199/158/494, and Playwright 145/145 with zero axe
  violations and 360/375/412/430/768/1440 Phase 5 coverage. The single-worker
  100-member roster renders in 444.6 ms, Phase 5 LCP is 416 ms, CLS is 0, and
  multi-brand readiness is 920 ms. Phase 4 scores 10,000 members inside its
  five-minute gate, renders its 365-day dashboard inside two seconds, and
  renders five charts 24.20 ms after the response. Pages plus
  development/staging/production Worker dry-run builds pass, as do production
  release 14/14, mobile release 7/7, Stripe catalog 16/16, mobile identity, and
  compile-only Capacitor Android/iOS sync. Provider transports remained
  injected; no provider was contacted.
- Architecture commit `5d36471` passed GitHub Actions run
  [`30221722696`](https://github.com/theonlygeranium/vinifera/actions/runs/30221722696):
  quality completed in 5m23s, Java 21 Android lint/debug/minified release
  assembly completed in 4m37s, and credential-gated migration/deployment jobs
  skipped. This Mac still has no local Java runtime.
- Phase 1 architecture closure commit `a27f078` passed GitHub Actions run
  [`30223237016`](https://github.com/theonlygeranium/vinifera/actions/runs/30223237016):
  quality completed in 5m43s, Android lint/debug/minified release completed in
  4m44s, the 90-day `playwright-evidence` artifact was retained through
  2026-10-24, and hosted migration/deployment skipped while activation remains
  off.
- Phase 2 architecture closure commit `15c9942` passed GitHub Actions run
  [`30226397256`](https://github.com/theonlygeranium/vinifera/actions/runs/30226397256):
  quality completed in 5m15s, Android lint/debug/minified release completed in
  3m39s, QA/native evidence uploaded, and hosted migration/deployment skipped
  while activation remains off.
- Phase 3 architecture closure commit `3b01c3a` passed GitHub Actions run
  [`30229260377`](https://github.com/theonlygeranium/vinifera/actions/runs/30229260377):
  quality completed in 6m22s, Android lint/debug/minified release completed in
  4m25s, QA/native evidence uploaded, the Pages rollback artifact validated,
  and hosted migration/deployment skipped while activation remains off.
- Phase 4 architecture closure commit `623dd2a` passed GitHub Actions run
  [`30232327146`](https://github.com/theonlygeranium/vinifera/actions/runs/30232327146):
  quality/browser QA completed in 6m49s, Android lint/debug/minified release
  completed in 4m19s, the Pages rollback artifact validated, and hosted
  migration/deployment skipped while activation remains off. The static custom
  domain now returns CSP, COOP, HSTS, frame-deny, and MIME-sniffing headers;
  `/api/health` still returns the static HTML shell until Worker activation.
- Phase 5 architecture closure commit `5d3dadd` passed GitHub Actions run
  [`30235083942`](https://github.com/theonlygeranium/vinifera/actions/runs/30235083942):
  quality/database/browser/Pages rollback completed in 5m39s, Java 21 Android
  lint/debug/minified release completed in 4m10s, QA/native evidence uploaded,
  and hosted migration/Worker deployment skipped because activation remains
  off.
- GitHub Actions artifact/log retention is configured at the allowed 90-day
  maximum, and Playwright login/signup captures at 375, 768, and 1440 are
  explicitly retained for 90 days. Android setup is pinned to v4.0.1/Node 24
  in normal CI and the protected mobile-release workflow.
- The GitHub `staging` environment is restricted to the `staging` branch;
  `production` and `mobile-release` remain restricted to `main`. All three
  require review by `theonlygeranium`; self-review is currently allowed
  because no second human reviewer is configured.
- The current Phase 5 evidence and any remaining local checks belong in
  `docs/build-specs/phase-5-qa-report.md`; do not copy pending checks here as
  passes.

The Phase 1–5 source architecture is complete. Hosted Supabase native
pgcrypto/pgTAP, provider round trips, real-data model/benchmark results, custom
DNS/certificates, Stripe live mode, signed physical devices, push delivery, and
internal store-track evidence remain required before the hosted operational exit
criterion can pass.

## Activation gates

Gates 10–12 now have a source-complete protected evidence controller in
`.github/workflows/phase4-hosted-acceptance.yml`. Its checked-in policy and
three one-shot switches are disabled. Gate 10 requires all documented
analytics metrics and the CSV values to equal the same source facts exactly;
Gate 11 retains the 500-member, 50-cancellation, six-source, AUC, rules, and
single training-run/model/experiment/promotion identity chain plus
full 30-day outcome gates; Gate 12 retains Estate/Reserve opt-in, ten
unique contributor organizations with a cohort-bound hashed owner opt-in audit for every winery,
privacy checks, and confirmed quarterly delivery. Per-run manifest hashes live
in protected post-immutable environment state rather than the candidate commit,
so exact revision binding does not require a Git SHA fixed point. A successful
run is hosted acceptance evidence for the selected gate, not a completion
claim or permission to activate another gate.

The code must remain fail-closed until these external connections are active:

1. Add staging-environment Supabase management credentials, then set the
   exact project hash and repository variable
   `STAGING_SUPABASE_MIGRATION_ENABLED=true` to apply `supabase/migrations/`
   and run `supabase test db --linked`.
2. **Live-passed 2026-08-06:** the reviewed account hash, protected credential,
   immutable package, isolated `vinifera-staging` deployment, and exact runtime
   readiness contract passed in run `31073800654`.
3. Enable the custom access-token hook, 900-second email OTP expiry, Google OAuth, and SMTP.
4. When service activation is explicitly resumed, reconcile the
   created-or-unknown Stripe test Price from run `30218801133`, then
   bootstrap/verify the four recurring Prices without a blind retry, register
   `/api/billing/webhook`, and add its signing secret.
5. Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled.
6. Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof.
7. **Live-passed 2026-08-06:** protected run `31089753727` passed the complete
   hosted two-tenant RLS, staff, real emailed member magic-link, Stripe test
   Checkout, signed-webhook lifecycle, grace/restriction/suspension/recovery,
   and reusable-fixture cleanup contract for exact candidate
   `530a003b91642ebf40af01468b10e444116ef632`.
8. Verify a Resend sending domain, signed webhook, and at least two real staging triggers.
9. Apply Phase 4 migration 15 to hosted Supabase and run the 37 current-stack
   pgTAP assertions plus native tenant/RPC tests.
10. Connect a winery with real Phase 2/3 operations and verify every analytics
    metric and CSV export against source records.
11. Configure a dedicated active `ML_PLATFORM_ACTOR_USER_ID`, accumulate at
    least 500 labeled members and 50 cancellations, reconcile all six source
    families, dry-run and execute `ops:phase4:qualify-ml`, train on production
    history, meet held-out AUC-ROC 0.82 without underperforming rules, and
    complete the superior 30-day A/B gate before actor-audited promotion.
12. Opt an Estate/Reserve winery into a peer cohort with at least ten
    contributors and verify the quarterly report delivery through the protected
    service-role database attestation added by migration 036. The attestation
    must join the persisted delivered email/event to the selected contribution
    and least-coarsened aggregate and hash the stored body plus PDF/CSV bytes.
    The quarterly cadence currently reports the prior-quarter-start monthly
    snapshot; its evidence window must remain honest to that exact stored first
    month and cannot substitute another month from the same quarter.
13. Obtain vendor-approved ShipCompliant sandbox access, set the server-only
    credential and contract bindings, and prove compliant, non-compliant,
    unknown, timeout, tax, fingerprint invalidation, and label recovery cases.
    A default-disabled protected acceptance controller and its empty exact-hash
    policy are source-complete on the Gate 13 preparation branch. It also fixes
    the service guard that previously prevented the existing completed-label
    recovery RPC from being reached. No vendor account, fixture, dispatch, or
    hosted completion evidence exists yet.
14. Provision the integration credential keyring, then validate winery-specific
    Klaviyo, Avalara, and Meta envelopes and the QuickBooks application OAuth
    plus encrypted per-connection token lifecycle.
15. Create two production-like brands and prove database plus service-role
    cross-brand isolation, shared/independent billing, and hostname-derived
    member context.
16. Add one winery custom hostname, complete DNS ownership and certificate
    activation, and verify sibling/unknown hosts cannot select its brand.
17. Configure APNs and FCM, Apple/Google signing, privacy/store metadata, and
    prove magic links, secure storage, biometrics, push, camera, offline restore,
    and relock on physical devices.
18. Install signed builds from TestFlight and the Play internal track.
19. Replace Stripe test keys with approved live keys only under human
    supervision and run one controlled charge/refund.
20. Move the production custom domain only after every hosted exit criterion is
    evidenced.

Credential and target setup details are in
`docs/runbooks/hosted-environment-provisioning.md`. Domain rollback is in
`docs/runbooks/production-cutover-rollback.md`; signed distribution is in
`docs/runbooks/mobile-store-release.md`.

See `.env.example` and `docs/setup.md` for exact variable names. Never print or commit values.

## Build and QA

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run build:worker:production
npm run qa:mobile-release
npm run qa:production-release
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:db:phase5
npm run qa:mobile:identity
npm run qa:e2e
npm run build:mobile:web
npm run build:mobile:android
```

The human supervisor directed the team to complete architecture now and connect
services later. Keep every deferred provider fail-closed; do not retry the
uncertain Stripe catalog write, populate target policies, dispatch provider
mutations, or describe a hosted exit criterion as passed without explicit
activation authority and redacted runtime evidence.
