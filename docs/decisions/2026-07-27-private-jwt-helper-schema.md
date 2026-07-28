# ADR: Keep Vinifera JWT helpers outside the managed Auth schema

**Date:** 2026-07-27
**Status:** Accepted
**Decided by:** Codex under BS-05

## Context

Migration 001 originally created `org_id`, `user_role`, `auth_surface`, and
`platform_role` helper functions in Supabase's `auth` schema. Current Supabase
local owns and protects that schema as `supabase_auth_admin`; the migration
runner cannot create those functions and a native clean reset fails with
PostgreSQL `42501`.

The helpers are Vinifera authorization code, not Supabase Auth internals. They
read claims through the supported `auth.jwt()` function and are called only by
Vinifera RLS/security functions. Supabase's custom access-token hook is
separate, remains in `public`, and retains its documented execute grant to
`supabase_auth_admin`.

The continuity record shows the application migrations have not been applied
to hosted Supabase. Activation Gate 1 is still pending, so there is no hosted
function identity to preserve or migrate in place.

## Decision

Define the four claim helpers in Vinifera's application-owned `private` schema,
update every migration and pgTAP reference to the private-qualified names, and
grant execute only to `authenticated` and `service_role`. Continue to revoke
access from `public` and `anon`.

Retain the exact migration-020 replay repair that revokes the function
signature actually recreated by that migration:
`complete_email_outbox_claim(uuid, text, email_status, text, text)`.

## Rationale

- Application functions do not require ownership of a managed Supabase schema.
- Fully qualified private names preserve fail-closed behavior under the empty
  function search paths already used by Vinifera.
- The existing private-schema usage and function grants expose only the
  minimum helpers required by authenticated/service-role authorization.
- Native Supabase CLI 2.109.1 and the embedded PostgreSQL verifier both replay
  all 22 migrations after integration.
- Repairing migration 020 is safe before first hosted application migration
  and prevents every clean database from failing before migration 021.

## Alternatives Considered

- Grant the migration runner ownership or `CREATE` on `auth`: rejected because
  the schema is Supabase-managed and current local roles correctly deny it.
- Assume `supabase_auth_admin` inside the migration: rejected because the
  migration runner cannot set that role and application code should not own
  Auth internals.
- Add only a later repair migration: rejected because clean replay fails in
  migration 001 and 020 before a later migration can execute.

## Consequences

- Any SQL added later must call `private.org_id()`,
  `private.user_role()`, `private.auth_surface()`, or
  `private.platform_role()` rather than defining application helpers in
  `auth`.
- The historical edits are valid only because Gate 1 remains pending and the
  hosted application schema is absent. If that premise changes before merge,
  stop and design a forward migration instead.
- Hosted staging migration plus linked pgTAP/RLS remains required before Gate 1
  can advance.

## References

- `docs/build-specs/bs-05-local-dev-ui-readiness.md`
- `docs/build-specs/local-dev-notes.md`
- `docs/build-specs/activation-readiness.md`
- `CONTINUITY_BRIEF.md`
- Supabase Auth hooks guidance: custom hook functions live in an
  application-owned schema with an explicit `supabase_auth_admin` execute
  grant.
