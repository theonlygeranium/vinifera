# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- React 19 + Tailwind/Vite staff and member applications with code-split `/app/*` and `/portal/*` routes.
- Express 5 backend-for-frontend packaged with static assets in one Cloudflare Worker.
- Secure staff password, reset, Google OAuth, invitation, and protected-route flows.
- Passwordless member magic-link flow with isolated staff/member HTTP-only cookie sessions.
- Supabase foundation migration with forced RLS, server-derived JWT claims, super-admin access, tenant indexes, atomic invitation consumption, and pgTAP suites.
- Stripe test-mode Checkout, Customer Portal, signed webhook processing, idempotency, out-of-order protection, and seven/fourteen-day access reconciliation.
- Configuration health and typed activation gates so real provider connections can be enabled later without production mocks.
- GitHub-hosted CI for dependency audit, type-checking, unit/integration tests, Worker packaging, Playwright/axe QA, conditional Supabase migration, and Worker deployment.
- Phase 1 architecture ADR and QA report.

### Changed

- Replaced the static `/app` deployment artifact with a production React shell while retaining the original `app` file as the visual reference.
- Moved runtime configuration from Pages `wrangler.toml` to Worker `wrangler.jsonc`.
- Stopped tracking generated `dist/` output; CI and deployments now build it from source.
- Updated setup, architecture, continuity, rollback, and repository documentation for the Phase 1 production foundation.

### Fixed

- Replaced the accidentally Base64-encoded `.gitignore` with active ignore rules that prevent local environment files, Worker secrets, dependencies, build output, and QA artifacts from being committed.
- Removed a timer-based Express rate-limit middleware that is incompatible with Cloudflare Worker global scope; member magic-link limits are enforced atomically in PostgreSQL.
- Normalized database RPC and API session contracts, including Stripe event return shapes and camel-cased browser payloads.
- Refreshed newly bootstrapped Supabase sessions so database-derived tenant claims are immediately available.
- Made disconnected session probes fail closed without producing noisy browser errors.

---

## [0.1.0] — 2026-07-26

### Added
- Initial repository created from `github-deploy-template`
- `AGENTS.md` — agent collaboration guide
- `CONTINUITY_BRIEF.md` — drop-in context for new agent sessions
- `CHANGELOG.md` — this file
- `REVERT.md` — stable baseline and rollback guide
- `.env.example` — non-secret environment variable template
- `docs/architecture.md` — system architecture documentation
- `docs/setup.md` — setup and deployment guide
- `docs/decisions/` — ADR directory
- `docs/runbooks/` — runbooks directory
- `.github/workflows/deploy.yml` — CI/CD pipeline
- Cloudflare Pages project `vinifera` created and configured
- Custom domain `vinifera.edstratumlabs.ai` with SSL
- GitHub Secrets injected: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `SCHUBERT_SSH_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Landing page (`index.html`) with hero vineyard illustration, feature grid, workflow illustrations, pricing, CTA sunset gradient
- App prototype (`app`) with 13 functional areas, 27 KPI cards, sidebar navigation, KPI watermarks, empty-state illustration
- Investor's guide (`guide`) with 8-part content, sticky TOC sidebar, reading progress bar, scroll-spy navigation, feature grid, tech stack, timeline, pricing, stats strip
- Four hero animations: vine line drawing, gold glow pulse, grape cluster sway, CTA shimmer sweep
- `prefers-reduced-motion` fallback for all animations (CSS + SVG SMIL)
- Extensionless `app` and `guide` files for Cloudflare Pages routing
- `_redirects` routing rules for `/app/*` and `/guide/*`
- `_headers` security headers and Content-Type overrides
- "Investor's Guide" nav links in desktop nav, mobile drawer, and footer

### Fixed
- Mobile navigation: hamburger visibility, positioning, and drawer functionality
- Landing page CTA links pointing to `index.html` instead of `/app/`
- App hamburger menu not opening on mobile
- App mobile pipeline overflow at 375px viewport
- Hero illustration visibility — gradient too dramatic, SVG opacities too low
- Grape cluster rendering — CSS `transform: rotate()` overriding SVG `transform="translate()"` attribute, switched to SVG `<animateTransform additive="sum">`
- Mobile grape cluster overlap with hero-proof text
- WCAG 2.1 AA color-contrast violations across landing, app, and guide pages (20+ elements)
- WCAG 1.4.3 `btn-gold` contrast: white text on gold (2.59:1) → wine-dark text (6.47:1)
- Guide page ARIA table role violations (`aria-required-children`, `aria-required-parent`)
- Guide page `--text-3` color contrast: `#9C8C78` (3.26:1) → `#6B5D4A` (6.38:1)
- Guide page gold stat-value contrast: `#C9993A` (2.59:1) → `#9A7510` (3.5:1)
- Missing `<main>` and `<header>` HTML landmarks
- Touch targets below 44px (WCAG 2.5.5) — 16 elements fixed
- Footer color contrast on dark background
- Guide page `aria-label` on divs without valid ARIA roles — added `role="group"`

### Changed
- Hero gradient from dramatic near-black-to-gold to uniform deep burgundy for SVG illustration visibility
- `--text-3` from `#9C8C78` to `#6B5D4A` for WCAG 2.1 AA compliance
- `--text-muted` from `#9CA3AF` to `#5B6470` for WCAG 2.1 AA compliance
- `--success` from `#16A34A` to `#15803D` for WCAG 2.1 AA compliance
- `--danger` from `#DC2626` to `#B91C1C` for WCAG 2.1 AA compliance
- `.btn-gold` text color from `--white` to `--wine-dark` for WCAG 1.4.3 compliance
- Template files updated with actual vinifera project details (replaced all `[REPO-NAME]` placeholders)
- README.md rewritten with professional project overview, features, tech stack, and EdStratum Labs about section
