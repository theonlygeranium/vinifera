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
  Actions and other machine clients. Broad bypass policies disable Access
  security controls and request logging and should not be used persistently.

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
3. Remove or narrow the interactive Cloudflare OTP requirement for
   `octopus.schubert.life` in Cloudflare Zero Trust. The preferred model is:
   browser traffic reaches the normal Octopus login page directly, while
   automation continues to authenticate with the existing Service Auth policy.
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

## Remaining Operator Action

Cloudflare Access policy changes are outside this repository. Use the
Cloudflare dashboard or API with a token that has `Access: Apps and Policies
Write` to inspect the Access application matching `octopus.schubert.life`.

Target result:

- no interactive OTP wall before the Octopus login page;
- no persistent broad `bypass everyone` policy for automation;
- Service Auth remains available for `OCTOPUS_CF_ACCESS_CLIENT_ID` and
  `OCTOPUS_CF_ACCESS_CLIENT_SECRET` used by GitHub Actions.
