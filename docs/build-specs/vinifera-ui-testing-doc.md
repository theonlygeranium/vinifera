# Vinifera UI Testing Specification
**Version:** 1.0 | **Repo:** `theonlygeranium/vinifera` | **Branch target:** `dev`
**Owner:** EdStratum Labs / `founder@edstratumlabs.ai`
**Baseline:** v0.5.0 — BS-01 through BS-06 merged, 624 Vitest + 155 passed Playwright/axe with 3 hosted-only skips
**Baseline:** v0.5.0 — BS-01 through BS-06 merged, 593 Vitest + 155 passed Playwright/axe with 3 hosted-only skips
**Baseline:** v0.5.0 — BS-01 through BS-06 merged, 585 Vitest + 155 passed Playwright/axe with 3 hosted-only skips
**Last updated:** 2026-08-06
**Baseline:** v0.5.0 — BS-01 through BS-06 merged, 596 Vitest + 155 passed Playwright/axe with 3 hosted-only skips
**Last updated:** 2026-08-05

---

## 0. Mandatory Pre-Flight for Every Agent

Before writing a single line of test code or opening a browser, every agent and subagent **must** read all four documents below in full. No exceptions.

1. `AGENTS.md` — prime directives, file ownership, PR rules
2. `CONTINUITY_BRIEF.md` — current activation gate status (all 20 gates are `pending`; do not attempt to pass them)
3. `docs/agent-workflow.md` — branching, PR loop, merge authority
4. `docs/architecture.md` — topology, tenant model, provider guards

**Critical constraints inherited from those documents:**
- All PRs target **`dev`** only. Never open a PR against `staging` or `main`.
- Never activate a hosted gate. Never commit real credentials.
- `CHANGELOG.md` must be updated in every commit.
- `npm run check` must pass before every push (TypeScript + 624 Vitest), and
  `npm run qa:e2e` owns the 155 passed Playwright/axe baseline.
- `npm run check` must pass before every push (593 Vitest + TypeScript clean + zero axe violations).
- `npm run check` must pass before every push (585 Vitest + TypeScript clean + zero axe violations).
- `npm run check` must pass before every push (596 Vitest + TypeScript clean + zero axe violations).
- Every visual change must be verified at 375 px viewport width.
- Touch targets must meet ≥ 44 × 44 px (WCAG 2.5.5).

---

## 1. Subagent Delegation Architecture

This testing mission is designed for **maximum parallel execution**. The primary agent must:

1. Clone the repo, run `npm ci`, start the frontend-only dev server (`npm run dev:frontend`), and confirm it serves at `http://localhost:5173` (or the configured port).
2. Read this document in full and produce a work manifest listing every subagent assignment below before dispatching any subagent.
3. Spawn one subagent per **Test Domain** defined in Section 4.
4. Each subagent operates in its own **git worktree** (see Section 2) and uses the **Computer + Browser/Chrome tools** to conduct live browser testing.
5. After all subagents complete, the primary agent consolidates findings, validates the full suite, and opens PRs for any bug fixes per Section 5.

### Subagent count (minimum)

| Subagent ID | Test Domain | Sections |
|-------------|-------------|----------|
| SA-01 | Static surfaces & auth | 4.1, 4.2 |
| SA-02 | Staff shell & navigation | 4.3 |
| SA-03 | Staff dashboard | 4.4 |
| SA-04 | Club operations — members, tiers, releases | 4.5 |
| SA-05 | Club operations — shipments, fulfillment, import | 4.6 |
| SA-06 | Member experience — churn, comms, retention, loyalty | 4.7 |
| SA-07 | Analytics & intelligence | 4.8 |
| SA-08 | Scale — brands, integrations, white-label | 4.9 |
| SA-09 | Member portal (all routes) | 4.10 |
| SA-10 | Shared components & cross-cutting concerns | 4.11 |
| SA-11 | Accessibility audit sweep (all pages) | 4.12 |
| SA-12 | Responsive layout sweep (all pages, 375/768/1440) | 4.13 |

Subagents SA-11 and SA-12 run **after** SA-01 through SA-10 complete, consuming their screenshots and findings as context.

---

## 2. Worktree and Branch Setup

Each bug-fixing subagent must use an isolated worktree. The primary agent sets them up:

```bash
# Create one worktree per fix domain as needed
git worktree add ../vinifera-fix-auth     fix/ui-auth-<issue>
git worktree add ../vinifera-fix-shell    fix/ui-shell-<issue>
git worktree add ../vinifera-fix-dash     fix/ui-dashboard-<issue>
# ... etc.
```

**Branch naming for fix branches:**
```
fix/ui-<domain>-<short-description>
```

Examples:
- `fix/ui-auth-password-toggle-focus`
- `fix/ui-shell-mobile-overflow`
- `fix/ui-dashboard-activation-block-heading`

Each fix branch targets `dev`. Unrelated bugs must be fixed in separate branches — never bundle fixes from different domains.

---

## 3. Test Execution Environment

### 3.1 Local stack

```bash
npm ci
npm run dev:frontend          # Vite-only, no Docker required
```

The frontend mock layer uses Playwright's `page.route()` to intercept all `/api/*` calls. All tests in this document use **mock API responses** unless a live local stack (`npm run dev`) is available.

### 3.2 Browser tool instructions (for every subagent)

Each subagent must:

1. Launch Chromium via the **Browser/Chrome tool** at the local dev URL.
2. Set viewport to **375 × 812** first (mobile-first testing), then **768 × 1024** (tablet), then **1440 × 900** (desktop) for each test case that requires responsive validation.
3. Capture a **screenshot** after every meaningful page load or state change.
4. Open the browser **DevTools Console** and verify zero errors and zero warnings for every interaction.
5. Run **axe-core** on every page using the `@axe-core/playwright` integration before closing each test.
6. Capture touch-target violations using `page.evaluate()` to measure interactive element bounding boxes.

### 3.3 Standard test utilities (already in `tests/e2e/`)

```typescript
// Reuse these helpers — do not reinvent them
async function assertA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

async function assertConsoleHealth(page: Page, action: () => Promise<void>) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await action();
  expect(errors).toEqual([]);
}
```

### 3.4 Mock session fixtures (already in `tests/e2e/phase1.spec.ts`)

```typescript
// Standard owner session
const staffSession = {
  access: { graceEndsAt: null, state: "active", suspendedAt: null },
  authenticated: true,
  organization: {
    accessState: "active",
    id: "10000000-0000-4000-8000-000000000001",
    name: "QA Winery",
    planTier: "vine",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "not_started",
  },
  user: {
    email: "owner@example.com",
    fullName: "QA Owner",
    id: "20000000-0000-4000-8000-000000000001",
    role: "owner",
  },
};

// Member session
const memberSession = {
  authenticated: true,
  organization: { id: "10000000-0000-4000-8000-000000000001", name: "QA Winery" },
  user: {
    email: "member@example.com",
    firstName: "Avery",
    id: "30000000-0000-4000-8000-000000000001",
    lastName: "Vine",
    status: "active",
  },
};
```

---

## 4. Test Domains — Detailed Specifications

---

### 4.1 Static Surfaces (SA-01)

**Files under test:** `index.html`, `guide` (extensionless), `public/_redirects`, `public/_headers`

#### 4.1.1 Landing Page (`/`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page loads, `<h1>` contains "Your wine club deserves software that works as hard as" | Heading visible, no JS error | 375, 1440 | ✓ |
| Hero vine animation plays with correct timing (2.5s `stroke-dashoffset`) | Animation completes without jank | 1440 | ✓ |
| Gold glow pulse animation visible on hero element | CSS `opacity` pulse at 6s cycle | 1440 | ✓ |
| Grape cluster sway animation visible | SVG `<animateTransform>` at 7/8/9s | 1440 | ✓ |
| CTA shimmer sweep animation on primary button | CSS `::after translateX` at 4s | 1440 | ✓ |
| `prefers-reduced-motion: reduce` disables all animations | All 4 animations halted | 1440 | ✓ |
| Features section renders with correct copy | Feature cards visible and not truncated | 375, 1440 | ✓ |
| Pricing section renders all plan tiers | Vine, Cellar, Estate, Reserve cards visible | 375, 1440 | ✓ |
| CTA button navigates to `/app/signup` | Navigation fires, signup page loads | 1440 | ✓ |
| No horizontal overflow at 375 px | `scrollWidth <= clientWidth` | 375 | ✓ |
| Zero axe-core WCAG 2.1 AA violations | `results.violations.length === 0` | 375, 1440 | — |
| All decorative SVGs have `aria-hidden="true"` | axe-core passes `aria-hidden-body` | 1440 | — |
| `<nav>`, `<main>`, `<header>`, `<footer>` landmarks present | axe-core landmark rules pass | 1440 | — |
| HSTS, CSP, X-Frame-Options, COOP headers present | `response.headers()` assertions | — | — |

#### 4.1.2 Investor Guide (`/guide/`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page loads at `/guide/`, `<h1>` contains "Vinifera: The Full Picture" | Heading visible | 375, 1440 | ✓ |
| Sticky Table of Contents visible on desktop | TOC `position: sticky` renders | 1440 | ✓ |
| TOC collapses or is scrollable on mobile | No TOC overflow at 375 px | 375 | ✓ |
| All 8 guide sections render with headings | 8 `<section>` or heading markers present | 1440 | ✓ |
| Internal TOC anchor links navigate to sections | Clicking a TOC link scrolls to target heading | 1440 | ✓ |
| No horizontal overflow at 375 px | `scrollWidth <= clientWidth` | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |
| `Content-Type: text/html` header served | Header assertion on response | — | — |

---

### 4.2 Authentication Pages (SA-01)

**Files under test:** `src/client/staff/StaffAuthPages.tsx`, `src/client/member/MemberLoginPage.tsx`, `src/client/shared/AuthLayout.tsx`, `src/client/shared/PasswordField.tsx`

#### 4.2.1 Staff Login (`/app/login`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page loads, heading "Welcome back" visible | `<h1>` rendered | 375, 768, 1440 | ✓ |
| Email field labeled "Email address" | `<label>` association correct | 375 | — |
| Password field labeled "Password" | `<label>` association correct | 375 | — |
| Show/Hide password toggle button present and labeled "Show password" / "Hide password" | button aria-label toggles | 375 | ✓ |
| Show password: clicking toggle changes `input[type]` from `password` → `text` | Input type changes | 375 | ✓ |
| Hide password: button label updates to "Hide password", pressing Enter hides again | Toggle works bidirectionally | 375 | ✓ |
| Tab key navigates: Email → Password → Show/Hide toggle → Submit | Focus order correct | 1440 | — |
| Submit with empty fields shows inline validation error | `FormFeedback` renders error | 375 | ✓ |
| Submit with valid credentials calls `POST /api/auth/staff/login` | Network request fired | 1440 | — |
| Successful login redirects to `/app` (dashboard) | Navigation to dashboard | 1440 | ✓ |
| Failed login shows API error message | Error message rendered | 375 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations at all three viewports | Zero violations | 375, 768, 1440 | — |
| Console is clean through all interactions | No errors or warnings | 375 | — |

#### 4.2.2 Staff Signup (`/app/signup`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page loads, heading "Create your winery workspace" visible | `<h1>` rendered | 375, 768, 1440 | ✓ |
| All required fields labeled: Winery name, Your name, Work email, Password, Confirm password | Labels associated | 375 | — |
| Plan tier selector renders Vine, Cellar, Estate, Reserve radio inputs | All 4 options present | 375 | ✓ |
| Selecting "Cellar" plan tier sets `input[name="planTier"][value="cellar"]` checked | Radio state correct | 1440 | — |
| Password and Confirm password mismatch shows validation error | Inline error message rendered | 375 | ✓ |
| Submitting valid form calls `POST /api/auth/staff/signup` with correct body | `{ email, fullName, organizationName, planTier }` | 1440 | — |
| Success (billingCustomerState: "ready") shows "Welcome to [org name]" heading | Dashboard rendered with welcome message | 1440 | ✓ |
| Success (billingCustomerState: "reconciliation_required") shows reconciliation notice without discarding workspace | Notice shown, workspace accessible | 1440 | ✓ |
| Show/Hide password toggle works on both password fields | Type toggles correctly | 375 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 768, 1440 | — |

#### 4.2.3 Member Login (`/portal/login`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page loads, heading "Your wine club, one click away" visible | `<h1>` rendered | 375, 768, 1440 | ✓ |
| Magic link email field labeled and reachable by keyboard | Label association + tab focus | 375 | — |
| Submitting email fires `POST /api/auth/member/magic-link` | Network request with email body | 1440 | — |
| Confirmation message shown after submit | Success feedback | 375 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 768, 1440 | — |

---

### 4.3 Staff Application Shell (SA-02)

**Files under test:** `src/client/staff/StaffShell.tsx`, `src/client/staff/StaffArea.tsx`, `src/client/staff/StaffSessionContext.tsx`, `src/client/staff/phase5/BrandScopeContext.tsx`

#### 4.3.1 Sidebar Navigation

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Sidebar renders all 4 nav sections: Overview, Club Operations, Member Experience, Scale | All section labels and links visible | 1440 | ✓ |
| Overview section: Dashboard, Analytics links present with correct icons | 2 links with lucide icons | 1440 | ✓ |
| Club Operations section: Members, Club Tiers, Release Schedule, Shipments, Fulfillment, Compliance, Payment Recovery, Import Members | 8 links present | 1440 | ✓ |
| Member Experience section: AI Churn Watch, Communications, Cancel Flow, Loyalty & Rewards, Peer Benchmarks | 5 links present | 1440 | ✓ |
| Scale section: Integrations, Brands, White-label | 3 links present | 1440 | ✓ |
| Workspace section: Team link visible for owner/admin role | Team link present | 1440 | ✓ |
| Workspace section: Team link hidden for non-owner/admin role | Team link absent | 1440 | — |
| Subscription button present in Workspace section | Button with CreditCard icon | 1440 | ✓ |
| Active nav item has `aria-current="page"` | ARIA attribute set correctly | 1440 | — |
| Active nav item styled with `staff-nav-item--active` class | Visual active state | 1440 | ✓ |
| Clicking a nav link navigates to target route | Navigation fires | 1440 | ✓ |
| User avatar displays first 2 chars of `fullName` or `email`, uppercased | "QO" for "QA Owner" | 1440 | ✓ |
| User name and role displayed below avatar | `<strong>` name + `<small>` role | 1440 | ✓ |

#### 4.3.2 Mobile Sidebar (Hamburger)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Menu button (hamburger) visible at 375 px | `icon-button staff-topbar__menu` visible | 375 | ✓ |
| Clicking hamburger opens sidebar (`staff-sidebar--open`) | Sidebar slides in | 375 | ✓ |
| Close button (X icon) inside sidebar dismisses it | `staff-sidebar--open` class removed | 375 | ✓ |
| Escape key dismisses open sidebar | Keyboard close works | 375 | — |
| Overlay button (backdrop) dismisses sidebar when clicked | Overlay click closes menu | 375 | ✓ |
| Sidebar closes automatically on route change | Navigate away → sidebar closes | 375 | ✓ |
| Overlay has `aria-label="Close navigation menu"` | ARIA label present | 375 | — |
| Sidebar has `aria-label="Staff navigation"` | ARIA label present | 375 | — |

#### 4.3.3 Topbar & Brand Switcher

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| `<h1>` in topbar reflects current page title | Title matches route | 1440 | ✓ |
| Eyebrow text renders above `<h1>` when provided | `<span>` rendered above heading | 1440 | ✓ |
| Sign Out button present and labeled "Sign out" | Button text matches | 1440 | ✓ |
| Clicking Sign Out calls `POST /api/auth/staff/logout` | Network request fired | 1440 | — |
| Sign Out success clears session and redirects to `/app/login` | Redirect fires | 1440 | ✓ |
| Sign Out shows "Signing out…" busy state during request | Button label changes | 1440 | ✓ |
| Sign Out error shows FormFeedback in live region | Error message in `aria-live="polite"` area | 1440 | ✓ |
| Brand switcher `<select>` visible when `brands.length > 1` | Dropdown rendered | 1440 | ✓ |
| Brand switcher hidden when single brand | Dropdown absent | 1440 | — |
| Brand switcher has `<label for="active-brand">Active brand</label>` | Label associated | 1440 | — |
| Changing brand switcher calls `brandScope.setActiveBrandId()` | State update fires | 1440 | — |
| "All brands · organization" option present for `canViewAllBrands` | Option rendered | 1440 | ✓ |

#### 4.3.4 Workspace Access States

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| `accessState: "active"` — no access banner shown | Banner absent | 1440 | — |
| `accessState: "restricted"` — access banner shows with heading "Subscription access: Restricted" | `access-banner--restricted` rendered | 1440 | ✓ |
| `accessState: "suspended"` — access banner shows with "Subscription access: Suspended" | `access-banner--suspended` rendered | 1440 | ✓ |
| "Update billing" button in access banner fires `openBilling()` | Billing flow initiated | 1440 | ✓ |
| `workspaceLocked` hides all nav links and page content | Children not rendered | 1440 | ✓ |
| Subscription button calls billing portal when subscription exists | `POST /api/billing/portal` fired | 1440 | — |
| Subscription button calls billing checkout when no subscription | `POST /api/billing/checkout` fired | 1440 | — |
| Billing 409 conflict clears the attempt reference and shows error | Error message shown | 1440 | ✓ |
| Billing redirect only fires for `https:` or same-origin URLs | Invalid URL throws error | — | — |

---

### 4.4 Staff Dashboard (`/app`) (SA-03)

**Files under test:** `src/client/staff/StaffDashboard.tsx`

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Welcome panel renders with org name: "Welcome to QA Winery" | `<h2>` with org name | 1440 | ✓ |
| Welcome panel renders "Welcome to Vinifera" when no org name | Fallback text | 1440 | ✓ |
| Welcome panel eyebrow "Workspace ready" visible | `<p class="eyebrow">` rendered | 1440 | ✓ |
| Grape icon decorative (`aria-hidden="true"`) | ARIA attribute present | 1440 | — |
| Organization card renders: name, role (via `sentenceCase`) | `<dl>` with Name + role values | 1440 | ✓ |
| Subscription card renders: plan tier name, subscription status | Vine/Cellar/Estate/Reserve + status | 1440 | ✓ |
| Loading state: `<LoadingBlock label="Loading dashboard metrics" />` renders | Loading spinner/text shown | 1440 | ✓ |
| Activation error state: `<ActivationBlock>` renders with correct title and detail text | Activation block visible | 1440 | ✓ |
| Error state: `<ErrorBlock>` with Retry button rendered | Error UI + retry button | 1440 | ✓ |
| Retry button in error state refreshes data | API call re-fires | 1440 | — |
| Metric grid (overview loaded): 4 MetricCards rendered: Active members, MRR, Shipments, Active brands | 4 cards present | 1440 | ✓ |
| MRR formatted as currency (`money()`) | `$0.00` or formatted value | 1440 | ✓ |
| Brand breakdown table rendered when `brandRows.length > 0` | Table with Brand, Active members, MRR, Shipments columns | 1440 | ✓ |
| Brand breakdown table has correct `scope="col"` and `scope="row"` on headers | Semantic table headers | 1440 | — |
| Refresh button in brand breakdown fires `overview.refresh()` | API re-fetches | 1440 | — |
| Empty state "Start the club loop" shown when no brands | Empty state component visible | 1440 | ✓ |
| Navigation notice from `location.state.notice` renders in `<FormFeedback kind="success">` | Success message visible | 1440 | ✓ |
| Each MetricCard section has `aria-labelledby` matching its `<h2>` `id` | ARIA association correct | 1440 | — |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

---

### 4.5 Club Operations — Members, Tiers, Releases (SA-04)

**Files under test:** `src/client/staff/phase2/MembersPage.tsx`, `src/client/staff/phase2/ClubTiersPage.tsx`, `src/client/staff/phase2/ReleasesPage.tsx`

#### 4.5.1 Members Page (`/app/members`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders under StaffShell with title "Members" | `<h1>Members</h1>` in topbar | 1440 | ✓ |
| Member list table renders with correct column headers | Name, Email, Tier, Status columns (or equivalent) | 1440 | ✓ |
| Table has `scope="col"` on `<th>` elements | Semantic table structure | 1440 | — |
| Loading state renders | Loading block shown initially | 1440 | ✓ |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| Empty state renders when no members | Empty state with CTA | 1440 | ✓ |
| Member row click or detail link navigates to detail route | Navigation fires | 1440 | ✓ |
| Search/filter input (if present) is labeled | Label or `aria-label` on input | 1440 | — |
| No horizontal overflow at 375 px (table scrolls horizontally in container) | `table-scroll` wrapper prevents page overflow | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.5.2 Club Tiers Page (`/app/tiers`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Club Tiers" | Title in topbar | 1440 | ✓ |
| Tier list renders with name, price, bottle count visible | Tier data displayed | 1440 | ✓ |
| Create Tier button/action present | Action button in topbar or page | 1440 | ✓ |
| Create Tier form/modal opens on click | Dialog or form renders | 1440 | ✓ |
| Form fields are labeled (name, price, bottle count) | Labels associated | 1440 | — |
| Submitting create tier calls correct API endpoint | `POST /api/tiers` or equivalent | 1440 | — |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.5.3 Release Schedule Page (`/app/releases`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Release Schedule" | Title in topbar | 1440 | ✓ |
| Release list renders with release date, tier, status columns | Data columns visible | 1440 | ✓ |
| Release detail route `/app/releases/:id` navigates to release detail | Subroute renders | 1440 | ✓ |
| `activePath` resolves `/app/releases/:id` to `/app/releases` for nav highlight | Release nav item marked active | 1440 | — |
| Create/Schedule Release action present | Action button visible | 1440 | ✓ |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

---

### 4.6 Club Operations — Shipments, Fulfillment, Import (SA-05)

**Files under test:** `src/client/staff/phase2/ShipmentOperationsPages.tsx`, `src/client/staff/phase2/ImportMembersPage.tsx`

#### 4.6.1 Shipments (`/app/shipments`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Shipments" | Title in topbar | 1440 | ✓ |
| Shipment table with status, member, tracking columns renders | Data columns visible | 1440 | ✓ |
| Shipment status badges render with correct text | Status displayed | 1440 | ✓ |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| No horizontal overflow at 375 px | Table within `table-scroll` wrapper | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.6.2 Fulfillment (`/app/fulfillment`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Fulfillment" | Title in topbar | 1440 | ✓ |
| Packing/fulfillment operation actions visible | Action buttons present | 1440 | ✓ |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.6.3 Payment Recovery (`/app/recovery`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Payment Recovery" | Title in topbar | 1440 | ✓ |
| Declined/retry shipments list renders | List or table visible | 1440 | ✓ |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.6.4 Compliance (`/app/compliance`)

**File:** `src/client/staff/phase4/CompliancePage.tsx`

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Compliance" | Title in topbar | 1440 | ✓ |
| Compliance status indicators render (compliant / non-compliant / unknown) | Status labels present | 1440 | ✓ |
| ShipCompliant activation guard renders `<ActivationBlock>` when not connected | Activation block present | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.6.5 Import Members (`/app/import`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Import Members" | Title in topbar | 1440 | ✓ |
| File upload input is present and labeled | `<input type="file">` with label | 1440 | ✓ |
| CSV file upload input accepts `.csv` files only | `accept=".csv"` attribute | 1440 | — |
| Preview step shown after file selection | Preview table or summary rendered | 1440 | ✓ |
| Commit button present on preview step | Commit action visible | 1440 | ✓ |
| Import with invalid CSV shows validation errors | Error list rendered | 1440 | ✓ |
| Import with valid `tests/fixtures/commerce7-members.csv` parses correctly | Preview rows match fixture | 1440 | ✓ |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

---

### 4.7 Member Experience (SA-06)

**Files under test:** `src/client/staff/phase3/ChurnWatchPage.tsx`, `src/client/staff/phase3/CommunicationsPage.tsx`, `src/client/staff/phase3/RetentionPage.tsx`, `src/client/staff/phase3/LoyaltyPage.tsx`

#### 4.7.1 AI Churn Watch (`/app/churn-watch`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "AI Churn Watch" | Title in topbar | 1440 | ✓ |
| Churn risk list or score table renders | Member risk scores displayed | 1440 | ✓ |
| ML activation guard renders `<ActivationBlock>` when model not trained | Activation block present | 1440 | ✓ |
| Rules-fallback indicator visible when ML inactive | Fallback state shown | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.7.2 Communications (`/app/communications`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Communications" | Title in topbar | 1440 | ✓ |
| Email trigger list renders (6 lifecycle triggers) | Trigger rows visible | 1440 | ✓ |
| Resend activation guard renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| Template preview shows responsive email layout | Preview rendered | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.7.3 Cancel Flow (`/app/retention`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Cancel Flow" | Title in topbar | 1440 | ✓ |
| 4-step cancellation steps displayed | Step indicators present | 1440 | ✓ |
| Active cancellation attempts list renders | List or table of attempts | 1440 | ✓ |
| Activation error/empty state renders correctly | State rendered | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.7.4 Loyalty & Rewards (`/app/loyalty`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Loyalty & Rewards" | Title in topbar | 1440 | ✓ |
| Points ledger table renders | FIFO lot entries visible | 1440 | ✓ |
| Award/redeem actions present | Action buttons visible | 1440 | ✓ |
| Point lot expiry dates rendered correctly | Date values displayed | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

---

### 4.8 Analytics & Intelligence (SA-07)

**Files under test:** `src/client/staff/phase4/AnalyticsPage.tsx`, `src/client/staff/phase4/BenchmarksPage.tsx`, `src/client/staff/phase4/ChurnIntelligencePage.tsx`, `src/client/staff/phase4/AccessibleChart.tsx`

#### 4.8.1 Analytics (`/app/analytics`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Analytics" | Title in topbar | 1440 | ✓ |
| Charts render without crashing (using `AccessibleChart` wrapper) | Chart elements visible | 1440 | ✓ |
| Chart data table/summary available for screen readers | ARIA describedby or summary element | 1440 | — |
| Dashboard saved layouts persist across navigation | Layout state retained | 1440 | — |
| CSV Export button present and labeled | Button visible | 1440 | ✓ |
| CSV Export calls correct API endpoint | `GET /api/analytics/export` or equivalent | 1440 | — |
| Formula-injection characters stripped in CSV export output | Verify API strips leading `=`, `+`, `-`, `@` | — | — |
| Activation error renders `<ActivationBlock>` | Activation block present | 1440 | ✓ |
| Date range picker (if present) is keyboard accessible | Arrow keys navigate dates | 1440 | — |
| Charts render within 2 seconds of page load | Performance gate | 1440 | — |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.8.2 Peer Benchmarks (`/app/benchmarks`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Peer Benchmarks" | Title in topbar | 1440 | ✓ |
| Benchmark values shown only when cohort ≥ 10 wineries | Activation/threshold guard visible when below threshold | 1440 | ✓ |
| k-anonymous aggregate bands rendered (not exact counts) | Band labels, not raw numbers | 1440 | ✓ |
| Opt-in consent control visible | Toggle or consent action present | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.8.3 Churn Intelligence (`/app/churn-watch` — Phase 4 view)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| ML model status indicator visible (candidate/shadow/promoted/rules-fallback) | Status label displayed | 1440 | ✓ |
| A/B test comparison panel visible when A/B active | Panel rendered | 1440 | ✓ |
| Model promotion controls gated behind activation state | Promote button absent without activation | 1440 | — |
| AUC-ROC score displayed when model trained | Metric rendered | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

---

### 4.9 Scale — Brands, Integrations, White-label (SA-08)

**Files under test:** `src/client/staff/phase5/BrandsPage.tsx`, `src/client/staff/phase5/IntegrationsPage.tsx`, `src/client/staff/phase5/WhiteLabelPage.tsx`, `src/client/staff/TeamPage.tsx`

#### 4.9.1 Brands Page (`/app/brands`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Brands" | Title in topbar | 1440 | ✓ |
| Brand list renders with name, status, member count | Brand rows visible | 1440 | ✓ |
| Create brand action present (owner/admin only) | Button visible for owner | 1440 | ✓ |
| Create brand action absent for non-owner/admin | Button hidden | 1440 | — |
| Switching active brand via brand switcher remounts data boundary | New brand data loaded | 1440 | — |
| Stale in-flight responses from prior brand are discarded | No data bleed between brands | 1440 | — |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.9.2 Integrations Page (`/app/integrations`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Integrations" | Title in topbar | 1440 | ✓ |
| All 4 integration connectors shown: Klaviyo, QuickBooks, Avalara, Meta | 4 connector cards rendered | 1440 | ✓ |
| Each connector shows its activation state: `activation_required` / `configured` / `active` / `degraded` | Status label present | 1440 | ✓ |
| Credential fields show redacted metadata only (no raw secrets in DOM) | No raw secrets in page source | 1440 | — |
| Connect/configure actions present for unconfigured integrations | Action buttons visible | 1440 | ✓ |
| Klaviyo field/list mapping controls present | Mapping UI rendered | 1440 | ✓ |
| QuickBooks account mapping controls present | Mapping UI rendered | 1440 | ✓ |
| Meta consent toggle present | Consent control visible | 1440 | ✓ |
| Integration activation guard messages accurate | `activation_required` label shown | 1440 | ✓ |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.9.3 White-label Page (`/app/white-label`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "White-label" | Title in topbar | 1440 | ✓ |
| Brand theme color inputs present | Color pickers or hex inputs visible | 1440 | ✓ |
| Theme colors validated against WCAG contrast (≥ 4.5:1 for normal text) | Invalid color shows contrast error | 1440 | ✓ |
| Logo URL input accepts HTTPS only | Non-HTTPS URL rejected | 1440 | — |
| Portal title input present | Text input visible | 1440 | ✓ |
| Custom hostname input present | Input visible | 1440 | ✓ |
| Resend sender verification section present | Email sender config UI visible | 1440 | ✓ |
| Save changes calls correct API endpoint | Network request fires | 1440 | — |
| Zero axe violations | Zero violations | 375, 1440 | — |

#### 4.9.4 Team Page (`/app/team`)

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Page renders with title "Team" (owner/admin only) | Title in topbar | 1440 | ✓ |
| Team member list renders with name, email, role | Member rows visible | 1440 | ✓ |
| Invite team member form/action present | Invite button/form visible | 1440 | ✓ |
| Invite form: email and role fields labeled | Labels associated | 1440 | — |
| Role selector shows Owner, Admin, Manager, Staff options | Role options in select | 1440 | ✓ |
| Manager/Staff cannot invite at or above their own role | Restricted options hidden | 1440 | — |
| Zero axe violations | Zero violations | 375, 1440 | — |

---

### 4.10 Member Portal (SA-09)

**Files under test:** `src/client/member/MemberArea.tsx`, `src/client/member/MemberPortal.tsx`, `src/client/member/MemberLoginPage.tsx`, `src/client/member/MemberBranding.tsx`, `src/client/member/MetaPrivacyControl.tsx`, `src/client/member/phase3/RetentionLoyalty.tsx`, `src/client/member/MemberSessionContext.tsx`

#### 4.10.1 Member Portal — Shipment Preview

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Authenticated portal loads with member greeting | "Hello, [firstName]" or equivalent | 375, 1440 | ✓ |
| Upcoming shipment preview renders bottle details | Wine names, quantities visible | 375, 1440 | ✓ |
| "Update shipping address" button present | Action visible | 375 | ✓ |
| Address update form fields labeled (street, city, state, zip) | Labels associated | 375 | — |
| Submitting address update calls `PATCH /api/portal/address` or equivalent | Network request fires | 375 | — |
| Bottle swap option present (if available for tier) | Swap UI visible | 375 | ✓ |
| Pause membership option present | Pause button/link visible | 375 | ✓ |
| Shipment history list renders with past shipments | History entries visible | 375, 1440 | ✓ |

#### 4.10.2 Member Portal — Retention & Loyalty

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| Cancellation flow initiates from "Cancel membership" | Cancel CTA present | 375 | ✓ |
| 4-step cancellation flow: step indicators present | Step 1-4 UI visible | 375 | ✓ |
| Accepting an alternative (tier downgrade, pause, swap) terminates attempt | Offer acceptance closes flow | 375 | ✓ |
| Final cancellation confirmation requires explicit action | Confirm button required | 375 | ✓ |
| Loyalty points balance displayed | Points total visible | 375 | ✓ |
| Expiring points warning shown | Expiry indicator present | 375 | ✓ |
| Redeem points action present | Redeem button visible | 375 | ✓ |

#### 4.10.3 Member Portal — Branding & Privacy

| Test Case | Expected Result | Viewport(s) | Screenshot |
|-----------|----------------|-------------|------------|
| White-labeled portal applies brand theme colors | Brand colors in CSS variables | 375 | ✓ |
| Brand logo renders (HTTPS URL) | `<img>` with HTTPS `src` | 375 | ✓ |
| Portal title reflects brand configuration | `<title>` or `<h1>` shows brand name | 375 | ✓ |
| Meta Privacy Control toggle renders when attribution configured | Toggle visible | 375 | ✓ |
| Withdrawing Meta consent calls correct API | Revocation request fires | 375 | — |
| No raw attribution data in DOM after consent withdrawal | DOM clean | 375 | — |
| No horizontal overflow at 375 px | Layout intact | 375 | ✓ |
| Zero axe violations | Zero violations | 375, 768, 1440 | — |

---

### 4.11 Shared Components (SA-10)

**Files under test:** `src/client/shared/` directory

| Component | Test Cases |
|-----------|-----------|
| **AuthLayout** | Renders `<main>` content area; visual logo/brand element present; no horizontal overflow at 375 px |
| **Brand (MemberBrand)** | Renders identity mark; `inverse` prop changes color treatment; `homeHref` sets link target |
| **Dialog** | Opens on trigger; `role="dialog"` present; `aria-modal="true"` present; focus trapped inside; Escape key closes; backdrop click closes; close button labeled |
| **ErrorBoundary** | Renders fallback UI when child throws; fallback has `role="alert"` or equivalent; retry action present |
| **FormFeedback** | Renders `role="alert"` for `kind="error"`; renders success styling for `kind="success"`; empty `message` renders nothing; `aria-live` region present |
| **LoadingScreen** | `label` prop passed to `aria-label` or visible text; spinner has `role="status"` or equivalent |
| **OperationalState (ActivationBlock, ErrorBlock, LoadingBlock)** | `ActivationBlock`: renders title and detail props; no interactive controls; `ErrorBlock`: renders error message and Retry button; Retry fires `onRetry()`; `LoadingBlock`: renders with label; appropriate ARIA |
| **PasswordField** | `type="password"` by default; Show/Hide toggle switches to `type="text"` and back; toggle button has correct `aria-label`; keyboard (Space/Enter) activates toggle |

---

### 4.12 Accessibility Audit Sweep — All Pages (SA-11)

SA-11 runs **after** SA-01 through SA-10 complete. It performs a comprehensive multi-page axe-core sweep.

**Scope:** Every route listed below at 375, 768, and 1440 px.

```
/                          /app/login              /app/signup
/guide/                    /portal/login           /app
/app/analytics             /app/members            /app/tiers
/app/releases              /app/shipments          /app/fulfillment
/app/compliance            /app/recovery           /app/import
/app/churn-watch           /app/communications     /app/retention
/app/loyalty               /app/benchmarks         /app/integrations
/app/brands                /app/white-label        /app/team
/portal (authenticated)
```

**For each route, verify:**

1. `results.violations.length === 0` for WCAG 2.1 AA (tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`)
2. Every `<img>` has `alt` text; decorative images have `alt=""` and `aria-hidden="true"`
3. All form inputs have associated `<label>` or `aria-label`
4. Focus indicators visible (minimum 2 px outline) — inspect via `getComputedStyle`
5. Skip link `<a href="#main">Skip to main content</a>` present on staff app pages
6. All interactive elements reachable via Tab key
7. `aria-live="polite"` regions present for status updates
8. `aria-live="assertive"` regions present for urgent notifications (e.g., error boundaries)
9. Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text — use axe-core color rules
10. Touch targets ≥ 44 × 44 px on all interactive elements — verify via computed bounding rect

**Known caveat:** The axe-core `::after` pseudo-element may return "incomplete" for elements with `::after` pseudo-elements (e.g., `.btn-gold` shimmer). Use the manual contrast checker for those cases. Filter out entries where `ratio === 1.0` — that is a known false positive when axe-core cannot resolve CSS gradient backgrounds.

---

### 4.13 Responsive Layout Sweep — All Pages (SA-12)

SA-12 runs after SA-01 through SA-10. It performs a targeted layout verification sweep.

**Viewports:** 375 × 812 (iPhone SE), 412 × 915 (Android large), 430 × 932 (iPhone 15), 768 × 1024 (iPad), 1440 × 900 (desktop)

**For each route at each viewport, verify:**

1. `scrollWidth <= clientWidth` (no horizontal overflow)
2. No text truncation that hides critical information
3. No elements positioned off-screen or clipped
4. Tables wrapped in `table-scroll` container — horizontal scroll within table only, not page
5. Navigation is accessible (hamburger on mobile, sidebar on desktop)
6. Touch targets meet ≥ 44 × 44 px at 375 px viewport
7. Font sizes ≥ 16 px on mobile inputs (prevents iOS zoom)

---

## 5. Bug Reporting and Fix Protocol

When a subagent identifies a defect, it must follow this exact protocol.

### 5.1 What constitutes a defect

The following are **blocking defects** that must be fixed before marking a test domain complete:

- Any axe-core WCAG 2.1 AA violation
- Horizontal overflow at 375 px viewport
- Touch target < 44 × 44 px
- Console error on page load or standard user interaction
- Interactive element unreachable by keyboard
- Missing ARIA label on interactive or form element
- React render crash (ErrorBoundary triggered)
- `ActivationBlock` failing to render when an activation gate is pending
- Navigation link not routing to correct component
- Form submission not calling the expected API endpoint

The following are **non-blocking defects** that should be documented but do not block the test run:

- Cosmetic inconsistencies that do not affect function or accessibility
- Minor copy/formatting issues
- Animation timing that differs from spec but is visually acceptable

### 5.2 Fix branch workflow

```bash
# 1. Create a worktree for the fix
git worktree add ../vinifera-fix-<domain>-<slug> fix/ui-<domain>-<short-description>

# 2. Navigate to the worktree
cd ../vinifera-fix-<domain>-<slug>

# 3. Implement the minimal targeted fix
# - No unrelated changes in the same branch
# - No logic changes; only UI/a11y/layout corrections

# 4. Verify the fix
npm run dev:frontend    # Start server
npm run qa:e2e          # Must still pass 155 with 3 hosted-only skips
npm run check           # TypeScript + 624 Vitest must pass
npm run check           # TypeScript + 593 Vitest must pass
npm run check           # TypeScript + 585 Vitest must pass
npm run check           # TypeScript + 596 Vitest must pass
# Re-run the specific browser test that caught the defect

# 5. Update CHANGELOG.md under [Unreleased]
# 6. Commit with correct conventional commit format:
#    fix(ui): <short description>
#
#    <what changed and why>
#
#    Verification: npm run check; 624/624 Vitest; npm run qa:e2e; 155 passed Playwright/axe
#    Verification: npm run check; 593/593 Vitest; 155 passed Playwright/axe
#    Verification: npm run check; 585/585 Vitest; 155 passed Playwright/axe
#    Verification: npm run check; 596/596 Vitest; 155 passed Playwright/axe
# 7. Open PR targeting dev
```

### 5.3 One bug, one branch

Never combine fixes from different UI areas in the same branch. If `fix/ui-auth-password-toggle` and `fix/ui-shell-mobile-overflow` are found together, they must be separate PRs. Bundled fixes will be rejected by CodeRabbit and Octopus.

### 5.4 Octopus and CodeRabbit disposition

- Octopus flagging HTTP-only cookies as insecure → 👎 "Intentional — see `.octopus/rules.md`"
- Octopus flagging activation guards as dead code → 👎 "Intentional — see `CONTINUITY_BRIEF.md`"
- CodeRabbit finding a real a11y regression → 👍 Fix it
- CodeRabbit finding a missing `brand_id` → 👍 Fix it (or flag for BS-06 if in service layer)

---

## 6. Acceptance Criteria

The testing mission is complete when all of the following are true:

| Criterion | Target |
|-----------|--------|
| Vitest suite | 624/624 passing (must not decrease) |
| Vitest suite | 593/593 passing (must not decrease) |
| Vitest suite | 585/585 passing (must not decrease) |
| Vitest suite | 596/596 passing (must not decrease) |
| Playwright/axe suite | 155 passing with 3 hosted-only skips (must not decrease) |
| axe-core WCAG 2.1 AA | Zero violations on all 23 routes × 3 viewports |
| Horizontal overflow | Zero pages overflow at 375 px |
| Console health | Zero errors or warnings on page load for all routes |
| Touch targets | 100% of interactive elements ≥ 44 × 44 px at 375 px |
| Fix PRs | All blocking defects have open fix PRs targeting `dev` |
| Fix PRs (CI) | All fix PRs pass TypeScript + Vitest + Playwright/axe |
| CHANGELOG | Updated in every fix commit |
| No activation gates touched | All 20 gates remain `pending` |

---

## 7. File and Route Reference

### Staff application routes

| Route | Component | Phase |
|-------|-----------|-------|
| `/app/login` | `StaffAuthPages` | 1 |
| `/app/signup` | `StaffAuthPages` | 1 |
| `/app` | `StaffDashboard` | 1 |
| `/app/members` | `MembersPage` | 2 |
| `/app/tiers` | `ClubTiersPage` | 2 |
| `/app/releases` | `ReleasesPage` | 2 |
| `/app/shipments` | `ShipmentOperationsPages` | 2 |
| `/app/fulfillment` | `ShipmentOperationsPages` | 2 |
| `/app/recovery` | `ShipmentOperationsPages` | 2 |
| `/app/import` | `ImportMembersPage` | 2 |
| `/app/churn-watch` | `ChurnWatchPage` + `ChurnIntelligencePage` | 3/4 |
| `/app/communications` | `CommunicationsPage` | 3 |
| `/app/retention` | `RetentionPage` | 3 |
| `/app/loyalty` | `LoyaltyPage` | 3 |
| `/app/analytics` | `AnalyticsPage` | 4 |
| `/app/benchmarks` | `BenchmarksPage` | 4 |
| `/app/compliance` | `CompliancePage` | 4 |
| `/app/integrations` | `IntegrationsPage` | 5 |
| `/app/brands` | `BrandsPage` | 5 |
| `/app/white-label` | `WhiteLabelPage` | 5 |
| `/app/team` | `TeamPage` | 5 |

### Member portal routes

| Route | Component |
|-------|-----------|
| `/portal/login` | `MemberLoginPage` |
| `/portal` | `MemberPortal` |
| `/portal/retention` | `RetentionLoyalty` |

### Static surfaces

| Route | Source |
|-------|--------|
| `/` | `index.html` |
| `/guide/` | `guide` (extensionless) |

---

## 8. Known Baseline Passing State

The baseline `dev` branch (v0.5.0, BS-01–06 merged) passes the following — do not regress these numbers:

| Suite | Baseline count | Command |
|-------|---------------|---------|
| Vitest unit/integration | 624 | `npm run check` |
| Vitest unit/integration | 593 | `npm run check` |
| Vitest unit/integration | 585 | `npm run check` |
| Vitest unit/integration | 596 | `npm run check` |
| Phase 2 DB | 250 assertions | `npm run qa:db:phase2` |
| Phase 3 DB | 199 assertions | `npm run qa:db:phase3` |
| Phase 4 DB | 159 assertions | `npm run qa:db:phase4` |
| Phase 5 DB | 515 assertions | `npm run qa:db:phase5` |
| Playwright E2E + axe | 155 passed, 3 hosted-only skipped | `npm run qa:e2e` |

Any new Playwright tests added by fix branches must increase the count — never replace or delete existing tests without documented justification.

---

*This document is the source of truth for Vinifera UI testing. It supersedes any informal test instructions. Refer back to `AGENTS.md` and `docs/architecture.md` for architectural constraints that govern all implementation decisions made during this testing mission.*
