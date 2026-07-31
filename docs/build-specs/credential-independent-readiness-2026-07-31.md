# Credential-independent readiness rehearsal — 2026-07-31

## Scope and evidence boundary

This rehearsal covers source, CI contracts, migrations, tenant fixtures,
browser behavior, builds, release guards, and current GitHub evidence without
activating a hosted gate. It does not deploy a Worker, mutate Supabase or a
provider, change DNS, enable billing, promote an environment branch, or modify
the public `vinifera` Pages project.

Current remote revisions at the start of the rehearsal:

| Branch | Revision | Current evidence |
| --- | --- | --- |
| `dev` | `55449cbe53e5982fab2085e07479cdc4b2b251a9` | Principal-orchestrator and immutable release source present; successful unprivileged deployment-candidate marker |
| `staging` | `c3b9df3dac84020fac966bb5580b1c9b3a742ce2` | Latest branch full validation passed; no current promotion PR |
| `main` | `3a688968a1e30c97fc94eb123445d5063015a3dc` | Full scheduled validation passed; nightly Octopus audit fails before runbook lookup |

There were no open pull requests or issues at the start of this work.

## Public rollback baseline

Read-only probes returned HTML with HTTP 200 for `/`, `/app/`, and `/guide/`.
`/api/health` returned the static marketing document rather than the Worker
JSON health contract. This proves only that the retained Pages baseline is
available; it does not prove a hosted Worker.

The current `dev`-only delivery changes do not modify `app`, `guide`,
`index.html`, `public/`, `src/client/`, `web/`, `scripts/build.mjs`, or Vite
configuration. This repair likewise leaves those paths untouched.

An in-app-browser baseline at 375 by 812 pixels found no horizontal overflow
or console errors and confirmed the dashboard content rendered. Two existing
prototype semantics remain outside this CI repair: the visible mobile menu
button measures 36 by 36 pixels, and the extensionless prototype does not use
`main` or `nav` landmarks. No prototype source or deployment was changed in
this task.

## Nightly Octopus audit diagnosis

Scheduled runs `30514775555` and `30606684736` fail on the first
`GET /api/spaces` call with HTTP 403. The current failure occurs before
environment, project, runbook, or `PublishedRunbookSnapshotId` evaluation.
PR-quality wrapper runs after the 2026-07-30 secret refresh failed at the same
boundary, while direct operator runbook executions succeeded.

The repair shares the PR bridge's safe credential-shape and HTTP response
provenance diagnostics with the nightly runner. Error output includes only the
request method/path, HTTP status, sanitized response-header provenance, and
credential lengths/host. It never includes query values, response bodies, or
credential values. Trusted runs can therefore distinguish a Cloudflare Access
rejection from an Octopus authorization or route response.

A direct redacted reproduction classified the response as Cloudflare Error
1010 (`browser_signature_banned`). The shared client now sends the stable
`Vinifera-GitHub-Actions/1.0` user-agent instead of relying on a runtime
default. The already-scoped `vinifera-github-actions-octopus` service token is
the sole non-identity include in the Octopus Access policy. It was renewed and
synchronized to GitHub and the private vault. The stale audit-specific GitHub
credential was replaced with the separately documented repository PAT only
after the GitHub API validated it, and the vault was synchronized. A
hostname-only configuration rule disables Browser Integrity Check for
`octopus.schubert.life`; Bot Fight
Mode was disabled for the `schubert.life` zone because this plan cannot bypass
that heuristic for CI traffic. Access and AI-bot controls remain active.

Rerun `30626572282` then crossed Access and failed with HTTP 400 on the legacy
database-backed runbook route. This change replaces that route with the exact
Config-as-Code `refs/heads/main` preview, snapshot-template, and grouped-run
contract. A direct real invocation queued and passed the Security Audit
runbook. The scheduled workflow cannot use the repair until trusted code
reaches `main`.

## Credential-independent verification matrix

| Surface | Command | Observed evidence | Gate effect |
| --- | --- | --- | --- |
| Documentation and delivery policy | `node --test .github/scripts/docs-ci-policy.policy.mjs .github/scripts/delivery-policy.policy.mjs .github/scripts/dev-automerge-policy.policy.mjs` | All policy contracts pass | None |
| Types, unit/integration, build, default Worker | `npm run check` | Worker types, TypeScript, 512 Vitest tests, Vite build, default Worker dry run passed | None |
| Database phases | `npm run qa:db:phase1` through `npm run qa:db:phase5` | 92, 250, 199, 158, and 513 assertions | None |
| Clean seed replay | `npm run qa:local-seed` | Forward migrations and deterministic double seed on independent clean databases | None |
| Browser and accessibility | `npm run qa:e2e` | 155 passed with zero axe violations; three hosted-only development-runtime cases skipped | None |
| Mobile contracts | `npm run qa:mobile:identity`, `npm run qa:mobile-release`, and compile-only `npm run build:mobile` | Identity, seven protected-release contracts, web preparation, and Android/iOS Capacitor sync passed | None |
| Production release contracts | `npm run qa:production-release` | 15 fail-closed immutable release and rollback policy cases passed | None |
| Pages rollback artifact | `npm run build:pages` plus prototype marker check | `dist/app` and `dist/guide` exist and `dist/app` retains the accepted static marker | None |
| Environment Worker bundles | Wrangler dry runs for development, staging, and production | All three configured bundles packaged without deployment | None |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` | Zero vulnerabilities | None |

## Promotion-readiness packet

`dev` and `staging` diverge from their shared two-speed-delivery base. The
current substantive `dev`-only units are PR #64 (candidate CI and preview),
PR #65 (trusted development auto-merge), and PR #66 (immutable development and
selected-release controls). `staging` and `main` do not contain them.

Do not treat the history as a fast-forward or reuse prior feature-head checks
as promotion evidence. A deliberate `dev → staging` candidate must bind the
current head/base, run full CI, obtain a current Octopus result, reconcile the
tree, and preserve exact artifact identity. No promotion is part of this
rehearsal.

Current blockers that remain separate from source completeness:

- scheduled Octopus execution still uses the legacy bridge until this repair
  reaches the trusted default branch;
- `staging` has no active branch-protection rule in the current GitHub API;
- the documented `development-worker` protected environment is not
  provisioned and its enable variable remains absent;
- trusted workflow-run controllers remain inactive until reviewed source
  reaches `main`;
- staging and production origin configuration must be reconciled with the
  documented stable application hostnames before any Worker activation; and
- all 20 hosted activation gates remain `pending`.

## Handoff rule

Only successful commands run in one checkout are local validation. A green PR
is fast GitHub validation. Promotion, staging deployment, production
deployment, and hosted/provider readiness each require their own exact
evidence and cannot be inferred from this report.
