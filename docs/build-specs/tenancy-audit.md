# BS-06 Service-Layer Tenancy Audit

**Audit date:** 2026-07-27

**Historical audit starting point:** `origin/main` at `30fe29e`

**Integrated implementation:** BS-03 service decomposition merged with
`origin/main` at `10c6c4588b80878ec5ce098d1745091427d0224f`. The five
BS-06 mobile-bootstrap predicates are preserved in
`server/services/webhooks.ts`; the original monolith paths are re-export-only
compatibility barrels.

**Scope:** Every database-calling function in `server/services/*.ts`

## Post-decomposition ownership

The detailed audit below preserves its original source-line references so the
BS-06 review can be reconstructed. Current code ownership is:

| Historical source | Current owners |
|---|---|
| `core-club.ts` | `members.ts` (principal/member lifecycle), `clubs.ts` (club/brand operations), `easypost.ts` (shipping providers), `stripe.ts` (billing/refunds/Avalara), and `orders.ts` (releases/shipments/schedules) |
| `integrations.ts` | `integration-runtime.ts` (shared provider runtime), `comms.ts` (Klaviyo/sender/mobile-push delivery), and `webhooks.ts` (connectors, domains, mobile sessions/bootstrap, association documents, and integration jobs) |

`core-club.ts` and `integrations.ts` now contain only compatibility exports.
The historical line references in their two sections are provenance, not
current navigation offsets. The fixed mobile-bootstrap owner and current
location are called out explicitly below.

## Evidence boundary

Schema evidence comes from the 21 migration files committed under
`supabase/migrations/`, through
`202607260021_p3_missing_indexes.sql`, at the audited implementation head. It
does not come from inspection of a deployed Supabase schema. Local embedded
database gates validate the repository migration model, but activation gate 9
— applying Phase 4 migration 15 to hosted Supabase and running the 37
current-stack pgTAP assertions plus native tenant/RPC tests — remains
**pending and unverified**.

## Method

The audit parsed every TypeScript source file in `server/services/`, inventoried
all Supabase `.from()` and `.rpc()` calls, and then reviewed each enclosing
function against the final schema produced by all 21 migrations. Direct table
queries were checked for `organization_id`/`brand_id` predicates or tenant
columns on inserted rows. RPCs were checked for tenant arguments or for a
documented privileged boundary in the SQL implementation.

The status vocabulary is:

- **Direct** — the query carries `organization_id`, `brand_id`, or both.
- **RLS principal** — an authenticated staff/member client supplies a
  database-enforced tenant boundary while the service resolves that principal.
- **Derived** — the query uses an opaque, globally unique record/provider key
  obtained from an already authorized or signed operation, and validates the
  returned tenant before use.
- **Privileged claim** — a service-role scheduler claims cross-brand work from
  a guarded RPC; the claimed row supplies the tenant for subsequent work.
- **Global authority** — intentionally organization-independent platform
  administration, hostname discovery, webhook discovery, or maintenance RPC.

`Direct`, `RLS principal`, and `Derived` all satisfy Rule 8. `Privileged claim`
and `Global authority` are not tenant-facing reads and are called out explicitly
so a future reviewer does not mistake them for browser-authorized access.

## Audit results

### `server/services/analytics.ts`

| Function | Line | Has tenant scope | Evidence |
|---|---:|---|---|
| `enqueueBenchmarkReports` | 333 | ✅ Direct | Passes recipient organization/brand into benchmark and artifact RPCs. |
| `runProductionMlTraining` | 554 | ✅ Global authority | Requires the configured active `super_admin`; training RPCs operate on the explicit source snapshot, not a browser tenant. |
| `recordMlTrainingSourceQualification` | 800 | ✅ Global authority | Verifies the configured platform actor before the service-role qualification RPC. |
| `callRpc` | 2355 | ✅ Derived | Private adapter forwards only caller-built RPC arguments; all call sites below carry tenant scope or an explicit global authority. |
| `organizationReportRecipient` | 2365 | ✅ Direct | Filters `staff_users` by `organization_id`. |
| `loadAnalyticsLayout` | 2387 | ✅ Direct | Filters layout by organization, brand, and staff user. |
| `requireAllBrandBenchmarkAccess` | 2402 | ✅ Direct | Resolves platform/staff authority and filters staff access by organization. |
| `getAnalyticsDashboard` | 2449 | ✅ Direct | Validates selected `brand_id`; dashboard RPC receives organization and brand. |
| `listScheduledAnalyticsReports` | 2600 | ✅ Direct | Filters schedules by organization and brand. |
| `updateScheduledAnalyticsReport` | 2690 | ✅ Direct | Filters the target schedule by organization and brand. |
| `getBenchmarkComparison` | 2862 | ✅ Direct | Reads preferences/schedules with organization and brand filters. |
| `getComplianceCheck` | 3071 | ✅ Direct | Filters the check by organization, brand, and shipment. |
| `runReleaseComplianceChecks` | 3105 | ✅ Direct | Filters shipments by organization, brand, and release. |
| `runAnalyticsSchedule` | 3188 | ✅ Privileged claim | Service-role cron RPCs either iterate authoritative brand rows or perform documented platform-wide aggregate maintenance. |

### Historical source: `server/services/core-club.ts`

| Function | Historical source line | Has tenant scope | Evidence |
|---|---:|---|---|
| `resolveStripePaymentMethod` | 1624 | ✅ Direct | Filters member by organization and brand. |
| `assertBrandOperationalAccess` | 1691 | ✅ Direct | Validates the brand/organization pair; the organization lookup uses the validated organization ID. |
| `persistAvalaraTaxStatus` | 1735 | ✅ Derived | Shipment source already contains authoritative organization and brand values passed to the RPC. |
| `prepareAvalaraTax` | 1764 | ✅ Direct | Connection, runtime, tax, and shipment reads are bound to the shipment organization/brand. |
| `requireStaff` | 2080 | ✅ RLS principal | Authenticated staff client resolves the current auth user and its organization before any service operation. |
| `requireMember` | 2131 | ✅ RLS principal | Authenticated/member-session resolution verifies auth user, organization, brand, and operational state. |
| `audit` | 2305 | ✅ Direct | Audit RPC receives organization and brand. |
| `recordDomainAnalyticsEvent` | 2349 | ✅ Direct | Analytics RPC receives principal organization and brand. |
| `activeBrandId` | 2393 | ✅ Direct | Resolves the default brand inside the principal organization and validates access. |
| `assertLegacySingleBrandScope` | 2441 | ✅ Direct | Filters brand count by organization. |
| `yearToDateBottleCount` | 2464 | ✅ Direct | Filters shipments by organization and brand. |
| `checkShipmentCompliance` | 2517 | ✅ Direct | Compliance RPC receives shipment organization and brand. |
| `checkStoredShipmentCompliance` | 2668 | ✅ Direct | Shipment read and compliance writes carry organization and brand; organization metadata is read by the already validated ID. |
| `listClubTiers` | 2796 | ✅ Direct | Filters by organization and brand. |
| `createClubTier` | 2810 | ✅ Direct | Command and readback carry organization and brand. |
| `updateClubTier` | 2845 | ✅ Direct | Command and readback carry organization and brand. |
| `deleteClubTier` | 2878 | ✅ Direct | Command carries organization and brand. |
| `listMembers` | 2896 | ✅ Direct | Filters by organization and brand. |
| `getMember` | 2927 | ✅ Direct | Member, shipment, billing, audit, and side-effect queries carry organization/brand or derive IDs from the scoped member. |
| `createMember` | 3068 | ✅ Direct | Command and readback carry organization and brand. |
| `updateMember` | 3116 | ✅ Direct | Command and readback carry organization and brand. |
| `deleteMember` | 3159 | ✅ Direct | Command carries organization and brand. |
| `transitionMember` | 3179 | ✅ Direct | Command and readback carry organization and brand. |
| `batchMembers` | 3224 | ✅ Direct | Batch command carries organization and brand. |
| `listReleases` | 3324 | ✅ Direct | Filters by organization and brand. |
| `getRelease` | 3352 | ✅ Direct | Filters by release, organization, and brand. |
| `createRelease` | 3374 | ✅ Direct | Command carries organization and brand. |
| `updateRelease` | 3435 | ✅ Direct | Command carries organization and brand. |
| `scheduleRelease` | 3512 | ✅ Direct | Command carries organization and brand. |
| `processRelease` | 3549 | ✅ Direct | Shipment creation and readback carry organization and brand. |
| `listRecoveryQueue` | 3638 | ✅ Direct | Filters by organization and brand. |
| `listShipments` | 3655 | ✅ Direct | Shipment query and related-row lookups are scoped by organization and brand. |
| `refundShipment` | 3737 | ✅ Direct | Shipment/billing reads and payment RPCs carry organization and brand. |
| `createMemberPaymentMethodPortal` | 3943 | ✅ Direct | Filters member by organization and brand. |
| `generateShipmentLabels` | 4014 | ✅ Direct | Shipment query and all label RPCs carry organization and brand; organization metadata uses the validated organization ID. |
| `getPickList` | 4426 | ✅ Direct | Filters shipments by organization, brand, and release. |
| `confirmShipmentPack` | 4450 | ✅ Direct | RPC receives organization and brand. |
| `transitionShipment` | 4479 | ✅ Direct | RPC receives organization and brand. |
| `previewMemberImport` | 4517 | ✅ Direct | Tier/member checks and inserted staging rows carry organization and brand; rollback uses the newly generated import ID. |
| `importMembers` | 4700 | ✅ Direct | Commit RPC and staged-row read carry organization and brand. |
| `getMemberPortalHistory` | 4762 | ✅ Direct | Filters by organization, brand, and member. |
| `updateMemberPortalAddress` | 4798 | ✅ Direct | Command and readback carry organization and brand. |
| `assertTenantEntity` | 4862 | ✅ Direct | Generic entity assertion filters organization and brand. |
| `assertReleaseTiers` | 4881 | ✅ Direct | Tier assertion filters organization and brand. |
| `replaceReleaseChildren` | 4918 | ✅ Direct | Deletes filter organization/brand; inserted rows include both tenant columns. |
| `getPaymentShipment` | 4991 | ✅ Direct | Filters shipment by organization and brand. |
| `recordPaymentOutcome` | 5154 | ✅ Direct | Payment and loyalty RPCs receive organization and brand. |
| `ensureBillingAttempt` | 5241 | ✅ Direct | Billing RPC receives organization and brand. |
| `executeMemberSideEffect` | 5360 | ✅ Privileged claim | Operates only on a row returned by the guarded side-effect claim; provider subject lookup is used to prove the subject still exists. |
| `processMemberSideEffects` | 5446 | ✅ Privileged claim | Claims globally queued service-role work; each row contains authoritative tenant context. |
| `attachSystemPaymentIntent` | 5490 | ✅ Direct | RPC receives shipment organization and brand. |
| `applySystemPaymentOutcome` | 5522 | ✅ Direct | RPC receives shipment organization and brand. |
| `applyRefundRecoveryFailure` | 5557 | ✅ Direct | RPC receives shipment organization and brand. |
| `recoverRefundAttempt` | 5585 | ✅ Direct | RPC receives claimed shipment organization and brand. |
| `requeueSystemAttempt` | 5805 | ✅ Derived | Updates only the claimed billing-attempt/shipment IDs after tenant-scoped claim validation. |
| `runCoreClubSchedule` | 5861 | ✅ Privileged claim | Cross-brand cron claims authoritative due rows; every provider operation and completion uses the claimed organization/brand. |

### Historical source: `server/services/integrations.ts`

| Function | Historical source line | Has tenant scope | Evidence |
|---|---:|---|---|
| `getPortalBranding` | 821 | ✅ Global authority | Public hostname discovery resolves only an active, globally unique custom hostname and returns safe branding fields. |
| `activeMemberAttributionHostname` | 894 | ✅ Derived | Hostname result must match the already authenticated member organization and brand. |
| `getMemberMetaPrivacy` | 933 | ✅ Direct | Filters consent by organization, brand, member, and integration. |
| `updateMemberMetaPrivacy` | 959 | ✅ Direct | Authenticated member RPCs receive organization, brand, and member. |
| `getMetaAttributionReport` | 1064 | ✅ Direct | Staff RPC receives organization and selected brand scope. |
| `activeBrandId` | 1101 | ✅ Direct | Resolves default brand from the principal organization and validates it. |
| `assertAllBrandAccess` | 1148 | ✅ Direct | Filters staff access by organization. |
| `connection` | 1169 | ✅ Direct | Filters connection by organization, brand, and provider. |
| `storeCredentials` | 1187 | ✅ Derived | Private helper receives the authorized connection ID; SQL verifies the connection before replacing its secret. |
| `persistProviderMappings` | 1273 | ✅ Derived | Private helper receives an authorized connection and mapping RPCs validate its tenant. |
| `listIntegrations` | 1302 | ✅ Direct | Connections are organization/brand scoped; secret metadata is limited to those resulting connection IDs. |
| `connectIntegration` | 1376 | ✅ Direct | Configuration, consent, and bootstrap RPCs receive organization and brand. |
| `updateIntegration` | 1482 | ✅ Direct | Configuration and consent RPCs receive organization and brand. |
| `disconnectIntegration` | 1570 | ✅ Derived | Connection ID comes from the principal-scoped connection lookup; RPC validates ownership. |
| `queueIntegrationSync` | 1583 | ✅ Derived | Authorized connection ID is passed to a tenant-validating enqueue RPC. |
| `queueAvalaraFilingVerification` | 1631 | ✅ Derived | Authorized Avalara connection ID is passed to a tenant-validating enqueue RPC. |
| `listIntegrationLogs` | 1677 | ✅ Direct | Filters by organization and brand. |
| `getQuickBooksAuthorizationUrl` | 1724 | ✅ Direct | Connection is scoped; OAuth job inserts organization and brand. |
| `completeQuickBooksOAuth` | 1791 | ✅ Direct | Nonce-bound job and connection are resolved inside the authenticated organization/brand. |
| `getQuickBooksReconciliation` | 1883 | ✅ Direct | Filters by organization, brand, and connection. |
| `getAvalaraLiability` | 1899 | ✅ Direct | Filters by organization, brand, and connection. |
| `getAvalaraFilingStatus` | 1946 | ✅ Derived | Snapshot rows are descendants of the principal-scoped connection; authenticated staff RLS applies as a second boundary. |
| `handleKlaviyoWebhook` | 2019 | ✅ Derived | Signed webhook resolves the globally unique active connection, then every row carries that connection's organization/brand. |
| `integrationRuntime` | 2132 | ✅ Direct | RPC receives organization and brand. |
| `listBrands` | 2193 | ✅ Direct | Filters brand and staff grant reads by organization. |
| `createBrand` | 2273 | ✅ Direct | Insert carries the principal organization. |
| `updateBrand` | 2301 | ✅ Direct | Brand/sender reads and writes carry organization and brand. |
| `activateBrandSender` | 2419 | ✅ Direct | Sender read and verification RPC carry organization and brand. |
| `getBrandOverview` | 2483 | ✅ Direct | Filters metrics by organization and brand. |
| `configureBrandDomain` | 2520 | ✅ Direct | Domain write ledger and persistence carry organization and brand. |
| `persistDomain` | 2677 | ✅ Direct | Upsert row includes organization and brand. |
| `getBrandDomain` | 2715 | ✅ Direct | Filters by organization and brand. |
| `deleteBrandDomain` | 2762 | ✅ Direct | Domain read and delete-ledger RPCs carry organization and brand. |
| `requestMobileMagicLink` | 2920 | ✅ Derived | Unique active brand slug is resolved first; member lookup then filters the resolved brand. |
| `completeMobileMagicLink` | 3049 | ✅ Direct | Member queries and exchange registration carry organization and brand. |
| `mobileMemberBrandIsOperational` | 3127 | ✅ Direct | Validates the brand/organization pair and the resolved organization. |
| `exchangeMobileSession` | 3153 | ✅ Derived | One-time exchange RPC returns authoritative tenant claims used for device/session writes. |
| `mobileSessionResponse` | 3242 | ✅ Direct | Filters member by organization, brand, auth user, and member ID. |
| `refreshMobileSession` | 3282 | ✅ Derived | Rotating opaque token RPC yields the only usable session ID; the loaded row supplies immutable tenant claims. |
| `logoutMobileSession` | 3329 | ✅ Derived | Hashed opaque refresh token resolves the family revoked by the guarded RPC. |
| `getMobileBootstrap` | 3421 | ✅ Direct (fixed) | Current owner: `webhooks.ts` near line 3387. Member, shipment, and loyalty reads all filter by authenticated organization and brand. |
| `registerMobileDevice` | 3486 | ✅ Direct | Member read is scoped; device and secret rows include organization and brand. |
| `unregisterMobileDevice` | 3551 | ✅ Direct | Filters the device by organization, brand, and member. |
| `claimRefundDelivery` | 3635 | ✅ Privileged claim | Claims one integration refund row by durable billing attempt; returned row includes tenant context. |
| `releaseRefundDelivery` | 3711 | ✅ Derived | Releases only the previously claimed refund delivery with its lease token. |
| `integrationRuntimeForJob` | 3747 | ✅ Direct | Runtime RPC receives claimed organization and brand. |
| `persistQuickBooksRotation` | 3835 | ✅ Derived | Completes the claimed connection generation with its lease token. |
| `claimQuickBooksRefreshLease` | 3875 | ✅ Derived | Claims the already tenant-bound job connection and expected generation. |
| `releaseQuickBooksRefreshLease` | 3908 | ✅ Derived | Releases the exact claimed connection/generation/lease. |
| `executeConnectionValidation` | 4037 | ✅ Derived | Operates on a claimed tenant job and its connection. |
| `executeKlaviyoProfiles` | 4216 | ✅ Direct | Uses claimed job tenant; source/mapping writes bind connection, organization, and brand. |
| `executeQuickBooksTransactions` | 4525 | ✅ Direct | Uses claimed job tenant for shipment, mapping, and completion work. |
| `attributionForMetaEvent` | 4994 | ✅ Direct | Filters attribution by job organization, brand, member, and connection. |
| `executeMetaConversions` | 5076 | ✅ Direct | Uses claimed job tenant; consent and event reads are organization/brand bound. |
| `executeKlaviyoEngagement` | 5204 | ✅ Direct | Uses claimed job tenant for mapping, event, and retry work. |
| `executeQuickBooksReconciliation` | 5301 | ✅ Direct | Uses claimed job tenant and persists organization/brand on the result. |
| `avalaraShipmentRows` | 5361 | ✅ Direct | Filters shipments by claimed organization and brand. |
| `executeAvalaraCalculate` | 5385 | ✅ Derived | Uses a claimed job and tenant-validating enqueue RPC. |
| `executeAvalaraReconciliation` | 5416 | ✅ Direct | Uses claimed job tenant for calculation, shipment, and persisted response. |
| `executeAvalaraFilingVerification` | 5524 | ✅ Derived | Uses the claimed connection; replacement RPC verifies the tenant-owned connection. |
| `executeAvalaraRefund` | 5558 | ✅ Direct | Uses claimed job tenant for shipment, calculation, and completion. |
| `executeMetaEvent` | 5724 | ✅ Direct | Uses claimed job tenant for shipment, consent, member, and event rows. |
| `enqueueScheduledIntegrationWork` | 5990 | ✅ Privileged claim | Service-role sweep reads only active connections and enqueues with each row's authoritative tenant fields. |
| `drainIntegrationJobs` | 6140 | ✅ Privileged claim | Guarded claim returns tenant context; completion requires the job lease. |
| `runMobilePushSchedule` | 6216 | ✅ Privileged claim | Guarded claim returns tenant/device context; completion requires the push ID and lease token. |

### `server/services/production-foundation.ts`

| Function | Line | Has tenant scope | Evidence |
|---|---:|---|---|
| `getStaffSession` | 293 | ✅ RLS principal | Authenticated user resolves staff/platform identity and its organization under RLS. |
| `staffSignup` | 381 | ✅ Derived | Bootstrap creates a new organization; recovery is keyed to the new auth user, then all work uses the returned organization ID. |
| `exchangeAuthCode` | 572 | ✅ Direct | Member link RPC receives organization, brand, member, and auth user. |
| `createStaffInvitation` | 643 | ✅ Direct | Insert carries principal organization and inviter. |
| `acceptStaffInvite` | 687 | ✅ Derived | Hashed one-time invite token selects the organization in the guarded RPC. |
| `requestMemberMagicLink` | 727 | ✅ Derived | Member discovery is followed by explicit hostname/brand verification and a context-bound registration RPC. |
| `createBillingCheckout` | 837 | ✅ Direct | Brand read and reconciliation RPC carry organization and brand. |
| `createBillingPortal` | 1003 | ✅ Direct | Filters brand by organization and brand. |
| `handleStripeWebhook` | 1060 | ✅ Derived | Signed Stripe event resolves a globally unique customer, then persists the resolved organization/brand. |
| `handleShipmentPaymentWebhook` | 1212 | ✅ Derived | Signed event and globally unique Stripe attempt/charge IDs resolve the tenant before any mutation. |
| `reconcileSubscriptionAccess` | 1474 | ✅ Global authority | Service-role scheduled reconciliation iterates authoritative subscriptions across organizations. |

### `server/services/retention.ts`

| Function | Line | Has tenant scope | Evidence |
|---|---:|---|---|
| `recordEmailProviderEvent` | 1129 | ✅ Derived | Signed provider event is matched by durable provider message identity in the guarded RPC. |
| `markEmail` | 1157 | ✅ Derived | Completion requires the exact claimed outbox row and lease token. |
| `recordMemberPortalLogin` | 1390 | ✅ Direct | RPC receives principal organization, brand, and member. |
| `listEmailTemplates` | 1415 | ✅ Direct | Filters templates/sender by organization and brand. |
| `upsertEmailTemplate` | 1462 | ✅ Direct | Read filters and inserted values carry organization and brand. |
| `updateEmailTemplate` | 1506 | ✅ Direct | Filters by organization and brand. |
| `deleteEmailTemplate` | 1566 | ✅ Direct | Filters by organization and brand. |
| `getTemplate` | 1589 | ✅ Direct | Filters by organization and brand. |
| `sendEmailTemplateTest` | 1638 | ✅ Direct | Sender read and email RPC carry organization and brand. |
| `listEmailLog` | 1718 | ✅ Direct | Filters by organization and brand. |
| `listChurnScores` | 1805 | ✅ Direct | All score queries filter organization and brand. |
| `getChurnScore` | 1877 | ✅ Direct | Filters organization, brand, and member. |
| `loadCancelFlowConfiguration` | 1905 | ✅ Direct | Filters organization and brand. |
| `updateCancelFlowConfiguration` | 1925 | ✅ Direct | Reads and RPC carry organization and brand. |
| `getCancelFlowAnalytics` | 2003 | ✅ Direct | RPC receives organization and brand. |
| `getMemberCancelFlow` | 2021 | ✅ Direct | Every member, shipment, loyalty, attempt, tier, and wine query is organization/brand scoped. |
| `startMemberCancelFlow` | 2174 | ✅ Direct | RPC receives organization, brand, and member. |
| `processCancelFlowEvent` | 2203 | ✅ Direct | Reads and state-transition RPC carry organization, brand, and member. |
| `listLoyaltyMembers` | 2406 | ✅ Direct | Member, lot, and multiplier reads filter organization and brand. |
| `adjustLoyaltyPoints` | 2501 | ✅ Direct | Member read and command RPC carry organization and brand. |
| `recordLoyaltyEvent` | 2572 | ✅ Direct | Member read and activity RPC carry organization and brand. |
| `loadMemberLoyalty` | 2658 | ✅ Direct | Ledger/member/lot/multiplier queries are organization/brand scoped; organization configuration uses the validated ID. |
| `redeemMemberLoyalty` | 2838 | ✅ Direct | Reservation RPC receives organization, brand, member, and shipment. |
| `applyUnsubscribe` | 2887 | ✅ Derived | Signed token claims contain the organization; RPC output must match those verified claims. |
| `runEmailOutbox` | 2904 | ✅ Privileged claim | Service-role claim returns tenant-owned rows and lease tokens used for all completions. |
| `runRetentionSchedule` | 2941 | ✅ Privileged claim | Service-role daily/hourly RPCs iterate authoritative tenant rows internally. |

### `server/services/stripe-runtime.ts`

| Function | Line | Has tenant scope | Evidence |
|---|---:|---|---|
| `SupabaseStripeCustomerProvisioningStore.claim` | 122 | ✅ Direct | RPC receives billing subject organization/brand/member identifiers. |
| `SupabaseStripeCustomerProvisioningStore.finalize` | 154 | ✅ Direct | RPC receives subject identifiers and the claim token. |
| `SupabaseStripeBillingAttemptStore.claim` | 177 | ✅ Direct | RPC receives subject organization/brand/member identifiers. |
| `SupabaseStripeBillingAttemptStore.close` | 227 | ✅ Derived | Closes the exact claimed attempt by opaque attempt/fingerprint identity. |
| `SupabaseStripeBillingAttemptStore.finalize` | 236 | ✅ Derived | Finalizes the exact claimed attempt by opaque attempt/fingerprint identity. |

`benchmark-report.ts`, `compliance.ts`, and `ml-training.ts` contain no Supabase
query calls; occurrences of `Buffer.from`/`Array.from` were excluded from the
database inventory.

## Finding and remediation

One defense-in-depth gap was confirmed in
`server/services/webhooks.ts` in
`ProductionIntegrationService.getMobileBootstrap`. Its member profile read had
an organization predicate but no brand predicate, while the shipment and
loyalty snapshot reads relied on member RLS plus `member_id` without repeating
either tenant discriminator. RLS already prevented cross-tenant data from being
returned, so no demonstrated leak existed; however, the service did not satisfy
Rule 8's explicit application-layer boundary.

The function now applies both:

```ts
.eq("organization_id", principal.organization.id)
.eq("brand_id", principal.brand.id)
```

to the member, shipment, and loyalty queries. A focused Vitest constructs two
tenant identifiers and verifies that every mobile-bootstrap query receives only
the authenticated organization's and brand's values.

No other unscoped tenant-facing service query was found. The derived/global
cases above must be reconsidered if their globally unique keys, signed inputs,
claim RPCs, or service-role restrictions change.
