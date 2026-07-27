# Vinifera review rules

These rules encode the architectural, security, and tenancy boundaries that
Greptile must apply to every pull request.

## 1. No direct route-to-database access

**Enforces:** Route handlers in `server/routes/` must call service-layer
functions. They must not create Supabase clients, call Supabase directly, or
construct SQL.

**Why it matters:** Keeping database access behind services preserves a single
authorization and tenant-scoping boundary and makes route handlers testable.

**Violation example:** A route file contains
`import { createClient } from "@supabase/supabase-js"` and queries a table
inside the request handler.

## 2. No circular imports between layers

**Enforces:** Files in `server/services/` must not import from
`server/routes/`. Route handlers must call integrations through
`server/services/`, never import from `server/integrations/` directly.

**Why it matters:** One-way dependencies keep routes, services, and provider
adapters independently testable and prevent initialization-order failures.

**Violation example:** A route file contains
`import { klaviyo } from "../integrations/klaviyo"`.

## 3. No provider secrets in source

**Enforces:** TypeScript source files must not contain string literals matching
`sk_live_`, `sk_test_`, `rk_live_`, `ep_test_`, or `re_`.

**Why it matters:** Provider credentials belong in encrypted CI or Worker
secrets. Committing one to source exposes the credential through repository
history and expands its blast radius.

**Violation example:** A `.ts` file assigns
`const stripeKey = "sk_live_example"`.

## 4. Zod validation on all API inputs

**Enforces:** Every Express handler that reads `req.body` or `req.params` must
validate the relevant input with a Zod schema before accessing any field.

**Why it matters:** Runtime validation prevents malformed or attacker-controlled
payloads from crossing the API boundary under an assumed TypeScript shape.

**Violation example:** A handler starts with
`const { memberId } = req.body` without a preceding `parse()` or `safeParse()`
against a Zod schema.

## 5. HTTP-only cookie JWTs only

**Enforces:** Web-session authentication tokens must be read from
`req.cookies`, never from `req.headers.authorization`. Native clients must use
the separate mobile exchange endpoint.

**Why it matters:** HTTP-only cookies keep web JWTs out of browser JavaScript
and preserve the intentionally separate native authentication boundary.

**Violation example:** Web-session middleware accepts an
`Authorization: Bearer` header and treats it as the staff or member session.

## 6. Fail-closed provider activation

**Enforces:** Code that calls an external provider must confirm the provider's
activation guard before executing the request.

**Why it matters:** Vinifera's deferred providers must remain dormant until
credentials, target authorization, and explicit human activation are present.

**Violation example:** A service calls EasyPost, Stripe, Resend, or a connector
API without first checking its activation state.

## 7. Idempotency keys on all mutating provider calls

**Enforces:** Stripe PaymentIntent creation, EasyPost label creation, and
Resend send operations must include an idempotency key derived from a stable
UUID stored on the associated database record.

**Why it matters:** Stable keys prevent retries, lease recovery, and concurrent
workers from creating duplicate charges, labels, or messages.

**Violation example:** A provider mutation is issued with no idempotency-key
argument or with a newly generated value on each retry.

## 8. Tenant isolation on every service function

**Enforces:** Every service function that queries the database must constrain
the operation by `brand_id` or `organization_id`.

**Why it matters:** The server uses privileged database credentials in some
paths, so explicit service-layer scoping is required as defense in depth for
multi-tenant data.

**Violation example:** A service selects or mutates rows by record ID alone
without a brand or organization condition.

## 9. CHANGELOG.md must be updated with every commit

**Enforces:** Every non-documentation commit must include an entry under
`[Unreleased]` in `CHANGELOG.md`.

**Why it matters:** The changelog is the durable audit trail for operators and
future agents reconstructing what changed and how deployment is affected.

**Violation example:** A pull request changes TypeScript, workflow, or
configuration files but contains no `CHANGELOG.md` diff.

## 10. No `any` type in new server code

**Enforces:** New or changed files under `server/` must use concrete types or
`unknown` plus a type guard instead of TypeScript `any`.

**Why it matters:** `any` bypasses compile-time protection at security,
provider, and tenant-data boundaries.

**Violation example:** New server code declares
`const data: any = await response.json()`.
