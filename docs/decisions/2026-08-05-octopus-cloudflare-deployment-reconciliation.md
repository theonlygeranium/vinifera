# ADR: Octopus↔Cloudflare Deployment Model Reconciliation

**Date:** 2026-08-05
**Status:** Accepted
**Supersedes:** Implicit assumption that Octopus deploys the Vinifera application via PM2 on Schubert

## Context

Vinifera is deployed as a **Cloudflare Worker** using Wrangler, with deployment owned by GitHub Actions workflows (`dev-worker-release.yml`, `production-worker-release.yml`). However, the Octopus Deploy configuration contained two artifacts that assumed a traditional Node.js/PM2 deployment model:

1. **`variables.ocl`** defined `AppHealthUrl` as `http://localhost:3000/health` — a local Node.js process endpoint that does not exist in the Worker deployment model. The real health endpoint is the deployed Worker URL.
2. **`deployment_process.ocl`** contained a `restart-application` step that SSH'd to Schubert and ran `pm2 restart`, and a `smoke-test` step hitting `localhost:3000`. Neither is valid for a Cloudflare Worker deployment.

Additionally, the GitHub Actions workflow `octopus-main-deploy.yml` included a "Deploy to Development" step that triggered the Octopus deployment process. Since Octopus cannot actually deploy a Cloudflare Worker (it lacks Wrangler integration and the Workers API credentials), this step produced a failed or misleading deployment record rather than a real deployment.

This mismatch created a situation where:
- The Octopus release audit trail referenced health checks that could never succeed.
- The deployment process attempted PM2 operations on a server that runs no PM2-managed Node.js process for Vinifera.
- The GitHub Actions "Deploy to Development" step created the appearance of a deployment without performing one.

## Decision

Adopt **Option B: Octopus as review/orchestration and release-audit record; GitHub Actions owns Worker deployment.**

### Changes

1. **`variables.ocl`**: `AppHealthUrl` corrected from `http://localhost:3000/health` to `https://vinifera-development.jeff-f69.workers.dev/health` — the real deployed Worker health endpoint.

2. **`deployment_process.ocl`**: The `restart-application` (PM2) step is deprecated and replaced with `verify-worker-health`, an evidence probe that checks the deployed Worker's health endpoint. The `smoke-test` step is merged into `verify-worker-health`. The `pull-and-build` step is retained but annotated to clarify that Octopus serves as a build-evidence record only; Worker deployment is performed by GitHub Actions. The `notify-on-failure` step is retained.

3. **`octopus-main-deploy.yml`**: Reduced to evidence-only. The "Deploy to Development" step is removed. The workflow now creates an Octopus release (with build information) as an audit record but does not attempt to trigger a deployment that Octopus cannot perform. The job name changes from "Create Release and Deploy to Development" to "Create Octopus Release (Audit Record)".

### What Octopus still does

- Creates release records with git commit references — providing an auditable chain from commit to release.
- Pushes build information — recording what was built and when.
- Provides the manual Staging→Production approval UI for owner-authorized promotion gates.
- Runs PR quality-gate runbooks for branch protection.

### What GitHub Actions does

- Deploys the Cloudflare Worker via Wrangler (`dev-worker-release.yml`, `production-worker-release.yml`).
- Owns the Worker deployment lifecycle — build, deploy, health-check, rollback.

## Alternatives Considered

### Option A: Rewrite Octopus deployment process to call Wrangler
Would duplicate the entire Worker release logic already implemented in GitHub Actions. High effort, negative value — porting a more capable system into a less capable one. Octopus's step-based process model is poorly suited for Wrangler's deploy lifecycle.

### Option C: Full removal of Octopus deployment role
Would lose the Octopus release-audit ledger and the manual Staging→Production approval UI. Option B preserves these capabilities while accepting that Octopus does not perform the actual deployment.

## Consequences

- The Octopus deployment process will no longer attempt PM2 operations that cannot succeed.
- The `verify-worker-health` evidence probe will fail (exit 1) if the Worker has not been deployed by GitHub Actions — this is correct behavior, as it surfaces the fact that the deployment step is owned elsewhere.
- The `octopus-main-deploy.yml` workflow no longer creates a misleading "deployment" record; it creates only a release/audit record.
- OIDC migration between GitHub Actions and Octopus remains parked (not abandoned) — the structural prerequisite (Octopus service-account OIDC identity) is not yet available. Current auth path is `api_key` + Cloudflare Access service token.
- The wiki recommendation to treat Octopus as "review/orchestration control until a reviewed deployment model aligns these systems" is now reflected in the configuration.
