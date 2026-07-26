# AGENTS.md — [PROJECT NAME] Agent Collaboration Guide

> **This file is mandatory reading for every AI agent that touches this repository.**
> Read it in full before making any change. No exceptions.

---

## 1. What This Repository Is

<!-- TODO: Replace this section with a concise description of the project. -->
`[REPO-NAME]` is a **[brief description]** owned by EdStratum Labs.

**Live URL:** `https://[your-domain]`
**Deployed on:** Schubert Nexus (`/opt/[REPO-NAME]/`)
**Owner contact:** `founder@edstratumlabs.ai`

---

## 2. Prime Directives for All Agents

1. **Document everything.** Every change — no matter how small — must be documented before it is committed. Non-negotiable.
2. **Never guess at Schubert's state.** Query live state via the Schubert Nexus connector before acting. Assumptions cause outages.
3. **No silent changes.** Any modification to a config, script, or deployment file must update the relevant documentation in the same commit.
4. **Preserve existing services.** Schubert runs production-adjacent services (LiteLLM, Ollama, PostgreSQL, Caddy, Cloudflared, MeetScribe, Project Foxtrot, Project Tango). Do not restart, reconfigure, or interfere with any service outside this project's scope without explicit authorization.
5. **Commit atomically.** One logical change per commit. Never bundle unrelated changes.
6. **Leave a trail.** Future agents — and the human owner — must be able to reconstruct exactly what was done, why, and what the state was before and after.
7. **Update CHANGELOG.md on every commit.** No exceptions.

---

## 3. Repository Structure and File Ownership

```
[REPO-NAME]/
├── AGENTS.md                   ← YOU ARE HERE — do not modify without authorization
├── CONTINUITY_BRIEF.md         ← Drop-in context for new agent sessions — keep current
├── README.md                   ← Project overview — update when architecture changes
├── CHANGELOG.md                ← All notable changes — update on every commit
├── REVERT.md                   ← Stable baseline and rollback guide
├── .env.example                ← Non-secret env var template — never put real values here
├── scripts/
│   └── deploy.sh               ← Deployment script called by CI
├── docs/
│   ├── architecture.md         ← Full system architecture — keep current
│   ├── setup.md                ← Step-by-step deploy and local dev guide
│   ├── decisions/              ← Architectural Decision Records (ADRs)
│   └── runbooks/               ← Operational runbooks
└── .github/
    └── workflows/
        └── deploy.yml          ← CI/CD — self-hosted LAN runner + Tailscale OAuth fallback
```

### File Ownership Rules

| File/Directory | Who Can Modify | Notes |
|---|---|---|
| `AGENTS.md` | Human owner only | Requires explicit authorization to change |
| `CONTINUITY_BRIEF.md` | Any agent | Must reflect current reality — update after every session |
| `README.md` | Any agent | Must reflect reality — no aspirational content |
| `CHANGELOG.md` | Any agent | Required on every commit |
| `REVERT.md` | Any agent | Update whenever a new stable tag is created |
| `.env.example` | Any agent | Real secrets NEVER go here |
| `docs/architecture.md` | Any agent | Must stay in sync with actual Schubert state |
| `docs/decisions/` | Any agent | New ADR required for every architectural decision |
| `docs/runbooks/` | Any agent | Add runbook when introducing new operational procedure |

---

## 4. Mandatory Documentation Standards

### 4.1 Every Commit Must Include

- **What changed:** Every file modified and what was altered.
- **Why it changed:** The reason or requirement that motivated the change.
- **Impact on Schubert:** Which services are affected, and whether a restart is required.
- **Verification steps:** How to confirm the change worked.

### 4.2 Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — what changed and why>

Impact: <which Schubert services are affected>
Requires restart: <yes/no — if yes, specify which service>
Verification: <how to confirm it works>
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `ci`

### 4.3 CHANGELOG.md Format

Every commit must add an entry under `[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) format.

### 4.4 Architectural Decision Records (ADRs)

Whenever an architectural, technology, or security decision is made, create an ADR in `docs/decisions/`.

**Filename:** `docs/decisions/YYYY-MM-DD-short-title.md`

**Template:**
```markdown
# ADR: <Short Title>

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded | Deprecated
**Decided by:** <agent name or human>

## Context
## Decision
## Rationale
## Alternatives Considered
## Consequences
## References
```

---

## 5. CI/CD and Deployment

This repo uses the **Schubert Hybrid Deploy** workflow:

- **Primary path:** `self-hosted` runner (`schubert-local`) — LAN-native, fires on every push to `main`. No Tailscale, no SSH from GitHub infra.
- **Fallback path:** GitHub-hosted runner + Tailscale OAuth — trigger manually via `workflow_dispatch → force_remote: true` when the self-hosted runner is offline.

**Deployment target:** Schubert Nexus at `/opt/[REPO-NAME]/`
**Deploy script:** `scripts/deploy.sh`
**Required secrets:** `SCHUBERT_SSH_KEY`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` (pre-provisioned)

---

## 6. Schubert Nexus Interaction Rules

### 6.1 Global Off-Limits Services

Do NOT restart or reconfigure any of the following without explicit human authorization:

| Service | Why Off-Limits |
|---|---|
| `caddy.service` | Manages all reverse proxy routing for all projects |
| `cloudflared.service` | Manages external access |
| `postgresql@18-main.service` | Production database — data loss risk |
| `tailscaled.service` | Network access |
| `ollama.service` | Shared GPU model server used by all projects |
| `polyglot-litellm.service` | Shared LLM proxy on port 4000 |
| `meetscribe-*` | Port 8010 permanently reserved |
| `foxtrot-*` | Port 3010 permanently reserved |
| `tango-*` | Ports 3006 + 8030 permanently reserved |

### 6.2 Git Operations on Schubert

- Always run git as `z121532`: `sudo -u z121532 git ...`
- Never `sudo git pull` as root.
- Python packages: use project venv.
- Path casing matters: use the exact case of `/opt/[REPO-NAME]`.

---

## 7. Git Workflow

- All production work on `main`. Experimental changes: `feature/<description>` branch.
- Never force-push to `main` without explicit human authorization.
- Before committing: CHANGELOG updated, no secrets in source, `.env.example` updated if new vars added.

### Stable Versioning

When a release is verified stable:
1. `git tag -a vX.Y-stable -m "description"`
2. `git push origin vX.Y-stable`
3. Update `REVERT.md` with the new baseline.

---

## 8. Agent Collaboration Architecture

| Agent | Platform | Primary Role |
|---|---|---|
| **Writer Agent** | WRITER (Writer.com) | Research, architecture, documentation, ADRs, CI/CD |
| **Codex** | OpenAI Codex CLI | Code implementation, execution, testing |

**Coordination:** Writer Agent plans first → Codex implements → Writer Agent documents after. Read before write. One agent per logical unit of work.

---

## 9. Sister Projects on Schubert

| Project | Schubert Path | Notes |
|---|---|---|
| Project Tango | `/opt/Project-Tango` | Ports 3006 + 8030 reserved |
| Watson AI | `/opt/watson-ai` | Port reserved |
| Pumpkin AI | `/opt/pumpkin-ai` | Open WebUI |
| Project Foxtrot | `/opt/Project-Foxtrot` | Port 3010 reserved |
| MeetScribe | `/opt/meetscribe` | Port 8010 reserved |

All projects share `polyglot-litellm.service` (port 4000) and `ollama.service` (port 11434).

---

## 10. Contact and Authorization

**Human owner:** EdStratum Labs (`founder@edstratumlabs.ai`)

For any action outside defined scope — modifying `AGENTS.md`, touching forbidden services, making architectural changes not covered by an ADR, or destructive operations — **stop and ask the human owner for explicit authorization.**
