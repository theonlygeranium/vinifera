# AGENTS.md — Vinifera Agent Collaboration Guide

> **This file is mandatory reading for every AI agent that touches this repository.**
> Read it in full before making any change. No exceptions.

---

## 1. What This Repository Is

`vinifera` is a **wine club management platform prototype** owned by EdStratum Labs. It consists of a marketing landing page, an interactive app prototype, and an investor's guide — all static HTML files deployed to Cloudflare Pages.

**Live URL:** `https://vinifera.edstratumlabs.ai`
**Deployed on:** Cloudflare Pages (auto-deploy from `main` via GitHub App webhook)
**Owner contact:** `founder@edstratumlabs.ai`

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `index.html` | Landing page with hero vineyard illustration, features, pricing |
| `/app/*` | `app` (extensionless) | Interactive app prototype — 13 functional areas, 27 KPI cards |
| `/guide/*` | `guide` (extensionless) | 8-part investor's guide with sticky TOC, reading progress bar |

---

## 2. Prime Directives for All Agents

1. **Document everything.** Every change — no matter how small — must be documented before it is committed. Non-negotiable.
2. **No silent changes.** Any modification to a config, script, or deployment file must update the relevant documentation in the same commit.
3. **Commit atomically.** One logical change per commit. Never bundle unrelated changes.
4. **Leave a trail.** Future agents — and the human owner — must be able to reconstruct exactly what was done, why, and what the state was before and after.
5. **Update CHANGELOG.md on every commit.** No exceptions.
6. **Preserve WCAG compliance.** All pages must pass axe-core with 0 WCAG 2.1 AA violations. Run the QA test suite before pushing.
7. **Test on mobile.** Every visual change must be verified at 375px viewport width. Touch targets must meet 44×44px (WCAG 2.5.5).
8. **Own every PR through completion.** Opening a PR is not completion. Use an
   available wait or monitoring mechanism until required CI and Greptile pass
   and zero unresolved review threads remain; disposition every finding,
   retest and re-review after each push, and merge only with explicit
   authorization. Follow the complete loop in `docs/agent-workflow.md`.

---

## 3. Repository Structure

```
vinifera/
├── index.html               # Landing page (hero, features, pricing, CTA)
├── app                      # App prototype (extensionless, served at /app/*)
├── guide                    # Investor's guide (extensionless, served at /guide/*)
├── public/
│   ├── _redirects           # Route rules: /app/* /guide/*
│   └── _headers              # Security headers + Content-Type overrides
├── scripts/
│   └── build.mjs            # Build script (copies files to dist/)
├── docs/                    # Architecture, setup, ADRs, runbooks
├── .github/workflows/       # CI/CD pipeline
├── AGENTS.md                # YOU ARE HERE — do not modify without authorization
├── CONTINUITY_BRIEF.md      # Drop-in context for new agent sessions
├── README.md                # Project overview
├── CHANGELOG.md             # Versioned change log
├── REVERT.md                # Stable baseline and rollback guide
├── package.json             # Build config
└── wrangler.toml            # Cloudflare Pages configuration
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
| `docs/` | Any agent | Must stay in sync with actual architecture |
| `index.html` | Any agent | Landing page — verify WCAG after changes |
| `app` | Any agent | App prototype — verify WCAG + mobile after changes |
| `guide` | Any agent | Investor's guide — verify WCAG after changes |
| `public/_redirects` | Any agent | Routing rules — test after changes |
| `public/_headers` | Any agent | Security + content-type headers — test after changes |

---

## 4. Mandatory Documentation Standards

### 4.1 Every Commit Must Include

- **What changed:** Every file modified and what was altered.
- **Why it changed:** The reason or requirement that motivated the change.
- **Impact on deployment:** Whether the change affects routing, headers, or build output.
- **Verification steps:** How to confirm the change worked.

### 4.2 Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — what changed and why>

Verification: <how to confirm it works>
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `ci`

### 4.3 CHANGELOG.md Format

Every commit must add an entry under `[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) format.

### 4.4 Architectural Decision Records (ADRs)

Whenever an architectural, technology, or security decision is made, create an ADR in `docs/decisions/`.

**Filename:** `docs/decisions/YYYY-MM-DD-short-title.md`

---

## 5. CI/CD and Deployment

This repo deploys to **Cloudflare Pages** via GitHub App webhook:

- **Trigger:** Push to `main` → Cloudflare Pages GitHub App detects push → auto-build + deploy
- **Build command:** `npm run build` (non-negotiable)
- **Output directory:** `dist/`
- **Node version:** Use the version pinned in `.nvmrc` (currently `22.22.0`);
  `package.json` requires Node `>=22.12.0`.
- **Webhook verification:** Check deployment `trigger_type: "github:push"` (the GitHub `/repos/{owner}/{repo}/hooks` endpoint returns 0 even when the webhook is active)

### Cloudflare Pages Conventions

- **Extensionless filenames:** `app` and `guide` must NOT have `.html` extensions. Cloudflare Pages' pretty-URL feature 308-redirects `*.html` files, intercepting `_redirects` rules.
- **`_headers` file:** Must include `/app/*` and `/guide/*` wildcard rules for `Content-Type: text/html`.
- **`_redirects` file:** `/app/*  /app  200` and `/guide/*  /guide  200` — rewrites, not redirects.
- **Account ID:** Use the connector's `accountId` variable, not hardcoded values.
- **Edge cache:** Custom domain cache lags deployment-specific URL by 15–30s. Verify fixes on `*.pages.dev` URL first.

---

## 6. Quality Assurance

### WCAG 2.1 AA Compliance

All pages must pass axe-core with 0 violations. The QA test suite is at `/workspace/.tmp/qa_three_pages.py`.

**Key requirements:**
- Color contrast: ≥4.5:1 (normal text), ≥3:1 (large text)
- Touch targets: ≥44×44px (WCAG 2.5.5)
- HTML landmarks: `<nav>`, `<main>`, `<header>`, `<footer>` present
- Decorative SVGs: `aria-hidden="true"`
- `prefers-reduced-motion`: All animations disabled (CSS + SVG SMIL)

### Known Issues

- **axe-core `::after` pseudo-element:** axe-core may return "incomplete" for elements with `::after` pseudo-elements (e.g., `.btn-gold` shimmer animation). The manual contrast checker is authoritative for these cases.
- **Manual contrast checker false positives:** Returns ratio 1.0 when it cannot resolve CSS gradient backgrounds. Filter out `ratio == 1.0` entries. axe-core is authoritative for all other cases.

---

## 7. Git Workflow

- Every change must use a scoped branch and pull request targeting `main`.
- Never commit or push directly to `main`.
- Use the branch prefixes documented in `docs/agent-workflow.md`.
- Never force-push to `main` without explicit human authorization.
- Before committing: CHANGELOG updated, no secrets in source.

### Stable Versioning

When a release is verified stable:
1. `git tag -a vX.Y-stable -m "description"`
2. `git push origin vX.Y-stable`
3. Update `REVERT.md` with the new baseline.

---

## 8. Agent Collaboration Architecture

| Agent | Platform | Primary Role |
|---|---|---|
| **Writer Agent** | WRITER (Writer.com) | Research, architecture, documentation, CI/CD, QA testing |
| **Codex** | OpenAI Codex CLI | Code implementation, execution, testing |

**Coordination:** Writer Agent plans first → Codex implements → Writer Agent documents after. Read before write. One agent per logical unit of work.

---

## 9. Contact and Authorization

**Human owner:** EdStratum Labs (`founder@edstratumlabs.ai`)

For any action outside defined scope — modifying `AGENTS.md`, making architectural changes not covered by an ADR, or destructive operations — **stop and ask the human owner for explicit authorization.**
