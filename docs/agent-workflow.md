# Agent workflow guide

> Canonical instructions for AI coding agents working on Vinifera. Agent
> feature work targets `dev`; deliberate promotion PRs advance
> `dev → staging → main`.

## Delivery model

Vinifera uses two validation speeds:

| Path | Required aggregate | Purpose |
| --- | --- | --- |
| Feature branch or PR to `dev` | `Dev fast checks` | Fast, actionable routine-development feedback |
| `dev → staging`, `staging → main`, protected release, or explicit full run | `Vinifera Promotion Gate` | Release-quality, exact-comparison evidence |

The fail-closed classifier reports risk, execution surface, browser
applicability, preview applicability, and focused tests. It must not silently
turn every routine change into the complete release pipeline. Local and draft
work is WIP; a non-draft exact PR head is the cloud-CI candidate.

Octopus is required for `dev → staging` promotion and protected/high-risk
review. It is available by explicit request for a high-risk feature PR, but it
does not run automatically for every routine `dev` PR. CodeRabbit is optional
and non-blocking while unavailable or rate-limited.

The credential-independent database contract and complete Playwright/axe suite
remain part of full validation. Staging and production provider evidence
remains separate from source and CI evidence.

## Logical delivery and commit contract

The logical unit is one coherent PR or promotion:

1. Work only on a named isolated feature branch. Preserve unrelated checkout
   and worktree changes.
2. WIP commits are allowed on that branch. Do not use them on `dev`, `staging`,
   or `main`.
3. Add one consolidated `[Unreleased]` changelog entry for the logical PR or
   promotion. Do not duplicate it for every WIP or repair commit.
4. Before merge to `dev`, squash the branch into one logical commit.
5. The final commit must use Conventional Commits, explain what changed and
   why, and record the exact verification actually run:

```text
<type>(<scope>): <short summary>

<body explaining what changed, why, and deployment/activation impact>

Verification: <exact commands and results>
```

Create an ADR only for an architectural, security, deployment,
database-policy, or governance decision. Routine implementation,
documentation, tests, dependency maintenance, and defect repair do not require
an ADR unless they change one of those boundaries.

## Evidence vocabulary

Use these terms precisely in PRs, reports, and notifications:

- **Local validation:** named commands passed in one local checkout.
- **Fast GitHub validation:** `Dev fast checks` passed for the exact feature
  head. This is not promotion evidence.
- **Full GitHub validation:** `Vinifera Promotion Gate` passed for the
  exact head/base comparison.
- **Preview deployment:** a feature artifact is reachable at a branch alias and
  immutable Pages URL. This is not stable-dev or staging evidence.
- **Staging deployment:** the stable staging URL reports the expected
  environment marker, build SHA/artifact digest, and API health contract.
- **Production deployment:** the live URL reports the reviewed artifact and
  required health contract after protected release.
- **Hosted/provider readiness:** a provider-specific redacted runtime contract
  passes against its authorized target.

An HTTP 200, landing page, Pages deployment, local fixture, or passing CI does
not by itself prove a hosted application, database, provider, or production
state.

## Fast development loop

1. Branch from the current `origin/dev` using `feat/`, `fix/`, `refactor/`,
   `docs/`, `chore/`, or `ci/`.
2. Implement and locally validate the affected surface. Visual work includes a
   375-pixel check and accessibility coverage.
3. Add the consolidated changelog entry and update relevant documentation.
4. Push the feature branch and open a draft PR targeting `dev` when early
   collaboration is useful. General feature pushes and draft synchronization
   do not run expensive cloud CI; `Dev fast checks` concludes
   `draft_not_candidate` so that head cannot carry a reusable success.
5. Collect the complete implementation and local findings, then mark one
   coherent head ready for review. A non-draft open/reopen, ready-for-review
   event or later non-draft synchronization creates the PR candidate. An exact
   manual dispatch must run from the candidate head ref, bind the current
   `dev` base, and report the distinct `Manual exact candidate checks` context.
6. Confirm the classifier reports the exact base/head, low/medium/high risk,
   execution surface, selected lane, browser decision, preview decision, and
   focused tests.
7. Wait for exact-head `Dev fast checks`. `Feature preview decision` is always
   present. After the trusted publisher is bootstrapped on `main`,
   frontend-relevant ready candidates also publish a branch alias and immutable
   `vinifera-dev.pages.dev` URL through `Frontend preview evidence`;
   non-frontend candidates receive explicit policy-approved non-applicability
   without claiming a deployment.
8. Inspect all current thread-aware findings before editing. Apply confirmed
   repairs and regression coverage together, validate the whole diff, and push
   one consolidated repair candidate. Repeat for no more than two substantive
   repair/re-review cycles. CodeRabbit absence or rate limiting is
   non-blocking.
9. When the exact head is ready, squash-merge to `dev` only under applicable
   owner authority, low/medium risk, trusted revalidation, and neither emergency
   label. Verify the resulting `dev` commit and stable-dev deployment evidence
   that applies.

Routine `dev` work does not wait for full Android assembly, all Phase 1–5
database suites, complete Playwright/axe, provider probes, or automatic
Octopus. Authority-high-risk classification requires the trusted
`octopus-review-required` label before the fast aggregate can pass; unknown
paths are invalid and require an explicit classifier update.

### Preview trust boundary and bootstrap

The pull-request workflow may build candidate assets but has no secrets or
write authority. The preview publisher is a `workflow_run` loaded from the
default branch. It revalidates the live same-repository PR, exact head/base,
draft state, emergency labels, reserved environment branch names, and exact
live-diff applicability using trusted policy; installs trusted locked Wrangler
without credentials; and exposes the Cloudflare token only to upload the
prebuilt artifact to a feature branch of the non-production `vinifera-dev`
Pages project. It never checks out or executes PR-head code in the privileged
job, and never targets the public `vinifera` project.

Cloudflare's direct Git preview integration remains enabled until the reviewed
publisher is on `main` and a frontend plus backend proof both pass. Only then
may automatic Pages previews be disabled and `Frontend preview evidence`
become required. This ordered transition prevents a permanently pending or
missing preview context.

## Full promotion and release loop

Do not open or update a `dev → staging` promotion after every `dev` push.
Start a consolidated promotion only by manual dispatch or an explicitly
owner-authorized workflow.

1. Capture the exact promotion PR, `dev` head SHA, `staging` base SHA, and
   attempt timestamp.
2. Require `Vinifera Promotion Gate` for that exact comparison. Missing,
   failed, cancelled, stale, timed-out, ambiguous, or incorrectly skipped
   evidence fails closed.
3. Require an Octopus result bound to the exact PR, head SHA, base ref, base
   SHA, and current attempt. Active requested-changes reviews block; stale
   unresolved comment threads do not.
4. Record CodeRabbit if available, but do not require it.
5. Run the authorized staging provider preflight and final recheck. A credential
   or HTTP 200 alone is not readiness.
6. Revalidate head, base, the canonical gate, Octopus, and active reviews immediately
   before any authorized merge.
7. After staging deploys, verify its environment marker, build SHA/digest,
   API/browser/accessibility smoke, and critical error state at
   `https://vinifera-staging.edstratumlabs.ai`.
8. Production promotion remains protected and owner-authorized. Require the
   configured soak, identical reviewed artifact or content digest, and
   protected release confirmations. A known rollback target means a separately
   verified prior reviewed release SHA plus a matching previously sole-active
   Worker version; the current `main` SHA remains the workflow-control
   authorization.
9. After production deploys, verify the live marker/SHA, API health, primary
   journey, authentication boundary, accessibility smoke, and critical
   console/server state. Use the automatic rollback path if a critical check
   fails.

Android lint/debug/minified release is required when Android, Capacitor,
mobile, shared mobile-web, native configuration, or relevant dependencies
change; when full mobile validation is explicitly requested; and during the
scheduled drift run. Non-mobile promotions validate the shared mobile web
bundle without unnecessary native assembly.

## Review trust boundary

The privileged Octopus workflow runs only reviewed default-branch bridge code.
Pull-request branch names, SHAs, and diffs are untrusted data. PR head code must
never be checked out or executed in a job that can read repository, GitHub,
Octopus, Cloudflare, provider, or deployment credentials. Forks and invalid
branch names fail before any secret-bearing job starts.

The Octopus publisher has read-only PR metadata plus status-write permission.
Promotion evidence jobs have read-only Actions, checks, PR, and status
permissions so they can bind results to the exact trusted run and job without
granting repository-content mutation.

To request Octopus for a high-risk feature PR, an owner or trusted automation
applies `octopus-review-required`. Removing that label or closing the PR
cancels an in-flight attempt; the bridge rechecks that the PR is open and the
label is still present before publishing. Promotion PRs are selected by their
exact `dev → staging` or `staging → main` comparison and do not need the label.

Collect all current Octopus findings before editing. Batch confirmed fixes,
add regression coverage, run focused validation, push once, and request one
fresh exact-head review. Continue for no more than two repair/re-review cycles.
Optional or speculative suggestions do not justify churn. Escalate a repeated
substantive blocker after the bounded loop.

Resolve a review thread only after the fix or evidence-based disposition is
present and verified. Flat comments are insufficient; use thread-aware review
state so resolution, outdated state, file, and line anchors are visible.

## Authority and emergency controls

Standing owner authorization may cover routine reversible fixes, trusted
labels, squash merges to `dev`, validated promotions, protected deployments,
verification, branch cleanup, and automatic rollback. It does not bypass
branch protection, target allowlists, environment scoping, exact confirmations,
privacy, exact-revision evidence, or rollback requirements.

The `Promote dev to staging` workflow must be dispatched from the current
`main` revision. Every job that reads the event-producing PAT or staging probe
credentials uses the `promotion-control` environment. Before enabling that
workflow, configure the environment to allow only `main`, prevent self-review
where supported, and move the promotion PAT and staging probe credentials into
that environment. A feature-ref dispatch must remain unable to read them.

| Label | Effect |
| --- | --- |
| `codex-managed` | Includes the PR in recurring monitoring |
| `codex-auto-fix` | Authorizes scoped reversible repairs under the standing contract |
| `codex-auto-merge` | Authorizes merge only after the applicable exact-revision gate |
| `human-review-required` | Pauses all automated mutation, replies, resolutions, merges, promotions, and deployments |
| `do-not-merge` | Absolute merge prohibition |

Automation may apply either emergency label when risk is detected. Only the
human owner or an explicitly trusted owner workflow may remove it. Neither
control may be bypassed by standing authorization.

### Trusted development auto-merge

`.github/delivery-risk-contract.json` is the machine-readable standing
authority contract. `Trusted development auto-merge` runs only from the
repository default branch and never checks out PR-head code. A candidate is
eligible only when it:

1. targets `dev` from the same repository and is not a draft;
2. carries `codex-auto-merge` and neither emergency label;
3. has an exact base equal to the current `dev` revision and an exact live
   head;
4. reclassifies as low or medium risk under trusted policy;
5. has successful `Dev fast checks`, every live protected context, and
   `Frontend preview evidence` when applicable;
6. has no active requested-changes review; and
7. produces the same result when the entire decision is repeated immediately
   before the exact-SHA squash merge.

Missing, queued, in-progress, neutral, skipped, cancelled, stale, or failed
required evidence blocks the mutation. High-risk work is never auto-merged.

### Development deployment and selected release candidate

A merge to `dev` produces an unprivileged exact deployment candidate.
Credentialed mutation runs only from trusted default-branch controller code
and remains disabled unless `DEV_WORKER_DEPLOY_ENABLED=true` and the protected
`development-worker` environment is fully provisioned. The controller builds
once without secrets, verifies the immutable manifest before upload, deploys
one Cloudflare Worker version, proves the real runtime and tenant boundaries,
and rolls back automatically on failure.

One maintained `dev → staging` PR is the selected release candidate.
`Package selected release candidate` requires its exact full CI and Octopus
evidence and packages one Worker/assets artifact. Staging and production must
consume the reviewed artifact without rebuilding. The protected production
entry point summarizes commit, changes, risk, validation, staging evidence,
artifact digest, target, rollback, and caveats before the one `production`
environment approval.

`Delivery Control Center` is one maintained GitHub issue. It reports
implemented, CI-verified, deployed, and live-verified states separately,
current revision and candidate, automatic repairs, health, blockers, next
automatic action, and the owner action. It does not send external messages.

Apply `human-review-required`, preserve evidence, and notify the owner for:

- destructive or irreversible database operations;
- credible production data-loss or corruption risk;
- unresolved authentication, authorization, tenant-isolation, or
  secret-exposure risk;
- real-money billing activation or an unapproved charge/refund decision;
- legal or regulatory judgment;
- suspected credential compromise requiring rotation;
- DNS/domain ownership changes that could disconnect production;
- materially different product choices with no documented preference;
- repeated substantive failure after the bounded repair attempts; or
- external failure without a safe fallback or rollback.

Routine reversible implementation, accessibility fixes, test repairs,
dependency maintenance, CI corrections, additive forward migrations, normal
protected deployments, and automatic rollbacks do not by themselves require
escalation.

## Stable environment and privacy contract

| Surface | Stable URL | Boundary |
| --- | --- | --- |
| Dev | `https://vinifera-dev.edstratumlabs.ai` | Development credentials and non-production data only |
| Staging | `https://vinifera-staging.edstratumlabs.ai` | Isolated staging credentials, sandboxes, and non-production data |
| Live | `https://vinifera-live.edstratumlabs.ai` | Protected production credentials and reviewed production artifact |
| Marketing/rollback | `https://vinifera.edstratumlabs.ai` | Retained public static baseline |

Feature branch aliases and immutable Cloudflare Pages deployment URLs supplement
the stable dev URL. Protect dev and preview surfaces with Cloudflare Access
whenever they expose non-public application or test data. Never use production
credentials or production customer data in development, staging, previews,
fixtures, review prompts, source, or logs.

## Agent prompt template

```text
Repository: theonlygeranium/vinifera

- Read AGENTS.md, CONTINUITY_BRIEF.md, and the relevant specification/ADRs.
- Preserve unrelated changes and work from an isolated branch based on current
  origin/dev.
- Target dev with one logical PR and one consolidated CHANGELOG entry.
- WIP commits may exist only on the feature branch. Before merge to dev, squash
  to one Conventional Commit with a body and exact Verification line.
- Run affected local checks, then own the exact-head Dev fast checks and Pages
  preview loop. Request Octopus only when high-risk or explicitly directed.
- CodeRabbit is optional while unavailable or rate-limited.
- Do not initiate an environment promotion unless this task explicitly
  includes that protected phase.
- Respect human-review-required and do-not-merge without exception.

Task:
[DESCRIBE THE TASK]
```

## Readiness checklists

### Feature PR to `dev`

- [ ] PR is non-draft and the current head is the intended coherent candidate
- [ ] Exact base/head classifier evidence is present
- [ ] Risk, surface, focused tests, browser, and preview decisions are present
- [ ] `Dev fast checks` passes on the current head
- [ ] `Frontend preview evidence` records exact-head URLs or policy-approved non-applicability when the trusted publisher is active
- [ ] Affected local tests and 375-pixel/accessibility checks are recorded
- [ ] Available substantive findings are dispositioned
- [ ] No more than two substantive repair/re-review cycles were required
- [ ] Zero blocking unresolved threads remain
- [ ] One consolidated changelog entry is present
- [ ] Final squash commit body and exact verification are prepared
- [ ] No secrets or production data are in the diff or preview
- [ ] Neither emergency label is present

### Promotion or protected release

- [ ] Exact PR/head/base/attempt evidence is present
- [ ] `Vinifera Promotion Gate` passes for that comparison
- [ ] Octopus passes for that exact comparison and attempt
- [ ] Required skipped jobs cannot be mistaken for success
- [ ] Zero blocking unresolved threads remain
- [ ] Authorized provider readiness probes pass with redacted evidence
- [ ] Staging marker, SHA/digest, health, and soak requirements pass
- [ ] Production artifact identity and rollback target are known
- [ ] Protected environment and exact confirmation requirements are satisfied
- [ ] Neither emergency label is present

## Direct-push enforcement

`Block direct push to main` remains the protected production-branch context.
It verifies GitHub associated-PR evidence for the exact resulting commit and
fails closed on forced updates, missing evidence, API errors, or timeout. The
push-side audit is not a substitute for branch protection: `main` must require
PR-only updates, strict required checks, conversation resolution,
administrator enforcement, and no force push.
