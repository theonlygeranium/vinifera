# Service-layer review rules

These rules supplement the repository-wide Greptile rules for
`server/services/`.

## Contextualize service errors

**Enforces:** Service functions must not leak uncaught exceptions. Catch
fallible operations and either return a typed error object or re-throw with
operation and tenant context while preserving the original cause.

**Why it matters:** Contextual errors make failures actionable without exposing
credentials or personal data, and typed failures keep route responses
predictable.

**Violation example:** A service directly awaits a database or provider call
with no error handling, allowing the original low-context exception to escape.

## Inject the Supabase client

**Enforces:** Service functions that access the database must receive their
Supabase client through a function or constructor parameter. They must not use
a module-level singleton.

**Why it matters:** Dependency injection supports isolated tests and prevents
shared privileged client state from crossing tenant or request boundaries.

**Violation example:** A service imports a global `supabase` client and queries
it instead of using the client supplied by its caller.
