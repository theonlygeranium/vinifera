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

The document also loaded the decorative Lucide browser bundle from unpkg.
Pages permitted that origin, while the Worker declared `script-src 'self'`, so
the Worker blocked the icon bundle. Allowing the entire CDN origin in the
Worker policy restored the icons but granted more script authority than the
pinned asset required.

## Decision

- Keep executable first-party marketing behavior in
  `/public/marketing.js`; inline JavaScript remains prohibited.
- Permit `unsafe-inline` only in `style-src` while the legacy marketing
  document retains inline CSS.
- Commit the Lucide 1.27.0 UMD bundle and upstream license under `public/`,
  serve it as `/lucide.min.js`, and retain its SHA-384 digest in a regression
  test.
- Keep the Worker `script-src` at `self`; do not grant script authority to a
  third-party origin.
- Use the same first-party bundle for the marketing page, investor guide, and
  static rollback prototype, and remove unpkg from the Pages header policy.
- Cover the Worker response policy and rendered 375-pixel target sizes in the
  Phase 1 browser suite.

## Consequences

The marketing page renders consistently through Pages and the Worker without
allowing inline script execution or trusting a third-party script origin. The
committed bundle's SHA-384 regression detects unreviewed byte changes, and its
ISC/MIT license text ships beside it.

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
4. Confirm the Worker response contains `script-src 'self'` and the documented
   `style-src` exception, and that all 58 landing-page Lucide icons render from
   `/lucide.min.js`.
