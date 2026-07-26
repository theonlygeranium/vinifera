# ADR: Credential-gated hosted and release control

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera production engineering

## Context

Vinifera's Phase 1–5 application architecture can be completed before every
provider, mobile-signing, store, and production control-plane credential is
available. The public custom domain is already attached to a verified
Cloudflare Pages prototype, so a partially configured Worker must never replace
that recoverable baseline.

Repository-level credentials also predate the production application and do not
prove that a target is an isolated staging project. Possession of a credential
therefore cannot be treated as deployment authorization.

## Decision

Hosted activation uses four independent controls:

1. **Environment scope.** Mutating workflows consume only `STAGING_*`,
   `PRODUCTION_*`, or mobile-release environment secrets. Generic repository
   secrets are accepted only by the manual, read-only readiness probe.
2. **Hashed target policy.** Staging Supabase/Cloudflare targets and production
   Cloudflare resources are SHA-256 allowlisted in tracked policy. Empty
   allowlists fail closed. Raw account, project, zone, and Worker-origin values
   do not enter source control.
3. **Explicit activation.** Staging mutations require repository enable
   variables. Production Worker bootstrap/version deployment/domain cutover and
   signed mobile build/store upload require exact confirmation phrases in
   protected, manually dispatched workflows.
4. **Runtime evidence.** Staging migrations run the linked native pgTAP suite.
   A deployed Worker must return the Vinifera health contract and configured
   core capabilities. Production custom-domain cutover requires every Phase
   1–5 capability, a retained active Pages domain, an immutable deployed Worker
   version, and automatic restoration on a failed health check.

The production release workflow accepts Stripe test-mode keys only and forces
`LIVE_BILLING_ENABLED=false`. Live billing is a separate human-approved
operation and is not implied by a production Worker or store release.

Mobile compilation remains credential-free. Signed Android App Bundles and iOS
archives materialize credentials only in ephemeral runner paths. Store delivery
requires a second exact confirmation and uses the official Google Play edit
transaction or Apple upload tooling.

## Consequences

- All Phase 1–5 source and release architecture can be completed and tested
  without inventing credentials or production mocks.
- Adding a secret alone cannot deploy, cut over a domain, enable live billing,
  or upload to a store.
- Activating a new target requires a small reviewed policy change and the
  corresponding documentation/changelog commit.
- The current Pages project remains a non-destructive rollback surface.
- Hosted/provider exit criteria remain explicitly deferred until their redacted
  evidence exists.

## Rejected alternatives

- **Use generic repository secrets for deployment.** Rejected because target
  intent and environment isolation are ambiguous.
- **Place raw target IDs in tracked configuration.** Rejected because hashes
  are sufficient for equality authorization.
- **Automatically move the public domain after a successful build.** Rejected
  because build success does not prove configuration, provider, database, or
  rollback readiness.
- **Treat simulator or unsigned native output as store proof.** Rejected
  because neither validates distribution signing nor store delivery.

## Verification

- Run `npm test`, including the activation, production-release, hosted
  readiness, and mobile-release suites.
- Run `npm run build:worker` and `npm run build:worker:production`.
- Parse every workflow as YAML.
- Confirm all tracked target allowlists are empty until independently resolved
  environment resources are approved.
- Confirm the static Pages source files and rollback artifact are unchanged.
