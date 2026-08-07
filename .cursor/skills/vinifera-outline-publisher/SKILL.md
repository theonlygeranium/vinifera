---
name: "vinifera-outline-publisher"
description: "Publish Vinifera session continuity, status, architecture, operational notes, and explicitly authorized credential updates into the private Vinifera Outline collection through Schubert. Use when the user asks to update, sync, publish, or hand off Vinifera knowledge or continuity to Outline."
---

# Vinifera Outline Publisher

Keep the Vinifera Outline collection current, coherent, private, and easy to read. Treat the wiki as a curated operating narrative, not a transcript archive.

## Cursor runtime

This skill is packaged for Cursor Agent Skills. Resolve `<skill-dir>` as the
directory containing this `SKILL.md`; do not assume a Codex installation path.
Examples below use a project-level installation at
`.cursor/skills/vinifera-outline-publisher`. A user-level installation at
`~/.cursor/skills/vinifera-outline-publisher` uses the same files.

Resolve the Vinifera repository from the current Cursor workspace first. If it
is not open, use `/Users/jeffgeronimo/Documents/vinifera` on the owner's Mac.

## Fixed targets

- Workspace: `https://wiki.edstratumlabs.ai`
- Collection: `Vinifera Product & Engineering`
- Collection ID and canonical document map: `config/outline-map.json`
- Schubert companion map: `config/schubert-map.json` for non-secret infrastructure documentation
- Transport: SSH alias `schubert` to Outline at `http://127.0.0.1:3101/api`
- Publisher: `scripts/publish.py`

## Credential resolution

The publisher resolves the Outline API token in this order:

1. `OUTLINE_API_TOKEN` in the current process.
2. macOS Keychain item:
   - service: `codex.vinifera.outline`
   - account: current macOS username.

Never place the token in this skill, the Vinifera repository, continuity files, shell history, command output, or an Outline page. If both sources are missing, stop and run the one-time setup:

```bash
python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py configure-keychain
```

The user does not need to supply the token again unless it is revoked or rotated.

## Required workflow

1. Resolve the Vinifera repository, then read its `AGENTS.md` in full.
2. Read the supplied continuity/session material plus current repository sources needed to verify it. At minimum inspect `CONTINUITY_BRIEF.md`, `README.md`, `CHANGELOG.md`, and `docs/agent-workflow.md` when present.
3. Run the read-only preflight:

```bash
python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py verify
```

4. Stop if collection identity or permission differs from its configured privacy contract, membership exceeds the configured limits, any public share exists, a mapped document is missing, or a title resolves ambiguously.
5. Distill the session into page-sized updates. Prefer updating existing canonical pages over creating new pages.
6. Preview every write without `--apply`.
7. Apply approved, in-scope writes with `--apply`.
8. Append one entry to `Change Log & Knowledge Base Updates`.
9. Run `verify` again and report exactly which pages changed.

## Editorial model

Write the collection as a succinct story:

- Start with what Vinifera is and where it stands.
- Explain how the product works before how it is implemented.
- Separate architecture, delivery, operations, and security.
- Put current truth in canonical pages; put chronology in the update log and archives.
- Use tables for exact mappings, callouts for risks, Mermaid only where relationships materially benefit, and code blocks for commands or contracts.
- Remove repetition. Link to the canonical page instead of restating it.
- Distinguish `implemented`, `CI-verified`, `deployed`, `live-verified`, `pending`, and `blocked`.
- Include dates and exact revisions for time-sensitive evidence.

Use the templates in `templates/` as drafting contracts, not as prose to copy verbatim.

## Routing rules

- Product purpose, personas, workflows, and features → product pages.
- Runtime components, data model, tenancy, integrations, and routes → architecture pages.
- Branches, CI, promotion, deployments, activation gates, and rollback → delivery/operations pages.
- Current state and next actions → status page.
- Decisions with durable consequences → decision/architecture page plus source ADR link.
- Session chronology → update log.
- Raw historical continuity → archive page only when it has unique evidence.
- Credentials and secret values → `Secure Operations Vault` only.
- Cross-project server and access mechanics → Schubert companion pages, never Schubert credential storage.

Do not create a new top-level section for a single session. Create a page only when the content has a durable audience and no canonical home.

## Publishing commands

Preview or update a page from a local Markdown file:

```bash
python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py upsert \
  --title "Current Status Snapshot" \
  --text-file /absolute/path/to/page.md

python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py upsert \
  --title "Current Status Snapshot" \
  --text-file /absolute/path/to/page.md \
  --apply
```

For non-secret Schubert infrastructure updates, place `--config` before the command:

```bash
python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py \
  --config .cursor/skills/vinifera-outline-publisher/config/schubert-map.json \
  upsert --title "Outline & WRITER Knowledge System" \
  --parent-title "Application Services" \
  --text-file /absolute/path/to/page.md \
  --allow-create
```

Append a concise update-log entry:

```bash
python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py append-log \
  --entry-file /absolute/path/to/update.md \
  --apply
```

Create a new child page only when necessary:

```bash
python3 .cursor/skills/vinifera-outline-publisher/scripts/publish.py upsert \
  --title "New Durable Topic" \
  --parent-title "System Architecture" \
  --text-file /absolute/path/to/page.md \
  --allow-create \
  --apply
```

## Secrets and vault rules

- Never print or summarize credential values.
- Never pass secret text directly as a command-line argument.
- For a vault write, use `--text-file` and add `--vault`.
- `--vault` requires the target to be `Secure Operations Vault` or its child and prevents preview output from including content-derived detail.
- Do not add or alter credentials unless the user explicitly asks.
- Never publish credential values into the Schubert companion collection; its sharing capability is enabled.
- Treat “private wiki” as a permission claim that must be verified each run.
- Keep credentials out of `Change Log & Knowledge Base Updates`; log only that the vault inventory was refreshed.

## Guardrails

- Default is dry-run. Mutations require `--apply`.
- Do not delete documents.
- Do not change collection permissions automatically.
- Do not publish repository secrets, `.env` contents, private keys, tokens, or credential envelopes outside the vault.
- Do not use current hosted responses as proof of Worker activation.
- Do not infer that a GitHub check, deploy workflow, or static Pages response proves production readiness.
- Preserve Outline revision history by updating documents rather than replacing their identity.
