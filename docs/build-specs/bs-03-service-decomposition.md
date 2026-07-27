# BS-03 — Service Layer Decomposition (`core-club.ts` + `integrations.ts`)

**Wave:** 1 (start after BS-01 merges; runs concurrently with BS-02, BS-04)
**Branch:** `refactor/service-layer-decomposition`
**Estimated duration:** 4–6 hours
**Parallel-safe:** Yes — no file overlap with BS-02 or BS-04
**Spawns subagents:** Required — one subagent per service domain
**Blocks:** Full parallel Sprint 2 work (every future feature touches a service file)

---

## Mandatory pre-task reading

1. `AGENTS.md`
2. `CONTINUITY_BRIEF.md`
3. `docs/agent-workflow.md`
4. `docs/codebase-assessment-2026-07-27.md` §3 ("Critical risks") — specifically the 207 KB `core-club.ts` and 206 KB `integrations.ts` entries
5. All `.greptile/rules.md` files (committed by BS-01) — rules 2, 4, 6, and 8 directly govern service layer structure

---

## Context: the problem

`core-club.ts` (207 KB) and `integrations.ts` (206 KB) are the two largest files in the repository. Every Codex agent that needs to add, fix, or extend business logic is forced to touch one of these files, creating a near-certain merge conflict in any parallel-agent scenario. The decomposition strategy is purely additive: extract into new files, re-export from the original for backward compatibility, and remove the backward-compat re-exports only after all imports have been updated.

This is the highest-risk structural change in the entire sprint. The agent must treat correctness as the only metric — no logic changes, no new features, no "while I'm here" improvements. Extract-only.

---

## Subagent strategy

**Primary agent role:** audit both files, produce the decomposition manifest, create the directory skeleton, then dispatch subagents.

**Coordination protocol:**
- Each subagent owns exactly one output file
- No subagent should modify `core-club.ts` or `integrations.ts` directly
- The primary agent performs the final step: add barrel re-exports to the originals and update all import paths

| Subagent | Extracts from | Output file | Branch suffix |
|----------|--------------|-------------|---------------|
| Sub-A | `core-club.ts` — member lifecycle functions | `server/services/members.ts` | `svc-members` |
| Sub-B | `core-club.ts` — club/tier management | `server/services/clubs.ts` | `svc-clubs` |
| Sub-C | `core-club.ts` — order processing logic | `server/services/orders.ts` | `svc-orders` |
| Sub-D | `core-club.ts` — analytics/ML stubs | `server/services/analytics.ts` | `svc-analytics` |
| Sub-E | `integrations.ts` — Stripe functions | `server/services/stripe.ts` | `svc-stripe` |
| Sub-F | `integrations.ts` — EasyPost functions | `server/services/easypost.ts` | `svc-easypost` |
| Sub-G | `integrations.ts` — Resend/Klaviyo functions | `server/services/comms.ts` | `svc-comms` |
| Sub-H | `integrations.ts` — connector/webhook handling | `server/services/webhooks.ts` | `svc-webhooks` |

---

## Task 1: Produce the decomposition manifest

Read `server/services/core-club.ts` and `server/services/integrations.ts` in full. Produce `docs/build-specs/service-manifest.md` with:

For every exported function:
- Function name and signature
- Destination file (which subagent target does it belong to)
- Internal dependencies (which other functions it calls within the same file)
- External dependencies (Supabase, Stripe SDK, EasyPost SDK, etc.)
- Any activation guard present or absent (flags violation of Rule 6 from `.greptile/rules.md`)

Group functions by extraction cohesion, not purely by domain label — if a function in the "members" logical domain calls three "orders" functions, the manifest should flag the coupling and suggest which direction the dependency should flow.

Commit `docs/build-specs/service-manifest.md` and `docs/build-specs/route-manifest.md` together **before dispatch**.

---

## Task 2: Create the `server/services/` directory structure

Create the skeleton of new service files (empty exports only, no logic yet):

```
server/services/
  members.ts      ← extracted from core-club.ts
  clubs.ts        ← extracted from core-club.ts
  orders.ts       ← extracted from core-club.ts
  analytics.ts    ← extracted from core-club.ts (ML stubs)
  stripe.ts       ← extracted from integrations.ts
  easypost.ts     ← extracted from integrations.ts
  comms.ts        ← extracted from integrations.ts (Resend + Klaviyo)
  webhooks.ts     ← extracted from integrations.ts
  index.ts        ← barrel export for all services
```

Commit the skeleton before dispatching subagents. An empty file prevents subagents from creating conflicting structures.

---

## Task 3: Subagent extraction protocol

Each subagent must follow this exact protocol:

**Step 1:** Read the service manifest for their assigned functions.

**Step 2:** Copy the identified functions verbatim into the target file. Do not paraphrase, simplify, or refactor. A comment is acceptable; a rewrite is not.

**Step 3:** Resolve imports. The target file needs its own import block. Derive it from the source file's imports, keeping only what the extracted functions actually use.

**Step 4:** If any extracted function violates `.greptile/rules.md` Rule 8 (missing tenant isolation), add a comment `// TODO(BS-08): add brand_id scoping — see rule 8` but do not fix it now. The fix belongs to BS-06.

**Step 5:** Export all extracted functions.

**Step 6:** Run `npm run typecheck`. Zero new type errors are accepted.

**Step 7:** Open a PR with the branch suffix from the subagent table.

---

## Task 4: Primary agent — add backward-compatible re-exports

After all subagent PRs are merged, update `core-club.ts` and `integrations.ts` to re-export from the new files:

```typescript
// core-club.ts (after extraction)
export { createMember, updateMember, deactivateMember } from './members'
export { createClub, updateTier } from './clubs'
// ... etc
```

This preserves all existing import paths while the codebase transitions. Existing tests that import directly from `core-club.ts` continue to pass without modification.

---

## Task 5: Update direct imports in `server/routes/` (coordinate with BS-02)

Once BS-02 is merged:
- Scan all route files for imports from `core-club.ts` or `integrations.ts`
- Replace with direct imports from the new service files
- Remove the backward-compat re-exports from `core-club.ts` and `integrations.ts` only after this step is complete

---

## Task 6: Run the full test suite

```bash
npm run test:unit
npm run test:e2e
npm run typecheck
npm run build
```

All 352 Vitest tests, 145 Playwright tests, zero axe violations, and clean build are required. This is a pure structural refactor — any test failure identifies a previously hidden coupling or broken import path, not a test to be skipped.

---

## CHANGELOG entry

```markdown
### Refactored
- Decomposed `core-club.ts` (207 KB) into domain-scoped service files: `members.ts`, `clubs.ts`, `orders.ts`, `analytics.ts`
- Decomposed `integrations.ts` (206 KB) into integration-scoped service files: `stripe.ts`, `easypost.ts`, `comms.ts`, `webhooks.ts`
- Added barrel re-exports to originals for backward compatibility during transition
- Created `server/services/index.ts` barrel export
- Produced `docs/build-specs/service-manifest.md` documenting all extracted functions and their dependency graph
```

---

## Acceptance criteria

- [ ] Eight new service files exist under `server/services/`
- [ ] `server/services/index.ts` barrel-exports all service functions
- [ ] `core-club.ts` and `integrations.ts` contain only re-export statements (no business logic)
- [ ] `npm run typecheck` passes with zero new errors
- [ ] `npm run test:unit` passes (352/352)
- [ ] `npm run test:e2e` passes (145/145)
- [ ] `grep -r "import.*core-club" server/routes/` returns zero results
- [ ] `grep -r "import.*integrations" server/routes/` returns zero results
- [ ] `docs/build-specs/service-manifest.md` committed
- [ ] `CHANGELOG.md` updated

---

## Greptile workflow

After the integration PR is open:
1. Comment `@greptileai check for any business logic remaining in core-club.ts or integrations.ts`
2. Comment `@greptileai verify no circular imports were introduced between the new service files`
3. Address all findings — Greptile has full codebase graph context and will detect cross-file coupling that static analysis misses