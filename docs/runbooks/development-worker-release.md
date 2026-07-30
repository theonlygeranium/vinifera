# Development Worker Release

## Current state

The protected workflow structure is source-complete and intentionally
`prepared_disabled`. It does not prove a Worker deployment. The static Pages
prototype remains separate and an HTTP 200 from it is not development-runtime
evidence.

Activation requires all of the following before setting repository variable
`DEV_WORKER_DEPLOY_ENABLED=true`:

- the controller is reviewed and promoted to the default branch;
- protected environment `development-worker` exists;
- scoped `DEV_CLOUDFLARE_ACCOUNT_ID` and `DEV_CLOUDFLARE_API_TOKEN` secrets can
  edit only `vinifera-development`;
- the Worker already has a known healthy rollback version;
- required application secrets are configured on the Worker without printing
  their values;
- `DEV_WORKER_ORIGIN` is the isolated
  `vinifera-development.<account>.workers.dev` origin;
- two synthetic QA staff identities exist in different organizations, each
  with at least one member in the first tenant; and
- no production provider, customer data, DNS, domain, or live-billing
  credential is involved.

These are external provisioning/activation boundaries. This repository change
does not create or rotate them.

## Flow

1. A protected `dev` push runs unprivileged `Development deployment candidate`.
2. Default-branch `Development Worker release` verifies the exact current
   `dev` revision and activation variable.
3. An unprivileged job builds one Worker bundle and static-assets directory,
   creates a deterministic SHA-256 manifest, and uploads the package.
4. The protected deployment job checks out only default-branch controller
   code, downloads the prebuilt package, verifies every digest, captures the
   prior rollback version, and uploads with Wrangler `--no-bundle`.
5. Cloudflare deploys that exact version to 100% of the isolated development
   Worker.
6. Hosted Playwright proof checks exact revision/environment health,
   configuration readiness, staff login, a tenant-scoped member journey,
   cross-tenant denial, the anonymous member-auth boundary, desktop rendering,
   375-pixel rendering, browser console/page errors, and HTTP 5xx responses.
7. Any post-deploy failure rolls back to the captured prior version.
8. Success retains a credential-free evidence artifact containing the commit,
   manifest digest, environment, and Worker version ID.

## Release candidate and promotion

`Promote dev to staging` continues to maintain one `dev → staging` PR and run
full CI plus Octopus once per selected comparison.
`Package selected release candidate` accepts only the current exact `dev` head
of that PR after both certification contexts pass. It builds one prebuilt
Worker/assets package and manifest. The protected staging job resolves that
exact package from its successful trusted packaging run, verifies the
candidate tree and every digest, uploads the prebuilt bundle with
`--no-bundle`, records the version, and deploys it without rebuilding.
Production bootstrap or version upload requires the same package run, source
commit, and artifact digest; it verifies that the package tree is identical to
the reviewed production tree before uploading the same bytes. Environment
bindings and secrets remain environment-scoped and are not part of the
code/assets artifact.

This artifact-consumer structure is implemented but not activated by this
change. Staging still requires its existing protected environment,
allowlisted targets, credentials, database gate, full CI, and explicit
activation variable. Production still requires its protected owner approval
and existing operation-specific confirmations. No package has been uploaded
to either environment by this implementation.

The current branch topology remains unchanged. Migrating staging from a
long-lived code branch to a deployment environment is future ADR work.

## Rollback

For development, the workflow automatically rolls back on failed verification.
For source rollback, revert the squash commit on `dev`. For governance
rollback, set `DEV_WORKER_DEPLOY_ENABLED=false`; do not delete versions,
secrets, environments, or branches as an incident shortcut.
