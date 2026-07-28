# Marketing Worker CSP Compatibility

**Date:** 2026-07-28

**Status:** Accepted as a bounded compatibility measure

## Context

The static marketing document still contains its primary stylesheet and 74
small presentation overrides inline. Cloudflare Pages already permits inline
styles for this artifact, but the Worker security middleware previously
declared `style-src 'self'`. When the same document was served by the Worker,
the browser discarded all of those styles. At a 375-pixel viewport this
rendered raw HTML and caused widespread failures of the 44-by-44-pixel touch
target requirement.

The document also loads the decorative Lucide browser bundle. Pages permitted
that origin, while the Worker declared `script-src 'self'`, so the Worker
blocked the icon bundle.

## Decision

- Keep executable first-party marketing behavior in
  `/public/marketing.js`; inline JavaScript remains prohibited.
- Permit `unsafe-inline` only in `style-src` while the legacy marketing
  document retains inline CSS.
- Permit `https://unpkg.com` in `script-src` for the Lucide browser bundle.
- Pin Lucide to the same `1.27.0` version used by the application dependency
  and require its SHA-384 Subresource Integrity digest plus anonymous CORS.
- Cover the Worker response policy and rendered 375-pixel target sizes in the
  Phase 1 browser suite.

## Consequences

The marketing page renders consistently through Pages and the Worker without
allowing inline script execution. The external icon bundle cannot execute if
its bytes differ from the committed integrity digest.

The inline-style allowance is a documented security debt. A future,
independently reviewed change may externalize the primary stylesheet and
replace every inline presentation override, then remove `unsafe-inline` from
both the Worker policy and `public/_headers`. That larger visual rewrite is not
part of the PR #51 release-repair batch.

## Verification

1. Run `npm run check`.
2. Run `npx playwright test tests/e2e/phase1.spec.ts`.
3. Confirm the marketing baseline at 375 pixels has zero axe violations,
   horizontal overflow, or undersized visible interactive targets.
4. Confirm the Worker response contains the committed `script-src` and
   `style-src` directives and the browser accepts the pinned Lucide asset.
