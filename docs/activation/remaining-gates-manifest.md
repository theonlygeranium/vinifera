# Remaining hosted activation gates — orchestration manifest

**Prepared:** 2026-08-06  
**Starting branch:** `origin/dev` at `211d7dcac4ebd90758a94cb72c4cad5e98ca4a18`  
**Primary owner:** Codex chief strategist/orchestrator

## Objective

Complete and independently QA Gates 6, 8, and 10–20 without weakening the
existing exact-candidate, tenant-isolation, provider-target, rollback, or
production safeguards. A gate changes to `live-passed` only after its complete
hosted/provider evidence is retained and inspected.

## Delegation boundaries

| Workstream | Gates | Delegated audit | Mutation authority |
|---|---:|---|---|
| Operations and communications | 6, 8 | Inventory existing controllers, fixtures, provider readiness, evidence contracts, and missing implementation | Primary agent only |
| Intelligence, compliance, integrations, and tenancy | 10–16 | Map source/runbook coverage, hosted prerequisites, safe sequencing, and external dependencies | Primary agent only |
| Mobile, stores, live billing, and production | 17–20 | Map signing/device/store, Stripe live, production cutover, rollback, and independent-confirmation boundaries | Primary agent only |

Delegated agents are read-only auditors. They must not edit files, create
provider resources, change credentials, dispatch workflows, merge branches, or
mark gates complete. The primary agent owns all integration decisions,
implementation branches, provider mutations, QA, evidence review, promotion,
and status changes.

## Execution order

1. Revalidate current repo, GitHub workflow, staging runtime, provider, and
   credential readiness without changing state.
2. Complete Gate 6, then run its dedicated hosted evidence and regression QA.
3. Complete Gate 8 and QA its sender, webhook, and real-trigger evidence.
4. Complete Gates 10, 15, and 16 before scale-dependent Gates 11–14 where their
   prerequisites overlap.
5. Complete Gates 17 and 18 with physical-device and internal-store artifacts.
6. Complete Gate 19 only through its protected live-billing workflow and exact
   controlled charge/refund evidence.
7. Complete Gate 20 last, using the identical reviewed artifact, live health,
   route verification, and proven rollback target.

## QA contract

After every gate, the primary agent must inspect the retained sanitized
evidence, rerun the gate-relevant regression suite, confirm cleanup or durable
fixture state, verify no sibling gate regressed, and update the canonical
readiness ledger through a reviewed PR. Batch implementation is allowed;
batching gate-completion claims is not.

