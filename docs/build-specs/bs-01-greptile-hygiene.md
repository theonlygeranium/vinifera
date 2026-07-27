# BS-01 — Greptile Configuration Upgrade & Repo Hygiene

**Wave:** 0 (runs first — all other specs depend on this being merged)
**Branch:** `chore/greptile-config-and-repo-hygiene`
**Estimated duration:** 1–2 hours
**Parallel-safe:** Yes — no other spec should run until this merges
**Spawns subagents:** No — single focused agent

---

## Mandatory pre-task reading

Before writing a single line of code, read these files in full:

1. `AGENTS.md` — prime directives, file ownership rules
2. `CONTINUITY_BRIEF.md` — current state, what is and is not activated
3. `docs/agent-workflow.md` — branching rules, Greptile workflow
4. `greptile.json` — current Greptile config (you will replace it)
5. `docs/codebase-assessment-2026-07-27.md` §4 — issues B-4 and B-8

---

## Context: why this runs first

Every PR opened by every other build spec will be reviewed by Greptile. If Greptile has no architectural rules for this codebase, it reviews in a vacuum and misses domain-specific violations. This spec upgrades `greptile.json` to a full `.greptile/` folder configuration that encodes vinifera's architecture, before any structural work begins. It also removes the 552 KB committed generated artifact that bloats every clone.

---

## Task 1: Upgrade Greptile config to `.greptile/` folder format

The current `greptile.json` exists at repo root. Migrate it to the recommended `.greptile/` folder format 【kg-wwwgre-25bb03ac】, which supports per-directory overrides and inline markdown rules.

### Create `.greptile/config.json`

```json
{
  "strictness": "medium",
  "commentTypes": {
    "logic": true,
    "security": true,
    "style": true,
    "syntax": false
  },
  "ignore": [
    "*.lock",
    "package-lock.json",
    "worker-configuration.d.ts",
    "android/**",
    "ios/**",
    "dist/**",
    ".wrangler/**"
  ]
}
```

### Create `.greptile/rules.md`

Write a markdown rules file with the following rules. Each rule must include: what it enforces, why it matters, and a concrete example of a violation.

**Rules to encode:**

1. **No direct route-to-database access** — Route handlers in `server/routes/` (once created) must call service functions, never call `supabase` directly or construct SQL. Violation: importing `createClient` in a route file.

2. **No circular imports between layers** — `server/services/` must not import from `server/routes/`. `server/integrations/` must not be called directly from route handlers; they must go through `server/services/`. Violation: `import { klaviyo } from '../integrations/klaviyo'` inside a route file.

3. **No provider secrets in source** — TypeScript source files must not contain string literals matching `sk_live_`, `sk_test_`, `rk_live_`, `ep_test_`, or `re_`. Violation: hardcoded Stripe key in any `.ts` file.

4. **Zod validation on all API inputs** — Every Express route handler that reads `req.body` or `req.params` must validate with a Zod schema before accessing any field. Violation: `const { memberId } = req.body` without a preceding `z.parse()` or `z.safeParse()`.

5. **HTTP-only cookie JWTs only** — Auth tokens must be read from `req.cookies`, never from `req.headers.authorization` for web sessions. Mobile auth uses a separate exchange endpoint. Violation: reading `Authorization: Bearer` header in web-session middleware.

6. **Fail-closed provider activation** — Any code that calls an external provider must check the provider activation guard before executing. Violation: calling an EasyPost, Stripe, Resend, or connector API without a preceding activation check.

7. **Idempotency keys on all mutating provider calls** — Stripe PaymentIntent creation, EasyPost label creation, and Resend send calls must supply an idempotency key derived from a stable UUID in the database record. Violation: provider mutation call without an idempotency key argument.

8. **Tenant isolation on every service function** — Every service function that queries the database must include a `brand_id` or `organization_id` scope condition. Violation: a service function that returns rows without a tenant-scoping WHERE clause.

9. **CHANGELOG.md must be updated with every commit** — Non-documentation commits that do not include a CHANGELOG entry should be flagged.

10. **No `any` type in new server code** — TypeScript `any` in `server/` files defeats type safety on multi-tenant data. Use `unknown` with a type guard, or a specific type. Violation: `const data: any = ...` in server code.

### Create `.greptile/files.json`

Point Greptile at the architectural context files it should read when reviewing every PR:

```json
{
  "files": [
    "AGENTS.md",
    "CONTINUITY_BRIEF.md",
    "docs/architecture.md",
    "docs/agent-workflow.md"
  ]
}
```

### Create per-directory overrides

Create `.greptile/` config overrides in these subdirectories:

**`server/services/.greptile/rules.md`** — Extra rules for the service layer:
- Service functions must not throw uncaught exceptions; all errors must be caught and returned as typed error objects or re-thrown with context.
- Service functions that call the database must use the Supabase client injected via function parameter, not a module-level singleton, to support test injection.

**`supabase/migrations/.greptile/config.json`** — Relax style rules, focus on SQL safety:
```json
{
  "commentTypes": {
    "logic": true,
    "security": true,
    "style": false,
    "syntax": false
  }
}
```

**`tests/.greptile/config.json`** — Relax rules in test files:
```json
{
  "commentTypes": {
    "logic": true,
    "security": false,
    "style": false,
    "syntax": false
  }
}
```

---

## Task 2: Remove `worker-configuration.d.ts` from version control

This is a 552 KB generated artifact produced by `wrangler types`. It must not be committed.

**Steps:**
1. Add `worker-configuration.d.ts` to `.gitignore`
2. Run `git rm --cached worker-configuration.d.ts` to stop tracking it without deleting it locally
3. In `.github/workflows/ci.yml`, find the typecheck step and add `npm run cf-typegen` immediately before `npm run typecheck` so the file is generated at CI time
4. Verify locally that `npm run qa:worker-types && npm run typecheck` still passes

**Exact `.gitignore` line to add** (after the existing `dist/` entry):
```
worker-configuration.d.ts
```

**Exact CI step to add** (find the typecheck step and prepend):
```yaml
- name: Generate Worker types
  run: npm run cf-typegen
```

---

## Task 3: Create Phase 5 QA report stub

Create `docs/build-specs/phase-5-qa-report.md` with the following populated content. Use the CI run IDs and metrics from `CONTINUITY_BRIEF.md` — do not fabricate any data:

The file should document:
- Phase 5 architecture closure commit `5d3dadd` and GitHub Actions run `30235083942`
- Test suite results: Vitest 352/352, database gates 92/231/199/158/494, Playwright 145/145, zero axe violations
- Performance measurements: single-worker 100-member roster 444.6 ms, Phase 5 LCP 416 ms, CLS 0, multi-brand readiness 920 ms
- Android lint/debug/minified release confirmation
- Phase 5 playwright coverage: 360/375/412/430/768/1440 viewports
- A clearly labelled section "Pending items (not yet passed)" listing all 20 activation gates verbatim from CONTINUITY_BRIEF.md

---

## Task 4: Delete the old `greptile.json`

Once `.greptile/` is created at the root, delete `greptile.json` from the repository. The `.greptile/` folder takes precedence and `greptile.json` is ignored if both exist 【kg-wwwgre-ef76a4b3】, but committing a dead file is confusing.

```bash
git rm greptile.json
```

---

## CHANGELOG entry

Add an entry under `[Unreleased]` in `CHANGELOG.md`:

```markdown
### Changed
- Migrated Greptile configuration from `greptile.json` to `.greptile/` folder format with per-directory overrides for `server/services/`, `supabase/migrations/`, and `tests/`
- Removed committed generated artifact `worker-configuration.d.ts` (552 KB); CI now generates it pre-typecheck

### Added
- `.greptile/rules.md`: 10 architectural boundary rules encoding vinifera's service, security, and tenancy patterns
- `.greptile/files.json`: Greptile context files for every PR review
- `docs/build-specs/phase-5-qa-report.md`: Phase 5 closure evidence with all 20 activation gates listed as pending
```

---

## Acceptance criteria

- [ ] `.greptile/config.json`, `.greptile/rules.md`, `.greptile/files.json` all exist and are valid JSON/Markdown
- [ ] `server/services/.greptile/rules.md` exists
- [ ] `supabase/migrations/.greptile/config.json` exists  
- [ ] `tests/.greptile/config.json` exists
- [ ] `worker-configuration.d.ts` is absent from `git ls-files` output
- [ ] `.gitignore` contains `worker-configuration.d.ts`
- [ ] `ci.yml` has a "Generate Worker types" step before typecheck
- [ ] `greptile.json` is deleted
- [ ] `docs/build-specs/phase-5-qa-report.md` exists with all 20 activation gates listed as pending
- [ ] `npm run qa:worker-types && npm run typecheck` passes locally (dry-run simulation acceptable if Wrangler is not authenticated)
- [ ] `CHANGELOG.md` is updated
- [ ] PR body explains all four tasks and references the assessment document

---

## PR workflow for this spec

1. Create branch: `chore/greptile-config-and-repo-hygiene`
2. Commit all four tasks atomically with a single conventional-commit message
3. Open PR targeting `main` as a **draft**
4. Comment `@greptileai review this draft` to get early Greptile feedback
5. Address any Greptile findings
6. Convert to ready-for-review
7. Do NOT merge — leave open for human review

---

## Notes for the Codex agent

- Do not modify `AGENTS.md` — it is human-owner-only per the ownership table
- The `.greptile/` folder migration is straightforward but verify the JSON is syntactically valid before committing — a malformed config silently disables Greptile rules 【kg-wwwgre-25bb03ac】
- The `files.json` array should contain paths relative to the repository root
- After this PR merges, all subsequent PRs will be reviewed under these rules — getting them right now matters