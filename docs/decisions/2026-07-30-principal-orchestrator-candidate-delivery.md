# ADR: Principal-orchestrator candidate delivery

- **Date:** 2026-07-30
- **Status:** Accepted
- **Decision owner:** EdStratum Labs human owner
- **Scope:** Agent authority, development candidates, fast CI, preview
  publication, review repair, and release-control ownership
- **Amends:** `2026-07-27-pr-ownership-and-automation-governance.md`,
  `2026-07-28-automated-dev-staging-promotion.md`,
  `2026-07-28-switch-greptile-to-octopus.md`, and
  `2026-07-29-two-speed-delivery-governance.md`

## Context

The accepted two-speed model established a fast `dev` lane and a protected full
promotion lane, but routine work still created duplicate feature-push and
pull-request runs, draft PRs consumed expensive validation, backend-only work
installed Playwright, and the Cloudflare Pages integration published previews
without considering candidate readiness.

The owner wants one primary delivery agent to own a coherent objective from
planning through exact-revision evidence. Routine delivery should proceed
without repeated owner interaction while privacy, authentication,
authorization, tenant isolation, billing, compliance, credentials, destructive
operations, emergency labels, rollback, and production remain fail closed.

## Decision

### 1. Treat a ready PR head as the development candidate

Local work and draft pull requests are work in progress. Required fast
validation runs when:

- a non-draft PR targeting `dev` opens or reopens;
- a draft becomes ready for review;
- a non-draft PR receives a new head; or
- an operator manually dispatches an exact current-`dev` base from the exact
  candidate head ref.

Converting a PR to draft cancels in-flight work through the PR-scoped
concurrency group and records a terminal `draft_not_candidate` failure without
running expensive work. That prevents a success from the same head being reused
when the PR later becomes ready. General feature-branch pushes do not run cloud
CI.

The exact PR aggregate remains `Dev fast checks`. Manual evidence uses the
distinct `Manual exact candidate checks` context so a dispatch cannot satisfy
the protected PR context. The protected promotion aggregate is
`Vinifera Promotion Gate`, which is the single GitHub Actions status promotion
automation and branch protection should require.

### 2. Classify risk and execution surface separately

The fast classifier reports:

- exact base and head SHAs;
- delivery lane;
- low, medium, or high risk;
- docs, frontend, backend, workflow, test, mixed, or unknown surface;
- browser requirement;
- preview requirement; and
- focused tests.

Unsafe records, unsupported events, unknown paths, missing diffs, invalid SHAs,
and ambiguous outcomes fail closed. A required job must conclude `success`.
Cancelled, failed, timed-out, or unexpectedly skipped required work cannot
satisfy an aggregate.

Unknown paths are invalid rather than merely expensive. Authority-high-risk
candidates cannot pass the fast aggregate until a trusted operator applies
`octopus-review-required`, which starts the separate exact-head review boundary.

Documentation-only candidates run documentation, policy, whitespace, and
credential-diff checks. Code candidates retain locked dependency installation,
secret and whitespace scanning, Worker types, TypeScript, production builds,
and classifier-selected tests. Browser/accessibility smoke runs only for
frontend, routing, CSS, shared-client, accessibility-sensitive, or explicitly
browser-risk paths.

### 3. Separate preview decision, build, and privileged publication

Every candidate receives the always-present `Feature preview decision`.
Frontend-relevant ready candidates produce a prebuilt Pages artifact.
Backend-only, workflow-only, test-only, documentation-only, and draft work
records policy-approved non-applicability unless an explicit risk rule requires
browser or preview evidence.

`Frontend preview evidence` is published by a trusted default-branch
`workflow_run`:

1. The unprivileged pull-request workflow builds the candidate without secrets
   and uploads assets plus strict metadata.
2. The publisher checks out only the default branch, treats the artifact as
   untrusted data, rejects symlinks and malformed metadata, and revalidates the
   live same-repository PR, exact head, exact base, draft state, emergency
   labels, and rejects the reserved `dev`, `staging`, and `main` branch names.
   It independently reclassifies the exact live diff with trusted
   default-branch policy and rejects artifact-supplied applicability that does
   not match.
3. The publisher installs the trusted locked Wrangler toolchain before any
   Cloudflare credential is present.
4. Only the deployment step receives the Pages credential. It uploads the
   already-built artifact to a feature branch of the non-production
   `vinifera-dev` Pages project without executing PR-head source and binds the
   deployment to the exact commit. The public `vinifera` project is never a
   preview target.
5. The exact-head status reports either successful publication or explicit
   policy-approved non-applicability. Failure is terminal.

Cloudflare's direct Git preview integration remains the bootstrap fallback
until the trusted publisher exists on the default branch. After that bootstrap
is live and verified, automatic Pages preview builds must be disabled and
publication must use the trusted path. Disabling the existing integration
before the trusted publisher is active would create a required-evidence gap and
is prohibited.

### 4. Bound repair and re-review

The primary delivery agent:

1. collects all current findings before editing;
2. applies confirmed fixes and regression coverage as one batch;
3. runs focused and whole-diff validation;
4. pushes one consolidated repair candidate; and
5. requests fresh exact-head evidence.

No more than two substantive repair/re-review cycles are permitted. A
high-risk finding or a repeated blocker after the second cycle applies
`human-review-required` and escalates. Speculative or optional suggestions do
not justify churn.

CodeRabbit remains optional and non-blocking when absent or rate-limited.
Available substantive findings still require disposition. Octopus is required
for promotion and for explicitly labeled or classified high-risk work, not
every routine PR.

### 5. Use explicit authority labels

The machine-readable labels are:

| Label | Authority |
| --- | --- |
| `codex-managed` | Include the PR in trusted delivery monitoring |
| `codex-auto-fix` | Permit scoped reversible repair |
| `codex-auto-merge` | Standing owner authority to merge an eligible exact candidate to `dev` |
| `octopus-review-required` | Require trusted high-risk Octopus review |
| `human-review-required` | Pause every automated mutation |
| `do-not-merge` | Absolute merge prohibition |

Automatic merge is implemented separately from unprivileged PR validation and
must run trusted default-branch code. It must re-read the live PR, exact head
and base, risk, labels, required terminal checks, applicable preview evidence,
and thread-aware review state immediately before mutation.

The implementation contract is `.github/delivery-risk-contract.json`.
`.github/workflows/dev-automerge.yml` consumes it from a trusted
default-branch checkout and unions its canonical contexts with live `dev`
branch-protection contexts. The workflow reacts to the completed fast gate,
the successful frontend publisher's exact-identity repository dispatch, and
relevant PR metadata changes. It
reclassifies the live diff, rejects forks, stale bases, drafts, high risk,
emergency labels, missing authority, non-success terminal states, and
active requested-changes reviews, then repeats the entire evaluation
immediately before an exact-SHA squash merge. Unresolved comment threads remain
review evidence but do not block trusted low/medium-risk automation unless the
latest review state is `CHANGES_REQUESTED`.

If GitHub denies the trusted controller access to the live branch-protection
contexts, the controller falls back to the versioned delivery contract and
prints the fallback notice outside its captured decision channel. The fallback
is intentionally fail-closed around the repository-owned contract: missing
canonical checks, failed preview evidence, high-risk diffs, emergency labels,
stale bases, drafts, and active requested-changes reviews still block mutation. The
replacement control is that the contract remains reviewed in the same protected
delivery path as the controller, and any live-context API denial is visible in
the workflow log for follow-up without corrupting the exact-head decision value.

Promotion PRs similarly use `Vinifera Promotion Gate` plus exact Octopus
evidence as the canonical release check set. The controller ignores unrelated
optional check noise and stale unresolved comment threads, but fails closed on
an active requested-changes review, emergency labels, head/base drift, stale
gate evidence, or an Octopus result not bound to the captured attempt.

### 6. Keep release and production boundaries protected

Routine development does not start a promotion. One maintained release
candidate batches `dev → staging` certification. Full CI, applicable database
and browser suites, Octopus, immutable artifact identity, staging deployment,
health, and soak belong to that selected candidate.

GitHub Actions owns validation, exact artifact/evidence identity, and protected
approval. Cloudflare owns Worker versions, deployment, and rollback. Octopus
owns promotion/high-risk review, scheduled security audit, and relevant
infrastructure runbooks. A later responsibility change requires an ADR,
contract tests, and evidence that the replacement control is at least
equivalent.

Production retains one explicit protected owner approval. This decision does
not authorize production deployment, domain cutover, live billing, credential
rotation, provider activation, destructive hosted database work, or production
customer-data access.

## Consequences

- One coherent PR head normally produces one required fast-CI run.
- Draft and local WIP do not continuously consume CI or preview deployments
  after the default-branch preview bootstrap is completed.
- Backend and workflow candidates avoid browser installation unless their
  classified paths require it.
- Required contexts remain always present and distinguish success from
  non-applicability without claiming a deployment occurred.
- Privileged preview publication never executes PR-head code.
- Routine low- and medium-risk merge automation can be added without granting
  write authority to the PR workflow.
- Default workflow permissions can remain read-only because the trusted merge
  workflow declares its narrowly scoped write permissions explicitly.
- The current branch topology remains in place. Treating staging solely as a
  deployment environment is a future separately reviewed migration.

## Implementation and activation boundary

This implementation changes repository governance, candidate CI, contract
tests, and the trusted preview publisher definition. It does not itself promote
the workflow to the default branch or change Cloudflare build controls.

Before requiring `Frontend preview evidence` or disabling direct Pages
previews:

1. promote the reviewed trusted publisher to `main` through the protected
   branch process;
2. run one ready frontend PR and one ready backend PR;
3. verify exact-head success with an immutable URL for the frontend PR and
   policy-approved non-applicability for the backend PR; and
4. only then set the Pages project's automatic preview deployment setting to
   `none`.

No activation gate is completed by this ADR.

The risk-based merge implementation is source-complete on `dev` but cannot
become active until the trusted workflow reaches the repository default
branch. `dev` branch protection and default workflow-token hardening are live
repository settings with the pre-change snapshot and rollback procedure in
`docs/build-specs/github-governance-snapshot-2026-07-30.md`.

The final delivery unit adds prepared-but-disabled default-branch development
deployment, immutable selected-candidate packaging, one protected production
summary/approval surface, and a maintained Delivery Control Center issue. The
real development mutation remains disabled until the isolated Worker,
protected credentials, rollback version, and synthetic two-tenant QA
identities are externally provisioned and verified. No activation gate is
advanced by source completeness.

## Verification

- Run `node --test .github/scripts/delivery-policy.policy.mjs`.
- Parse every changed workflow and run `actionlint` when available.
- Run the repository action-policy and workflow contract suites.
- Run `git diff --check` and the complete diff secret scan.
- Confirm `Dev fast checks` and `Vinifera Promotion Gate` retain their
  exact names.
- Confirm the trusted publisher checks out only the default branch and exposes
  Cloudflare credentials only to the upload step.
