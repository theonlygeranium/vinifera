# Two-speed delivery implementation manifest

**Base:** `origin/dev` at `6dc8ea3697af46a965440efbcce12731bcc03af4`

**Branch:** `ci/two-speed-delivery`

**Target:** `dev`

## Objective

Separate routine development feedback from promotion-grade validation without
weakening staging, production, tenant, credential, or rollback boundaries.
Routine pull requests to `dev` receive a small, always-present fast aggregate
and an independently produced Cloudflare Pages preview. Promotion pull
requests and protected release operations retain exact-revision, fail-closed
release evidence.

## Workstreams and file ownership

| Workstream | Primary files | Contract |
| --- | --- | --- |
| Fast development lane | `.github/workflows/dev-fast.yml`, `.github/scripts/delivery-policy.mjs` | Classify exact base/head changes as documentation, routine, high-risk, or invalid; run type/Worker checks, build, focused tests, whitespace, secret scan, and browser smoke; expose `Dev fast checks` on every applicable run. |
| Full promotion lane | `.github/workflows/ci.yml`, `.github/workflows/promote-dev-to-staging.yml` | Preserve `Type, test, build, and package`; run full release validation for staging/main promotion events; select native Android work only for mobile-relevant changes, explicit full-mobile requests, or nightly drift detection; never promote after every `dev` push. |
| Review trust boundary | `.github/workflows/octopus-pr-quality-gates.yml`, `.github/scripts/octopus-runbook.mjs` | Run automatic Octopus review for promotion comparisons; permit explicit review requests for high-risk `dev` PRs; execute only trusted default-branch bridge code and bind status to the exact PR, head, base, and attempt. |
| Contract tests | `.github/scripts/delivery-policy.policy.mjs`, `tests/scripts/promote-dev-to-staging.test.mjs`, focused workflow tests | Prove lane selection, concurrency, skipped-job aggregation, high-risk coverage, promotion triggers, Android selection, exact evidence, optional CodeRabbit, and secret isolation. |
| Browser smoke | `tests/e2e/smoke.spec.ts`, Playwright/package configuration only if required | Cover application boot, primary navigation, and a basic axe accessibility pass without replacing the complete promotion suite. |
| Governance and operations | `AGENTS.md`, `docs/agent-workflow.md`, `CONTINUITY_BRIEF.md`, `.github/pull_request_template.md`, relevant runbooks, new ADR, `CHANGELOG.md` | Establish one changelog entry per logical PR/promotion, isolated-branch WIP commits, squash merge into `dev`, narrowed ADR requirements, Octopus-first review policy, optional CodeRabbit, evidence-level terminology, stable URLs, and activation boundaries. |

`CHANGELOG.md` remains owned by the primary agent during integration so the
logical PR receives one consolidated delivery entry after this manifest entry.

## Integration invariants

- The dirty primary checkout remains untouched.
- No pull-request head code executes in a job that can read repository,
  Octopus, Cloudflare, provider, or deployment credentials.
- Required aggregates use `if: always()` and reject failed, cancelled,
  stale, missing, ambiguous, or incorrectly skipped required jobs.
- Documentation and routine changes never inherit release success from a
  skipped job.
- `dev` previews do not wait for Android, database architecture suites, the
  complete Playwright suite, provider probes, or automatic Octopus review.
- Staging and production never consume development or preview credentials.
- The stable dev, staging, live, and marketing/rollback addresses remain
  unchanged. Feature branch aliases and immutable Pages deployment URLs are
  retained as additional evidence.
- No provider, billing, email, DNS, database, Worker, mobile-store, or
  production activation occurs in this task.

## Integration verification

The primary agent will run and record:

1. focused classifier, workflow-policy, Octopus, and promotion contract tests;
2. YAML parsing and supported action validation;
3. `npm run check`;
4. all applicable Phase 1–5 database suites;
5. the focused browser smoke suite and complete Playwright/axe suite;
6. selected mobile-web/native validation according to the new classifier;
7. `git diff --check`;
8. secret-pattern, unsafe-permission, and untrusted-code execution review; and
9. cold/warm development-lane and full-promotion timing estimates with the
   removed routine jobs and projected execution reduction.

The implementation will be pushed only after local integration and audit.
The resulting pull request will target `dev`; this task does not initiate an
environment promotion or production deployment.
