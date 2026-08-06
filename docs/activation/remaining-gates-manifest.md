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

| Workstream | Gates | Delegated scope | Integration authority |
|---|---:|---|---|
| Operations and communications | 6, 8 | Audit plus isolated Gate 8 and, after Gate 13, Gate 6 implementation worktrees | Primary agent reviews, integrates, runs hosted mutations, and claims gates |
| Intelligence, compliance, integrations, and tenancy | 10–16 | Audit plus isolated implementation worktrees selected after dependency mapping | Primary agent reviews, integrates, runs hosted mutations, and claims gates |
| Mobile, stores, live billing, and production | 17–20 | Audit plus isolated readiness repairs that do not cross store, real-money, DNS, or production-release boundaries | Primary agent reviews and integrates; owner confirmation remains required at consequential boundaries |

Auditors begin read-only. The primary agent may then dispatch a bounded
implementation task in an isolated worktree with explicit owned files and QA.
Delegated implementers must not create provider resources, change credentials,
dispatch workflows, merge branches, or mark gates complete. The primary agent
owns integration decisions, provider mutations, QA review, evidence review,
promotion, and status changes.

## Execution order

1. Revalidate current repo, GitHub workflow, staging runtime, provider, and
   credential readiness without changing state.
2. Complete Gate 8 and QA its sender, webhook, and real-trigger evidence.
3. Complete Gate 13 provider activation before Gate 6. The hosted label path
   calls the fail-closed compliance adapter, so Gate 6 cannot produce valid
   label evidence while ShipCompliant is unconfigured; the test-only simulator
   is not acceptable hosted compliance authority.
4. Complete Gate 6, then run its dedicated hosted evidence and regression QA.
5. Complete Gates 10, 15, and 16 before scale-dependent Gates 11, 12, and 14
   where their prerequisites overlap.
6. Complete Gates 17 and 18 with physical-device and internal-store artifacts
   only after the production mobile API and association routes are executable.
7. Complete Gate 19 only through its protected live-billing workflow and exact
   controlled charge/refund evidence.
8. Complete Gate 20 last, using the identical reviewed artifact, live health,
   route verification, and proven rollback target.

The completed reusable Gate 7 controller is not an implicit prerequisite for
subsequent promotions. Keep `STAGING_HOSTED_ACCEPTANCE_ENABLED=false` after its
retained successful evidence and use one-shot, gate-specific activation
switches so unrelated promotions do not require a new email handoff.

The staging GitHub environment retains its staging-only branch policy but no
longer applies a global required-reviewer rule. Reversible staging deployments
are governed by their exact-candidate, target-policy, workflow-confirmation,
health, rollback, and one-shot gate controls. Production DNS, real-money,
mobile-store, destructive/legal-provider, and other consequential boundaries
retain their independent confirmation requirements.

## QA contract

After every gate, the primary agent must inspect the retained sanitized
evidence, rerun the gate-relevant regression suite, confirm cleanup or durable
fixture state, verify no sibling gate regressed, and update the canonical
readiness ledger through a reviewed PR. Batch implementation is allowed;
batching gate-completion claims is not.
