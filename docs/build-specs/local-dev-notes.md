# BS-05 local development verification notes

**Date:** 2026-07-27
**Branch:** `feat/bs-05-local-dev-ui-readiness`
**Base:** `origin/main` at `3d6c850`
**Activation result:** All 20 composite gates remain `pending`; BS-05 records
partial local prerequisite evidence for Gates 1, 7, and 15

## Implemented workflow

- `npm run dev` invokes an executable, fail-fast orchestration script for the
  pinned Supabase CLI, clean database reset and configured seed, loopback Auth
  bootstrap, Vite build, Wrangler local Worker, Vite hot reload, and
  authenticated smoke checks.
- `supabase/seed.sql` creates two organizations/default brands, four tiers
  (three for Sunrise), eleven synthetic members, one release, six shipments,
  and four billing attempts. Every email uses `example.com`.
- Auth users are created through the loopback Supabase Admin API after reset,
  never by writing internal Auth tables. The workflow derives local keys
  without printing them, writes a mode-0600 temporary Worker environment file,
  removes the CLI status file immediately after parsing, and removes only its
  invocation-owned Worker environment file on exit. It never overwrites a
  contributor's `.dev.vars.local`. Build and Vite explicitly inherit none of
  the Supabase/service-only values.
- Worker and Vite processes are terminated as complete descendant trees.
  Startup fails instead of choosing a different Vite port when 5173 is busy,
  requires both HTTP services to respond in the same bounded readiness cycle,
  re-probes both after authenticated smoke,
  and cleanup removes invocation-owned credential files before stopping child
  processes so both Ctrl-C and startup-error paths remain fail-closed.
- The frontend honors `VITE_API_BASE_URL` for credential-free HTTPS or
  loopback HTTP. Production remains same-origin when it is unset; Capacitor
  builds still require a secure, port-free API origin.
- The local security and process-lifecycle decisions are recorded in
  [the local harness ADR](../decisions/2026-07-27-local-dev-harness-boundaries.md).

## Schema reconciliation and safety

The BS-05 examples predate the current schema. Vinifera has `organizations`,
`brands`, `club_tiers`, `members`, and `shipments`; it has no `clubs` or
`orders` table. `member_status` has no `pending`, so pending enrollment is
represented by active members without Stripe identifiers. Shipment states use
`pending`, `charged`, and `declined`, not `processing` or `failed`.

The three paid fixtures stop at `charged`. Synthetic `shipped` rows would
bypass the Phase 4 requirement for current ShipCompliant evidence and a
successful label attempt. The local workflow does not fabricate provider
proof.

The member web flow is `POST /api/auth/member/magic-link`; there is no member
password-login route. The smoke script uses staff password login plus the real
member magic-link endpoint, and verifies the seeded member's bearer session
directly through local Supabase Auth.

## Clean-replay corrections

Native Supabase local exposed two defects that the embedded PGlite gate could
not reproduce:

1. Migration 001 created Vinifera claim helpers in Supabase's managed `auth`
   schema. Current local Supabase correctly denies the migration runner
   `CREATE` there (`42501`). The helpers and every migration/test reference now
   use Vinifera's application-owned `private` schema. Supabase's documented
   `public.custom_access_token_hook` remains in `public` with the existing
   `supabase_auth_admin` execute grant.
2. Native seed statement batching dropped the `ON COMMIT DROP` temporary brand
   map before later statements used it. Seed rows now resolve each
   trigger-created default brand directly from `organizations`.
3. Re-inserting an existing organization still fires the
   `seed_default_brand` `BEFORE INSERT` trigger before `ON CONFLICT`, which
   collides with the existing `(organization_id, slug)` brand. The seed updates
   known organizations first and inserts only missing IDs, and the verifier
   now applies the entire seed twice before checking invariant counts.
4. The Phase 3–5 embedded verifiers now import one neutral PostgreSQL bootstrap
   module. Phase 4 and Phase 5 no longer scrape executable source from the
   Phase 3 verifier, so refactoring one gate cannot silently break the others.

Migration 020 also revoked
`complete_email_outbox_claim(uuid, uuid, email_status, text, text)` after
recreating the text-argument overload. The revoke now names
`complete_email_outbox_claim(uuid, text, email_status, text, text)`. The
continuity record confirms hosted application migrations have not been
activated, and both embedded and native clean replay now prove the corrected
chain.

The real login flow additionally showed that a second server client could not
read cookies written only to the current response. Staff login and invite
acceptance now resolve the principal with the client that established or
refreshed that session.

The member smoke follows the complete browser contract: it preserves the PKCE
and signed member-link cookies returned by the request, reads the newly
captured Mailpit message, follows Supabase verification into the Worker
callback, asserts an HTTP-only member session cookie, and loads seeded portal
shipment data.

That populated portal check exposed parallel organization- and brand-scoped
foreign keys that made PostgREST's implicit `shipments` relationship embeds
ambiguous. The portal query now names the brand-scoped release and item
relationships. Repeated session checks also use one canonical midnight UTC
timestamp with the existing one-event-per-member-per-day key, so database and
analytics idempotency fingerprints replay without noisy failed writes.

## Evidence collected

| Check | Result |
|---|---|
| Toolchain | Node 22.22.3; npm 10.9.8; Supabase CLI 2.109.1; Wrangler 4.114.0; Docker client 29.6.2/server 29.5.2 on Colima 0.10.3 |
| `npm ci` | Passed; 406 packages installed, 407 audited; 0 vulnerabilities |
| Script syntax | `bash -n` and `node --check` passed |
| Integrated tests | TypeScript passed; Vitest passed 42 files and 436/436 tests; the focused browser-origin, harness, and retention set passed 62/62 |
| Embedded phase gates | Phase 1–5 passed 92/92, 250/250, 199/199, 158/158, and 513/513 assertions |
| Embedded replay | Passed all 22 migrations, two consecutive seed applications, fixture cardinality/state mix, tenant integrity, fixed brand IDs, and an independent clean-database identity comparison |
| Native seed replay | The integrated 22-migration head passed `supabase db reset --local` with the configured seed and produced the exact default brand IDs `20000000-0000-4000-8000-000000000001` and `20000000-0000-4000-8000-000000000002`. |
| Auth bootstrap | Passed four loopback-only staff/member identities |
| Worker smoke | Health 200; unauthenticated members 401; both staff logins 200; Sunrise roster exactly 9; Pacific request for Sunrise brand 403 |
| Member flow | Seeded bearer session resolved the correct member/brand; Mailpit link completed the PKCE callback, issued an HTTP-only member cookie, and returned populated portal shipment data |
| Shutdown safety | Normal Ctrl-C and occupied-port startup failure both removed the temporary env file and the complete Worker/Vite process trees; ports 8788/5173 and `.dev.vars.local` were absent afterward |
| Rendered UI | Real staff login opened Sunrise workspace and populated 9-row member roster on desktop and 375x812 |
| Accessibility/mobile | axe-core returned zero WCAG 2.1 A/AA violations at desktop and 375px; no visible interactive target was below 44x44px at 375px |
| Integrated Playwright suite | 145/145 against the local Worker; mocked API scenarios remain the canonical deterministic UI coverage |

The Playwright suite's request interception still supplies deterministic data
for its canonical scenarios. It ran against the real local Worker assets; the
separate browser and HTTP checks above prove the non-mocked Supabase data path.

## Activation boundary

This evidence does not complete any composite activation gate. It records
partial local prerequisites for Gates 1, 7, and 15, while all 20 statuses
remain `pending`. Staging migration plus linked pgTAP/RLS, provider-backed
billing, hostname-derived context, and production-like multi-brand proof still
require authorized Track A environments. BS-05 establishes that the local
application is ready for that work without claiming external activation.

Supabase local currently warns that its development services bind to
`0.0.0.0`; the shared default keys, unauthenticated Studio/pgMeta surfaces, and
ports 54321-54324 must remain behind the developer machine's firewall. Worker
and Vite bind explicitly to `127.0.0.1`.
