# Setup & Deployment Guide — Vinifera

---

## Prerequisites

- Node.js 20+
- npm
- Git

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/theonlygeranium/vinifera.git
cd vinifera

# Install dependencies
npm install

# Start dev server
npm run dev
```

The dev server (`npx serve .`) serves the project root at `http://localhost:3000`.

---

## Building for Production

```bash
npm run build
```

This runs `scripts/build.mjs`, which:
1. Removes the `dist/` directory
2. Copies `index.html`, `app`, and `guide` to `dist/`
3. Copies `public/_headers` and `public/_redirects` to `dist/`

Output is in `dist/` — ready for Cloudflare Pages.

---

## Deploying to Cloudflare Pages

### Automatic (recommended)
Push to `main` — the Cloudflare Pages GitHub App detects the push and auto-builds + deploys.

Build configuration (non-negotiable):
- **Build command:** `npm run build`
- **Output directory:** `dist/`
- **Node version:** 20

### Manual (via Cloudflare API)
Use the `CLOUDFLARE_API` connector to trigger a deployment:
```
POST /accounts/{accountId}/pages/projects/vinifera/deployments
```

### Verifying Deployment

```bash
# Check deployment status via Cloudflare API
# Look for latest_stage.status == "success" or "active"

# Verify pages are live
curl -sS -o /dev/null -w "HTTP %{http_code}" https://vinifera.edstratumlabs.ai/
curl -sS -o /dev/null -w "HTTP %{http_code}" https://vinifera.edstratumlabs.ai/app/
curl -sS -o /dev/null -w "HTTP %{http_code}" https://vinifera.edstratumlabs.ai/guide/
```

All three should return HTTP 200 with `Content-Type: text/html`.

---

## Cloudflare Pages Conventions

### Extensionless Filenames
`app` and `guide` must NOT have `.html` extensions. Cloudflare Pages' pretty-URL feature 308-redirects `*.html` files, which intercepts `_redirects` rules.

### `_headers` File
Must include wildcard rules for extensionless routes:
```
/app
Content-Type: text/html; charset=utf-8

/app/*
Content-Type: text/html; charset=utf-8

/guide
Content-Type: text/html; charset=utf-8

/guide/*
Content-Type: text/html; charset=utf-8
```

### `_redirects` File
```
/app/*    /app    200
/guide/*  /guide  200
```

These are rewrites (status 200), not redirects.

---

## Quality Assurance

Before pushing visual changes, run the QA test suite:

```bash
# Full 8-phase QA across all 3 pages
python /workspace/.tmp/qa_three_pages.py

# Expected result: 100/100, 0 bugs, 0 warnings
```

### Key QA Requirements
- **axe-core:** 0 WCAG 2.1 AA violations
- **Touch targets:** All interactive elements ≥44×44px
- **Color contrast:** ≥4.5:1 (normal text), ≥3:1 (large text)
- **Performance:** FCP < 1800ms, CLS < 0.1
- **Security:** 6/6 security headers present
- **prefers-reduced-motion:** All animations disabled
