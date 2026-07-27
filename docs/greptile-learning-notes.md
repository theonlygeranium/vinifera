# Greptile Learning Notes

This file documents intentional patterns that automated review may flag. A
negative reaction is appropriate only when the comment matches one of these
documented cases exactly; a real security, tenancy, or correctness finding must
still be fixed.

## HTTP-only cookie authentication

Vinifera deliberately uses separate secure, HTTP-only cookies for staff and
member web sessions. Native clients use the dedicated mobile exchange
boundary. A suggestion to replace web-cookie authentication with browser-held
Bearer tokens conflicts with the architecture and `.greptile/rules.md` Rule 5.

## Activation guards can resemble dead code

Provider calls remain behind environment, credential, and target-authorization
guards until their activation gate passes. The dormant path is intentional and
must fail closed. Do not remove an activation guard merely because every
current environment takes the inactive branch.

## Stable database-backed idempotency keys

Stripe, EasyPost, Resend, and other mutating provider operations derive
idempotency from stable database records or durable command identifiers.
Replacing those values with random UUIDs or timestamps on each retry would
allow duplicate provider mutations.

## Privileged cross-brand schedulers

Some service-role-only schedulers claim work across brands because a cron or
queue wake signal has no tenant principal. The claim RPC authenticates the
service role and returns the authoritative `organization_id` and `brand_id`;
all subsequent reads, writes, provider credentials, and completions are bound
to that claimed row. A blanket recommendation to accept a browser-supplied
brand for these schedulers would weaken the boundary. Comments that identify a
follow-up query not bound to its claimed tenant are valid and should be fixed.

## Compatibility service files and `any`

The current `core-club.ts` and `integrations.ts` monoliths contain no TypeScript
`any` annotations. BS-03 decomposes them without changing behavior. Do not
suppress a real `any` introduced in either an extracted service or a changed
legacy file; `.greptile/rules.md` Rule 10 applies to all new server code.
