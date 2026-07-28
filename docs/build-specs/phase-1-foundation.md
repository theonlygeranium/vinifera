# Phase 1: The Foundation

**Duration:** Weeks 1–6
**Status:** Active
**Exit Criterion:** Secure staff login, magic-link member login, multi-tenant organization architecture, and Stripe subscription billing are all functional and verified against real Stripe test mode.

---

## Objective

Build the infrastructure layer that every subsequent phase depends on. No wine club features yet — getting the foundation correct before any club features exist prevents costly rewrites later.

This phase delivers: authentication, multi-tenant data architecture, Stripe subscription billing, and the base application scaffolding (React + Tailwind frontend, Node.js backend, Supabase database).

---

## Scope

### 1.1 Application Scaffolding

- Initialize a React + Tailwind CSS frontend project (Vite-based)
- Initialize a Node.js backend (Express or Next.js API routes — Codex decides based on architecture evaluation)
- Configure Supabase project with PostgreSQL database
- Set up environment variable management (`.env` files, never committed)
- Configure CI/CD pipeline (GitHub Actions → Cloudflare Pages for frontend, Supabase for backend)
- Establish project structure matching the prototype's functional areas

### 1.2 Authentication — Staff Portal

- Supabase Auth with email/password for staff
- OAuth support (Google) as alternative staff login
- Role-based access control: Owner, Admin, Manager, Staff
- Session management with JWT tokens
- Protected routes — unauthenticated users redirect to login
- Staff onboarding flow: invite → accept → set password → first-login dashboard

### 1.3 Authentication — Member Portal

- Supabase Auth with magic-link (passwordless) for members
- Member receives email with one-click login link
- Link expires after 15 minutes
- Rate limiting: max 5 magic-link requests per email per hour
- Member session is separate from staff session (different auth surfaces)
- Member portal route: `/portal/*` (separate from admin `/app/*`)

### 1.4 Multi-Tenant Architecture

- Organization model: each winery is an organization (tenant)
- Row-Level Security (RLS) at the database layer — Winery A can NEVER see Winery B's data
- RLS policies enforced on every table: `WHERE organization_id = private.org_id()`
- Staff belong to exactly one organization (enforced at DB level)
- Members belong to exactly one organization
- Super-admin role for platform operators (EdStratum Labs) — can access all orgs

### 1.5 Stripe Subscription Billing

- Stripe Customer created per organization on signup
- Subscription tiers: Vine ($149/mo), Cellar ($349/mo), Estate ($749/mo), Reserve ($1,500+/mo)
- Stripe Webhook handler for subscription events:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- Subscription status syncs to database via webhook
- Grace period handling: 7 days past due → restricted access, 14 days → suspended
- Stripe test mode for development — no real charges

### 1.6 Database Schema (Foundation Tables)

```
organizations
  - id (uuid, PK)
  - name (text)
  - stripe_customer_id (text)
  - stripe_subscription_id (text)
  - plan_tier (enum: vine, cellar, estate, reserve)
  - created_at (timestamptz)
  - updated_at (timestamptz)

users (staff)
  - id (uuid, PK, references auth.users)
  - organization_id (uuid, FK → organizations)
  - email (text, unique)
  - role (enum: owner, admin, manager, staff)
  - created_at (timestamptz)

members
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - email (text)
  - first_name (text)
  - last_name (text)
  - status (enum: active, paused, cancelled)
  - created_at (timestamptz)

subscription_events
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - event_type (text)
  - stripe_event_id (text, unique)
  - payload (jsonb)
  - created_at (timestamptz)
```

RLS policies on all tables: staff can only access rows where `organization_id` matches their org. Members can only access their own row.

---

## Implementation Instructions for Codex

### Architecture Decisions

Codex has full authority to make architecture decisions within these constraints:
- **Frontend:** React + Tailwind CSS (Vite). Must match the existing prototype's visual design.
- **Backend:** Node.js. Express or Next.js API routes — Codex evaluates and decides.
- **Database:** Supabase (PostgreSQL) with RLS.
- **Auth:** Supabase Auth (password for staff, magic-link for members).
- **Payments:** Stripe (subscriptions + webhooks).

Codex may spawn subagents for: frontend scaffolding, backend API setup, database schema design, Stripe integration, auth implementation, and testing.

### Build Order

1. **Scaffold** — frontend + backend + Supabase project
2. **Database** — schema migrations + RLS policies
3. **Auth (staff)** — login, signup, roles, protected routes
4. **Auth (members)** — magic-link flow, separate session
5. **Stripe** — customer creation, subscription tiers, webhooks
6. **Integration** — connect auth + billing + database
7. **QA Gate** — run full QA suite (see below)
8. **Deploy** — deploy to staging, verify end-to-end

---

## QA Gate (Phase 1)

**This phase is NOT complete until ALL of the following pass.**

### Functional Tests

- [ ] Staff can sign up, log in, and log out
- [ ] Staff password reset flow works
- [ ] Staff OAuth (Google) login works
- [ ] Role-based access: Staff cannot access Owner-only routes
- [ ] Member can request magic-link and log in with it
- [ ] Magic-link expires after 15 minutes
- [ ] Rate limiting prevents magic-link abuse (5/hour max)
- [ ] Staff and member sessions are isolated (no cross-auth)
- [ ] Stripe checkout creates subscription in test mode
- [ ] Stripe webhook updates subscription status in database
- [ ] Payment failure triggers grace period logic
- [ ] RLS prevents cross-organization data access (verify with SQL test)

### Accessibility (axe-core)

- [ ] 0 axe-core WCAG 2.1 AA violations on login, signup, and dashboard pages
- [ ] All form inputs have associated `<label>` or `aria-label`
- [ ] Color contrast ≥ 4.5:1 for normal text
- [ ] Keyboard navigation: Tab order is logical, Enter/Space activates buttons
- [ ] Focus indicators visible on all interactive elements
- [ ] Error messages are announced to screen readers (`aria-live`)

### Visual / Layout

- [ ] Login and signup forms render correctly at 375px (mobile), 768px (tablet), 1440px (desktop)
- [ ] No text overflow, clipping, or element overlap at any breakpoint
- [ ] Touch targets ≥ 44×44px on mobile
- [ ] `visual_qa` passes on all captured screenshots

### Performance

- [ ] LCP < 2.5s on login page
- [ ] CLS < 0.1
- [ ] No render-blocking resources
- [ ] JS bundle < 200KB gzipped (initial load)

### Security

- [ ] HTTPS enforced
- [ ] Security headers present (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Content-Security-Policy)
- [ ] No sensitive data in client-side JS or HTML source
- [ ] No API keys, tokens, or secrets in localStorage
- [ ] JWT tokens are httpOnly cookies (not localStorage)
- [ ] CORS configured restrictively (not `*`)
- [ ] Stripe webhook signature verification implemented

### Mobile

- [ ] Viewport meta tag correct
- [ ] No hover-only interactions
- [ ] Orientation change handled
- [ ] Input types optimized for mobile keyboards (email, password)

### Exit Criterion Verification

- [ ] One real test organization created via signup flow
- [ ] Stripe subscription activated in test mode
- [ ] Staff can log in and see an empty dashboard
- [ ] Member can log in via magic-link and see an empty portal
- [ ] RLS verified: create two orgs, confirm Org A staff cannot query Org B data

---

## Deliverables

- Working application with auth + billing + multi-tenant architecture
- Database schema with RLS policies
- Stripe webhook handler
- QA test report (saved as `docs/build-specs/phase-1-qa-report.md`)
- ADR for any architectural decisions made (saved in `docs/decisions/`)
- Updated CHANGELOG.md

---

## Pre-Provisioned Credentials

The following credentials are already stored as encrypted GitHub repository secrets. Codex should read them from the repo environment — do NOT hardcode values in source files, and do NOT request them from the human supervisor.

| Secret name | Purpose | Scope |
|-------------|---------|-------|
| `SUPABASE_URL` | Supabase project URL | Client + server |
| `SUPABASE_ANON_KEY` | Supabase anon/public key | Client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | **Server-only** — bypasses RLS, never expose client-side |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase new-format publishable key | Client-safe |
| `SUPABASE_SECRET_KEY` | Supabase new-format secret key | Server-only |
| `STRIPE_PUBLISHABLE_KEY` | Stripe test-mode publishable key | Client-safe |
| `STRIPE_SECRET_KEY` | Stripe test-mode secret key | Server-only |

**Stripe webhook secret** (`STRIPE_WEBHOOK_SECRET`) is not pre-provisioned. Codex must create the webhook endpoint in the Stripe dashboard, then store the webhook signing secret as a new GitHub repo secret.

**Security rules:**
- The `SUPABASE_SERVICE_ROLE_KEY` bypasses all Row-Level Security. It must NEVER appear in client-side code, frontend bundles, or environment variables exposed to the browser. Use it only in server-side API routes and backend services.
- The `STRIPE_SECRET_KEY` must never appear client-side. Use `STRIPE_PUBLISHABLE_KEY` for client-side Stripe.js.
- All secrets should be accessed via the repo's secret management (GitHub Actions secrets for CI/CD, `.env` for local development — `.env` is gitignored and must never be committed).

---

## Constraints

- **No wine club features in this phase.** No member management, no shipments, no club tiers. Only infrastructure.
- **Stripe test mode only.** No real charges. Test cards only.
- **Supabase RLS is non-negotiable.** Application-level authorization alone is insufficient — it must be enforced at the database layer.
- **Magic-link for members is mandatory.** No passwords for members. This is a product differentiator.
- **The prototype at `https://vinifera.edstratumlabs.ai/app/` is the visual spec.** Match its design language, color palette, and layout patterns.
- **Never commit secret values to source files.** The repository is public. All credentials are stored as encrypted GitHub repository secrets.
