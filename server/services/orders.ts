import { assertStripeBillingAuthority } from "../config";
import { AppError } from "../lib/errors";
import { assertUuid } from "../lib/utils";
import type {
  ComplianceStatus,
  CoreClubService,
  PostalAddress,
  ReleaseInput,
  ReleasePatchInput,
  ReleaseStatus,
  ShipmentStatus,
  StaffPrincipal,
  WorkerEnv,
} from "../types";
import {
  complianceRequestFingerprint,
  createComplianceProvider,
  permitsLabelGeneration,
  withAuditableComplianceId,
  type ComplianceCheckRequest,
  type ComplianceCheckResult,
} from "./compliance";
import {
  createShippingProvider,
  isCompleteShippingContact,
  type LabelRequest,
} from "./easypost";
import {
  commandError,
  commandResult,
  createAdminClient,
  databaseError,
  getAddress,
  oneRelation,
  rpcRecord,
  toPublicRecord,
  toPublicRelease,
  toPublicShipment,
  type ShipmentLabelRow,
} from "./members";
import {
  assertBrandOperationalAccess,
  chargeSystemShipment,
  CoreClubStripeService,
  createStripe,
  executeScheduledRetry,
  mapConcurrent,
  payableShipmentAmount,
  paymentIdempotencyKey,
  processMemberSideEffects,
  recoverRefundAttempt,
  requeueSystemAttempt,
  type CoreClubScheduleReport,
  type ProcessingAttemptRow,
  type ProcessingRefundAttemptRow,
  type ProcessingReleaseRow,
  type RefundRecoveryClaimRow,
  type ScheduledRetryRow,
  type ShipmentPaymentRow,
} from "./stripe";

export type {
  CoreClubScheduleReport,
  ProcessingReleaseRow,
} from "./stripe";

const RELEASE_LIST_LIMIT = 100;
const RELEASE_SHIPMENT_DETAIL_LIMIT = 500;

interface ShipmentComplianceContext {
  brandId: string;
  bottleCount: number;
  destination: PostalAddress;
  memberBirthday?: string | null;
  organizationId: string;
  origin: PostalAddress;
  recipientName: string;
  shipment: ShipmentLabelRow;
}

function parseOriginAddress(value: unknown): PostalAddress {
  const address = getAddress(value);
  if (!address) {
    throw new AppError(
      503,
      "activation_required",
      "A complete winery shipping origin must be configured before labels can be generated.",
    );
  }
  return address;
}

export class ProductionCoreClubService
  extends CoreClubStripeService
  implements CoreClubService
{
  private async yearToDateBottleCount(
    organizationId: string,
    brandId: string,
    memberId: string,
    checkedAt: Date,
  ): Promise<number> {
    const yearStart = new Date(
      Date.UTC(checkedAt.getUTCFullYear(), 0, 1),
    ).toISOString();
    const { data, error } = await this.admin
      .from("shipments")
      .select("shipment_items(quantity)")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("member_id", memberId)
      .gte("created_at", yearStart)
      .in("status", [
        "charged",
        "label_created",
        "packed",
        "shipped",
        "delivered",
      ]);
    if (error) {
      throw databaseError(
        "The member's year-to-date shipment volume could not be loaded.",
      );
    }
    return (data ?? []).reduce((shipmentTotal, shipment) => {
      const items = Array.isArray(shipment.shipment_items)
        ? shipment.shipment_items
        : shipment.shipment_items
          ? [shipment.shipment_items]
          : [];
      return (
        shipmentTotal +
        items.reduce(
          (itemTotal, item) =>
            itemTotal +
            Math.max(
              0,
              Number(
                item && typeof item === "object"
                  ? (item as Record<string, unknown>).quantity
                  : 0,
              ),
            ),
          0,
        )
      );
    }, 0);
  }

  protected async checkShipmentCompliance(
    principal: StaffPrincipal,
    context: ShipmentComplianceContext,
  ): Promise<{
    check: Record<string, unknown>;
    requestFingerprint: string;
    result: ComplianceCheckResult;
  }> {
    const checkedAt = new Date();
    const yearToDateBottleCount = await this.yearToDateBottleCount(
      context.organizationId,
      context.brandId,
      context.shipment.member_id,
      checkedAt,
    );
    const request: ComplianceCheckRequest = {
      destination: context.destination,
      organizationId: context.organizationId,
      origin: context.origin,
      recipient: {
        dateOfBirth: context.memberBirthday,
        name: context.recipientName,
      },
      shipment: {
        bottleCount: context.bottleCount,
        chargeAmountCents: payableShipmentAmount(context.shipment),
        id: context.shipment.id,
        yearToDateBottleCount,
      },
    };
    const requestFingerprint = await complianceRequestFingerprint(
      request,
      checkedAt,
    );
    let result: ComplianceCheckResult;
    try {
      result = await createComplianceProvider(this.env).checkShipment(request);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "activation_required"
      ) {
        throw error;
      }
      result = {
        checkedAt: checkedAt.toISOString(),
        evidence: {
          ageVerified: null,
          originToRecipientAllowed: null,
          recipientStateAllowed: null,
          rulesVersion: null,
          volumeWithinLimit: null,
        },
        provider:
          this.env.COMPLIANCE_PROVIDER === "simulated"
            ? "simulated"
            : "shipcompliant",
        providerResponseId: null,
        reason: "The compliance provider could not return a verified decision.",
        status: "unknown",
        taxEstimateCents: null,
      };
    }
    result = withAuditableComplianceId(
      result,
      () => requestFingerprint.slice(0, 32),
    );
    const { data, error } = await this.admin.rpc(
      "record_shipment_compliance_check",
      {
        p_actor_user_id: principal.user.id,
        p_brand_id: context.brandId,
        p_checked_at: result.checkedAt,
        p_metadata: {
          age_verified: result.evidence.ageVerified,
          bottle_count: context.bottleCount,
          contract_version:
            result.provider === "shipcompliant"
              ? this.env.SHIPCOMPLIANT_CONTRACT_VERSION
              : "test-simulator-v1",
          destination_country: context.destination.country.toUpperCase(),
          destination_region: context.destination.state.toUpperCase(),
          origin_to_recipient_allowed:
            result.evidence.originToRecipientAllowed,
          provider: result.provider,
          provider_response_is_local:
            result.providerResponseId?.startsWith("local-") ?? false,
          recipient_state_allowed:
            result.evidence.recipientStateAllowed,
          request_fingerprint_sha256: requestFingerprint,
          rules_version: result.evidence.rulesVersion,
          volume_within_limit: result.evidence.volumeWithinLimit,
          year_to_date_bottle_count: yearToDateBottleCount,
        },
        p_organization_id: context.organizationId,
        p_provider: result.provider,
        p_provider_response_id: result.providerResponseId,
        p_reason: result.reason,
        p_shipment_id: context.shipment.id,
        p_status: result.status,
        p_tax_estimate_cents: result.taxEstimateCents,
      },
    );
    if (error) {
      throw databaseError("The compliance decision could not be persisted.");
    }
    const row =
      Array.isArray(data) && data.length
        ? data[0]
        : data && typeof data === "object"
          ? data
          : {
              checked_at: result.checkedAt,
              provider: result.provider,
              provider_response_id: result.providerResponseId,
              reason: result.reason,
              shipment_id: context.shipment.id,
              status: result.status,
              tax_estimate_cents: result.taxEstimateCents,
            };
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        provider: result.provider,
        status: result.status,
        taxEstimateCents: result.taxEstimateCents,
      },
      eventType: "shipment.compliance_checked",
      memberId: context.shipment.member_id,
      requestKey: `compliance:${context.shipment.id}:${result.providerResponseId}`,
    });
    return {
      check: toPublicRecord(row),
      requestFingerprint,
      result,
    };
  }

  protected complianceBlock(
    status: Exclude<ComplianceStatus, "compliant">,
    reason: string | null,
  ): AppError {
    return new AppError(
      409,
      "conflict",
      status === "non_compliant"
        ? reason || "ShipCompliant blocked this alcohol shipment."
        : reason ||
            "No verified compliance decision is available, so the alcohol label is blocked.",
    );
  }

  protected async checkStoredShipmentCompliance(
    principal: StaffPrincipal,
    shipmentId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const [{ data: organization, error: organizationError }, shipmentResult] =
      await Promise.all([
        this.admin
          .from("organizations")
          .select("name,shipping_origin_address")
          .eq("id", organizationId)
          .single(),
        this.admin
          .from("shipments")
          .select(
            "id,organization_id,brand_id,member_id,release_id,status,shipping_address,charge_amount_cents,loyalty_discount_cents,retry_count,members!inner(id,organization_id,brand_id,email,first_name,last_name,phone,birthday),shipment_items(*)",
          )
          .eq("id", shipmentId)
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .maybeSingle(),
      ]);
    if (organizationError || !organization) {
      throw databaseError("The winery shipping settings could not be loaded.");
    }
    if (shipmentResult.error) {
      throw databaseError("The shipment could not be loaded.");
    }
    if (!shipmentResult.data) {
      throw new AppError(404, "not_found", "Shipment not found.");
    }
    const shipment = shipmentResult.data as ShipmentLabelRow;
    if (shipment.status !== "charged") {
      throw new AppError(
        409,
        "conflict",
        "Operational compliance checks run only after charge and before label generation.",
      );
    }
    const destination = getAddress(shipment.shipping_address);
    if (!destination) {
      throw new AppError(
        409,
        "conflict",
        "A complete member shipping address is required.",
      );
    }
    const validation =
      await createShippingProvider(this.env).validateAddress(destination);
    if (!validation.valid) {
      throw new AppError(
        409,
        "conflict",
        validation.messages.join(" ") || "The shipping address is invalid.",
      );
    }
    const { data: preparedShipment, error: preparationError } =
      await this.admin.rpc("set_validated_shipment_address", {
        p_actor_user_id: principal.user.id,
        p_organization_id: organizationId,
        p_shipment_id: shipment.id,
        p_validated_address: {
          city: validation.address.city,
          country_code: validation.address.country,
          line1: validation.address.line1,
          line2: validation.address.line2,
          postal_code: validation.address.postalCode,
          region: validation.address.state,
        },
        p_validation_messages: validation.messages,
        p_validation_status: "valid",
      });
    if (preparationError) {
      throw databaseError(
        "The validated shipping address could not be persisted.",
      );
    }
    if (!preparedShipment) {
      throw new AppError(
        409,
        "conflict",
        "The shipment changed before its validated address could be prepared.",
      );
    }
    const origin = parseOriginAddress(organization.shipping_origin_address);
    const member = oneRelation(shipment.members);
    const recipientName =
      typeof shipment.shipping_address?.name === "string"
        ? shipment.shipping_address.name.trim()
        : `${member?.first_name ?? ""} ${member?.last_name ?? ""}`.trim();
    if (!recipientName) {
      throw new AppError(
        409,
        "conflict",
        "A recipient name is required for compliance verification.",
      );
    }
    const bottleCount = Math.max(
      1,
      (shipment.shipment_items ?? []).reduce(
        (total, item) => total + Math.max(0, Number(item.quantity ?? 0)),
        0,
      ),
    );
    const decision = await this.checkShipmentCompliance(principal, {
      brandId,
      bottleCount,
      destination: validation.address,
      memberBirthday: member?.birthday,
      organizationId,
      origin,
      recipientName,
      shipment,
    });
    return {
      ...decision.check,
      blocksLabel: decision.result.status !== "compliant",
      provider: decision.result.provider,
      providerResponseId: decision.result.providerResponseId,
      reason: decision.result.reason,
      requestFingerprint: decision.requestFingerprint,
      status: decision.result.status,
      taxEstimateCents: decision.result.taxEstimateCents,
    };
  }

  async listReleases(input: {
    from?: string;
    status?: ReleaseStatus;
    to?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("releases")
      .select(
        "*,release_tiers(*),release_wines(*,release_tier_items(quantity,unit_price_cents,release_tier_id)),shipments(status,charge_amount_cents)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (input.status) query = query.eq("status", input.status);
    if (input.from) query = query.gte("processing_date", input.from);
    if (input.to) query = query.lte("processing_date", input.to);
    const { data, error } = await query
      .order("processing_date", { ascending: false })
      .limit(RELEASE_LIST_LIMIT)
      .limit(RELEASE_SHIPMENT_DETAIL_LIMIT, {
        referencedTable: "shipments",
      });
    if (error) throw databaseError("Releases could not be loaded.");
    return (data ?? []).map(toPublicRelease);
  }

  async getRelease(releaseId: string): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("releases")
      .select(
        "*,release_tiers(*),release_wines(*,release_tier_items(quantity,unit_price_cents,release_tier_id)),shipments(*,members(id,first_name,last_name,email),shipment_items(*))",
      )
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .limit(RELEASE_SHIPMENT_DETAIL_LIMIT, {
        referencedTable: "shipments",
      })
      .maybeSingle();
    if (error) throw databaseError("The release could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Release not found.");
    return toPublicRelease(data);
  }

  async createRelease(
    input: ReleaseInput,
    commandId: string,
    initialStatus: "draft" | "scheduled" = "draft",
  ): Promise<Record<string, unknown>> {
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("apply_release_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "create",
      p_organization_id: organizationId,
      p_payload: {
        description: input.description ?? "",
        embargo_date: input.embargoDate,
        initial_status: initialStatus,
        name: input.name,
        processing_date: input.processingDate,
        tiers: input.tierPrices.map((tier) => ({
          price_cents: tier.priceCents,
          tier_id: tier.tierId,
        })),
        wines: input.wines.map((wine) => ({
          price_cents: wine.priceCents,
          quantity: wine.quantity,
          wine_name: wine.wineName,
        })),
      },
      p_release_id: null,
    });
    if (error) {
      throw commandError(error, "The release could not be created.");
    }
    const result = commandResult(data);
    const releaseId = String(result.entityId ?? "");
    assertUuid(releaseId, "Release");
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        initialStatus,
        tier_count: input.tierIds.length,
        wine_count: input.wines.length,
      },
      eventType: "release.created",
      requestKey: `release:${releaseId}:created:${commandId}`,
    });
    if (initialStatus === "scheduled") {
      console.info(
        JSON.stringify({
          event: "release.notification.stub",
          organizationId,
          processingDate: input.processingDate,
          releaseId,
        }),
      );
    }
    return { ...(await this.getRelease(releaseId)), command: result };
  }

  async updateRelease(
    releaseId: string,
    input: ReleasePatchInput,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const current = await this.getRelease(releaseId);
    const currentWines =
      (current.wines as Array<Record<string, unknown>> | undefined) ?? [];
    const currentWinePrices = new Map(
      currentWines
        .filter((wine) => typeof wine.id === "string")
        .map((wine) => [String(wine.id), Number(wine.priceCents)]),
    );
    const completeWines = input.wines
      ? input.wines.map((wine) => {
          const existingWineId =
            wine.id !== undefined && currentWinePrices.has(wine.id)
              ? wine.id
              : undefined;
          if (wine.priceCents !== undefined) {
            return {
              ...(existingWineId ? { id: existingWineId } : {}),
              priceCents: wine.priceCents,
              quantity: wine.quantity,
              wineName: wine.wineName,
            };
          }
          const storedPrice =
            existingWineId === undefined
              ? undefined
              : currentWinePrices.get(existingWineId);
          if (storedPrice === undefined) {
            throw new AppError(
              400,
              "invalid_request",
              "Each new or unknown wine needs an explicit price.",
            );
          }
          return {
            id: existingWineId,
            priceCents: storedPrice,
            quantity: wine.quantity,
            wineName: wine.wineName,
          };
        })
      : currentWines.map((row) => ({
          ...(typeof row.id === "string" ? { id: row.id } : {}),
          priceCents: Number(row.priceCents),
          quantity: Number(row.quantity),
          wineName: String(row.name),
        }));
    const completeInput = {
      description:
        Object.prototype.hasOwnProperty.call(input, "description")
          ? input.description ?? null
          : typeof current.description === "string"
            ? current.description
            : null,
      embargoDate:
        input.embargoDate ??
        (typeof current.embargoDate === "string" ? current.embargoDate : ""),
      name:
        input.name ?? (typeof current.name === "string" ? current.name : ""),
      processingDate:
        input.processingDate ??
        (typeof current.processingDate === "string" ? current.processingDate : ""),
      tierIds:
        input.tierIds ??
        (((current.tiers as Array<Record<string, unknown>> | undefined) ?? [])
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string")),
      tierPrices:
        input.tierPrices ??
        (((current.tiers as Array<Record<string, unknown>> | undefined) ?? []).map(
          (row) => ({
            priceCents: Number(row.priceCents),
            tierId: String(row.id),
          }),
        )),
      wines: completeWines,
    };
    const { data, error } = await this.admin.rpc("apply_release_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "update",
      p_organization_id: organizationId,
      p_payload: {
        description: completeInput.description ?? "",
        embargo_date: completeInput.embargoDate,
        name: completeInput.name,
        processing_date: completeInput.processingDate,
        tiers: completeInput.tierPrices.map((tier) => ({
          price_cents: tier.priceCents,
          tier_id: tier.tierId,
        })),
        wines: completeInput.wines.map((wine) => ({
          ...("id" in wine && wine.id ? { wine_id: wine.id } : {}),
          price_cents: wine.priceCents,
          quantity: wine.quantity,
          wine_name: wine.wineName,
        })),
      },
      p_release_id: releaseId,
    });
    if (error) throw commandError(error, "The release could not be updated.");
    const result = commandResult(data);
    return { ...(await this.getRelease(releaseId)), command: result };
  }

  async scheduleRelease(
    releaseId: string,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("apply_release_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "schedule",
      p_organization_id: organizationId,
      p_payload: {},
      p_release_id: releaseId,
    });
    if (error) throw commandError(error, "The release could not be scheduled.");
    const result = commandResult(data);
    const release = await this.getRelease(releaseId);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: { processingDate: String(release.processingDate) },
      eventType: "release.scheduled",
      requestKey: `release:${releaseId}:scheduled:${commandId}`,
    });
    console.info(
      JSON.stringify({
        event: "release.notification.stub",
        organizationId,
        processingDate: release.processingDate,
        releaseId,
      }),
    );
    return { ...release, command: result };
  }

  async processRelease(releaseId: string): Promise<{
    charged: number;
    declined: number;
    releaseId: string;
    skipped: number;
  }> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    await assertBrandOperationalAccess(this.admin, organizationId, brandId);
    assertStripeBillingAuthority(this.env);
    const stripe = createStripe(this.env);
    const { error: createError } = await this.admin.rpc("create_release_shipments", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_organization_id: organizationId,
      p_release_id: releaseId,
    });
    if (createError) {
      console.error(
        JSON.stringify({
          code: createError.code ?? "upstream_error",
          event: "release.shipment_preparation_failed",
          organizationId,
          releaseId,
          resumable: false,
        }),
      );
      throw commandError(
        createError,
        "Release shipments could not be prepared transactionally.",
      );
    }
    const { data: shipments, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("release_id", releaseId)
      .eq("status", "pending");
    if (error) throw databaseError("Release shipments could not be loaded.");

    const results = await mapConcurrent(
      (shipments ?? []) as ShipmentPaymentRow[],
      5,
      async (shipment) => {
        try {
          return await this.chargeShipment(
            stripe,
            shipment,
            principal,
            "release_processing",
          );
        } catch (error) {
          console.error(
            JSON.stringify({
              code: error instanceof AppError ? error.code : "upstream_error",
              event: "release.shipment_charge_failed",
              organizationId,
              releaseId,
              shipmentId: shipment.id,
            }),
          );
          return "skipped" as const;
        }
      },
    );
    const summary = {
      charged: results.filter((result) => result === "charged").length,
      declined: results.filter((result) => result === "declined").length,
      releaseId,
      skipped: results.filter((result) => result === "skipped").length,
    };
    await this.audit(principal, "release.processed", "release", releaseId, summary);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        charged: summary.charged,
        declined: summary.declined,
        skipped: summary.skipped,
      },
      eventType: "release.processed",
      requestKey: `release:${releaseId}:processed`,
    });
    return summary;
  }

  async listShipments(input: {
    limit: number;
    offset: number;
    releaseId?: string;
    search?: string;
    status?: ShipmentStatus;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("shipments")
      .select(
        "id,member_id,release_id,status,shipping_address,tracking_number,carrier,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,decline_reason,retry_count,next_retry_at,created_at,updated_at,members(first_name,last_name,email),releases(name),release_tiers(tier_name),shipment_items(id,wine_name,quantity,price_cents)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (input.releaseId) query = query.eq("release_id", input.releaseId);
    if (input.status) query = query.eq("status", input.status);
    if (input.search) {
      const search = input.search.replaceAll("%", "\\%").replaceAll(",", "");
      const [{ data: members }, { data: releases }] = await Promise.all([
        this.admin
          .from("members")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .or(
            `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`,
          )
          .limit(100),
        this.admin
          .from("releases")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .ilike("name", `%${search}%`)
          .limit(100),
      ]);
      const filters = [`tracking_number.ilike.%${search}%`];
      if (members?.length) {
        filters.push(`member_id.in.(${members.map((member) => member.id).join(",")})`);
      }
      if (releases?.length) {
        filters.push(
          `release_id.in.(${releases.map((release) => release.id).join(",")})`,
        );
      }
      query = query.or(filters.join(","));
    }
    const { count, data, error } = await query
      .order("created_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);
    if (error) throw databaseError("Shipments could not be loaded.");
    return {
      items: (data ?? []).map(toPublicShipment),
      total: count ?? 0,
    };
  }

  async generateShipmentLabels(shipmentIds: string[]): Promise<{
    failed: number;
    generated: number;
    results: Array<Record<string, unknown>>;
  }> {
    if (!shipmentIds.length || shipmentIds.length > 100) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose between 1 and 100 shipments for label generation.",
      );
    }
    shipmentIds.forEach((shipmentId) => assertUuid(shipmentId, "Shipment"));
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const provider = createShippingProvider(this.env);
    const { data: organization, error: organizationError } = await this.admin
      .from("organizations")
      .select("name,shipping_origin_address")
      .eq("id", organizationId)
      .single();
    if (organizationError || !organization) {
      throw databaseError("The winery shipping settings could not be loaded.");
    }
    const fromAddress = parseOriginAddress(organization.shipping_origin_address);
    const originConfig =
      organization.shipping_origin_address &&
      typeof organization.shipping_origin_address === "object"
        ? (organization.shipping_origin_address as Record<string, unknown>)
        : {};
    const originName =
      typeof originConfig.name === "string" && originConfig.name.trim()
        ? originConfig.name.trim()
        : String(organization.name ?? "").trim();
    const originCompany =
      typeof originConfig.company === "string" && originConfig.company.trim()
        ? originConfig.company.trim()
        : String(organization.name ?? "").trim();
    const originPhone =
      typeof originConfig.phone === "string" ? originConfig.phone.trim() : "";
    if (
      !isCompleteShippingContact(
        {
          company: originCompany,
          name: originName,
          phone: originPhone,
        },
        true,
      )
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Complete the winery shipping origin name, company, and phone before generating alcohol labels.",
      );
    }
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,brand_id,member_id,release_id,status,shipping_address,charge_amount_cents,loyalty_discount_cents,retry_count,members!inner(id,organization_id,brand_id,email,first_name,last_name,phone,birthday),shipment_items(*)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .in("id", shipmentIds);
    if (error) throw databaseError("Shipments could not be loaded.");
    const foundIds = new Set((data ?? []).map((shipment) => String(shipment.id)));
    const missingResults = shipmentIds
      .filter((shipmentId) => !foundIds.has(shipmentId))
      .map((shipmentId) => ({
        error: { code: "not_found", message: "Shipment not found." },
        shipmentId,
        success: false,
      }));
    const results = await mapConcurrent(
      (data ?? []) as ShipmentLabelRow[],
      5,
      async (shipment): Promise<Record<string, unknown>> => {
        try {
          if (shipment.status !== "charged") {
            throw new AppError(
              409,
              "conflict",
              "Only successfully charged shipments can receive labels.",
            );
          }
          const member = oneRelation(shipment.members);
          const toAddress = getAddress(shipment.shipping_address);
          if (!toAddress) {
            throw new AppError(
              409,
              "conflict",
              "A complete member shipping address is required.",
            );
          }
          const validation = await provider.validateAddress(toAddress);
          if (!validation.valid) {
            throw new AppError(
              409,
              "conflict",
              validation.messages.join(" ") || "The shipping address is invalid.",
            );
          }
          const validatedShippingAddress = {
            city: validation.address.city,
            country_code: validation.address.country,
            line1: validation.address.line1,
            line2: validation.address.line2,
            postal_code: validation.address.postalCode,
            region: validation.address.state,
          };
          // Persist the normalized address while the shipment is still charged.
          // The database invalidates any earlier decision here, then the
          // compliance RPC fingerprints this exact immutable pre-label state.
          const { data: preparedShipment, error: preparationError } =
            await this.admin.rpc("set_validated_shipment_address", {
              p_actor_user_id: principal.user.id,
              p_organization_id: organizationId,
              p_shipment_id: shipment.id,
              p_validated_address: validatedShippingAddress,
              p_validation_messages: validation.messages,
              p_validation_status: "valid",
            });
          if (preparationError) {
            throw databaseError(
              "The validated shipping address could not be persisted.",
            );
          }
          if (!preparedShipment) {
            throw new AppError(
              409,
              "conflict",
              "The shipment changed before its validated address could be prepared.",
            );
          }
          const items = shipment.shipment_items ?? [];
          const bottleCount = Math.max(
            1,
            items.reduce(
              (total, item) => total + Number(item.quantity ?? 0),
              0,
            ),
          );
          const recipientName =
            typeof shipment.shipping_address?.name === "string"
              ? shipment.shipping_address.name.trim()
              : `${member?.first_name ?? ""} ${member?.last_name ?? ""}`.trim();
          const recipientPhone =
            typeof shipment.shipping_address?.phone === "string"
              ? shipment.shipping_address.phone.trim()
              : String(member?.phone ?? "").trim();
          if (
            !isCompleteShippingContact({
              name: recipientName,
              phone: recipientPhone,
            })
          ) {
            throw new AppError(
              409,
              "conflict",
              "The member needs a recipient name and phone before an adult-signature label can be generated.",
            );
          }
          const compliance = await this.checkShipmentCompliance(principal, {
            brandId,
            bottleCount,
            destination: validation.address,
            memberBirthday: member?.birthday,
            organizationId,
            origin: fromAddress,
            recipientName,
            shipment,
          });
          if (!permitsLabelGeneration(compliance.result.status)) {
            const block = this.complianceBlock(
              compliance.result.status,
              compliance.result.reason,
            );
            return {
              compliance: compliance.check,
              error: {
                code: block.code,
                message: block.message,
                reason: compliance.result.reason,
                status: compliance.result.status,
              },
              shipmentId: shipment.id,
              success: false,
            };
          }
          const labelRequest: LabelRequest = {
            externalId: shipment.id,
            fromAddress,
            fromContact: {
              company: originCompany,
              name: originName,
              phone: originPhone,
            },
            parcel: {
              heightInches: 6,
              lengthInches: 14,
              weightOunces: bottleCount * 48,
              widthInches: 12,
            },
            toAddress: validation.address,
            toContact: {
              name: recipientName,
              phone: recipientPhone,
            },
          };
          {
            const { data: attemptData, error: attemptError } =
              await this.admin.rpc("acquire_shipping_label_attempt", {
                p_actor_user_id: principal.user.id,
                p_lease_seconds: 300,
                p_organization_id: organizationId,
                p_provider: this.env.SHIPPING_PROVIDER,
                p_shipment_id: shipment.id,
                p_worker_id: `staff:${principal.user.id}`,
              });
            if (attemptError) {
              throw databaseError(
                "A durable shipping label attempt could not be acquired.",
              );
            }
            const attempt = rpcRecord(attemptData);
            const disposition = String(attempt.disposition ?? "");
            if (disposition === "succeeded") {
              const providerMetadata =
                attempt.providerMetadata &&
                typeof attempt.providerMetadata === "object"
                  ? (attempt.providerMetadata as Record<string, unknown>)
                  : {};
              await this.recordDomainAnalyticsEvent(principal, {
                eventData: {
                  carrier: String(attempt.carrier ?? "unknown"),
                  provider: String(attempt.provider ?? "unknown"),
                  rateCents: Number(attempt.labelCostCents ?? 0),
                },
                eventType: "shipment.label_created",
                memberId: shipment.member_id,
                requestKey: `label:${shipment.id}:${String(attempt.externalLabelId)}`,
              });
              return {
                label: {
                  carrier: attempt.carrier,
                  labelId: attempt.externalLabelId,
                  labelUrl: attempt.labelUrl,
                  providerReference: attempt.externalShipmentId,
                  rateId: attempt.externalRateId,
                  rateCents: Number(attempt.labelCostCents ?? 0),
                  service:
                    typeof providerMetadata.service === "string"
                      ? providerMetadata.service
                      : "Recovered",
                  trackingNumber: attempt.trackingNumber,
                },
                recovered: true,
                shipmentId: shipment.id,
                success: true,
              };
            }
            if (disposition === "in_progress") {
              throw new AppError(
                409,
                "conflict",
                "Another worker is already purchasing this shipment label.",
              );
            }
            const attemptId = String(attempt.attemptId ?? "");
            const leaseToken = String(attempt.leaseToken ?? "");
            if (
              !attemptId ||
              !leaseToken ||
              ![
                "create_shipment",
                "recover_purchase",
                "reconcile",
              ].includes(disposition)
            ) {
              throw new AppError(
                409,
                "conflict",
                "The shipping label attempt requires reconciliation before another purchase.",
              );
            }
            let externalShipmentPersisted = Boolean(
              attempt.externalShipmentId,
            );
            try {
              const label = await provider.createLabel(
                {
                  ...labelRequest,
                  externalId: String(attempt.correlationReference),
                },
                {
                externalRateId:
                  typeof attempt.externalRateId === "string"
                    ? attempt.externalRateId
                    : null,
                externalShipmentId:
                  typeof attempt.externalShipmentId === "string"
                    ? attempt.externalShipmentId
                    : null,
                persistExternalShipment: async (
                  externalShipmentId,
                  externalRateId,
                ) => {
                  const { error: persistError } = await this.admin.rpc(
                    "persist_shipping_label_external_shipment",
                    {
                      p_attempt_id: attemptId,
                      p_external_rate_id: externalRateId,
                      p_external_shipment_id: externalShipmentId,
                      p_lease_token: leaseToken,
                    },
                  );
                  if (persistError) {
                    throw databaseError(
                      "The external carrier shipment could not be persisted before purchase.",
                    );
                  }
                  externalShipmentPersisted = true;
                },
                },
              );
              const { error: completionError } = await this.admin.rpc(
                "complete_shipping_label_attempt",
                {
                  p_attempt_id: attemptId,
                  p_carrier: label.carrier,
                  p_error_message: null,
                  p_external_label_id: label.labelId,
                  p_label_cost_cents: label.rateCents,
                  p_label_url: label.labelUrl,
                  p_lease_token: leaseToken,
                  p_outcome: "succeeded",
                  p_provider_metadata: {
                    label_format: "PDF",
                    service: label.service,
                  },
                  p_tracking_number: label.trackingNumber,
                },
              );
              if (completionError) {
                throw databaseError(
                  "The purchased carrier label could not be committed.",
                );
              }
              await this.recordDomainAnalyticsEvent(principal, {
                eventData: {
                  carrier: label.carrier,
                  provider: this.env.SHIPPING_PROVIDER ?? "unknown",
                  rateCents: label.rateCents,
                },
                eventType: "shipment.label_created",
                memberId: shipment.member_id,
                requestKey: `label:${shipment.id}:${label.labelId}`,
              });
              return { label, shipmentId: shipment.id, success: true };
            } catch (error) {
              await this.admin.rpc("complete_shipping_label_attempt", {
                p_attempt_id: attemptId,
                p_carrier: null,
                p_error_message: externalShipmentPersisted
                  ? "Carrier purchase outcome requires reconciliation."
                  : "Carrier shipment creation failed before persistence.",
                p_external_label_id: null,
                p_label_cost_cents: null,
                p_label_url: null,
                p_lease_token: leaseToken,
                p_outcome: externalShipmentPersisted
                  ? "indeterminate"
                  : "failed",
                p_provider_metadata: {},
                p_tracking_number: null,
              });
              throw error;
            }
          }
        } catch (error) {
          return {
            error:
              error instanceof AppError
                ? { code: error.code, message: error.message }
                : { code: "upstream_error", message: "Label generation failed." },
            shipmentId: shipment.id,
            success: false,
          };
        }
      },
    );
    results.push(...missingResults);
    const summary = {
      failed: results.filter((result) => !result.success).length,
      generated: results.filter((result) => result.success).length,
      results,
    };
    await this.audit(
      principal,
      "shipment.labels_generated",
      "organization",
      organizationId,
      {
      failed: summary.failed,
      generated: summary.generated,
      shipment_ids: shipmentIds,
      },
    );
    return summary;
  }

  async getPickList(releaseId: string): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,status,members(first_name,last_name),shipment_items(id,wine_name,quantity,packed_quantity,barcode)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("release_id", releaseId)
      .in("status", ["charged", "label_created", "packed", "shipped"]);
    if (error) throw databaseError("The pick list could not be generated.");
    const shipments = (data ?? []).map(toPublicRecord);
    return {
      generatedAt: new Date().toISOString(),
      releaseId,
      shipmentCount: shipments.length,
      shipments,
    };
  }

  async confirmShipmentPack(
    shipmentId: string,
    input: { barcode: string },
  ): Promise<{ complete: boolean; packedItems: number; status: ShipmentStatus }> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("confirm_shipment_item_pack", {
      p_actor_user_id: principal.user.id,
      p_barcode: input.barcode,
      p_organization_id: organizationId,
      p_shipment_id: shipmentId,
    });
    if (error) {
      throw new AppError(
        error.code === "P0002" ? 404 : 409,
        error.code === "P0002" ? "not_found" : "conflict",
        "The barcode could not be confirmed for this shipment.",
      );
    }
    const result = Array.isArray(data) ? data[0] : data;
    return {
      complete: Boolean(result?.complete),
      packedItems: Number(result?.packed_items ?? 0),
      status: (result?.status ?? "label_created") as ShipmentStatus,
    };
  }

  async transitionShipment(
    shipmentId: string,
    input: {
      carrier?: string;
      status: "shipped" | "delivered" | "cancelled";
      trackingNumber?: string;
    },
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("transition_shipment", {
      p_actor_user_id: principal.user.id,
      p_carrier: input.carrier ?? null,
      p_metadata: {},
      p_organization_id: organizationId,
      p_shipment_id: shipmentId,
      p_target_status: input.status,
      p_tracking_number: input.trackingNumber ?? null,
    });
    if (error) {
      throw new AppError(409, "conflict", "That shipment status change is not allowed.");
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (input.status === "shipped" || input.status === "delivered") {
      await this.recordDomainAnalyticsEvent(principal, {
        eventData: { status: input.status },
        eventType:
          input.status === "shipped"
            ? "shipment.shipped"
            : "shipment.delivered",
        requestKey: `shipment:${shipmentId}:${input.status}`,
      });
    }
    return { id: shipmentId, status: result };
  }

  private async assertTenantEntity(
    table: string,
    id: string,
    organizationId: string,
    brandId: string,
    label: string,
  ): Promise<void> {
    assertUuid(id, label);
    const { data, error } = await this.admin
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError(`${label} could not be validated.`);
    if (!data) throw new AppError(404, "not_found", `${label} not found.`);
  }

  private async assertReleaseTiers(
    input: ReleaseInput,
    organizationId: string,
    brandId: string,
  ): Promise<void> {
    const uniqueTierIds = new Set(input.tierIds);
    if (uniqueTierIds.size !== input.tierIds.length) {
      throw new AppError(400, "invalid_request", "Release tiers must be unique.");
    }
    if (new Set(input.tierPrices.map((price) => price.tierId)).size !== uniqueTierIds.size) {
      throw new AppError(
        400,
        "invalid_request",
        "Each participating tier needs one release price.",
      );
    }
    if (
      input.tierPrices.some((price) => !uniqueTierIds.has(price.tierId))
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Release prices must belong to participating tiers.",
      );
    }
    const { data, error } = await this.admin
      .from("club_tiers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .in("id", input.tierIds);
    if (error) throw databaseError("Release tiers could not be validated.");
    if ((data ?? []).length !== uniqueTierIds.size) {
      throw new AppError(404, "not_found", "One or more club tiers were not found.");
    }
  }

  private async replaceReleaseChildren(
    releaseId: string,
    organizationId: string,
    brandId: string,
    input: ReleaseInput,
  ): Promise<void> {
    const tables = ["release_tier_items", "release_wines", "release_tiers"];
    for (const table of tables) {
      const { error } = await this.admin
        .from(table)
        .delete()
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("release_id", releaseId);
      if (error) throw databaseError("Release details could not be replaced.");
    }
    const { data: releaseTiers, error: tiersError } = await this.admin
      .from("release_tiers")
      .insert(
        input.tierIds.map((tierId) => ({
          brand_id: brandId,
          organization_id: organizationId,
          release_id: releaseId,
          tier_id: tierId,
        })),
      )
      .select("id,tier_id");
    if (tiersError || !releaseTiers) {
      throw databaseError("Release tiers could not be saved.");
    }
    for (const price of input.tierPrices) {
      const { error } = await this.admin
        .from("release_tiers")
        .update({ price_cents: price.priceCents })
        .eq("release_id", releaseId)
        .eq("tier_id", price.tierId)
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId);
      if (error) throw databaseError("Release tier pricing could not be saved.");
    }
    const { data: releaseWines, error: winesError } = await this.admin
      .from("release_wines")
      .insert(
        input.wines.map((wine) => ({
          brand_id: brandId,
          organization_id: organizationId,
          release_id: releaseId,
          wine_name: wine.wineName,
        })),
      )
      .select("id,wine_name");
    if (winesError || !releaseWines) {
      throw databaseError("Release wines could not be saved.");
    }
    const tierItems = releaseTiers.flatMap((releaseTier) =>
      releaseWines.map((releaseWine, index) => ({
        brand_id: brandId,
        organization_id: organizationId,
        quantity: input.wines[index]?.quantity ?? 1,
        release_id: releaseId,
        release_tier_id: releaseTier.id,
        release_wine_id: releaseWine.id,
        unit_price_cents: input.wines[index]?.priceCents ?? 0,
      })),
    );
    const { error: itemError } = await this.admin
      .from("release_tier_items")
      .insert(tierItems);
    if (itemError) {
      throw databaseError("Release tier items could not be saved.");
    }
  }
}

export async function resumeProcessingReleaseShipments(
  releases: ProcessingReleaseRow[],
  createShipments: (release: ProcessingReleaseRow) => Promise<void>,
): Promise<number> {
  let failed = 0;
  for (const release of releases) {
    try {
      await createShipments(release);
    } catch {
      failed += 1;
    }
  }
  return failed;
}

export async function runCoreClubSchedule(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<CoreClubScheduleReport> {
  assertStripeBillingAuthority(env);
  const admin = createAdminClient(env);
  const stripe = createStripe(env);
  const report: CoreClubScheduleReport = {
    charged: 0,
    claimedReleases: 0,
    declined: 0,
    failed: 0,
    memberSideEffectFailures: 0,
    memberSideEffects: 0,
    recoveredAttempts: 0,
    refundsRecovered: 0,
    retryAttempts: 0,
  };
  const sideEffects = await processMemberSideEffects(
    admin,
    stripe,
    asOf,
  );
  report.memberSideEffects = sideEffects.processed;
  report.memberSideEffectFailures = sideEffects.failed;
  report.failed += sideEffects.failed;
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_due_releases",
    {
      p_as_of: asOf.toISOString().slice(0, 10),
      p_limit: 25,
    },
  );
  if (claimError) throw databaseError("Due releases could not be claimed.");
  const claimedReleases = (claimed ?? []) as Array<{
    organization_id: string;
    release_id: string;
  }>;
  report.claimedReleases = claimedReleases.length;
  const { data: processingReleases, error: processingReleaseError } = await admin
    .from("releases")
    .select("id,organization_id,brand_id")
    .eq("status", "processing")
    .lte("processing_date", asOf.toISOString().slice(0, 10))
    .limit(100);
  if (processingReleaseError) {
    throw databaseError("Processing releases could not be resumed.");
  }
  report.failed += await resumeProcessingReleaseShipments(
    (processingReleases ?? []) as ProcessingReleaseRow[],
    async (release) => {
      const { error } = await admin.rpc("create_release_shipments", {
        p_actor_user_id: null,
        p_brand_id: release.brand_id,
        p_organization_id: release.organization_id,
        p_release_id: release.id,
      });
      if (error) {
        console.error(
          JSON.stringify({
            code: "upstream_error",
            event: "release.schedule_shipment_creation_failed",
            organizationId: release.organization_id,
            releaseId: release.id,
          }),
        );
        throw databaseError("Release shipments could not be resumed.");
      }
    },
  );

  // Include all resumable pending shipments from processing releases, not just
  // this invocation's claims, so a transient Stripe failure is retried safely.
  const { data: pending, error: pendingError } = await admin
    .from("shipments")
    .select(
      "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id),releases!inner(status)",
    )
    .eq("status", "pending")
    .eq("releases.status", "processing")
    .limit(500);
  if (pendingError) throw databaseError("Scheduled release shipments could not be loaded.");
  const initialResults = await mapConcurrent(
    (pending ?? []) as ShipmentPaymentRow[],
    5,
    async (shipment) => {
      try {
        return await chargeSystemShipment(env, admin, stripe, shipment, {
          attemptKind: "charge",
          idempotencyKey: paymentIdempotencyKey(
            shipment,
            "release_processing",
          ),
        });
      } catch {
        return "failed" as const;
      }
    },
  );
  report.charged += initialResults.filter((result) => result === "charged").length;
  report.declined += initialResults.filter((result) => result === "declined").length;
  report.failed += initialResults.filter((result) => result === "failed").length;

  const { data: processingAttempts, error: processingAttemptsError } = await admin
    .from("billing_attempts")
    .select(
      "id,idempotency_key,attempt_kind,status,shipments!inner(id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id))",
    )
    .in("attempt_kind", ["charge", "retry"])
    .in("status", ["processing", "queued"])
    .lte("scheduled_for", asOf.toISOString())
    .limit(100);
  if (processingAttemptsError) {
    throw databaseError("In-flight billing attempts could not be recovered.");
  }
  const recoveryResults = await mapConcurrent(
    (processingAttempts ?? []) as ProcessingAttemptRow[],
    5,
    async (attempt) => {
      const shipment = oneRelation(attempt.shipments);
      if (!shipment) return "failed" as const;
      try {
        if (attempt.status === "queued") {
          const { data: claimedAttempt, error: claimAttemptError } = await admin
            .from("billing_attempts")
            .update({ started_at: asOf.toISOString(), status: "processing" })
            .eq("id", attempt.id)
            .eq("status", "queued")
            .select("id")
            .maybeSingle();
          if (claimAttemptError || !claimedAttempt) return "skipped" as const;
        }
        return await chargeSystemShipment(env, admin, stripe, shipment, {
          attemptId: attempt.id,
          attemptKind: attempt.attempt_kind,
          idempotencyKey: attempt.idempotency_key,
        });
      } catch {
        if (attempt.attempt_kind === "retry") {
          await requeueSystemAttempt(admin, attempt.id, shipment.id, asOf).catch(
            () => undefined,
          );
        }
        return "failed" as const;
      }
    },
  );
  report.recoveredAttempts = recoveryResults.length;
  report.charged += recoveryResults.filter((result) => result === "charged").length;
  report.declined += recoveryResults.filter(
    (result) => result === "declined",
  ).length;
  report.failed += recoveryResults.filter((result) => result === "failed").length;

  const { data: refundClaims, error: refundClaimsError } = await admin.rpc(
    "claim_stale_refund_attempts",
    {
      p_as_of: asOf.toISOString(),
      p_lease_seconds: 300,
      p_limit: 100,
      p_stale_seconds: 300,
      p_worker_id: `core-club-refund:${asOf.toISOString()}`,
    },
  );
  if (refundClaimsError) {
    throw databaseError("Stale refund attempts could not be claimed.");
  }
  const claimedRefunds = (refundClaims ?? []) as RefundRecoveryClaimRow[];
  const refundLeaseByAttempt = new Map(
    claimedRefunds.map((claim) => [
      claim.billing_attempt_id,
      claim.lease_token,
    ]),
  );
  let processingRefunds: ProcessingRefundAttemptRow[] = [];
  if (claimedRefunds.length > 0) {
    const { data, error } = await admin
      .from("billing_attempts")
      .select(
        "id,amount_cents,idempotency_key,metadata,shipments!inner(id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,stripe_charge_id)",
      )
      .in(
        "id",
        claimedRefunds.map((claim) => claim.billing_attempt_id),
      )
      .eq("attempt_kind", "refund")
      .eq("status", "processing");
    if (error) {
      throw databaseError("Claimed refund attempts could not be loaded.");
    }
    processingRefunds = ((data ?? []) as Omit<
      ProcessingRefundAttemptRow,
      "recovery_lease_token"
    >[]).map((attempt) => ({
      ...attempt,
      recovery_lease_token:
        refundLeaseByAttempt.get(attempt.id) ?? "",
    }));
  }
  const refundRecoveryResults = await mapConcurrent(
    processingRefunds,
    5,
    async (attempt) => {
      let outcome: "failed" | "refunded" | "retry";
      try {
        outcome = await recoverRefundAttempt(admin, stripe, attempt);
      } catch {
        outcome = "retry";
      }
      const { error } = await admin.rpc(
        "complete_refund_recovery_claim",
        {
          p_billing_attempt_id: attempt.id,
          p_error_code:
            outcome === "retry" ? "RECOVERY_RETRY_REQUIRED" : null,
          p_lease_token: attempt.recovery_lease_token,
          p_retry: outcome === "retry",
        },
      );
      if (error) {
        throw databaseError("A refund recovery lease could not be finalized.");
      }
      return outcome;
    },
  );
  report.recoveredAttempts += refundRecoveryResults.length;
  report.refundsRecovered += refundRecoveryResults.filter(
    (result) => result === "refunded",
  ).length;
  report.failed += refundRecoveryResults.filter(
    (result) => result !== "refunded",
  ).length;

  const { data: retries, error: retryError } = await admin.rpc(
    "schedule_due_shipment_retries",
    {
      p_as_of: asOf.toISOString(),
      p_limit: 100,
    },
  );
  if (retryError) throw databaseError("Due shipment retries could not be claimed.");
  const retryRows = (retries ?? []) as ScheduledRetryRow[];
  report.retryAttempts = retryRows.length;
  const retryResults = await mapConcurrent(retryRows, 5, async (retry) =>
    executeScheduledRetry(
      retry,
      async () => {
        if (!retry.brand_id) {
          throw databaseError("The claimed retry is missing its brand scope.");
        }
        const { data, error } = await admin
          .from("shipments")
          .select(
            "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
          )
          .eq("id", retry.shipment_id)
          .eq("organization_id", retry.organization_id)
          .eq("brand_id", retry.brand_id)
          .maybeSingle();
        if (error || !data) {
          throw databaseError("The claimed retry shipment could not be loaded.");
        }
        return chargeSystemShipment(env, admin, stripe, data as ShipmentPaymentRow, {
          attemptId: retry.billing_attempt_id,
          attemptKind: "retry",
          idempotencyKey: `auto-retry:${retry.shipment_id}:${retry.attempt_number}`,
        });
      },
      async () => {
        await requeueSystemAttempt(
          admin,
          retry.billing_attempt_id,
          retry.shipment_id,
          asOf,
        );
      },
    ),
  );
  report.charged += retryResults.filter((result) => result === "charged").length;
  report.declined += retryResults.filter((result) => result === "declined").length;
  report.failed += retryResults.filter((result) => result === "failed").length;
  console.info(JSON.stringify({ event: "core_club.schedule_completed", ...report }));
  return report;
}
