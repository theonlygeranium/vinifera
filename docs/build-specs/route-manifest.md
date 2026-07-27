# BS-02 Route Manifest

**Source audited:** `server/app.ts` at `30fe29e`
**Audit date:** 2026-07-27
**Scope:** All 129 Express HTTP route registrations, global middleware order,
inline route logic, and route-to-database access.

## Middleware chains

The route tables use these exact middleware-chain identifiers:

| ID | Middleware chain in registration order |
|---|---|
| `P` | `helmet` → CSP/cache headers → CORS |
| `R1` | `P` → `express.raw({ limit: "1mb", type: "application/json" })` |
| `R5` | `P` → `express.raw({ limit: "5mb", type: "application/json" })` |
| `A` | `P` → `express.json({ limit: "256kb", strict: true })` → `assertTrustedOrigin` → `requireAuthPresence` |
| `M6` | `A` → `express.raw({ limit: "6mb", type: "multipart/form-data" })` |

All handlers are inline anonymous functions in the source. `async` is recorded
where the handler is asynchronous.

## Public, callback, and webhook routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/.well-known/apple-app-site-association` | anonymous | `P` |
| GET | `/.well-known/assetlinks.json` | anonymous | `P` |
| POST | `/api/billing/webhook` | anonymous async | `R1` |
| POST | `/api/webhooks/klaviyo/:integrationId` | anonymous async | `R5` |
| GET | `/api/integrations/quickbooks/callback` | anonymous async | `P` |
| GET | `/api/auth/member/mobile/callback` | anonymous async | `P` |
| POST | `/api/webhooks/resend`, `/api/email/webhook` | anonymous async | `R1` |
| GET | `/api/communications/unsubscribe` | anonymous async | `P` |
| POST | `/api/communications/unsubscribe` | anonymous async | `P` |

## System and portal routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/health` | anonymous | `A` |
| GET | `/api/health/configuration` | anonymous | `A` |
| GET | `/api/portal/branding` | anonymous async | `A` |

## Integration, organization, and brand routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/integrations` | anonymous async | `A` |
| POST | `/api/integrations/:type/connect` | anonymous async | `A` |
| PATCH | `/api/integrations/:type` | anonymous async | `A` |
| DELETE | `/api/integrations/:type` | anonymous async | `A` |
| POST | `/api/integrations/:type/sync` | anonymous async | `A` |
| GET | `/api/integrations/:type/logs` | anonymous async | `A` |
| GET | `/api/integrations/quickbooks/authorize` | anonymous async | `A` |
| GET | `/api/integrations/quickbooks/reconciliation` | anonymous async | `A` |
| GET | `/api/integrations/avalara/liability` | anonymous async | `A` |
| GET | `/api/integrations/avalara/filing` | anonymous async | `A` |
| POST | `/api/integrations/avalara/filing/verify` | anonymous async | `A` |
| GET | `/api/integrations/meta/attribution` | anonymous async | `A` |
| GET | `/api/brands` | anonymous async | `A` |
| POST | `/api/brands` | anonymous async | `A` |
| PATCH | `/api/brands/:id` | anonymous async | `A` |
| POST | `/api/brands/:id/sender/verify` | anonymous async | `A` |
| GET | `/api/organization/overview` | anonymous async | `A` |
| PUT | `/api/brands/:id/domain` | anonymous async | `A` |
| GET | `/api/brands/:id/domain` | anonymous async | `A` |
| DELETE | `/api/brands/:id/domain` | anonymous async | `A` |

## Mobile and member privacy routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/mobile/app-policy` | anonymous async | `A` |
| POST | `/api/auth/member/mobile/magic-link` | anonymous async | `A` |
| POST | `/api/auth/member/mobile/exchange` | anonymous async | `A` |
| POST | `/api/auth/member/mobile/refresh` | anonymous async | `A` |
| POST | `/api/auth/member/mobile/logout` | anonymous async | `A` |
| GET | `/api/mobile/bootstrap` | anonymous async | `A` |
| POST | `/api/mobile/devices` | anonymous async | `A` |
| DELETE | `/api/mobile/devices` | anonymous async | `A` |
| PUT | `/api/member/privacy/meta` | anonymous async | `A` |
| GET | `/api/member/privacy/meta` | anonymous async | `A` |

## Analytics, intelligence, benchmark, and compliance routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/analytics/dashboard` | anonymous async | `A` |
| GET | `/api/analytics/export` | anonymous async | `A` |
| GET | `/api/analytics/layout` | anonymous async | `A` |
| PATCH | `/api/analytics/layout` | anonymous async | `A` |
| GET | `/api/analytics/reports` | anonymous async | `A` |
| POST | `/api/analytics/reports` | anonymous async | `A` |
| PATCH | `/api/analytics/reports/:id` | anonymous async | `A` |
| POST | `/api/analytics/events` | anonymous async | `A` |
| GET | `/api/ml/operations` | anonymous async | `A` |
| GET | `/api/churn-intelligence` | anonymous async | `A` |
| PATCH | `/api/churn-intelligence/alerts/:id` | anonymous async | `A` |
| GET | `/api/members/:id/churn-intelligence` | anonymous async | `A` |
| GET | `/api/benchmarks` | anonymous async | `A` |
| PATCH | `/api/benchmarks/preferences` | anonymous async | `A` |
| GET | `/api/compliance/dashboard` | anonymous async | `A` |
| GET | `/api/compliance/checks/:id` | anonymous async | `A` |
| POST | `/api/compliance/shipments/:shipmentId/check` | anonymous async | `A` |
| POST | `/api/compliance/releases/:releaseId/check` | anonymous async | `A` |

## Staff/member authentication and billing routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| POST | `/api/auth/staff/signup` | anonymous async | `A` |
| POST | `/api/auth/staff/login` | anonymous async | `A` |
| POST | `/api/auth/staff/logout` | anonymous async | `A` |
| GET | `/api/auth/staff/session` | anonymous async | `A` |
| POST | `/api/auth/staff/forgot-password` | anonymous async | `A` |
| POST | `/api/auth/staff/reset-password` | anonymous async | `A` |
| GET | `/api/auth/staff/google` | anonymous async | `A` |
| GET | `/api/auth/staff/callback` | anonymous async | `A` |
| POST | `/api/auth/staff/accept-invite` | anonymous async | `A` |
| POST | `/api/staff/invitations` | anonymous async | `A` |
| POST | `/api/auth/member/magic-link` | anonymous async | `A` |
| GET | `/api/auth/member/callback` | anonymous async | `A` |
| GET | `/api/auth/member/session` | anonymous async | `A` |
| POST | `/api/auth/member/logout` | anonymous async | `A` |
| POST | `/api/billing/checkout` | anonymous async | `A` |
| POST | `/api/billing/portal` | anonymous async | `A` |

## Communications, retention, cancellation, and loyalty routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/email/templates` | anonymous async | `A` |
| POST | `/api/email/templates` | anonymous async | `A` |
| PATCH | `/api/email/templates/:id` | anonymous async | `A` |
| DELETE | `/api/email/templates/:id` | anonymous async | `A` |
| POST | `/api/email/templates/:id/preview` | anonymous async | `A` |
| POST | `/api/email/templates/:id/test`, `/api/email/templates/:id/test-send` | anonymous async | `A` |
| GET | `/api/email/log` | anonymous async | `A` |
| GET | `/api/churn-scores` | anonymous async | `A` |
| GET | `/api/members/:id/churn-score` | anonymous async | `A` |
| GET | `/api/cancel-flow/config` | anonymous async | `A` |
| PATCH | `/api/cancel-flow/config` | anonymous async | `A` |
| GET | `/api/cancel-flow/analytics` | anonymous async | `A` |
| GET | `/api/member/cancel-flow` | anonymous async | `A` |
| POST | `/api/member/cancel-flow` | anonymous async | `A` |
| POST | `/api/member/cancel-flow/events` | anonymous async | `A` |
| GET | `/api/loyalty/members` | anonymous async | `A` |
| POST | `/api/loyalty/members/:id/adjust` | anonymous async | `A` |
| POST | `/api/loyalty/members/:id/events` | anonymous async | `A` |
| GET | `/api/loyalty/members/:id` | anonymous async | `A` |
| GET | `/api/member/loyalty` | anonymous async | `A` |
| POST | `/api/member/loyalty/redeem` | anonymous async | `A` |

## Club tier and member routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/club-tiers` | anonymous async | `A` |
| POST | `/api/club-tiers` | anonymous async | `A` |
| PATCH | `/api/club-tiers/:id` | anonymous async | `A` |
| DELETE | `/api/club-tiers/:id` | anonymous async | `A` |
| POST | `/api/club-tiers/:id/assign` | anonymous async | `A` |
| GET | `/api/members` | anonymous async | `A` |
| POST | `/api/members` | anonymous async | `A` |
| GET | `/api/members/export` | anonymous async | `A` |
| POST | `/api/members/import/preview` | anonymous async | `M6` |
| POST | `/api/members/import` | anonymous async | `A` |
| POST | `/api/members/batch` | anonymous async | `A` |
| GET | `/api/members/:id` | anonymous async | `A` |
| PATCH | `/api/members/:id` | anonymous async | `A` |
| DELETE | `/api/members/:id` | anonymous async | `A` |

## Release, recovery, shipment, and member-fulfillment routes

| Method | Path | Handler | Chain |
|---|---|---|---|
| GET | `/api/releases` | anonymous async | `A` |
| POST | `/api/releases` | anonymous async | `A` |
| GET | `/api/releases/:id` | anonymous async | `A` |
| PATCH | `/api/releases/:id` | anonymous async | `A` |
| POST | `/api/releases/:id/schedule` | anonymous async | `A` |
| POST | `/api/releases/:id/process` | anonymous async | `A` |
| GET | `/api/recovery` | anonymous async | `A` |
| GET | `/api/shipments` | anonymous async | `A` |
| POST | `/api/shipments/labels` | anonymous async | `A` |
| POST | `/api/shipping/validate-address` | anonymous async | `A` |
| GET | `/api/shipments/pick-list` | anonymous async | `A` |
| POST | `/api/shipments/:id/pack` | anonymous async | `A` |
| POST | `/api/shipments/:id/retry` | anonymous async | `A` |
| POST | `/api/shipments/:id/refund` | anonymous async | `A` |
| PATCH | `/api/shipments/:id/status` | anonymous async | `A` |
| GET | `/api/member/shipments` | anonymous async | `A` |
| PATCH | `/api/member/profile/address` | anonymous async | `A` |
| POST | `/api/member/billing/portal` | anonymous async | `A` |

## Non-route middleware registrations

After the protected routes, `app.ts` registers an `/api` fallback that raises
the existing structured 404 `AppError`, followed by the terminal structured
error handler. Their order must remain unchanged after extraction.

## Inline logic audit

The following handlers contain more than request validation, a single service
call, and response serialization. BS-02 must move them unchanged and annotate
them for the later service-layer work:

| Route | Inline concern |
|---|---|
| `GET /api/communications/unsubscribe` | Builds and returns the confirmation HTML document. |
| `GET /api/auth/member/session` | Projects the session principal to the public member shape. |
| `PATCH /api/cancel-flow/config` | Normalizes the accepted `order`/`position` aliases. |
| `POST /api/member/cancel-flow/events` | Normalizes step/outcome and details/metadata aliases. |
| `POST /api/members/import/preview` | Parses multipart data and validates/sanitizes the uploaded CSV metadata. |
| `PATCH /api/members/:id` | Branches status transitions from profile updates and normalizes profile aliases. |
| `POST /api/releases` | Normalizes release tier and wine aliases before the service call. |
| `PATCH /api/releases/:id` | Normalizes partial release tier and wine aliases before the service call. |

The remaining handlers perform boundary validation, service delegation, and
HTTP response shaping only. Response status selection, redirects, CSV response
headers, and configuration fail-closed checks are transport concerns and are
not classified as business logic.

## Post-extraction review follow-up

The extraction commit moved the audited handlers unchanged. The subsequent
owner-authorized review pass hardened the route boundary without changing any
registration or middleware chain in this manifest:

- Release create/update normalization rejects mismatched tier/price sets and
  unnamed wine lines before service dispatch; member and release PATCH routes
  send only supplied fields, and canonical member aliases preserve explicit
  `null` values.
- Partial email-template updates do not apply the create-time `enabled`
  default, and shared email validation trims before format validation.
- Staff callback redirects reject control-character and backslash authority
  forms without rewriting them into an accepted path, and webhook handlers
  reject non-buffer raw bodies with a structured 400 response before provider
  dispatch.
- Audit fields and rate-limit actor keys trust Cloudflare's edge-managed
  `CF-Connecting-IP` value only when `APP_ENV` is `staging` or `production`.
  Development and test requests use Express's direct socket address so callers
  cannot choose their own identity by supplying that header.
- The existing CSV multipart parser remains in the
  `POST /api/members/import/preview` handler and retains its `TODO(BS-03)`.
  It now validates bounded MIME boundary syntax, CRLF/header framing, terminal
  boundaries, and field counts, and ignores delimiter-like bytes that are not
  valid boundary lines. A Node stream-oriented `multer`/`busboy` dependency was
  not added to the Cloudflare Worker request adapter without runtime evidence.
- The `GET /api/auth/member/session` projection retains its `TODO(BS-03)` and
  remains tracked in the inline-logic table above.

## Direct database access audit

`server/app.ts` has no direct Supabase import, no `createClient` call, and no
SQL construction. Every route reaches persistence through the injected
foundation, core, retention, analytics, or integration service interfaces.

## Extraction ownership plan

| Target file | Route domains |
|---|---|
| `server/routes/system.ts` | Association documents, health, configuration, portal branding |
| `server/routes/webhooks.ts` | Stripe, Klaviyo, and Resend webhooks |
| `server/routes/integrations.ts` | QuickBooks callback, connectors, brands, organization |
| `server/routes/mobile.ts` | Mobile callback/auth/session/device routes and Meta privacy |
| `server/routes/analytics.ts` | Analytics dashboard, exports, layouts, reports, events |
| `server/routes/intelligence.ts` | ML operations, churn intelligence, benchmarks |
| `server/routes/compliance.ts` | Compliance dashboard and check execution |
| `server/routes/auth.ts` | Staff/member web authentication and staff invitations |
| `server/routes/billing.ts` | Staff billing Checkout/portal |
| `server/routes/retention.ts` | Unsubscribe, email, churn score, cancel flow, loyalty |
| `server/routes/tiers.ts` | Club tier CRUD and assignment |
| `server/routes/members.ts` | Member CRUD, batch, import, and export |
| `server/routes/releases.ts` | Releases and recovery queue |
| `server/routes/fulfillment.ts` | Shipments, address validation, member fulfillment/billing |
| `server/routes/index.ts` | Ordered router mounting |

Shared schemas, injected service selectors, and unchanged transport helpers may
live in `server/routes/shared.ts`; this keeps all additions inside
`server/routes/` and leaves `server/app.ts` as the global middleware entry
point.
