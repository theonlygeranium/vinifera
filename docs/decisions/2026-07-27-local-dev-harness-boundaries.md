# ADR: Local development harness boundaries

- **Date:** 2026-07-27
- **Status:** Accepted
- **Decision owners:** Vinifera maintainers

## Context

BS-05 needs one command that can reset and seed Supabase local, create
synthetic Auth identities, start the Worker and Vite, and prove tenant
isolation. The harness handles local service-role material and application
secrets, but those values must never enter frontend builds, tracked templates,
hosted environments, or contributor-owned files. A failed startup must not
leave credentials or child processes behind.

## Decision

1. The harness accepts only credential-free loopback HTTP origins for local
   Supabase, Mailpit, and Worker endpoints. Credentials, paths, queries, and
   fragments are rejected.
2. Supabase keys are derived from the running local CLI. The harness writes
   them only to invocation-owned mode-0600 temporary files and removes those
   files on every exit path.
3. Build and Vite processes explicitly unset server-only Supabase and
   application-secret values. The tracked `.env.local.example` contains only
   `VITE_API_BASE_URL`.
4. `.dev.vars.local` is contributor-owned and is neither read nor overwritten.
5. Worker and Vite bind to `127.0.0.1`; an occupied port fails closed. Cleanup
   terminates each invocation-owned process tree, while Supabase containers
   remain available for deliberate reuse.
6. Local Auth users are synthetic `example.com` fixtures created through the
   loopback Admin API. Staff use local password login; member web login follows
   the real Mailpit magic-link callback. No member password-login API is added.
7. Application JWT helpers remain in the application-owned `private` schema,
   as decided separately in
   [the JWT helper ADR](./2026-07-27-private-jwt-helper-schema.md).
8. Embedded database verifiers import one shared PostgreSQL bootstrap module,
   and local scripts import one shared environment/password helper so security
   assumptions cannot drift between callers.

## Consequences

- `npm run dev` resets local data on every start and must never target a hosted
  Supabase project.
- Synthetic credentials are safe only on the developer loopback boundary.
- Supabase local may bind some development services to `0.0.0.0`; the machine
  firewall must prevent untrusted network access to ports 54321–54324.
- Local evidence is recorded separately from hosted activation. It does not
  promote any composite activation gate.

## Deployment impact

None. This decision changes only local tooling, credential-independent CI
verification, and documentation. It performs no hosted database, Worker,
Pages, provider, DNS, or secret mutation.

## Verification

- `npm run dev`
- `npm run qa:local-seed`
- `npm run check`
- `npm run test:e2e`
- normal Ctrl-C and occupied-port cleanup tests
- real desktop and 375px axe/touch-target checks
