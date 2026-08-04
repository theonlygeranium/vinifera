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
4. Treat Octopus OIDC as the next credential-hardening improvement. The repo can
   adopt `OctopusDeploy/login` after an Octopus service account OIDC identity is
   created and the service account ID is stored as a GitHub secret.
5. Keep production Worker releases manual. Fast dev/staging visibility should
   not turn production deployment into an accidental push side effect.

## Implementation Notes

- `.github/workflows/octopus-main-deploy.yml` ignores:
  - `public/vinifera-promotion-smoke-*.html`
  - `public/_redirects`
- `tests/scripts/workflow-promotion-smoke.test.mjs` asserts this trigger guard.

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

## OIDC Migration Preparation

Octopus OIDC remains a future credential-hardening improvement. Implementing it
requires human/admin setup outside this repository:

- create or choose an Octopus service account for GitHub Actions OIDC;
- configure the OIDC identity in Octopus for `theonlygeranium/vinifera`;
- add the resulting service account identifier as a GitHub secret, for example
  `OCTOPUS_SERVICE_ACCOUNT_ID`;
- then replace API-key login in Octopus workflows with `OctopusDeploy/login`
  and `id-token: write`.

Do not remove `OCTOPUS_API_KEY` until every Octopus workflow has been migrated
and a scheduled/manual smoke run proves OIDC authentication works.

## Branch Hygiene

`dev`, `staging`, and `main` can intentionally diverge during smoke artifact
creation, cleanup, and protected-branch promotion bookkeeping. For narrow
release-control patches that only affect `main` behavior, branch from
`origin/main` and target `main` directly to avoid dragging unrelated `dev`
history into the diff. For feature/application work, keep using the normal
feature-to-`dev`, `dev`-to-`staging`, `staging`-to-`main` path.
