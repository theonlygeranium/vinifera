# Local development quickstart

## Prerequisites

- Node.js 22.12+ (CI uses 22.22.0)
- npm
- Git
- A running Docker-compatible runtime

Supabase CLI 2.109.1 and Wrangler 4.114.0 are locked development
dependencies. Do not install global copies or add hosted credentials.

## Start the stack

```bash
git clone https://github.com/theonlygeranium/vinifera.git
cd vinifera
npm ci
npm run dev
```

The command resets and seeds local Supabase, creates local Auth identities,
starts the integrated Worker at `http://127.0.0.1:8788`, starts Vite hot
reload at `http://127.0.0.1:5173`, and runs authenticated smoke checks. Use:

- Staff app: `http://127.0.0.1:8788/app/`
- Member portal: `http://127.0.0.1:8788/portal/`
- Health: `curl http://127.0.0.1:8788/api/health`
- Supabase Studio: `http://127.0.0.1:54323`

Local staff accounts use password `ViniferaLocal1!`:

- `owner.sunrise@example.com`
- `owner.pacific@example.com`

Seeded member accounts are `member.sunrise@example.com` and
`member.pacific@example.com`. The web portal uses its real magic-link flow;
inspect the local mail catcher reported by `npx supabase status`. The smoke
script follows that link through the Worker callback and receives the local
member session. It separately verifies that a local Supabase bearer token
resolves the same seeded member; there is no member password-login API. Staff
password login remains a distinct local-only flow.

All fixtures are synthetic `example.com` data. Three paid shipments stop at
`charged`; Vinifera deliberately requires real compliance and label evidence
before `label_created` or `shipped`.

Press Ctrl-C to stop Worker and Vite. Local Supabase containers remain
available; stop them with `npx supabase stop`.

## Local-only cautions

`npm run dev` resets the local database on every start. Do not point it at a
hosted Supabase project or reuse its synthetic credentials outside loopback.
Supabase seed files run automatically through `db reset`; the pinned CLI does
not expose a separate `db seed` command.

Ports 5173 and 8788 must be available. Startup fails closed if either service
cannot stay running; it does not silently choose a different Vite port.

Current Supabase local images may report that development services bind to
`0.0.0.0`. Keep the machine firewall enabled and do not expose ports
`54321`–`54324` to an untrusted network. See
`docs/build-specs/local-dev-notes.md` for the clean-replay corrections and
redacted verification evidence.
