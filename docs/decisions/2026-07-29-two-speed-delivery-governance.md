# ADR: Two-speed delivery governance

- **Date:** 2026-07-29
- **Status:** Accepted
- **Decision owner:** EdStratum Labs human owner
- **Scope:** CI, review, commit, promotion, deployment, and evidence governance
- **Amends:** `2026-07-27-pr-ownership-and-automation-governance.md`,
  `2026-07-28-agents-md-governance-update.md`,
  `2026-07-28-automated-dev-staging-promotion.md`, and
  `2026-07-28-switch-greptile-to-octopus.md`

## Context

Vinifera applied release-quality validation and two external AI reviewers to
nearly every development update. The complete database, browser, and Android
lanes provided strong promotion evidence, but made routine feature feedback
slow and repeatedly consumed review capacity. The promotion workflow also
started after every push to `dev`, creating release work before a coherent
group of changes was selected for staging.

The owner wants fast, reversible iteration without weakening authentication,
authorization, tenant isolation, database, provider, staging, production,
privacy, credential, or rollback boundaries.

## Decision

### 1. Separate development and release evidence

Routine feature branches and pull requests targeting `dev` use an
always-present `Dev fast checks` aggregate. A fail-closed classifier selects
documentation, routine, or high-risk focused work. The lane checks the exact
diff, installs locked dependencies, validates TypeScript and Worker types,
builds the web application, runs focused tests, checks whitespace and secret
patterns, and executes a small application/navigation/accessibility browser
smoke.

The Cloudflare Pages branch preview runs independently and records both its
branch alias and immutable deployment URL. Preview evidence does not imply
stable-dev, staging, production, database, or provider readiness.
Branch protection requires the independent exact-head feature-preview result
(`Cloudflare Pages: vinifera` in the current project configuration) alongside
`Dev fast checks`; the informational preview-discovery job is not a substitute
for Cloudflare's own check. The `dev` branch deployment separately emits
`Cloudflare Pages: vinifera-dev`.

Promotion and release comparisons retain the exact required
`Type, test, build, and package` aggregate. The full lane validates the exact
head and base, complete application and database suites, full Playwright/axe,
release builds, and the applicable provider or deployment gates. Native
Android assembly is selected for mobile-relevant changes, an explicit full
mobile request, and scheduled drift validation; other changes still validate
the shared mobile web bundle.

Unknown or ambiguous classification fails closed. A skipped optional job may
not leave a required context pending, and a skipped required job may not be
treated as success.

### 2. Make promotion deliberate

`dev → staging` promotion is consolidated and begins only through a manual or
explicitly owner-authorized workflow. It does not trigger after every push to
`dev`. The promotion captures the exact `dev` head, `staging` base, PR, and
attempt, then requires full CI, Octopus, thread-aware review state, staging
provider probes, and final evidence revalidation.

`staging → main` and production remain protected owner-authorized operations.
They require staging deployment and soak evidence, an environment marker,
expected build SHA, API/browser/accessibility health, an identical reviewed
artifact or verified content digest, and a known rollback target. Direct
pushes to `staging` and `main` remain prohibited.

Standing owner authorization may allow trusted automation to merge, promote,
deploy, verify, or roll back only through these protected controls.
`human-review-required` pauses all mutation, merge, promotion, and deployment;
`do-not-merge` is absolute. Only the owner or an explicitly trusted owner
workflow may remove either label.

### 3. Prioritize Octopus and make CodeRabbit optional

Octopus is required for the consolidated `dev → staging` promotion and may be
requested for a high-risk feature PR. Routine `dev` PRs do not automatically
consume an Octopus review. The trusted bridge executes only reviewed
default-branch code; pull-request code is immutable review input and never
executes beside GitHub, Octopus, Cloudflare, provider, or repository
credentials. The published result is bound to the exact PR, head SHA, base ref,
base SHA, and current attempt.

The explicit feature-review request is the persistent
`octopus-review-required` label. Closing the PR or removing the label cancels
the current attempt and prevents a late success publication.

CodeRabbit is optional and non-blocking while unavailable or rate-limited.
Available substantive findings must still be dispositioned, but the absence of
a CodeRabbit run is not a merge or promotion gate.

### 4. Treat the PR as the logical delivery unit

- One logical PR or promotion receives one consolidated `[Unreleased]`
  changelog entry.
- WIP commits are permitted only on an isolated feature branch.
- Feature PRs are squash-merged into `dev`.
- The final logical commit uses Conventional Commits, includes a substantive
  body, and records the exact verification actually run.
- Reviewer-repair commits may remain visible during review but are included in
  the final squash rather than creating duplicate changelog entries.
- ADRs are required only for architectural, security, deployment,
  database-policy, or governance decisions. Routine implementation,
  documentation, tests, dependencies, and defect repairs do not require one
  unless they change one of those boundaries.

### 5. Use precise evidence terminology

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Local validation | Named commands passed in one checkout | GitHub, deployment, or provider state |
| Fast GitHub validation | `Dev fast checks` passed for the exact feature head | Promotion readiness |
| Full GitHub validation | `Type, test, build, and package` passed for the exact comparison | Deployment or provider readiness |
| Preview deployment | Exact artifact is reachable at branch/immutable Pages URLs | Stable dev or protected environment state |
| Staging deployment | Marker, SHA/digest, and health pass at staging | Production readiness without soak and release gates |
| Production deployment | Reviewed artifact and health pass at live | Independent provider activation not covered by the release |
| Hosted/provider readiness | Redacted provider-specific runtime contract passes | Authorization to activate another provider |

An HTTP 200, landing page, or healthy static surface alone proves none of the
environment-specific rows above.

## Environment and privacy boundaries

The stable URLs remain:

- Dev: `https://vinifera-dev.edstratumlabs.ai`
- Staging: `https://vinifera-staging.edstratumlabs.ai`
- Live: `https://vinifera-live.edstratumlabs.ai`
- Marketing/static rollback: `https://vinifera.edstratumlabs.ai`

Feature branch aliases and immutable Cloudflare Pages deployment URLs are
additional preview evidence. Cloudflare Access must protect dev or preview
surfaces that expose non-public application or test data. Development and
staging must not use production data or production provider credentials.
Production credentials remain scoped to protected production environments.
The static Pages rollback baseline remains retained.

## Consequences

- Routine feedback can complete without Android assembly, every database
  suite, complete Playwright/axe, provider probes, or automatic AI review.
- High-risk and promotion paths remain fail-closed and exact-revision bound.
- Promotion work is intentionally batched instead of following every `dev`
  update.
- Optional CodeRabbit capacity cannot stall delivery; Octopus capacity is
  reserved for higher-value review boundaries.
- Branch protection and environment settings must require the correct
  aggregate for each branch and must not require a retired CodeRabbit context.

## Implementation boundary

This ADR and its implementation PR change repository governance and workflow
definitions only. They do not merge a feature or promotion PR, provision a
hosted target, activate a provider, deploy an environment, move DNS, enable
live billing, expose private data, or mark an activation gate complete.

GitHub does not activate a newly introduced default-branch event workflow from
a feature PR alone. After this implementation PR is reviewed and merged to
`dev`, the owner must use the existing protected/manual branch-promotion
process to place the reviewed bridge and workflow definitions on `staging` and
then `main`; this task intentionally does not perform either promotion. Only
after `main` contains the reviewed files may `promotion-control` be enabled and
the new required contexts be added to branch protection. This bounded
bootstrap is an installation step, not evidence that Octopus or a deployment
has run.
