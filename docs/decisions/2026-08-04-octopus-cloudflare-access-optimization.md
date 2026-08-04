# Octopus and Cloudflare Access Optimization

Date: 2026-08-04

## Context

Vinifera now uses fast promotion lanes for hidden HTML smoke artifacts,
cleanup, static routing, and release-control changes. The latest end-to-end
smoke drill proved that GitHub validation no longer selects the full package,
mobile web, or Android jobs for those paths.

Octopus still has two separate roles:

- Deployment evidence for real `main` application changes.
- Trusted PR quality gates for protected promotions and high-risk development
  changes.

Cloudflare Access sits in front of `octopus.schubert.life`. That Access login
is separate from Octopus authentication. If a browser sees a Cloudflare OTP page
before the Octopus login form, the OTP is being required by a Cloudflare Access
application or policy, not by Octopus.

## Current Documentation Findings

- Octopus recommends GitHub Actions as the CI/CD orchestration layer for
  creating releases, deploying releases, pushing build information, running
  runbooks, and waiting for tasks.
- Octopus supports GitHub Actions OIDC through `OctopusDeploy/login`; this is
  preferred over long-lived API keys once an Octopus service account OIDC
  identity exists.
- Version-controlled Octopus projects should create releases with both the Git
  reference and exact commit SHA when the OCL files live in the same repository
  as the application, so release snapshots bind to the built commit rather than
  a moving branch head.
- Channels can constrain Git references, choose different lifecycles, scope
  steps, and require custom release fields. Those are useful for separating
  smoke/test channels from real application deployment channels.
- Runbooks are the right Octopus primitive for repeatable operational checks,
  maintenance, audits, and emergency tasks.
- Cloudflare Access service-token policies are the right pattern for GitHub
  Actions and other machine clients. For `octopus.schubert.life`, the browser
  bypass policy is intentionally scoped to the Octopus hostname so Octopus can
  own human authentication while the Access application still hosts the
  non-identity service-token path for automation.

Primary references:

- https://octopus.com/docs/packaging-applications/build-servers/github-actions
- https://octopus.com/docs/octopus-rest-api/openid-connect/github-actions
- https://octopus.com/docs/projects/version-control
- https://octopus.com/docs/projects/version-control/creating-and-deploying-releases-version-controlled-project
- https://octopus.com/docs/releases/channels
- https://octopus.com/docs/runbooks
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/

## Decision

1. Do not run `Octopus Deploy - Main to Development` for hidden promotion-smoke
   HTML artifacts or `public/_redirects` tombstone-only changes. These are
   Cloudflare Pages/static-routing proofs, not application deployments.
2. Keep Cloudflare Access service-token authentication for GitHub Actions and
   other machine clients that call Octopus.
3. Keep the interactive Cloudflare OTP requirement removed for
   `octopus.schubert.life`. The intended Cloudflare Access policy shape is:
   browser traffic matches `Browser Bypass - Octopus self-auth`, then Octopus
   owns human authentication; GitHub Actions traffic can still use the
   `vinifera-github-actions-service-token` non-identity policy.
4. Keep the main deployment and PR quality gate workflows on the verified
   API-key login path through the Cloudflare Access proxy. Keep the
   `vinifera-gha` OIDC service account identity and
   `OCTOPUS_SERVICE_ACCOUNT_ID` secret available only for a standalone future
   smoke test until Octopus accepts the GitHub Actions assertion repeatedly.
5. Keep production Worker releases manual. Fast dev/staging visibility should
   not turn production deployment into an accidental push side effect.

## Implementation Notes

- `.github/workflows/octopus-main-deploy.yml` ignores:
  - `public/vinifera-promotion-smoke-*.html`
  - `public/_redirects`
- `tests/scripts/workflow-promotion-smoke.test.mjs` asserts this trigger guard.
- Protected-branch `ci-script-tested` changes run through the same focused
  release-control job as workflow/controller patches, so script-only policy
  fixes do not invoke the full app, browser, mobile web, or Android lanes.
- `npm audit --omit=dev --audit-level=moderate` remains in the full lane. The
  current lockfile clears it with targeted overrides for transitive
  `brace-expansion` and `undici`; do not relax the audit gate to hide Wrangler
  or Miniflare advisories.
- `package.json` and `package-lock.json` stay high-risk and full-lane, but do
  not automatically select Android. Use explicit `full_mobile=true` or touch a
  native/mobile path when a dependency update must prove Android assembly.

## Current Operator State

Cloudflare Access policy state is managed outside this repository. As of the
2026-08-04 verification, `octopus.schubert.life` has the intended two-policy
shape:

- browser users match `Browser Bypass - Octopus self-auth`, with decision
  `bypass`;
- GitHub Actions can use `vinifera-github-actions-service-token`, with decision
  `non_identity`;
- the former Cloudflare OTP allow policy for the Octopus hostname remains
  removed.

The Cloudflare Access application object must stay registered even though
browser users bypass it. The application object hosts the GitHub Actions
service-token policy, and its `/.well-known/cloudflare-access-protected-resource/`
metadata endpoint is expected while that object exists.

## Regression Probe

`.github/workflows/octopus-access-smoke.yml` runs every six hours and can be
manually dispatched. It verifies:

- `/` redirects to `/app`, not to `cloudflareaccess.com`;
- `/app` returns the Octopus app shell;
- `/api` returns Octopus API metadata;
- `/api/users/me` returns Octopus-native `401` JSON without an API key;
- the existing Cloudflare Access and Octopus secrets can authenticate to
  `/api/users/me` in GitHub Actions.

This probe is intentionally lightweight and does not create Octopus releases,
deploy Workers, apply migrations, or mutate Cloudflare policy.

## Octopus Authentication State

The production workflow path remains API-key authentication through the
Cloudflare Access proxy for:

- `.github/workflows/octopus-main-deploy.yml`;
- `.github/workflows/octopus-pr-quality-gates.yml`.

Both workflows use `OctopusDeploy/login@v2` with `api_key` and pass
`OCTOPUS_API_KEY` to downstream Octopus calls. This is the verified production
path until Octopus accepts the GitHub Actions OIDC service-account identity.
The shared `.github/scripts/octopus-runbook.mjs` bridge still accepts either
`OCTOPUS_ACCESS_TOKEN` or `OCTOPUS_API_KEY`, preferring the bearer access token
when both are present, so a future OIDC retry does not need another runbook
bridge change.

The self-hosted Octopus instance advertises its OIDC token endpoint as
`http://localhost:8080/token/v1` in `/.well-known/openid-configuration`. GitHub
Actions cannot reach that container-local address, so the Cloudflare Access
proxy rewrites only the discovery document's `token_endpoint` back to the
runner-local proxy URL. Do not remove that rewrite unless Octopus is reconfigured
to advertise the externally reachable `octopus.schubert.life` endpoint.

Do not remove `OCTOPUS_API_KEY` until every Octopus workflow has been migrated
and scheduled/manual smoke runs prove OIDC authentication works everywhere.
The 2026-08-04 OIDC trial reached Octopus through the proxy but Octopus rejected
the GitHub assertion even after API-visible service-account OIDC identities were
created. Treat OIDC as a follow-up hardening item, not the deployment-critical
path.

## Branch Hygiene

`dev`, `staging`, and `main` can intentionally diverge during smoke artifact
creation, cleanup, and protected-branch promotion bookkeeping. For narrow
release-control patches that only affect `main` behavior, branch from
`origin/main` and target `main` directly to avoid dragging unrelated `dev`
history into the diff. For feature/application work, keep using the normal
feature-to-`dev`, `dev`-to-`staging`, `staging`-to-`main` path.
