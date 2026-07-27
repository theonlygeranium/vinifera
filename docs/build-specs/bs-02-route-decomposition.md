# BS-02 — Route Layer Decomposition (from `app.ts`)

**Wave:** 1 (start after BS-01 merges)
**Branch:** `refactor/route-layer-decomposition`
**Estimated duration:** 3–4 hours
**Parallel-safe:** Yes — runs concurrently with BS-03, BS-04
**Spawns subagents:** Recommended — one subagent per route domain (see §Subagent strategy)
**Blocks:** BS-05 (local dev readiness depends on a clean `app.ts`)

---

## Mandatory pre-task reading

1. `AGENTS.md`
2. `CONTINUITY_BRIEF.md`
3. `docs/agent-workflow.md`
4. `docs/codebase-assessment-2026-07-27.md` §3 ("Monolithic files") and §4 (B-1)

---

## Context: the problem

`app.ts` is ~69 KB and registers all Express routes inline. This is the lowest-risk monolith to break apart because route files are thin by design — they validate inputs with Zod, call service functions, and return responses. They should not contain business logic. The goal of this spec is to extract every route domain into a dedicated file under `server/routes/`, leaving `app.ts` as a pure mounting file.

This unlocks:
- Multiple Codex agents editing different routes simultaneously without merge conflicts
- Greptile's per-directory `.greptile/rules.md` rules (from BS-01) applying cleanly to each route file
- Faster CI because only changed route files are re-typechecked

---

## Subagent strategy

The primary agent should read `app.ts`, identify all route groups, and create a dispatch plan. Recommended groupings for subagents (adjust if the actual file differs):

| Subagent | Route prefix | Branch suffix |
|----------|-------------|---------------|
| Sub-A | `/api/members`, `/api/auth` | `routes-members-auth` |
| Sub-B | `/api/clubs`, `/api/tiers` | `routes-clubs-tiers` |
| Sub-C | `/api/orders`, `/api/fulfillment` | `routes-orders-fulfillment` |
| Sub-D | `/api/analytics`, `/api/webhooks` | `routes-analytics-webhooks` |
| Sub-E | All remaining routes + `app.ts` mount refactor | `routes-misc-mount` |

Each subagent opens its own PR. The primary agent then opens a final integration PR.

**Coordination rule:** subagents must not touch `app.ts` directly. They create their route file and export a router. Only Sub-E touches `app.ts` to mount the routers.

---

## Task 1: Audit `app.ts` and produce route manifest

Read `server/app.ts` in full. Produce a file `docs/build-specs/route-manifest.md` listing:
- Every route registration: method, path, handler function name, middleware chain
- Any inline business logic (a route that does more than validate + call service = flagged)
- Any direct Supabase calls inside route handlers (violates `.greptile/rules.md` Rule 1 from BS-01)

Do not begin decomposition until this manifest is committed.

---

## Task 2: Create the `server/routes/` directory structure

Create the directory skeleton:

```
server/routes/
  index.ts          ← aggregates and re-exports all routers
  members.ts
  auth.ts
  clubs.ts
  tiers.ts
  orders.ts
  fulfillment.ts
  analytics.ts
  webhooks.ts
  admin.ts          ← if admin routes exist
```

Each route file must follow this exact template structure:

```typescript
import { Router } from 'express'
import { z } from 'zod'
// import service functions here — no direct supabase imports

const router = Router()

// --- schemas ---
// All Zod schemas for this route group defined here

// --- routes ---
// router.get(...)
// router.post(...)

export default router
```

---

## Task 3: Migrate routes domain by domain

For each route group:

1. Copy route handlers from `app.ts` into the corresponding `server/routes/<domain>.ts` file
2. Verify all Zod validation is preserved — do not relax input validation
3. Replace any middleware that was applied globally in `app.ts` but only applies to a domain with explicit per-router `router.use()` calls
4. Export `default router`

**Critical: during migration, do not refactor logic.** If a route handler has inline business logic, copy it as-is and add a `// TODO(BS-03): move logic to service layer` comment. That refactor belongs to BS-03, not here. Mixing structural changes with logic changes creates untestable diffs.

---

## Task 4: Refactor `app.ts` to a mounting file

After all route files exist, `app.ts` should become a pure mounting file:

```typescript
import membersRouter from './routes/members'
import authRouter from './routes/auth'
import clubsRouter from './routes/clubs'
// ... etc

app.use('/api/members', membersRouter)
app.use('/api/auth', authRouter)
app.use('/api/clubs', clubsRouter)
// ... etc
```

Global middleware (CORS, cookie-parser, rate limiters from BS-04) stays in `app.ts`. Route-specific middleware moves to the route file.

Target size for `app.ts` after refactor: under 100 lines.

---

## Task 5: Run the full test suite

```bash
npm run test:unit
npm run test:e2e
npm run typecheck
```

All 352 Vitest tests and 145 Playwright tests must pass. Zero regressions are acceptable. If a test fails, fix the import path or export — do not modify test assertions.

---

## Task 6: Update `server/routes/index.ts`

Export a `mountRoutes(app: Express)` function that applies all routers. This makes `app.ts` a single function call:

```typescript
// app.ts
import { mountRoutes } from './routes'
mountRoutes(app)
```

---

## CHANGELOG entry

```markdown
### Refactored
- Extracted all route handlers from monolithic `app.ts` into domain-scoped files under `server/routes/`
- `app.ts` reduced to a mounting file under 100 lines
- Created `server/routes/index.ts` with `mountRoutes()` function
- Produced `docs/build-specs/route-manifest.md` documenting all routes, middleware chains, and flagged inline logic
```

---

## Acceptance criteria

- [ ] `server/routes/` directory exists with one file per domain
- [ ] `app.ts` is under 100 lines
- [ ] `server/routes/index.ts` exports `mountRoutes()`
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run test:unit` passes (352/352)
- [ ] `npm run test:e2e` passes (145/145)
- [ ] No route file imports `@supabase/supabase-js` directly (enforce via `grep -r "createClient" server/routes/`)
- [ ] `docs/build-specs/route-manifest.md` committed
- [ ] `CHANGELOG.md` updated
- [ ] PR body lists all extracted route domains

---

## Greptile workflow

After opening the PR:
1. Comment `@greptileai review only the route layer changes` to target the review
2. Greptile will apply Rule 1 (no direct DB in routes) and Rule 2 (no circular imports) from BS-01's `.greptile/rules.md`
3. Address all Greptile findings before marking PR ready
4. Use `@greptileai suggest another approach` if a suggested fix looks wrong for this codebase