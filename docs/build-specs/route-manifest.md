# BS-03 Route-to-Service Manifest

**Source revision:** `30fe29e`
**Purpose:** Record current consumers of `CoreClubService` and
`IntegrationService` before service extraction. BS-02 owns the complete route
decomposition; this companion manifest limits itself to BS-03 import and
service-method coupling.

## Current construction path

`server/app.ts` constructs `ProductionFoundationService`, whose inheritance
chain includes `ProductionIntegrationService`, `ProductionAnalyticsService`,
`ProductionRetentionService`, and `ProductionCoreClubService`. Routes request
the narrower `CoreClubService` or `IntegrationService` interface at runtime.

Only the well-known association handlers directly import exports from
`server/services/integrations.ts`. All other routes call an interface method,
so compatibility barrels must remain until BS-02 route modules are merged and
their imports can be updated without editing files owned by the open BS-02
branch.

## Core-club route consumers

| Route family | Service methods | Destination |
|---|---|---|
| `/api/club-tiers*` | `listClubTiers`, `createClubTier`, `updateClubTier`, `deleteClubTier`, `batchMembers` | `clubs.ts`, `members.ts` |
| `/api/members*` | `listMembers`, `createMember`, `exportMembers`, `previewMemberImport`, `importMembers`, `batchMembers`, `getMember`, `transitionMember`, `updateMember`, `deleteMember` | `members.ts` |
| `/api/releases*` | `listReleases`, `createRelease`, `getRelease`, `updateRelease`, `scheduleRelease`, `processRelease` | `orders.ts` |
| `/api/recovery` | `listRecoveryQueue` | `stripe.ts` |
| `/api/shipments*` | `listShipments`, `generateShipmentLabels`, `getPickList`, `confirmShipmentPack`, `retryShipment`, `refundShipment`, `transitionShipment` | `orders.ts`, `stripe.ts` |
| `/api/shipping/validate-address` | `validateShippingAddress` | `easypost.ts` facade through the core service class |
| `/api/member/shipments` | `getMemberPortalHistory` | `members.ts` |
| `/api/member/profile/address` | `updateMemberPortalAddress` | `members.ts` + `easypost.ts` |
| `/api/member/billing/portal` | `createMemberPaymentMethodPortal` | `stripe.ts` |

## Integration route consumers

| Route family | Service methods / exports | Destination |
|---|---|---|
| `/.well-known/*` | `appleAppSiteAssociation`, `androidAssetLinks` | `webhooks.ts` |
| `/api/portal/branding` | `getPortalBranding` | `webhooks.ts` |
| `/api/integrations*` | `listIntegrations`, `connectIntegration`, `updateIntegration`, `disconnectIntegration`, `queueIntegrationSync`, `listIntegrationLogs` | `webhooks.ts` |
| `/api/integrations/quickbooks*` | `getQuickBooksAuthorizationUrl`, `completeQuickBooksOAuth`, `getQuickBooksReconciliation` | `webhooks.ts` |
| `/api/integrations/avalara*` | `getAvalaraLiability`, `getAvalaraFilingStatus`, `queueAvalaraFilingVerification` | `webhooks.ts` |
| `/api/integrations/klaviyo/webhook*` | `handleKlaviyoWebhook` | `comms.ts` |
| `/api/brands*`, `/api/organization/overview` | `listBrands`, `createBrand`, `updateBrand`, `getBrandOverview` | `clubs.ts` compatibility surface |
| `/api/brands/:id/sender/verify` | `activateBrandSender` | `comms.ts` |
| `/api/brands/:id/domain*` | `updateBrandDomain`, `getBrandDomain`, `deleteBrandDomain` | `webhooks.ts` |
| `/api/auth/member/mobile*` | `requestMobileMagicLink`, `completeMobileMagicLink`, `exchangeMobileSession`, `refreshMobileSession`, `logoutMobileSession` | `webhooks.ts` |
| `/api/mobile/app-policy`, `/api/mobile/bootstrap` | `getMobileAppPolicy`, `getMobileBootstrap` | `webhooks.ts` |
| `/api/mobile/devices` | `registerMobileDevice`, `unregisterMobileDevice` | `comms.ts` |
| `/api/member/privacy/meta` | `getMemberMetaPrivacy`, `updateMemberMetaPrivacy` | `webhooks.ts` |

## BS-02 coordination rule

- Do not edit route files owned by the active BS-02 worktree.
- Keep compatibility exports in `core-club.ts` and `integrations.ts` while the
  BS-03 PR is open.
- After BS-02 merges, rebase BS-03, replace direct monolith imports in the new
  route modules with domain imports, and resolve this manifest in favor of the
  more complete BS-02 route audit if both branches changed the same file.
- Remove compatibility exports only when `rg
  'from.*services/(core-club|integrations)' server/routes` returns no matches
  and the full suite passes.
