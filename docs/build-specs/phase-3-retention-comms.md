# Phase 3: Retention & Communications

**Duration:** Months 5–7
**Status:** Planned
**Exit Criterion:** Email automation fires on real triggers, AI churn risk scores are assigned to every member, the cancel-flow retention tool intercepts cancellations, and the loyalty program awards and redeems points.

---

## Objective

Build the features that set Vinifera apart from every existing platform. No major wine club platform builds cancel-flow retention natively. Vinifera makes it standard.

This phase delivers: email automation, AI churn risk scoring (rules-based first, then ML), the cancel-flow retention tool, and the full loyalty program.

---

## Prerequisites

- Phase 2 complete: core club loop functional, members and shipments exist in the database
- Real member behavioral data available from at least one winery's release cycle
- QA gate for Phase 2 passed

---

## Scope

### 3.1 Email Automation (Resend Integration)

- Connect Resend API for transactional email delivery
- DKIM/SPF authentication configured for the winery's domain
- Automated email triggers:
  - **Welcome email** — sent on member signup
  - **Pre-shipment notification** — sent X days before release processing (configurable, default 3)
  - **Payment decline notice** — sent when a charge declines
  - **Shipment shipped** — sent with tracking number when label is created
  - **Birthday email** — sent on member's birthday (if birthday field is populated)
  - **Re-engagement email** — sent to members inactive for 60+ days
- Email template editor: staff can customize subject line and body per trigger type
- Email sending log: every email sent is logged with recipient, template, status, timestamp
- Email preview: staff can preview and send a test email before enabling a trigger
- Unsubscribe handling: member portal includes unsubscribe link (transactional emails only — not marketing)

### 3.2 AI Churn Risk Scoring

#### Phase 3a: Rules-Based Scoring (this phase)

- Score every member 0–100 based on weighted rules:
  - Days since last shipment interaction (-weight)
  - Number of declined charges in last 12 months (+weight)
  - Membership duration (longer = lower risk, -weight)
  - Email engagement: open rate, click rate in last 90 days (+weight if low)
  - Recent portal logins (-weight if active)
  - Tier downgrades in last 12 months (+weight)
- Score thresholds:
  - 0–30: Low risk (green)
  - 31–60: Medium risk (yellow)
  - 61–100: High risk (red)
- Score recalculation: nightly batch job updates all member scores
- Dashboard: AI Churn Watch panel shows high-risk members sorted by score
- Per-member view: churn risk score + contributing factors displayed on member detail page

#### Phase 3b: ML-Assisted Scoring (Phase 4 — not this phase)

- ML model trained on accumulated behavioral data
- Target accuracy: 75–85% (competitive with Commerce7's June 2026 specification)
- This is Phase 4 — do not implement in Phase 3

### 3.3 Cancel-Flow Retention Tool

This is Vinifera's key differentiator. No major wine club platform builds this natively.

- When a member initiates cancellation (via member portal):
  1. **Step 1 — Pause offer:** "Would you like to pause your membership instead?" Options: Pause for 1 month, 3 months, or continue with cancellation
  2. **Step 2 — Downgrade offer:** "Would you like to switch to a lower tier?" Show current tier and available lower tiers with pricing
  3. **Step 3 — Swap offer:** "Would you like to customize your next shipment instead?" Show wine swap options
  4. **Step 4 — Final confirmation:** "Are you sure you want to cancel?" with clear summary of what they lose (loyalty points, tier benefits, etc.)
- If member accepts any offer: cancellation is interrupted, the alternative action is taken, and the member stays active
- If member completes all 4 steps: cancellation is processed
- Analytics: track which step intercepted the most cancellations, conversion rate at each step
- Staff visibility: staff can see cancel-flow outcomes on the member detail page
- Configurable: staff can enable/disable individual steps or reorder them

### 3.4 Loyalty Program

- Points awarded for:
  - Shipment received: 100 points per shipment
  - Event attendance: 50 points per event (manual entry by staff)
  - Referral: 200 points when a referred member completes their first shipment
  - Birthday: 25 points on birthday
  - Anniversary: 50 points on membership anniversary
- Points redeemed:
  - Against upcoming shipment: deduct X points for $Y discount (configurable ratio, default 100 points = $10)
  - Full ledger in member portal: every award and redemption logged
- Points expiration: points expire 24 months after award if not redeemed
- Staff can manually adjust points with reason logging
- Loyalty tier bonuses: higher tiers earn points at a multiplier (Vine 1×, Cellar 1.25×, Estate 1.5×)

### 3.5 Database Schema (Phase 3 Tables)

```
email_templates
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - trigger_type (enum: welcome, pre_shipment, payment_decline, shipped, birthday, re_engagement)
  - subject (text)
  - body (text)
  - enabled (boolean, default true)
  - created_at, updated_at (timestamptz)

email_log
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members)
  - template_id (uuid, FK → email_templates)
  - status (enum: sent, failed, bounced)
  - resend_id (text)
  - created_at (timestamptz)

churn_scores
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members)
  - score (integer, 0-100)
  - risk_level (enum: low, medium, high)
  - contributing_factors (jsonb)
  - calculated_at (timestamptz)

cancel_flow_events
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members)
  - step_reached (integer, 1-4)
  - outcome (enum: paused, downgraded, swapped, cancelled)
  - created_at (timestamptz)

loyalty_points
  - id (uuid, PK)
  - organization_id (uuid, FK → organizations)
  - member_id (uuid, FK → members)
  - points (integer, can be negative for redemptions)
  - reason (text)
  - expires_at (timestamptz, nullable)
  - created_at (timestamptz)
```

---

## Implementation Instructions for Codex

### Build Order

1. **Resend integration** — API connection, DKIM/SPF setup, email template CRUD
2. **Email triggers** — wire each trigger to its template and event source
3. **Churn scoring** — rules engine, nightly batch job, dashboard panel
4. **Cancel-flow** — 4-step flow, analytics tracking, staff configuration UI
5. **Loyalty** — points engine, award/redemption logic, member portal ledger
6. **Integration** — wire email triggers to Phase 2 events (decline, shipment, etc.)
7. **QA Gate** — run full QA suite
8. **Deploy** — staging → verify exit criterion

### Subagent Delegation

Codex should spawn subagents for:
- Backend: Resend API integration, email template engine, churn scoring batch job, loyalty points engine
- Frontend: email template editor, churn watch dashboard, cancel-flow UI, loyalty ledger in member portal
- Data: churn scoring rules engine design, loyalty points schema, analytics queries
- QA: email delivery testing, cancel-flow flow testing, loyalty points calculation verification

---

## QA Gate (Phase 3)

### Functional Tests

- [ ] Welcome email sent on member signup
- [ ] Pre-shipment email sent X days before processing (verify with test release)
- [ ] Payment decline email sent when charge declines
- [ ] Shipment shipped email sent with tracking number
- [ ] Birthday email sent on member's birthday (set test birthday to today)
- [ ] Email template editor: staff can edit subject and body, preview, send test
- [ ] Email log records every email with status
- [ ] Unsubscribe link in emails works and updates member preference
- [ ] Churn score calculated for all members after nightly batch
- [ ] Churn score reflects contributing factors accurately
- [ ] AI Churn Watch dashboard shows high-risk members sorted by score
- [ ] Cancel-flow: member initiating cancellation sees all 4 steps
- [ ] Cancel-flow: pause offer interrupts cancellation when accepted
- [ ] Cancel-flow: downgrade offer interrupts cancellation when accepted
- [ ] Cancel-flow: swap offer interrupts cancellation when accepted
- [ ] Cancel-flow: completing all 4 steps processes cancellation
- [ ] Cancel-flow analytics: staff can see outcome for each cancellation attempt
- [ ] Loyalty: points awarded on shipment received
- [ ] Loyalty: points awarded on referral (when referred member completes first shipment)
- [ ] Loyalty: points redeemed against upcoming shipment
- [ ] Loyalty: points expire after 24 months
- [ ] Loyalty: staff can manually adjust points with reason
- [ ] Loyalty: tier multiplier applies correctly (Vine 1×, Cellar 1.25×, Estate 1.5×)
- [ ] Member portal: loyalty ledger shows all awards and redemptions

### Accessibility (axe-core)

- [ ] 0 axe-core WCAG 2.1 AA violations on all new pages
- [ ] Email template editor is keyboard accessible
- [ ] Cancel-flow modal traps focus and restores on close
- [ ] Loyalty ledger table has proper headers and scope
- [ ] Color contrast ≥ 4.5:1 (including risk-level color indicators — green/yellow/red must meet contrast for text labels, not just color)
- [ ] Risk-level indicators don't rely on color alone (include text labels: "Low", "Medium", "High")

### Visual / Layout

- [ ] Churn Watch dashboard renders correctly at all breakpoints
- [ ] Cancel-flow modal renders correctly at 375px (mobile)
- [ ] Email template editor renders correctly at all breakpoints
- [ ] Loyalty ledger renders correctly at all breakpoints
- [ ] No horizontal overflow at 375px
- [ ] Touch targets ≥ 44×44px
- [ ] `visual_qa` passes on all screenshots

### Performance

- [ ] Churn scoring batch job completes < 60s for 1000 members
- [ ] Email sending completes < 10s per batch of 100 emails
- [ ] Cancel-flow modal loads < 500ms
- [ ] LCP < 2.5s on all new pages
- [ ] CLS < 0.1

### Security

- [ ] Resend API key stored in environment variables, never in client-side code
- [ ] Email templates sanitized against HTML injection (no `<script>` tags)
- [ ] Cancel-flow requires authenticated member session
- [ ] Loyalty point adjustments require staff auth and are audit-logged
- [ ] Unsubscribe token is signed and expires

### Mobile

- [ ] Cancel-flow fully functional on mobile (375px) — this is where most members will interact with it
- [ ] Email templates render correctly in mobile email clients (responsive HTML)
- [ ] Loyalty ledger usable on mobile
- [ ] Churn Watch dashboard usable on mobile

### Exit Criterion Verification

- [ ] Configure at least 2 email triggers and verify they fire on real events
- [ ] Run churn scoring batch — verify scores are assigned and displayed
- [ ] Initiate a cancellation via member portal — verify cancel-flow intercepts or processes correctly
- [ ] Award points for a shipment — verify ledger updates
- [ ] Redeem points against a shipment — verify discount applies

---

## Deliverables

- Email automation system (Resend integration + 6 trigger types)
- AI churn risk scoring (rules-based)
- Cancel-flow retention tool (4-step configurable flow)
- Loyalty program (points engine + member portal ledger)
- QA test report (saved as `docs/build-specs/phase-3-qa-report.md`)
- ADRs for architectural decisions
- Updated CHANGELOG.md

---

## Pre-Provisioned Credentials

Phase 3 builds on Phase 1 and 2 credentials. The following additional credential is NOT pre-provisioned and must be obtained before starting this phase:

| Secret name | Purpose | How to obtain |
|-------------|---------|---------------|
| `RESEND_API_KEY` | Resend API for transactional email | Register at https://resend.com, create an API key, store as GitHub repo secret |

**DKIM/SPF setup** also requires access to the winery's DNS records. For development, use Resend's default sender domain (`onboarding@resend.dev`). For production, the winery must add DKIM and SPF TXT records to their domain's DNS. Codex should document the DNS records needed and escalate to the human supervisor for DNS configuration.

---

## Constraints

- **Rules-based churn scoring only in this phase.** ML-assisted scoring is Phase 4.
- **Email is transactional only.** Marketing email campaigns (broadcasts to segments) are a Phase 3 stretch goal — implement if time permits, otherwise defer to Phase 4.
- **Cancel-flow is the centerpiece.** This is the feature that differentiates Vinifera from every competitor. It must work flawlessly on mobile.
- **Loyalty points expire.** Expiration logic must be tested — expired points should not be redeemable.
- **The prototype's AI Churn Watch panel is the visual spec** for the churn dashboard.
- **Never commit secret values to source files.** The repository is public. All credentials are stored as encrypted GitHub repository secrets.
