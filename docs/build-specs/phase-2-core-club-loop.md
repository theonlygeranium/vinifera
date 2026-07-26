# Phase 2: The Core Club Loop

**Duration:** Weeks 7–16
**Status:** Critical
**Exit Criterion:** One real winery adds ten members, creates a release, charges them via Stripe, generates shipping labels, and marks shipments complete. The money moves. The wine ships.

---

## Objective

Build the complete core club loop — the sequence of operations that every wine club performs every release cycle. This is the phase where Vinifera becomes a product that processes real money and ships real wine.

This phase delivers: member management, club tier configuration, release scheduling, Stripe billing for shipments, payment decline recovery, shipping label generation, and CSV migration import.

---

## Prerequisites

- Phase 1 complete: auth, multi-tenant architecture, Stripe billing all functional
- QA gate for Phase 1 passed with 0 violations
- Database schema from Phase 1 in place

---

## Scope

### 2.1 Member Management (CRM)

- Member CRUD: create, read, update, delete
- Member fields: name, email, phone, shipping address, club tier, join date, status
- Member search: by name, email, or status
- Member detail view: order history, lifetime value, communication log, churn risk score (placeholder — actual scoring in Phase 3)
- Member status transitions: active → paused → cancelled → reactivated
- Batch operations: pause all, resume all, export filtered list
- Member import via CSV (see 2.7)

### 2.2 Club Tier Configuration

- Create unlimited tiers, each with:
  - Name and description
  - Monthly or quarterly pricing
  - Number of included bottles
  - Shipment frequency (monthly, bi-monthly, quarterly, semi-annual, annual)
  - Upgrade path (which tier members can upgrade to)
  - Per-tier member count display
- Tier assignment: assign members to tiers individually or in bulk
- Tier editing: changes apply to future releases, not retroactively

### 2.3 Release Scheduling

- Create a release: name, description, included wines, pricing per tier
- Set processing date: the date charges run and labels generate
- Set embargo date: members cannot see shipment contents before this date
- Assign tiers: select which tiers participate in this release
- Release calendar view: all upcoming and past releases
- Release status: draft → scheduled → processing → completed
- Automated member notification: email sent X days before processing (email integration in Phase 3 — stub with console.log for now)

### 2.4 Stripe Billing for Shipments

- When a release is processed:
  1. For each active member in participating tiers, create a Stripe PaymentIntent
  2. Charge the member's saved payment method
  3. Record the transaction in the database
  4. Handle declines (see 2.5)
- Billing run: batch process all members in a release
- Partial success: some members charge successfully, others decline — both states recorded
- Refund flow: staff can refund individual charges via Stripe
- Billing audit log: every charge, refund, and decline logged with timestamp and staff member

### 2.5 Payment Decline Recovery

- Declined charges enter a recovery queue
- Automatic retry logic: retry on day 1, day 3, day 7 (configurable)
- Staff can manually retry a declined charge
- Member notification on decline (stub — email in Phase 3)
- Card update flow: member can update their card via the member portal
- Decline reasons displayed to staff (insufficient funds, expired card, etc.)
- Recovery queue dashboard: all declined charges with retry status

### 2.6 Shipping Label Generation

- Integration with carrier APIs: UPS, FedEx, GLS (Codex selects which to implement first — UPS recommended as primary)
- Address validation: verify shipping address before label creation
- Label generation: create label for each successful charge in a release
- Pick-list generation: printable list of all items to pack per shipment
- Scan-to-confirm pack station: barcode scan confirms item packed
- Tracking number recording: save tracking number to shipment record
- Shipping status: label_created → packed → shipped → delivered
- Compliance check: verify state-by-state shipping legality before label creation (ShipCompliant integration in Phase 4 — stub with state whitelist for now)

### 2.7 CSV Migration Import

- CSV upload: staff upload a CSV of existing members
- Column mapping: map CSV columns to database fields
- Validation: validate email format, required fields, duplicate detection
- Preview: show first 10 rows before committing
- Import: batch insert validated rows
- Error report: list of rows that failed validation with reasons
- Support common formats: Commerce7 export, WineDirect export, generic CSV

### 2.8 Database Schema (Phase 2 Tables)

```
club_tiers
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - name (text)
  - description (text)
  - price_cents (integer)
  - bottle_count (integer)
  - frequency (enum: monthly, bi_monthly, quarterly, semi_annual, annual)
  - upgrade_path_id (uuid, FK → club_tiers, nullable)
  - created_at, updated_at (timestamptz)

releases
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - name (text)
  - description (text)
  - processing_date (date)
  - embargo_date (date)
  - status (enum: draft, scheduled, processing, completed)
  - created_at, updated_at (timestamptz)

release_tiers (join table)
  - release_id (uuid, FK → releases)
  - tier_id (uuid, FK → club_tiers)

shipments
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members)
  - release_id (uuid, FK → releases)
  - tier_id (uuid, FK → club_tiers)
  - status (enum: pending, charged, declined, label_created, packed, shipped, delivered, cancelled)
  - tracking_number (text, nullable)
  - carrier (text, nullable)
  - charge_amount_cents (integer)
  - stripe_charge_id (text, nullable)
  - decline_reason (text, nullable)
  - retry_count (integer, default 0)
  - next_retry_date (date, nullable)
  - created_at, updated_at (timestamptz)

shipment_items
  - id (uuid, PK)
  - shipment_id (uuid, FK → shipments)
  - wine_name (text)
  - quantity (integer)
  - price_cents (integer)

audit_log
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - user_id (uuid, FK → users)
  - action (text)
  - entity_type (text)
  - entity_id (uuid)
  - metadata (jsonb)
  - created_at (timestamptz)
```

RLS on all tables: `organization_id` filtering.

---

## Implementation Instructions for Codex

### Build Order

1. **Database** — Phase 2 schema migrations + RLS policies
2. **Club Tiers** — CRUD UI + API
3. **Members** — CRUD UI + API + search + batch ops
4. **Releases** — scheduling UI + API + calendar view
5. **Billing** — Stripe PaymentIntent flow + batch processing
6. **Decline Recovery** — retry queue + manual retry + card update
7. **Shipping** — carrier integration + address validation + labels + pick-lists
8. **CSV Import** — upload + mapping + validation + preview + import
9. **Integration** — wire all components together end-to-end
10. **QA Gate** — run full QA suite
11. **Deploy** — staging → verify exit criterion

### Subagent Delegation

Codex should spawn subagents for:
- Frontend: member management UI, tier config UI, release calendar, recovery queue dashboard
- Backend: billing API, shipping API, CSV import API, audit log middleware
- Database: schema design, RLS policies, migration scripts
- Integration: Stripe billing ↔ shipments ↔ releases, carrier API ↔ labels
- QA: automated test suite, axe-core scans, visual validation

### Critical Path

The critical path is: **Tier config → Member assignment → Release creation → Billing run → Decline handling → Label generation → Shipment completion.** Every step in this chain must work for the exit criterion to pass.

---

## QA Gate (Phase 2)

### Functional Tests

- [ ] Create a club tier with pricing and frequency
- [ ] Add 10 members via UI, assign to tiers
- [ ] Import 10 members via CSV (test with Commerce7-format CSV)
- [ ] CSV validation catches: invalid email, missing required field, duplicate email
- [ ] Create a release, assign tiers, set processing date
- [ ] Process release: all 10 members charged in Stripe test mode
- [ ] At least 1 member declines (use Stripe test card `4000 0000 0000 0002`)
- [ ] Declined charge enters recovery queue
- [ ] Manual retry of declined charge succeeds (update card first)
- [ ] Generate shipping labels for successful charges
- [ ] Address validation rejects invalid addresses
- [ ] Pick-list generates correctly with all items
- [ ] Mark shipments as packed → shipped → delivered
- [ ] Refund a charge via Stripe — status updates in database
- [ ] Audit log records every action with user, timestamp, and metadata
- [ ] Member portal: member can view their shipment history
- [ ] Member portal: member can update their shipping address
- [ ] Member portal: member can update their payment method

### Accessibility (axe-core)

- [ ] 0 axe-core WCAG 2.1 AA violations on all new pages
- [ ] All data tables have proper `<thead>`, `<th scope>`, and captions
- [ ] All form inputs have labels
- [ ] Modal dialogs trap focus and restore on close
- [ ] Dynamic content updates (success/error messages) use `aria-live`
- [ ] Color contrast ≥ 4.5:1 throughout

### Visual / Layout

- [ ] Member table renders correctly at 375px (responsive — columns collapse or scroll)
- [ ] Release calendar renders correctly at all breakpoints
- [ ] Recovery queue dashboard renders correctly at all breakpoints
- [ ] No horizontal overflow at 375px
- [ ] Touch targets ≥ 44×44px on all interactive elements
- [ ] `visual_qa` passes on all screenshots

### Performance

- [ ] Member list loads < 1s with 100 members
- [ ] Release processing completes < 30s for 50 members
- [ ] CSV import of 1000 rows completes < 10s
- [ ] LCP < 2.5s on all pages
- [ ] CLS < 0.1

### Security

- [ ] RLS enforced: Org A staff cannot access Org B members, tiers, releases, or shipments
- [ ] Stripe webhook signature verification on all billing webhooks
- [ ] No card data stored (Stripe handles all PCI-compliant data)
- [ ] CSV upload validates file type and size limits
- [ ] Audit log is tamper-evident (append-only, no UPDATE/DELETE)

### Mobile

- [ ] Member management functional on mobile (375px)
- [ ] Release calendar usable on mobile
- [ ] Recovery queue dashboard usable on mobile
- [ ] CSV upload works from mobile (file picker)
- [ ] All forms have appropriate input types

### Exit Criterion Verification

**This is the most important gate in the entire build.**

- [ ] Create a test organization (or use the one from Phase 1)
- [ ] Add 10 test members with valid Stripe test cards
- [ ] Create a club tier and assign all 10 members
- [ ] Create a release with the tier
- [ ] Process the release — 10 charges run in Stripe test mode
- [ ] Generate shipping labels for all successful charges
- [ ] Mark all shipments as complete
- [ ] **The money moved (in test mode). The wine shipped (simulated). The loop is closed.**

---

## Deliverables

- Complete core club loop: members → tiers → releases → billing → shipping
- CSV import tool
- Audit log
- QA test report (saved as `docs/build-specs/phase-2-qa-report.md`)
- ADRs for architectural decisions
- Updated CHANGELOG.md

---

## Constraints

- **The exit criterion is non-negotiable.** If the money doesn't move and the wine doesn't ship, this phase is not complete.
- **Stripe test mode only.** No real charges until Phase 5 production launch.
- **No AI features in this phase.** Churn risk score is a placeholder field — actual scoring is Phase 3.
- **No email automation in this phase.** Stub with `console.log` — full email integration is Phase 3.
- **State compliance is a stub.** Use a hardcoded state whitelist for now — ShipCompliant integration is Phase 4.
- **The prototype is the visual spec.** Match the dashboard, member list, shipment processing, and release calendar screens.
