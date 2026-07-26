# Vinifera — Agent Continuity Brief
**Last updated:** 2026-07-26 by Writer Agent (thread 85816652)
**Purpose:** Drop-in context document for any new WRITER Agent or Codex session working on this project. Read this before touching anything.

---

## Project Identity
- **Project name:** Vinifera
- **Owner:** EdStratum Labs (`founder@edstratumlabs.ai`)
- **Live URL:** `https://vinifera.edstratumlabs.ai`
- **Repo:** `https://github.com/theonlygeranium/vinifera` (public)
- **Default branch:** `main` → auto-deploys to Cloudflare Pages on push

---

## Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS (single-file pages, no framework) |
| Icons | Lucide Icons (CDN) |
| CI/CD | GitHub Actions + Cloudflare Pages GitHub App webhook |
| Deploy target | Cloudflare Pages (`vinifera` project) |
| Build | `npm run build` → copies files to `dist/` |

---

## Repository Key Files
```
vinifera/
├── index.html               # Landing page — hero, features, pricing
├── app                      # App prototype (extensionless) — served at /app/*
├── guide                    # Investor's guide (extensionless) — served at /guide/*
├── public/
│   ├── _redirects           # /app/* /app 200, /guide/* /guide 200
│   └── _headers              # Security headers + Content-Type overrides
├── scripts/
│   └── build.mjs            # Copies index.html, app, guide, public/* to dist/
├── AGENTS.md                # Agent rules — read first
├── CONTINUITY_BRIEF.md      # This file — update after every session
├── README.md                # Human-readable overview
├── CHANGELOG.md             # All changes — updated every commit
├── REVERT.md                # Stable baseline + rollback instructions
├── package.json             # Build config (name: vinifera, version: 0.0.1)
├── wrangler.toml            # Cloudflare Pages config (pages_build_output_dir: ./dist)
└── docs/                    # Architecture, setup, ADRs, runbooks
```

---

## CI/CD Pipeline
- Push to `main` → Cloudflare Pages GitHub App webhook triggers build → `npm run build` → deploy
- Build command: `npm run build` (non-negotiable)
- Output dir: `dist/`
- Node version: 20
- Webhook verification: Check deployment `trigger_type: "github:push"` (GitHub `/hooks` endpoint returns 0 even when active)

---

## Current State
- **Last stable tag:** Not yet tagged
- **Active branch:** `main`
- **Latest commit:** `7e4bbba` — Fix remaining guide color-contrast
- **Latest deployment:** `eec75703` (active)
- **Open work:** None — all three pages pass QA at 100/100

### Deployments This Session
| Commit | Deployment ID | Change |
|--------|--------------|--------|
| `b0380a4` | `2a7c2c33` | Add investor's guide page + nav links |
| `df34001` | `2d5c1e61` | Fix WCAG violations on guide page |
| `7e4bbba` | `eec75703` | Fix remaining guide color-contrast |

---

## Environment Variables
No application-level environment variables required. This is a static site.

### GitHub Secrets (for CI/CD)
| Secret | Purpose |
|--------|---------|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth (Schubert fallback deploy) |
| `TS_OAUTH_SECRET` | Tailscale OAuth (Schubert fallback deploy) |
| `SCHUBERT_SSH_KEY` | SSH key for Schubert Nexus |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API access |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |

---

## Cloudflare Pages Configuration
- **Project:** `vinifera`
- **Build command:** `npm run build`
- **Destination dir:** `dist`
- **NODE_VERSION:** `20`
- **Custom domain:** `vinifera.edstratumlabs.ai` (CNAME proxied, SSL active)
- **Connector account ID:** `f69a6a0cad6e417b182bac1559292bf6`
- **Zone for `edstratumlabs.ai`:** `7c25efc22d8f8fc7c10a0f9da67c0c5f`

---

## Quality Status
- **axe-core:** 0 WCAG 2.1 AA violations on all 3 pages (landing, app, guide)
- **Touch targets:** All interactive elements meet 44×44px
- **Performance:** FCP < 370ms, CLS 0.0000, DOM load < 0.35s
- **Security:** 6/6 security headers on all pages
- **prefers-reduced-motion:** All animations disabled (CSS + SVG SMIL)

---

## Rules Every Agent Must Follow
1. Update this file at the end of every session with current state.
2. Never commit secrets to source.
3. Update `CHANGELOG.md` on every commit.
4. Run the QA test suite before pushing visual changes.
5. See `AGENTS.md` for full rules.
