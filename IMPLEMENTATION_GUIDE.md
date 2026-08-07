# Cursor + WRITER Agent Integration — Implementation Guide

**Date:** 2026-08-07
**Purpose:** Step-by-step guide for setting up Cursor Pro+ alongside WRITER Agent, including the API bridge that enables WRITER Agent to orchestrate Cursor cloud agents.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Phase 1: Cursor Configuration Files](#phase-1-cursor-configuration-files)
4. [Phase 2: Hook Scripts](#phase-2-hook-scripts)
5. [Phase 3: MCP Server Configuration](#phase-3-mcp-server-configuration)
6. [Phase 4: Cloud Agent Environment](#phase-4-cloud-agent-environment)
7. [Phase 5: WRITER→Cursor API Bridge (Section 10)](#phase-5-writercursor-api-bridge)
8. [Phase 6: Testing the Integration](#phase-6-testing-the-integration)
9. [Ongoing Maintenance](#ongoing-maintenance)

---

## 1. Overview

This guide implements the recommendations from the Cursor integration report. The deliverables are organized into two layers:

**Layer 1: Cursor configuration** — Rules, hooks, MCP servers, skills, and environment config that govern how Cursor agents behave when working on the Vinifera codebase. These files live in the `.cursor/` directory and are committed to the repository.

**Layer 2: WRITER→Cursor API bridge** — An OpenAPI specification and orchestration scripts that enable WRITER Agent to programmatically launch and manage Cursor cloud agents. This is the Section 10 implementation — the manager-worker pattern where WRITER Agent orchestrates and Cursor cloud agents execute code-writing tasks.

### File Structure

```
cursor-integration/
├── .cursor/
│   ├── rules/
│   │   ├── agent-boundaries.mdc        # Always-on governance constraints
│   │   ├── db-safety.mdc               # Path-scoped: migrations, scripts
│   │   ├── workflow-policy.mdc         # Path-scoped: .github/workflows
│   │   └── frontend-conventions.mdc    # Path-scoped: frontend
│   ├── hooks/
│   │   ├── block-protected-branches.js # Block pushes to staging/main
│   │   ├── block-network-exfil.js      # Block secret exfiltration
│   │   ├── block-secret-exposure.js    # Block reading secret files
│   │   ├── run-formatter.js            # Auto-format after edits
│   │   └── audit-mcp-call.js           # Audit MCP tool calls
│   ├── skills/
│   │   ├── gate-validation/SKILL.md
│   │   ├── migration-authoring/SKILL.md
│   │   └── two-speed-policy/SKILL.md
│   ├── hooks.json                      # Hook configuration
│   ├── mcp.json                        # MCP server config (read-only)
│   └── environment.json               # Cloud agent environment
├── openapi/
│   └── cursor-cloud-agents-connector.json  # OpenAPI spec for WRITER connector
└── scripts/
    ├── cursor-client.js                # Cursor Cloud Agents API client
    ├── bugbot-client.js                # Bugbot API client
    ├── implement-issue.js              # Manager-worker: implement from issue
    ├── fix-ci.js                       # Manager-worker: fix CI failures
    └── parallel-tasks.js               # Fan-out: parallel agents
```

---

## 2. Prerequisites

### Cursor Side
- **Cursor Pro+** plan ($60/month) or higher
- Cursor IDE installed (desktop or web)
- A Cursor API key (generate from Dashboard → API Keys)
- GitHub repository connected to Cursor (for cloud agents)

### WRITER Agent Side
- WRITER Agent with connector access
- AI Studio access (for creating custom connectors)
- The Cursor API key (for the custom connector authentication)

### Repository
- The Vinifera repo with `AGENTS.md` in the root (already present — Cursor reads it natively)
- GitHub branch protection on `staging` and `main` (recommended hard enforcement)

---

## Phase 1: Cursor Configuration Files

### 1.1 Copy the `.cursor` directory

Copy the entire `.cursor/` directory from this integration package into the root of the Vinifera repository:

```bash
cp -r cursor-integration/.cursor /path/to/vinifera/
```

### 1.2 Verify AGENTS.md is present

The repo already has `AGENTS.md` in the root. Cursor reads this automatically — no action needed. The `.cursor/rules/*.mdc` files layer on top for path-scoped rules.

### 1.3 Rules verification

The four `.mdc` files serve different purposes:

| File | Scope | When it applies |
|---|---|---|
| `agent-boundaries.mdc` | `alwaysApply: true` | Every agent session, always |
| `db-safety.mdc` | `globs: supabase/migrations/**, scripts/**` | When working with migration or script files |
| `workflow-policy.mdc` | `globs: .github/workflows/**` | When working with CI/CD workflows |
| `frontend-conventions.mdc` | `globs: frontend/**` | When working with frontend code |

**Critical:** Plain `.md` files in `.cursor/rules/` are ignored. Only `.mdc` files with frontmatter are recognized.

---

## Phase 2: Hook Scripts

### 2.1 Hook configuration

The `hooks.json` file references five hook scripts. Each hook communicates over stdio using JSON and can allow, deny, or modify agent actions.

### 2.2 Hook inventory

| Hook | Trigger | Purpose | Fail mode |
|---|---|---|---|
| `block-protected-branches.js` | `beforeShellExecution` (matcher: `git push`) | Blocks pushes to `staging`, `main`, `production` | Fail-closed (exit 2) |
| `block-network-exfil.js` | `beforeShellExecution` (matcher: `curl\|wget\|nc `) | Blocks secret exfiltration via network tools | Fail-closed |
| `block-secret-exposure.js` | `beforeReadFile` | Blocks reading `.env`, `*secret*`, `*.pem`, `*.key` files | Fail-closed |
| `run-formatter.js` | `afterFileEdit` | Runs Prettier on edited files | Fail-open (informational) |
| `audit-mcp-call.js` | `beforeMCPExecution` | Logs all MCP calls, blocks write operations on sensitive resources | Fail-closed |

### 2.3 Testing hooks

To test a hook locally:

```bash
# Test the protected branch blocker
echo '{"command":"git push origin staging"}' | node .cursor/hooks/block-protected-branches.js
# Expected: {"permission":"deny",...} and exit code 2

echo '{"command":"git push origin feat/my-branch"}' | node .cursor/hooks/block-protected-branches.js
# Expected: {"permission":"allow"} and exit code 0

# Test the secret exposure blocker
echo '{"file_path":"/path/to/.env"}' | node .cursor/hooks/block-secret-exposure.js
# Expected: {"permission":"deny",...} and exit code 2
```

### 2.4 Security note

The `beforeReadFile` and `beforeMCPExecution` hooks use fail-closed behavior — if the hook script crashes or times out, the action is blocked. This is intentional for security-critical hooks. The `afterFileEdit` formatter hook uses fail-open behavior because formatting is non-blocking.

---

## Phase 3: MCP Server Configuration

### 3.1 Review the MCP config

The `mcp.json` file configures three read-only MCP servers using HTTP transport:

- **github-readonly** — Read-only GitHub access (PR listing, file viewing, CI status)
- **supabase-introspection** — Supabase schema introspection (read-only)
- **context7** — Library documentation lookup

### 3.2 Set environment variables

These MCP servers reference credentials via environment variables. Set them in your Cursor settings or shell environment:

```bash
export GITHUB_TOKEN_READONLY="ghp_your_readonly_token"
export SUPABASE_ACCESS_KEY_READONLY="your_supabase_readonly_key"
export CONTEXT7_API_KEY="your_context7_key"
```

**Critical:** Never put service-role Supabase keys, Stripe secret keys, or Cloudflare write tokens in `mcp.json`. Those belong behind WRITER Agent's connector gateway.

### 3.3 Transport choice

All servers use HTTP transport, not stdio. This is deliberate: with HTTP, tool calls are proxied through Cursor's backend and the server config is never present in the cloud agent's VM. Stdio servers expose their configuration and environment variables to the VM — a credential exposure risk.

---

## Phase 4: Cloud Agent Environment

### 4.1 Environment configuration

The `environment.json` file configures the cloud agent's development environment:

- **install:** `npm ci` — deterministic dependency installation
- **build:** `npm run build` — project build command
- **env:** `NODE_ENV=development` — default environment
- **secrets:** List of secret names the agent can access (set in Cursor Dashboard → Cloud Agents → Secrets)

### 4.2 Setting secrets

Add the following secrets in Cursor Dashboard → Cloud Agents → Secrets:

1. `GITHUB_TOKEN_READONLY`
2. `SUPABASE_ACCESS_KEY_READONLY`
3. `CONTEXT7_API_KEY`

These are workspace/team-scoped and encrypted at rest. The agent's VM accesses them through the environment but cannot read the raw values back.

### 4.3 Multi-repo support

If the Vinifera project spans multiple repositories (frontend, backend, infrastructure), the cloud agent environment can be configured for multi-repo access. Select multiple repositories when creating the environment in the Cloud Agents dashboard.

---

## Phase 5: WRITER→Cursor API Bridge

This is the core Section 10 implementation — enabling WRITER Agent to orchestrate Cursor cloud agents via the Cloud Agents API.

### 5.1 Two connection paths

WRITER Agent can connect to the Cursor Cloud Agents API through two mechanisms:

**Path A: OpenAPI Custom Connector (recommended)**

This is the simplest path. Upload the OpenAPI specification to AI Studio and configure API key authentication.

1. Navigate to **AI Studio → Connectors & Tools**
2. Select **Create custom connector**
3. Choose **OpenAPI specification** as the connector type
4. Upload the file `openapi/cursor-cloud-agents-connector.json`
5. Enter connector details:
   - **Connector name:** `Cursor Cloud Agents`
   - **About this connector:** `Programmatically launch and manage Cursor cloud agents for code implementation, CI fixes, and code review. Wraps the Cursor Cloud Agents API v1 (public beta) and Bugbot API.`
6. Configure authentication:
   - **Authentication method:** API key
   - **Key name:** `Authorization`
   - **Key prefix:** `Bearer` (this prepends "Bearer " to the key value)
7. Select **Next** to proceed to tool configuration
8. Review the auto-discovered tools (createAgent, listAgents, getAgent, createRun, listRuns, getRun, cancelRun, triggerBugbotReview)
9. Enable the tools you want WRITER Agent to access
10. Save and test the connector

The key insight: the OpenAPI spec defines 8 operations that map directly to WRITER Agent tools. When WRITER Agent needs to "create a cloud agent," it calls the `createAgent` tool, which hits `POST https://api.cursor.com/v1/agents` with the Cursor API key as a Bearer token.

**Path B: MCP Server Wrapper**

For more control, run a lightweight MCP server that wraps the Cloud Agents API. This allows both Cursor and WRITER Agent to use the same tool surface.

1. Deploy the `scripts/cursor-client.js` as an MCP server (e.g., using `@modelcontextprotocol/sdk`)
2. Expose tools: `create_agent`, `send_prompt`, `get_run_status`, `wait_for_run`, `cancel_run`, `trigger_bugbot_review`
3. In WRITER Agent: Create a custom connector from the MCP server URL
4. In Cursor: Add the MCP server to `.cursor/mcp.json` (for local agents) or the Cloud Agents dashboard (for cloud agents)

Path B is more work but provides a unified tool surface and allows custom logic (e.g., automatic retry on 409, polling abstraction).

### 5.2 Authentication setup

Generate a Cursor API key:

1. Go to **Cursor Dashboard → API Keys** (https://cursor.com/dashboard/api)
2. Click **Create API Key**
3. Name it (e.g., "WRITER Agent Integration")
4. Copy the key immediately (it's shown only once)
5. Store it securely — this key bills to your Pro+ plan usage

For the WRITER custom connector, use this key as the API key value. The OpenAPI spec defines `bearerAuth` as the security scheme, so the connector will send it as `Authorization: Bearer <key>`.

### 5.3 The API client library

The `scripts/cursor-client.js` file provides a Node.js client for the Cloud Agents API. It implements:

- `createAgent(params)` — Create a cloud agent and enqueue its initial run
- `listAgents(query)` — List agents with pagination
- `getAgent(agentId)` — Get agent metadata
- `createRun(agentId, params)` — Send a follow-up prompt
- `listRuns(agentId, query)` — List runs for an agent
- `getRun(agentId, runId)` — Get run status and result
- `cancelRun(agentId, runId)` — Cancel an active run
- `waitForRun(agentId, runId, options)` — Poll until a run reaches terminal state
- `createAgentAndWait(params, options)` — Convenience: create + wait
- `sendPrompt(agentId, params, options)` — Send prompt with 409 handling

### 5.4 Orchestration scripts

Three example scripts demonstrate the manager-worker pattern:

**`implement-issue.js`** — Launch a cloud agent to implement a feature from a GitHub issue:
```bash
CURSOR_API_KEY=crsr_xxx node scripts/implement-issue.js --issue 298 --repo theonlygeranium/vinifera
```

The script:
1. Constructs a prompt from the issue number with governance constraints embedded
2. Launches a cloud agent targeting the `dev` branch with `autoCreatePR: true`
3. Polls for completion (up to 10 minutes)
4. Optionally triggers a Bugbot review on the resulting PR
5. Outputs a JSON summary for WRITER Agent to verify against governance constraints

**`fix-ci.js`** — Launch a cloud agent to fix a CI failure on an existing PR:
```bash
CURSOR_API_KEY=crsr_xxx node scripts/fix-ci.js --pr 306 --repo theonlygeranium/vinifera
```

The script:
1. Accepts a PR number and CI failure log
2. Launches a cloud agent with `workOnCurrentBranch: true` (works on the PR's existing branch)
3. The agent fixes only the CI failure, runs tests, and pushes to the existing branch
4. Outputs next steps for WRITER Agent (verify CI passes, check governance)

**`parallel-tasks.js`** — Fan out multiple agents for independent tasks:
```bash
CURSOR_API_KEY=crsr_xxx node scripts/parallel-tasks.js tasks.json
```

The script:
1. Reads a JSON array of tasks
2. Launches all agents in parallel (each in its own VM)
3. Waits for all runs to complete
4. Outputs a summary with PR URLs and statuses

### 5.5 Bugbot integration

The `bugbot-client.js` file provides a client for the Bugbot API:

- `triggerReview(prUrl, options)` — Queue a Bugbot review (30 req/min limit)
- `dryRunReview(prUrl)` — Run analysis without posting comments (10 req/min limit)

**Note:** The Bugbot API requires an API key with `admin:*` scope, which is an Enterprise plan feature. On Pro+, you can still trigger Bugbot reviews from the Cursor UI or by commenting `cursor review` on a PR.

### 5.6 The 409 agent_busy handling

Only one run can be active per agent. The `sendPrompt` method in the API client handles this automatically:

1. Try to create a run
2. If 409 (agent_busy), list the agent's runs
3. Cancel the active run
4. Retry the prompt

For the one-agent-per-task pattern (recommended for Vinifera), each task creates a new agent, sends one prompt, waits for completion, and archives the agent. This avoids the 409 issue entirely.

---

## Phase 6: Testing the Integration

### 6.1 Test the API client

```bash
# Set your API key
export CURSOR_API_KEY="crsr_your_key_here"

# Test listing agents (should return empty or existing agents)
node -e "const {CursorClient} = require('./scripts/cursor-client'); const c = new CursorClient(process.env.CURSOR_API_KEY); c.listAgents({limit: 5}).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e.message))"
```

### 6.2 Test a cloud agent launch

```bash
# Launch a simple agent to verify the API works
CURSOR_API_KEY=crsr_xxx node scripts/implement-issue.js --prompt "Add a comment to the top of package.json explaining the project structure" --repo theonlygeranium/vinifera
```

Verify:
- The agent is created (Agent ID with `bc-` prefix)
- The run reaches `COMPLETED` status
- A PR is created targeting `dev`
- No pushes to `staging` or `main`

### 6.3 Test the hooks

```bash
# Test each hook with sample input
echo '{"command":"git push origin staging"}' | node .cursor/hooks/block-protected-branches.js
echo '{"command":"git push origin feat/test"}' | node .cursor/hooks/block-protected-branches.js
echo '{"file_path":"/repo/.env"}' | node .cursor/hooks/block-secret-exposure.js
echo '{"file_path":"/repo/src/index.ts"}' | node .cursor/hooks/block-secret-exposure.js
```

### 6.4 Test the WRITER connector

After creating the custom connector in AI Studio:

1. In a WRITER Agent conversation, ask it to "list Cursor cloud agents"
2. Verify it can call the `listAgents` tool and receive results
3. Ask it to "create a Cursor cloud agent to implement a simple change"
4. Verify the agent is created and the run status is returned

---

## Ongoing Maintenance

### Rules drift
Keep `AGENTS.md` as the canonical source for global governance. The `.mdc` files should not duplicate `AGENTS.md` content — they add path-scoped specifics. If a rule appears in both, designate one as canonical.

### Hook updates
When adding new sensitive file patterns or blocked commands, update the corresponding hook script. Test changes locally before committing.

### API stability
The Cloud Agents API is in public beta. APIs may change before general availability. Monitor the [Cursor API docs](https://cursor.com/docs/api) for breaking changes. The OpenAPI spec and API client may need updates if the endpoint structure changes.

### Usage monitoring
On Pro+, API-driven cloud agent runs bill to the user's plan usage. Monitor spend in the Cursor Dashboard → Usage. If automation volume is high, consider upgrading to Teams plan for shared usage pools.

### Secret rotation
Rotate the Cursor API key periodically:
1. Generate a new key in Cursor Dashboard → API Keys
2. Update the WRITER custom connector configuration
3. Update the `CURSOR_API_KEY` environment variable
4. Archive the old key

---

## Quick Reference

### Environment Variables

| Variable | Purpose | Where to set |
|---|---|---|
| `CURSOR_API_KEY` | Cursor Cloud Agents API authentication | Shell env, WRITER connector config, Cursor Dashboard secrets |
| `GITHUB_TOKEN_READONLY` | Read-only GitHub MCP server | Shell env, Cursor Dashboard secrets |
| `SUPABASE_ACCESS_KEY_READONLY` | Supabase introspection MCP server | Shell env, Cursor Dashboard secrets |
| `CONTEXT7_API_KEY` | Context7 MCP server | Shell env, Cursor Dashboard secrets |

### Key Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/agents` | POST | Create agent + initial run |
| `/v1/agents` | GET | List agents |
| `/v1/agents/{id}` | GET | Get agent |
| `/v1/agents/{id}/runs` | POST | Send follow-up prompt |
| `/v1/agents/{id}/runs` | GET | List runs |
| `/v1/agents/{id}/runs/{runId}` | GET | Get run status |
| `/v1/agents/{id}/runs/{runId}/cancel` | POST | Cancel run |
| `/bugbot/review` | POST | Trigger Bugbot review |

### Rate Limits

| API | Limit |
|---|---|
| Cloud Agents API | Standard rate limiting |
| Bugbot API (`/bugbot/review`) | 30 req/min |
| Bugbot API (dryRun) | 10 req/min (additional) |

### Governance Constraints (enforced by rules + hooks)

1. PRs target `dev` only — never `staging` or `main`
2. Merge requires owner authorization
3. Agents do not initiate promotions
4. `human-review-required` and `do-not-merge` labels are absolute
5. `brand_id` scoping mandatory on all data queries
6. No service-role keys in code or model context
