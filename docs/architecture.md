# Architecture — Vinifera

**Last updated:** 2026-07-26
**Maintainer:** Any agent (must reflect actual deployment state)

---

## System Overview

Vinifera is a static multi-page web application deployed to Cloudflare Pages. There is no backend, database, or server-side runtime — all three pages are self-contained HTML files with inline CSS and JavaScript.

```
[Browser] → [Cloudflare Pages CDN (330+ edge locations)] → [Static HTML files in dist/]
```

### Pages

| Page | Source File | Route | Description |
|------|------------|-------|-------------|
| Landing | `index.html` | `/` | Marketing site: hero vineyard illustration with 4 CSS/SVG animations, feature grid, workflow illustrations, pricing, CTA sunset gradient |
| App Prototype | `app` (extensionless) | `/app/*` | Interactive dashboard: 13 functional areas, 27 KPI cards, sidebar nav, KPI watermarks, empty-state illustration |
| Investor's Guide | `guide` (extensionless) | `/guide/*` | 8-part document: sticky TOC sidebar, reading progress bar, scroll-spy, feature grid, tech stack, timeline, pricing, stats |

---

## Build Pipeline

```
index.html ─┐
app ────────┤→ scripts/build.mjs → dist/
guide ──────┤
public/* ───┘
```

The build script (`scripts/build.mjs`) copies the three root files and the `public/` directory contents into `dist/`. No transpilation, bundling, or minification occurs — the files are served as-is.

### Cloudflare Pages Configuration

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Output directory | `dist/` |
| Node version | 20 |
| Deploy trigger | GitHub App webhook (push to `main`) |
| `pages_build_output_dir` | `./dist` (in `wrangler.toml`) |

---

## Routing

Routing is handled by Cloudflare Pages' `_redirects` file:

```
/app/*    /app    200
/guide/*  /guide  200
```

These are rewrites (status 200), not redirects. The root path `/` serves `index.html` as a static file.

### Why Extensionless Filenames

Cloudflare Pages' pretty-URL feature 308-redirects `*.html` files, which intercepts `_redirects` rules. Using extensionless filenames (`app`, `guide`) avoids this. The `_headers` file sets `Content-Type: text/html` for these routes.

---

## Security Headers

The `public/_headers` file applies security headers to all routes:

| Header | Value |
|--------|-------|
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=() |
| Strict-Transport-Security | (set by Cloudflare edge) |

Content-Type overrides are applied for `/app` and `/guide` routes (both direct and wildcard) to ensure `text/html; charset=utf-8`.

---

## External Dependencies

| Service | Purpose | Notes |
|---------|---------|-------|
| Lucide Icons (CDN) | Icon library | Loaded via `<script>` from `unpkg.com` |
| Cloudflare Pages | Hosting + CDN | 330+ edge locations, 99.99% uptime |

No other external dependencies. All CSS and JS are inline — no external stylesheets or scripts beyond Lucide.

---

## Animations

The landing page hero includes four animations:

| Animation | Type | Duration | Reduced-Motion |
|-----------|------|----------|----------------|
| Vine line drawing | CSS `stroke-dashoffset` | 2.5s one-time | `animation: none` |
| Gold glow pulse | CSS `opacity` on `::before` | 6s alternate | `animation: none` |
| Grape cluster sway | SVG `<animateTransform additive="sum">` | 7/8/9s | `display: none !important` |
| CTA shimmer sweep | CSS `::after` `translateX` | 4s | `display: none` |

All animations are disabled under `@media (prefers-reduced-motion: reduce)`.

---

## Known Constraints

- **CSS transform vs SVG transform:** CSS `transform` overrides SVG `transform` presentation attributes — they do not compose. Use SVG-native `<animateTransform additive="sum">` for animations that combine with existing `transform="translate()"` positioning.
- **Edge cache lag:** Custom domain cache lags deployment-specific URL by 15–30s. Verify fixes on `*.pages.dev` URL first.
- **GitHub webhook API:** The `/repos/{owner}/{repo}/hooks` endpoint returns 0 hooks even when the Cloudflare Pages GitHub App webhook is active. Verify via deployment `trigger_type`.
