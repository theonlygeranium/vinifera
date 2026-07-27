# BS-03 Service Decomposition Manifest

**Source revision:** `30fe29e`
**Audited files:** `server/services/core-club.ts` (6,166 lines) and
`server/services/integrations.ts` (6,324 lines)
**Constraint:** Extraction only. Function and method bodies, names, parameters,
return types, ordering, activation behavior, and error behavior must remain
unchanged.

## Audit notes and source/spec reconciliation

- `server/services/analytics.ts` already exists and contains the production
  analytics/ML service inherited by `ProductionIntegrationService`. There are
  no analytics or ML exports in `core-club.ts` to move into it. BS-03 must not
  overwrite that existing implementation.
- Stripe billing, EasyPost shipping, and Avalara shipment-tax preparation are
  currently in `core-club.ts`, not `integrations.ts`. The destination is based
  on functional cohesion rather than the source-file assumption in the
  dispatch table.
- Both source files export stateful classes. Public class methods are included
  below because moving only top-level functions would leave most business logic
  in the monoliths.
- Existing missing tenant or activation guards are recorded, not repaired.
  BS-03 does not add guards or tenant filters. Rule 8 follow-up belongs to
  BS-06.
- The communications executors and webhook scheduler both require the original
  provider-runtime helpers. Those unchanged source-private helpers live in
  `integration-runtime.ts`, preventing a `comms.ts` ↔ `webhooks.ts` import
  cycle without changing their bodies or exposing them through the public
  service barrel.
- Final integration with verified `main` revision `c534703` preserves that
  revision's reviewed release-wine identity/replay change in the extracted
  owner, `orders.ts`. That post-extraction behavior change is attributable to
  the merged review-hardening baseline, not to the BS-03 decomposition;
  `core-club.ts` remains re-export-only.

## Intended dependency direction

```text
easypost.ts ──► members.ts ──► clubs.ts ──► stripe.ts ──► orders.ts

analytics.ts (existing) ───────────────────────────────► webhooks.ts
integration-runtime.ts ──► comms.ts ──────────────────► webhooks.ts
```

The final public class names remain `ProductionCoreClubService` and
`ProductionIntegrationService`. The original `core-club.ts` and
`integrations.ts` import paths remain re-export-only compatibility barrels.
After the BS-02 route transition merged, runtime consumers and the system
association route moved to their direct extracted-domain imports.

## `core-club.ts` exported symbols

### Top-level functions

| Export and signature | Destination | Internal dependencies | External dependencies | Activation / tenant audit |
|---|---|---|---|---|
| `assertStaffWorkspaceAccess(accessState?: string \| null): void` | `members.ts` | None | `AppError` | No provider/DB access |
| `assessLegacyShippingWhitelist(env, address): { allowed; reason }` | `easypost.ts` | `allowedStates` | `WorkerEnv`, `PostalAddress` | Legacy inactive reference; no provider call |
| `createShippingProvider(env): ShippingProvider` | `easypost.ts` | `SimulatedShippingProvider`, `EasyPostShippingProvider` | EasyPost, `assertEasyPostTarget` | Present: simulation is test-only; EasyPost key/target required |
| `canonicalizeCsvImportMapping(sourceToTarget): Record<string, string>` | `members.ts` | `IMPORT_TARGET_KEYS`, `REQUIRED_IMPORT_TARGETS` | `AppError` | No provider/DB access |
| `buildCsvTierLookup(tiers): Map<string, string>` | `members.ts` | None | None | No provider/DB access |
| `resolveCsvTierId(value, lookup): string \| null` | `members.ts` | None | None | No provider/DB access |
| `isCompleteShippingContact(contact, requireCompany?): boolean` | `easypost.ts` | `isUsableShippingPhone` | None | No provider/DB access |
| `brandAllowsOperationalAccess(input): boolean` | `members.ts` (re-exported by `stripe.ts`) | None | None | Pure fail-closed status predicate shared by member authorization and payment scheduling |
| `prepareAvalaraTax(env, admin, shipment): Promise<PreparedAvalaraTax \| null>` | `stripe.ts` | `persistAvalaraTaxStatus`, `shipmentSubtotalAmount`, `getAddress`, `databaseError` | Supabase, Avalara, credential decryption | Present: connection status, opt-in, activation and environment assertions; queries scope `organization_id` + `brand_id` |
| `executeMemberSideEffect(admin, stripe, effect): Promise<"applied" \| "superseded">` | `stripe.ts` | `databaseError` | Supabase, Stripe | Provider is injected by guarded schedule; row is pre-claimed |
| `processMemberSideEffects(admin, stripe, asOf): Promise<{ failed; processed }>` | `stripe.ts` | `executeMemberSideEffect`, `safeMemberSideEffectErrorCode`, `mapConcurrent` | Supabase, Stripe | Provider is injected by guarded schedule; RPC claims authoritative rows |
| `recoverRefundAttempt(admin, stripe, attempt): Promise<"failed" \| "refunded" \| "retry">` | `stripe.ts` | `applyRefundRecoveryFailure`, retry classifiers, `oneRelation` | Supabase, Stripe | Provider is injected by guarded schedule; shipment row carries organization/brand |
| `resumeProcessingReleaseShipments(releases, createShipments): Promise<number>` | `orders.ts` | Callback only | None | No provider/DB access |
| `executeScheduledRetry(retry, charge, requeue): Promise<"charged" \| "declined" \| "failed">` | `stripe.ts` | Callbacks only | None | Guard responsibility remains with injected callbacks |
| `runCoreClubSchedule(env, asOf?): Promise<CoreClubScheduleReport>` | `orders.ts` | `processMemberSideEffects`, `recoverRefundAttempt`, `executeScheduledRetry`, `resumeProcessingReleaseShipments`, payment helpers | Supabase, Stripe | Present: `assertStripeBillingAuthority`; claimed rows carry organization/brand |

### Exported shipping classes and types

| Symbol | Destination | Dependencies | Activation / tenant audit |
|---|---|---|---|
| `ShipmentPaymentRow` | `members.ts` (re-exported by `stripe.ts`) | Member/shipment types | Data contract shared by member, payment, and order services |
| `AddressValidationResult`, `LabelRequest`, `LabelResult`, `LabelPurchaseRecovery`, `ShippingProvider` | `easypost.ts` | `PostalAddress` | Data contracts only |
| `SimulatedShippingProvider` | `easypost.ts` | `sha256` | Instantiation is guarded by `createShippingProvider` |
| `EasyPostShippingProvider` | `easypost.ts` | Fetch API, `assertEasyPostTarget` | Constructor validates target; provider key required by factory |
| `ScheduledRetryRow`, `ProcessingReleaseRow`, `MemberSideEffectRow`, `CoreClubScheduleReport` | `stripe.ts` / `orders.ts` | Schedule data contracts | Data contracts only |

### `ProductionCoreClubService` public method manifest

All database-backed methods first resolve an authenticated principal. A method
listed as "scoped" contains explicit `organization_id` and/or `brand_id`
constraints or calls an RPC that receives both. "RPC contract" means the
service itself does not add a post-RPC filter; BS-03 preserves that behavior.

| Public method | Destination | Direct `this` dependencies | External dependencies | Guard / scope |
|---|---|---|---|---|
| `listClubTiers()` | `clubs.ts` | `requireStaff`, `organizationId`, `activeBrandId` | Supabase | Scoped |
| `createClubTier(input, commandId)` | `clubs.ts` | auth/tenant helpers | Supabase command RPC | UUID + scoped RPC contract |
| `updateClubTier(tierId, input, commandId)` | `clubs.ts` | auth/tenant helpers | Supabase command RPC | UUID + scoped RPC contract |
| `deleteClubTier(tierId, commandId)` | `clubs.ts` | auth/tenant helpers | Supabase command RPC | UUID + scoped RPC contract |
| `listMembers(input)` | `members.ts` | auth/tenant helpers | Supabase | Scoped |
| `getMember(memberId)` | `members.ts` | auth/tenant helpers | Supabase activity joins | UUID + scoped |
| `createMember(input, commandId)` | `members.ts` | auth/tenant helpers, `recordDomainAnalyticsEvent` | Supabase command RPC, deferred Stripe side effect | UUID + scoped RPC contract |
| `updateMember(memberId, input, commandId)` | `members.ts` | auth/tenant helpers, analytics event | Supabase command RPC | UUID + scoped RPC contract |
| `deleteMember(memberId, commandId)` | `members.ts` | auth/tenant helpers | Supabase command RPC | UUID + scoped RPC contract |
| `transitionMember(memberId, status, commandId)` | `members.ts` | auth/tenant helpers, analytics event | Supabase command RPC | UUID + scoped RPC contract |
| `batchMembers(input)` | `members.ts` | auth/tenant helpers, analytics event | Supabase command RPC | UUID + RPC contract |
| `exportMembers(input)` | `members.ts` | `listMembers` | CSV encoder | Inherits `listMembers` scope |
| `previewMemberImport(input)` | `members.ts` | auth/tenant helpers | Supabase, CSV helpers | Scoped |
| `importMembers(input)` | `members.ts` | auth/tenant helpers | Supabase import RPC | Scoped RPC contract |
| `getMemberPortalHistory()` | `members.ts` | `requireMember` | Supabase | Scoped |
| `updateMemberPortalAddress(address, commandId)` | `members.ts` | `requireMember`, shipping validation | Supabase command RPC, EasyPost validation | UUID; provider factory guard; scoped RPC contract |
| `listReleases(input)` | `orders.ts` | auth/tenant helpers | Supabase | Scoped |
| `getRelease(releaseId)` | `orders.ts` | auth/tenant helpers | Supabase release/shipment joins | UUID + scoped |
| `createRelease(input, commandId, initialStatus?)` | `orders.ts` | auth/tenant helpers, `getRelease`, analytics event | Supabase command RPC | UUID + scoped RPC contract |
| `updateRelease(releaseId, input, commandId)` | `orders.ts` | auth/tenant helpers, `getRelease` | Supabase command RPC | UUID + scoped RPC contract |
| `scheduleRelease(releaseId, commandId)` | `orders.ts` | auth/tenant helpers, `getRelease`, analytics event | Supabase command RPC | UUID + scoped RPC contract |
| `processRelease(releaseId)` | `orders.ts` | auth/tenant helpers, `chargeShipment`, audit/analytics | Supabase, Stripe | `assertBrandOperationalAccess` + `assertStripeBillingAuthority`; scoped |
| `listRecoveryQueue()` | `stripe.ts` | auth/tenant helpers | Supabase | Scoped |
| `listShipments(input)` | `orders.ts` | auth/tenant helpers | Supabase | Scoped |
| `retryShipment(shipmentId)` | `stripe.ts` | auth/tenant helpers, `getPaymentShipment`, `chargeShipment` | Stripe | UUID + Stripe authority; tenant resolved before payment lookup |
| `refundShipment(shipmentId, input, commandId)` | `stripe.ts` | auth/tenant helpers | Supabase, Stripe | UUID + Stripe authority; scoped |
| `createMemberPaymentMethodPortal(input)` | `stripe.ts` | `requireMember`, application origin | Supabase, Stripe runtime | Stripe authority; scoped member principal |
| `validateShippingAddress(address)` | `easypost.ts` | provider validation helper | EasyPost | Factory activation guard |
| `generateShipmentLabels(shipmentIds)` | `orders.ts` | auth/tenant, compliance, audit/analytics | Supabase, ShipCompliant, EasyPost | Scoped; provider factory + compliance gate |
| `getPickList(releaseId)` | `orders.ts` | auth/tenant helpers | Supabase | UUID + scoped |
| `confirmShipmentPack(shipmentId, input)` | `orders.ts` | auth/tenant helpers | Supabase command RPC | UUID + RPC contract |
| `transitionShipment(shipmentId, input)` | `orders.ts` | auth/tenant helpers, analytics event | Supabase command RPC | UUID + RPC contract |

### `ProductionCoreClubService` shared/internal coupling

| Internal method group | Required by | Dependency direction |
|---|---|---|
| `authenticatedSurfaceClient`, `requireStaff`, `requireMember`, `audit`, `recordDomainAnalyticsEvent`, `organizationId`, `activeBrandId`, `assertLegacySingleBrandScope` | All core domains | Remain protected foundation in `members.ts`; downstream classes extend/import it |
| `yearToDateBottleCount`, compliance helpers | Label generation | `orders.ts` only |
| `validateShippingAddressWithProvider` | Member address + staff validation | `members.ts` and EasyPost facade; provider implementation in `easypost.ts` |
| `assertTenantEntity`, `assertReleaseTiers`, `replaceReleaseChildren` | Release mutations | `orders.ts` only |
| `getPaymentShipment`, `chargeShipment`, `recordPaymentOutcome`, `ensureBillingAttempt` | Release processing + retry | `stripe.ts`; `orders.ts` depends on Stripe service behavior |
| `coreApplicationOrigin` | Member payment portal | `stripe.ts` |

## `integrations.ts` exported symbols

### Top-level functions

| Export and signature | Destination | Internal dependencies | External dependencies | Activation / tenant audit |
|---|---|---|---|---|
| `normalizeMetaAttribution(input, allowedHostnames, now?): NormalizedMetaAttribution` | `webhooks.ts` | `normalizedAttributionText` | Meta browser-data normalizer | Pure validation; no provider/DB |
| `metaAttributionCustomData(customData, attribution): Record<...>` | `webhooks.ts` | None | None | Pure transform |
| `normalizeMobileClubCode(value?): string \| null` | `webhooks.ts` | None | None | Pure validation |
| `uniqueMobileClubBrandId(brands): string \| null` | `webhooks.ts` | None | None | Pure ambiguity guard |
| `providerMappingsFromSyncConfig(type, config)` | `webhooks.ts` | `configuredMappingValue` | Klaviyo/QuickBooks mapping contracts | Pure validation; no provider/DB |
| `contrastRatio(foreground, background): number` | `webhooks.ts` | `luminance` | None | Pure WCAG calculation |
| `evaluateThemeColor(background)` | `webhooks.ts` | `contrastRatio` | None | Pure WCAG calculation |
| `validatedTheme(input, current?)` | `webhooks.ts` | theme helpers | None | Pure validation |
| `appleAppSiteAssociation(env)` | `webhooks.ts` | Mobile identity data | Apple association contract | Configuration-required, no provider call |
| `androidAssetLinks(env)` | `webhooks.ts` | Mobile identity data | Android association contract | Configuration-required, fingerprint validation |
| `buildConfiguredKlaviyoProfile(row, mappings): KlaviyoProfile` | `comms.ts` | `klaviyoSourceValue` | Klaviyo contract | Pure transform |
| `configuredKlaviyoListIds(row, mappings): string[]` | `comms.ts` | None | Klaviyo contract | Pure transform |
| `unexplainedKlaviyoMissingProfiles(memberIds, ids, failed): string[]` | `comms.ts` | None | Klaviyo contract | Pure reconciliation |
| `resolveQuickBooksAccountMapping(mappings, kind, tierId)` | `webhooks.ts` | None | QuickBooks contract | Pure transform |
| `quickBooksShipmentFinancials(row, refunded)` | `webhooks.ts` | `quickBooksShipmentLineFinancials` | QuickBooks contract | Pure calculation |
| `quickBooksShipmentLineFinancials(row, cumulativeRefund?)` | `webhooks.ts` | `allocateCumulativeRefund` | QuickBooks contract | Pure calculation |
| `quickBooksRefundDeltaFinancials(row, prior, target)` | `webhooks.ts` | `quickBooksShipmentFinancials` | QuickBooks contract | Pure calculation |
| `quickBooksRefundDeltaLineFinancials(row, prior, target)` | `webhooks.ts` | `quickBooksShipmentLineFinancials` | QuickBooks contract | Pure calculation |
| `metaPurchaseValue(shipment): number` | `webhooks.ts` | None | Meta contract | Pure calculation |
| `integrationJobKind(integrationType, syncType): IntegrationJobKind` | `webhooks.ts` | None | Connector contracts | Pure dispatch |
| `executeIntegrationJob(env, admin, job): Promise<IntegrationJobCompletion>` | `webhooks.ts` | Provider job executors, `integrationJobKind` | Klaviyo, QuickBooks, Avalara, Meta | Per-provider runtime/activation validation occurs in provider resolution |
| `runIntegrationSchedule(env, asOf?): Promise<IntegrationDrainReport>` | `webhooks.ts` | enqueue + drain | Supabase | Claims authoritative jobs; provider guards delegated |
| `integrationWakeDelaySeconds(input): number \| null` | `webhooks.ts` | None | None | Pure calculation |
| `failedClaimedIntegrationJob(job, error, asOf)` | `webhooks.ts` | `failedIntegrationJob` | Connector completion contract | Pure calculation |
| `drainIntegrationJobs(env, asOf?, admin?, claimLimit?)` | `webhooks.ts` | claim, execute, wake-delay helpers | Supabase + all connectors | Provider guards delegated to job execution |
| `runMobilePushSchedule(env, asOf?)` | `comms.ts` | `integrationAdmin` | APNs, FCM | Present: clients constructed before claim; activation-required returns without burning attempts |

### `ProductionIntegrationService` public method manifest

| Public method | Destination | Direct `this` dependencies | External dependencies | Guard / scope |
|---|---|---|---|---|
| `getPortalBranding(hostname)` | `webhooks.ts` | admin client | Supabase | Hostname normalization; resolver RPC |
| `getMemberMetaPrivacy()` | `webhooks.ts` | member auth/client | Supabase | Scoped |
| `updateMemberMetaPrivacy(input)` | `webhooks.ts` | member auth, attribution hostname | Supabase, encrypted Meta attribution | UUID; consent path; scoped RPC contract |
| `getMetaAttributionReport(input)` | `webhooks.ts` | staff auth/tenant/client | Supabase | Scoped |
| `listIntegrations()` | `webhooks.ts` | staff auth/tenant/client | Supabase | Scoped |
| `connectIntegration(type, input)` | `webhooks.ts` | mapping/credential helpers, audit | Supabase, connector validation | Provider environment assertion; scoped command |
| `updateIntegration(type, input)` | `webhooks.ts` | connection/mapping/credential helpers | Supabase, connector validation | Provider environment assertion; scoped |
| `disconnectIntegration(type)` | `webhooks.ts` | connection/client/audit | Supabase | Scoped connection |
| `queueIntegrationSync(type)` | `webhooks.ts` | connection | Supabase | Active connection required |
| `queueAvalaraFilingVerification()` | `webhooks.ts` | connection | Supabase, Avalara | Active connection required |
| `listIntegrationLogs(type, limit)` | `webhooks.ts` | staff auth/tenant/client | Supabase | Scoped |
| `getQuickBooksAuthorizationUrl(brandId?)` | `webhooks.ts` | staff auth/tenant/client | QuickBooks | Environment + redirect configuration; scoped |
| `completeQuickBooksOAuth(input)` | `webhooks.ts` | credential storage | QuickBooks | Signed/expiring state + UUID checks |
| `getQuickBooksReconciliation()` | `webhooks.ts` | staff auth/tenant/client | Supabase | Scoped |
| `getAvalaraLiability()` | `webhooks.ts` | staff auth/tenant/client | Supabase | Scoped |
| `getAvalaraFilingStatus()` | `webhooks.ts` | connection/client | Supabase | Connection-scoped |
| `handleKlaviyoWebhook(integrationId, payload, headers)` | `comms.ts` | integration runtime | Klaviyo | UUID + signature verification; brand-bound runtime |
| `listBrands()` | `webhooks.ts` | staff auth/organization/client | Supabase | Organization-scoped |
| `createBrand(input)` | `clubs.ts` | staff auth/client/audit | Supabase | Organization command RPC |
| `updateBrand(brandId, input)` | `clubs.ts` | staff auth/client/audit | Supabase, Resend formatting, theme validation | UUID + scoped |
| `activateBrandSender(brandId)` | `comms.ts` | staff auth/tenant/client/audit | Resend Domains | UUID + provider configuration; scoped |
| `getBrandOverview(brandId?)` | `clubs.ts` | staff auth/scope/client | Supabase | Explicit all-brand authorization or scoped |
| `updateBrandDomain(brandId, hostname)` | `webhooks.ts` | tenant/domain client | Cloudflare custom hostnames | UUID + retry-safe provider ledger |
| `getBrandDomain(brandId)` | `webhooks.ts` | tenant/domain client | Cloudflare custom hostnames | UUID + scoped |
| `deleteBrandDomain(brandId)` | `webhooks.ts` | tenant/domain client | Cloudflare custom hostnames | UUID + retry-safe provider ledger |
| `requestMobileMagicLink(input)` | `webhooks.ts` | mobile brand/auth helpers | Supabase Auth | Redirect/config guards; brand-bound |
| `completeMobileMagicLink(input)` | `webhooks.ts` | auth/brand helpers | Supabase Auth | Signed/expiring state; brand-bound |
| `exchangeMobileSession(input)` | `webhooks.ts` | mobile response helper | Supabase | Redirect + UUID; RPC contract |
| `refreshMobileSession(input)` | `webhooks.ts` | mobile response helper | Supabase | UUID; RPC contract |
| `logoutMobileSession(input)` | `webhooks.ts` | None | Supabase | Hashed token RPC |
| `getMobileAppPolicy(input)` | `webhooks.ts` | None | Mobile config | Configuration-required |
| `getMobileBootstrap()` | `webhooks.ts` | member auth/client | Supabase | Explicit organization + brand scope on member, shipment, and loyalty reads (BS-06) |
| `registerMobileDevice(input)` | `comms.ts` | member auth, credential storage | Supabase, encrypted push token | Member/brand bound |
| `unregisterMobileDevice(deviceFingerprint)` | `comms.ts` | member auth | Supabase | Member/organization scoped |

### `ProductionIntegrationService` shared/internal coupling

| Internal method group | Required by | Dependency direction |
|---|---|---|
| Staff/member clients, active-brand resolution, organization helpers | All connector surfaces | Remain inherited from existing analytics/core chain |
| `connection`, credential storage/validation, provider mapping persistence, integration runtime | Connector commands and Klaviyo webhook | `webhooks.ts` owns connector foundation; `comms.ts` consumes it without importing routes |
| Custom-hostname client/persistence | Brand-domain methods | `webhooks.ts` |
| Mobile auth state/session helpers | Mobile methods | `webhooks.ts`; push token methods may call comms helpers |

## Extraction checks

For each destination:

1. Copy assigned bodies verbatim.
2. Keep only required imports.
3. Do not add a provider or database call.
4. Do not add, remove, rename, or reorder parameters.
5. Preserve all existing guards. Missing guards remain manifest findings only.
6. Add `// TODO(BS-08): add brand_id scoping — see rule 8` only when an
   extracted database operation demonstrably lacks both organization and brand
   context; do not change the query.
7. Run `npm run typecheck` after integration, then the full BS-03 suite.

## Integrated transition status

The extraction is integrated with the BS-02 route layer, BS-04 observability
and rate-limit boundary, and BS-06 tenancy hardening. `core-club.ts` and
`integrations.ts` contain only compatibility exports; production runtime and
route code imports the extracted owner directly. The only intentional
post-extraction service-body change is BS-06's five
`getMobileBootstrap()` organization/brand predicates in `webhooks.ts`, backed
by the focused cross-organization and same-organization/cross-brand test.
