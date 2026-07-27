import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  AvalaraClient,
  type AvalaraCredentials,
  type AvalaraTaxQuote,
  type AvalaraTaxRequest,
} from "../integrations/avalara";
import { decryptIntegrationCredentials } from "../integrations/security";
import {
  assertAvalaraBaseUrlEnvironment,
  assertStripeBillingAuthority,
  stripeCredentialMode,
} from "../config";
import { mapConcurrent } from "../lib/concurrency";
import { AppError, requireConfigured } from "../lib/errors";
import { assertUuid, sha256 } from "../lib/utils";
import type {
  PostalAddress,
  ShipmentStatus,
  StaffPrincipal,
  WorkerEnv,
} from "../types";
import {
  executeStripeBillingAttempt,
  provisionStripeCustomer,
  supabaseStripeBillingAttemptStore,
  supabaseStripeCustomerProvisioningStore,
} from "./stripe-runtime";
import { CoreClubClubService } from "./clubs";
import {
  brandAllowsOperationalAccess,
  databaseError,
  getAddress,
  oneRelation,
  toPublicShipment,
  type MemberRow,
  type ShipmentPaymentRow,
} from "./members";

export {
  brandAllowsOperationalAccess,
  type ShipmentPaymentRow,
} from "./members";
export { mapConcurrent } from "../lib/concurrency";

const STRIPE_API_VERSION = "2026-02-25.clover";


export function createStripe(env: WorkerEnv): Stripe {
  stripeCredentialMode(env);
  return new Stripe(requireConfigured(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "Vinifera",
      url: "https://vinifera.edstratumlabs.ai",
      version: "0.2.0",
    },
  });
}


function authFailure(): AppError {
  return new AppError(401, "unauthorized", "A valid sign-in is required.");
}

function paymentDeclineReason(error: unknown): string {
  if (error instanceof Stripe.errors.StripeCardError) {
    return error.decline_code ?? error.code ?? "card_declined";
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "payment_failed";
}

async function resolveStripePaymentMethod(
  stripe: Stripe,
  admin: SupabaseClient,
  member: MemberRow,
): Promise<string | null> {
  if (!member.stripe_customer_id) return null;
  const customer = await stripe.customers.retrieve(member.stripe_customer_id);
  if (customer.deleted) {
    throw new AppError(
      409,
      "conflict",
      "The member's Stripe customer has been deleted.",
    );
  }
  const configured = customer.invoice_settings.default_payment_method;
  const paymentMethodId =
    typeof configured === "string" ? configured : configured?.id ?? null;
  if (paymentMethodId !== member.stripe_payment_method_id) {
    let update = admin
      .from("members")
      .update({ stripe_payment_method_id: paymentMethodId })
      .eq("id", member.id)
      .eq("organization_id", member.organization_id);
    if (member.brand_id) update = update.eq("brand_id", member.brand_id);
    const { error } = await update;
    if (error) throw databaseError("The member payment method could not be synchronized.");
  }
  return paymentMethodId;
}


export function paymentIdempotencyKey(
  shipment: ShipmentPaymentRow,
  source: "release_processing" | "manual_retry",
): string {
  return source === "release_processing"
    ? `shipment:${shipment.id}:charge`
    : `shipment:${shipment.id}:manual-retry:${shipment.retry_count + 1}`;
}


function shipmentSubtotalAmount(shipment: ShipmentPaymentRow): number {
  return Math.max(
    0,
    shipment.charge_amount_cents - Number(shipment.loyalty_discount_cents ?? 0),
  );
}

export function payableShipmentAmount(shipment: ShipmentPaymentRow): number {
  return (
    shipmentSubtotalAmount(shipment) +
    Math.max(0, Number(shipment.tax_amount_cents ?? 0))
  );
}

export async function assertBrandOperationalAccess(
  admin: SupabaseClient,
  organizationId: string,
  brandId: string,
): Promise<void> {
  const [{ data: brand, error: brandError }, { data: organization, error: orgError }] =
    await Promise.all([
      admin
        .from("brands")
        .select("id,active,billing_mode,access_status")
        .eq("organization_id", organizationId)
        .eq("id", brandId)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("id,access_status")
        .eq("id", organizationId)
        .maybeSingle(),
    ]);
  if (
    brandError ||
    orgError ||
    !brand ||
    !organization ||
    !brandAllowsOperationalAccess({
      active: Boolean(brand.active),
      access_status: String(brand.access_status),
      billing_mode: String(brand.billing_mode),
      organization_access_status: String(organization.access_status),
    })
  ) {
    throw new AppError(403, "forbidden", "This wine club is suspended.");
  }
}

interface PreparedAvalaraTax {
  calculationId: string;
  client: AvalaraClient;
  connectionId: string;
  quote: AvalaraTaxQuote;
  requestHash: string;
  status: "committed" | "temporary";
}

async function persistAvalaraTaxStatus(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  prepared: PreparedAvalaraTax,
  status: "committed" | "temporary" | "voided",
): Promise<string> {
  const { data, error } = await admin.rpc("record_avalara_tax_calculation", {
    p_connection_id: prepared.connectionId,
    p_currency_code: prepared.quote.currencyCode,
    p_document_code: prepared.quote.code,
    p_document_status: status,
    p_exempt_amount_cents: prepared.quote.exemptAmountCents,
    p_jurisdiction_summary: prepared.quote.jurisdictionSummary,
    p_provider_transaction_code: prepared.quote.code,
    p_request_hash: prepared.requestHash,
    p_response_hash: await sha256(
      JSON.stringify({ quote: prepared.quote, status }),
    ),
    p_shipment_id: shipment.id,
    p_shipping_tax_cents: prepared.quote.shippingTaxCents,
    p_tax_amount_cents: prepared.quote.taxCents,
    p_taxable_basis_cents: shipmentSubtotalAmount(shipment),
  });
  if (error || typeof data !== "string") {
    throw databaseError("The Avalara tax ledger could not be persisted.");
  }
  return data;
}

export async function prepareAvalaraTax(
  env: WorkerEnv,
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
): Promise<PreparedAvalaraTax | null> {
  const { data: connection, error: connectionError } = await admin
    .from("integration_connections")
    .select("id,status,opted_in")
    .eq("organization_id", shipment.organization_id)
    .eq("brand_id", shipment.brand_id)
    .eq("integration_type", "avalara")
    .maybeSingle();
  if (connectionError) {
    throw databaseError("Avalara activation could not be checked.");
  }
  if (!connection || !connection.opted_in) return null;
  if (connection.status !== "active") {
    throw new AppError(
      503,
      "activation_required",
      "Avalara is enabled for this brand but its credentials are not active.",
    );
  }
  const { data: runtimeValue, error: runtimeError } = await admin.rpc(
    "get_integration_runtime",
    {
      p_brand_id: shipment.brand_id,
      p_integration_type: "avalara",
      p_organization_id: shipment.organization_id,
      p_include_credentials: true,
    },
  );
  const runtime = Array.isArray(runtimeValue) ? runtimeValue[0] : runtimeValue;
  if (
    runtimeError ||
    !runtime ||
    runtime.storage_mode !== "encrypted_envelope" ||
    runtime.algorithm !== "A256GCM" ||
    runtime.envelope_version !== 1
  ) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara is enabled but its encrypted credentials are unavailable.",
    );
  }
  const credentials = await decryptIntegrationCredentials<AvalaraCredentials>(
    env,
    {
      integrationType: "avalara",
      organizationId: shipment.organization_id,
      targetId: String(runtime.connection_id),
    },
    {
      algorithm: "A256GCM",
      ciphertext: String(runtime.credential_ciphertext),
      iv: String(runtime.credential_iv),
      keyVersion: String(runtime.key_version),
      version: 1,
    },
  );
  assertAvalaraBaseUrlEnvironment(env, credentials.baseUrl);
  const { data: sourceValue, error: sourceError } = await admin.rpc(
    "get_avalara_shipment_source",
    {
      p_connection_id: connection.id,
      p_shipment_id: shipment.id,
    },
  );
  const source = Array.isArray(sourceValue) ? sourceValue[0] : sourceValue;
  const destination = getAddress(source?.shipping_address);
  const origin = getAddress(source?.shipping_origin_address);
  if (sourceError || !source || !destination || !origin) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara requires complete origin and destination addresses.",
    );
  }
  const shipmentSubtotalCents = shipmentSubtotalAmount(shipment);
  const shippingChargeCents = Math.min(
    shipmentSubtotalCents,
    Math.max(0, Number(source.shipping_charge_cents ?? 0)),
  );
  const wineSubtotalCents = shipmentSubtotalCents - shippingChargeCents;
  const wineTaxCode =
    typeof source.wine_tax_code === "string" ? source.wine_tax_code : null;
  const wineItemCode =
    typeof source.wine_item_code === "string" ? source.wine_item_code : null;
  const shippingTaxCode =
    typeof source.shipping_tax_code === "string"
      ? source.shipping_tax_code
      : null;
  const shippingItemCode =
    typeof source.shipping_item_code === "string"
      ? source.shipping_item_code
      : null;
  if (!wineTaxCode || !wineItemCode) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara requires a wine tax-code mapping for this brand and tier.",
    );
  }
  if (shippingChargeCents > 0 && (!shippingTaxCode || !shippingItemCode)) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara requires a shipping tax-code mapping when shipping is charged.",
    );
  }
  const request: AvalaraTaxRequest = {
    currencyCode: "USD",
    customerCode:
      typeof source.provider_customer_code === "string"
        ? source.provider_customer_code
        : `member-${shipment.member_id}`,
    destination,
    entityUseCode:
      typeof source.entity_use_code === "string"
        ? source.entity_use_code
        : null,
    exemptionNumber:
      typeof source.provider_exemption_reference === "string"
        ? source.provider_exemption_reference
        : null,
    lines: [
      {
        amountCents: wineSubtotalCents,
        description: "Wine club shipment",
        itemCode: wineItemCode,
        kind: "wine",
        quantity: 1,
        taxCode: wineTaxCode,
      },
      ...(shippingChargeCents > 0
        ? [
            {
              amountCents: shippingChargeCents,
              description: "Wine club shipping",
              itemCode: shippingItemCode!,
              kind: "shipping" as const,
              quantity: 1,
              taxCode: shippingTaxCode!,
            },
          ]
        : []),
    ],
    origin,
    transactionCode:
      `VIN-${shipment.id}` +
      (shipment.retry_count > 0 ? `-R${shipment.retry_count}` : ""),
    transactionDate: new Date().toISOString().slice(0, 10),
  };
  const requestHash = await sha256(JSON.stringify(request));
  const client = new AvalaraClient(credentials);
  const { data: existing, error: existingError } = await admin
    .from("avalara_tax_calculations")
    .select(
      "id,provider_transaction_code,document_code,document_status,currency_code,tax_amount_cents,shipping_tax_cents,exempt_amount_cents,jurisdiction_summary,request_hash",
    )
    .eq("connection_id", connection.id)
    .eq("organization_id", shipment.organization_id)
    .eq("brand_id", shipment.brand_id)
    .eq("shipment_id", shipment.id)
    .in("document_status", ["temporary", "committed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw databaseError("The saved Avalara calculation could not be loaded.");
  }
  if (existing) {
    if (String(existing.request_hash) !== requestHash) {
      if (existing.document_status === "committed") {
        throw new AppError(
          409,
          "conflict",
          "A committed Avalara transaction cannot be replaced after shipment inputs change.",
        );
      }
    } else {
      if (
        existing.document_status === "committed" &&
        ["pending", "declined"].includes(shipment.status)
      ) {
        throw new AppError(
          409,
          "conflict",
          "A committed Avalara transaction cannot be reused for an uncharged shipment.",
        );
      }
      const prepared: PreparedAvalaraTax = {
        calculationId: String(existing.id),
        client,
        connectionId: String(connection.id),
        quote: {
          code: String(
            existing.provider_transaction_code ?? existing.document_code,
          ),
          currencyCode: String(existing.currency_code ?? "USD"),
          jurisdictionSummary: Array.isArray(existing.jurisdiction_summary)
            ? existing.jurisdiction_summary
            : [],
          providerId: null,
          exemptAmountCents: Number(existing.exempt_amount_cents ?? 0),
          shippingTaxCents: Number(existing.shipping_tax_cents ?? 0),
          status: "Saved",
          taxCents: Number(existing.tax_amount_cents ?? 0),
          totalCents:
            shipmentSubtotalAmount(shipment) +
            Number(existing.tax_amount_cents ?? 0),
        },
        requestHash: String(existing.request_hash),
        status:
          existing.document_status === "committed" ? "committed" : "temporary",
      };
      const { data: rebound, error: reboundError } = await admin
        .from("shipments")
        .update({
          avalara_tax_calculation_id: prepared.calculationId,
          tax_amount_cents: prepared.quote.taxCents,
        })
        .eq("id", shipment.id)
        .eq("organization_id", shipment.organization_id)
        .eq("brand_id", shipment.brand_id)
        .in("status", ["pending", "declined"])
        .select("id")
        .maybeSingle();
      if (reboundError || !rebound) {
        throw databaseError(
          "The saved Avalara calculation could not be rebound.",
        );
      }
      shipment.tax_amount_cents = prepared.quote.taxCents;
      return prepared;
    }
  }
  const quote = await client.createTaxQuote(request);
  const prepared: PreparedAvalaraTax = {
    calculationId: "",
    client,
    connectionId: String(connection.id),
    quote,
    requestHash,
    status: "temporary",
  };
  prepared.calculationId = await persistAvalaraTaxStatus(
    admin,
    shipment,
    prepared,
    "temporary",
  );
  const { data: bound, error: bindingError } = await admin
    .from("shipments")
    .update({
      avalara_tax_calculation_id: prepared.calculationId,
      tax_amount_cents: quote.taxCents,
    })
    .eq("id", shipment.id)
    .eq("organization_id", shipment.organization_id)
    .eq("brand_id", shipment.brand_id)
    .in("status", ["pending", "declined"])
    .select("id")
    .maybeSingle();
  if (bindingError || !bound) {
    await client.voidTransaction(quote.code).catch(() => undefined);
    await persistAvalaraTaxStatus(admin, shipment, prepared, "voided").catch(
      () => undefined,
    );
    throw databaseError("The saved Avalara calculation could not be bound.");
  }
  shipment.tax_amount_cents = quote.taxCents;
  return prepared;
}

async function finalizeAvalaraTax(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  prepared: PreparedAvalaraTax | null,
  outcome: "commit" | "void",
): Promise<void> {
  if (!prepared) return;
  if (outcome === "commit") {
    if (prepared.status === "committed") return;
    await prepared.client.commitTransaction(prepared.quote.code);
    await persistAvalaraTaxStatus(admin, shipment, prepared, "committed");
    prepared.status = "committed";
    return;
  }
  await prepared.client.voidTransaction(prepared.quote.code);
  await persistAvalaraTaxStatus(admin, shipment, prepared, "voided");
}


export class CoreClubStripeService extends CoreClubClubService {
  async listRecoveryQueue(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "*,members(id,first_name,last_name,email),releases(id,name),billing_attempts(*)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("status", "declined")
      .order("next_retry_at");
    if (error) throw databaseError("The recovery queue could not be loaded.");
    return (data ?? []).map(toPublicShipment);
  }


  async retryShipment(shipmentId: string): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    assertStripeBillingAuthority(this.env);
    const shipment = await this.getPaymentShipment(
      shipmentId,
      organizationId,
      brandId,
      "declined",
    );
    const status = await this.chargeShipment(
      createStripe(this.env),
      shipment,
      principal,
      "manual_retry",
    );
    return { shipmentId, status };
  }

  async refundShipment(
    shipmentId: string,
    input: { amountCents?: number; reason?: string },
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    assertStripeBillingAuthority(this.env);
    const { data: shipment, error } = await this.admin
      .from("shipments")
      .select(
        "id,status,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,refund_amount_cents,stripe_payment_intent_id,stripe_charge_id",
      )
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError("The shipment could not be loaded.");
    if (!shipment) throw new AppError(404, "not_found", "Shipment not found.");
    const idempotencyKey = `shipment:${shipmentId}:refund:${commandId}`;
    const { data: existingAttempt, error: existingAttemptError } =
      await this.admin
        .from("billing_attempts")
        .select("id,status,amount_cents,metadata,stripe_refund_id")
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("shipment_id", shipmentId)
        .eq("attempt_kind", "refund")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
    if (existingAttemptError) {
      throw databaseError("The existing refund attempt could not be loaded.");
    }
    if (existingAttempt) {
      const requestedReason = input.reason ?? "";
      const recordedReason =
        typeof existingAttempt.metadata === "object" &&
        existingAttempt.metadata !== null &&
        "reason" in existingAttempt.metadata &&
        typeof existingAttempt.metadata.reason === "string"
          ? existingAttempt.metadata.reason
          : "";
      if (
        (input.amountCents !== undefined &&
          input.amountCents !== Number(existingAttempt.amount_cents)) ||
        requestedReason !== recordedReason
      ) {
        throw new AppError(
          409,
          "conflict",
          "This refund command was already used with different details.",
        );
      }
      if (existingAttempt.status === "refunded") {
        return {
          amountCents: Number(existingAttempt.amount_cents),
          id: shipmentId,
          status: shipment.status,
        };
      }
      if (
        !["queued", "processing"].includes(existingAttempt.status as string)
      ) {
        throw new AppError(
          409,
          "conflict",
          "This refund command already reached a terminal result.",
        );
      }
    }
    if (
      !["charged", "label_created", "packed", "shipped", "delivered"].includes(
        shipment.status,
      )
    ) {
      throw new AppError(409, "conflict", "This shipment has no refundable payment.");
    }
    if (!shipment.stripe_payment_intent_id) {
      throw new AppError(409, "conflict", "The Stripe payment reference is missing.");
    }
    const capturedAmount = Math.max(
      0,
      Number(shipment.charge_amount_cents) -
        Number(shipment.loyalty_discount_cents ?? 0) +
        Number(shipment.tax_amount_cents ?? 0),
    );
    const alreadyRefunded = Number(shipment.refund_amount_cents ?? 0);
    const remainingRefundable = Math.max(0, capturedAmount - alreadyRefunded);
    const refundAmount = input.amountCents ?? remainingRefundable;
    if (
      !Number.isInteger(refundAmount) ||
      refundAmount <= 0 ||
      refundAmount > remainingRefundable
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Refund amount must be a positive number of cents no greater than the remaining captured amount.",
      );
    }
    const { data: attemptData, error: attemptError } = await this.admin.rpc(
      "record_billing_attempt",
      {
        p_actor_user_id: principal.user.id,
        p_amount_cents: refundAmount,
        p_attempt_kind: "refund",
        p_brand_id: brandId,
        p_idempotency_key: idempotencyKey,
        p_metadata: { reason: input.reason ?? "" },
        p_organization_id: organizationId,
        p_shipment_id: shipmentId,
        p_stripe_payment_intent_id: shipment.stripe_payment_intent_id,
      },
    );
    if (attemptError) throw databaseError("The refund attempt could not be recorded.");
    const billingAttemptId = Array.isArray(attemptData)
      ? attemptData[0]
      : attemptData;
    if (typeof billingAttemptId !== "string") {
      throw databaseError("The refund attempt is unavailable.");
    }
    let refund: Stripe.Refund;
    try {
      refund = await createStripe(this.env).refunds.create(
        {
          amount: refundAmount,
          metadata: {
            billing_attempt_id: billingAttemptId,
            brand_id: brandId,
            organization_id: organizationId,
            reason: input.reason ?? "",
            shipment_id: shipmentId,
          },
          payment_intent: shipment.stripe_payment_intent_id,
          reason: "requested_by_customer",
        },
        {
          idempotencyKey,
        },
      );
    } catch (error) {
      if (!isRetryableStripeRecoveryError(error)) {
        const { error: failureError } = await this.admin.rpc(
          "apply_shipment_payment_event",
          {
            p_billing_attempt_id: billingAttemptId,
            p_brand_id: brandId,
            p_decline_code: safeStripeRecoveryErrorCode(error),
            p_decline_reason: "Stripe rejected the refund request.",
            p_event_created_at: new Date().toISOString(),
            p_metadata: { reason: input.reason ?? "", source: "staff_refund" },
            p_organization_id: organizationId,
            p_shipment_id: shipmentId,
            p_status: "failed",
            p_stripe_charge_id: shipment.stripe_charge_id,
            p_stripe_event_id: null,
            p_stripe_refund_id: null,
          },
        );
        if (failureError) {
          throw databaseError(
            "Stripe rejected the refund and its failed ledger state could not be recorded.",
          );
        }
      }
      throw new AppError(
        502,
        "upstream_error",
        isRetryableStripeRecoveryError(error)
          ? "Stripe did not confirm the refund. Vinifera will safely reconcile the same request."
          : "Stripe rejected the refund request.",
      );
    }
    const { error: applyError } = await this.admin.rpc(
      "apply_shipment_payment_event",
      {
        p_billing_attempt_id: billingAttemptId,
        p_brand_id: brandId,
        p_decline_code: null,
        p_decline_reason: null,
        p_event_created_at: new Date().toISOString(),
        p_metadata: { reason: input.reason ?? "", source: "staff_refund" },
        p_organization_id: organizationId,
        p_shipment_id: shipmentId,
        p_status: "refunded",
        p_stripe_charge_id: shipment.stripe_charge_id,
        p_stripe_event_id: null,
        p_stripe_refund_id: refund.id,
      },
    );
    if (applyError) {
      throw databaseError("The refund succeeded but its local ledger did not update.");
    }
    return {
      amountCents: refund.amount,
      id: shipmentId,
      status:
        alreadyRefunded + refundAmount >= capturedAmount
          ? "refunded"
          : shipment.status,
    };
  }

  async createMemberPaymentMethodPortal(input: {
    attemptId: string;
  }): Promise<{ url: string }> {
    const principal = await this.requireMember();
    assertStripeBillingAuthority(this.env);
    const { data: member, error } = await this.admin
      .from("members")
      .select("id,organization_id,stripe_customer_id")
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .eq("brand_id", principal.brand.id)
      .single();
    if (error || !member) throw authFailure();
    const stripe = createStripe(this.env);
    let customerId = member.stripe_customer_id as string | null;
    if (!customerId) {
      customerId = await provisionStripeCustomer({
        brandId: principal.brand.id,
        createCustomer: (params, idempotencyKey) =>
          stripe.customers.create(params, { idempotencyKey }),
        memberId: member.id,
        organizationId: member.organization_id,
        scope: "member",
        store: supabaseStripeCustomerProvisioningStore(this.admin),
        subjectId: member.id,
      });
    }
    return executeStripeBillingAttempt({
      attemptId: input.attemptId,
      brandId: principal.brand.id,
      createSession: async ({ idempotencyKey }) => {
        const session = await stripe.billingPortal.sessions.create(
          {
            customer: customerId,
            flow_data: { type: "payment_method_update" },
            return_url: `${this.coreApplicationOrigin()}/portal/payment-method`,
          },
          { idempotencyKey },
        );
        return { id: session.id, url: session.url };
      },
      customerId,
      memberId: member.id,
      operation: "member_portal",
      organizationId: member.organization_id,
      planTier: null,
      providerPayloadKey: "member_portal:v1",
      reconcileOpenCheckout: async () => ({ status: "expired" as const }),
      store: supabaseStripeBillingAttemptStore(this.admin),
      subjectId: member.id,
    });
  }


  private coreApplicationOrigin(): string {
    const origin = this.request.get("origin");
    if (origin) {
      try {
        return new URL(origin).origin;
      } catch {
        // Origin validation middleware rejects malformed state-changing requests.
      }
    }
    const host = this.request.get("host");
    const protocol =
      this.request.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      this.request.protocol;
    return host ? `${protocol}://${host}` : this.env.APP_ORIGIN ?? "http://localhost:5173";
  }


  private async getPaymentShipment(
    shipmentId: string,
    organizationId: string,
    brandId: string,
    requiredStatus: ShipmentStatus,
  ): Promise<ShipmentPaymentRow> {
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
      )
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError("The shipment could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Shipment not found.");
    if (data.status !== requiredStatus) {
      throw new AppError(
        409,
        "conflict",
        `The shipment must be ${requiredStatus} for this operation.`,
      );
    }
    return data as ShipmentPaymentRow;
  }

  protected async chargeShipment(
    stripe: Stripe,
    shipment: ShipmentPaymentRow,
    principal: StaffPrincipal,
    source: "release_processing" | "manual_retry",
  ): Promise<"charged" | "declined" | "skipped"> {
    assertStripeBillingAuthority(this.env);
    if (!["pending", "declined"].includes(shipment.status)) return "skipped";
    const organizationId = this.organizationId(principal);
    const member = oneRelation(shipment.members);
    if (
      !member ||
      member.organization_id !== organizationId ||
      member.brand_id !== shipment.brand_id
    ) {
      throw new AppError(403, "forbidden", "Shipment tenant validation failed.");
    }
    await assertBrandOperationalAccess(
      this.admin,
      organizationId,
      shipment.brand_id,
    );
    const avalara = await prepareAvalaraTax(this.env, this.admin, shipment);
    const billingAttemptId = await this.ensureBillingAttempt(
      shipment,
      principal,
      source,
      null,
    );
    const payableAmount = payableShipmentAmount(shipment);
    if (payableAmount === 0) {
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId: null,
        declineReason: null,
        paymentIntentId: null,
        source,
        status: "charged",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "commit");
      return "charged";
    }
    const paymentMethodId = await resolveStripePaymentMethod(
      stripe,
      this.admin,
      member,
    );
    if (!member.stripe_customer_id || !paymentMethodId) {
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId: null,
        declineReason: "payment_method_missing",
        paymentIntentId: null,
        source,
        status: "declined",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "void");
      return "declined";
    }
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: payableAmount,
          automatic_payment_methods: { enabled: true },
          confirm: true,
          currency: "usd",
          customer: member.stripe_customer_id,
          description: `Vinifera release ${shipment.release_id}`,
          metadata: {
            brand_id: shipment.brand_id,
            member_id: shipment.member_id,
            organization_id: organizationId,
            release_id: shipment.release_id,
            shipment_id: shipment.id,
          },
          off_session: true,
          payment_method: paymentMethodId,
        },
        {
          idempotencyKey: paymentIdempotencyKey(shipment, source),
        },
      );
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeCardError)) {
        await finalizeAvalaraTax(
          this.admin,
          shipment,
          avalara,
          "void",
        ).catch(() => undefined);
        throw new AppError(
          502,
          "upstream_error",
          "Stripe could not confirm this shipment payment.",
        );
      }
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId: null,
        declineReason: paymentDeclineReason(error),
        paymentIntentId: error.payment_intent?.id ?? null,
        source,
        status: "declined",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "void");
      return "declined";
    }
    if (paymentIntent.status !== "succeeded") {
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId:
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id ?? null,
        declineReason:
          paymentIntent.last_payment_error?.decline_code ?? paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        source,
        status: "declined",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "void");
      return "declined";
    }
    // Never downgrade successful money movement when local persistence fails.
    // The signed Stripe webhook remains the convergence path for this state.
    await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
      chargeId:
        typeof paymentIntent.latest_charge === "string"
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge?.id ?? null,
      declineReason: null,
      paymentIntentId: paymentIntent.id,
      source,
      status: "charged",
    });
    await finalizeAvalaraTax(this.admin, shipment, avalara, "commit");
    return "charged";
  }

  private async recordPaymentOutcome(
    shipment: ShipmentPaymentRow,
    principal: StaffPrincipal,
    billingAttemptId: string,
    outcome: {
      chargeId: string | null;
      declineReason: string | null;
      paymentIntentId: string | null;
      source: "release_processing" | "manual_retry";
      status: "charged" | "declined";
    },
  ): Promise<void> {
    const organizationId = this.organizationId(principal);
    const persistedAttemptId = await this.ensureBillingAttempt(
      shipment,
      principal,
      outcome.source,
      outcome.paymentIntentId,
    );
    if (persistedAttemptId !== billingAttemptId) {
      throw databaseError("The billing attempt id changed during confirmation.");
    }
    const { error } = await this.admin.rpc("apply_shipment_payment_event", {
      p_billing_attempt_id: billingAttemptId,
      p_brand_id: shipment.brand_id,
      p_decline_code: outcome.declineReason,
      p_decline_reason: outcome.declineReason,
      p_event_created_at: new Date().toISOString(),
      p_metadata: { source: outcome.source },
      p_organization_id: organizationId,
      p_shipment_id: shipment.id,
      p_status: outcome.status === "charged" ? "succeeded" : "declined",
      p_stripe_charge_id: outcome.chargeId,
      p_stripe_event_id: null,
    });
    if (error) throw databaseError("The shipment payment state could not be persisted.");
    if (outcome.status === "charged" && shipment.loyalty_redemption_id) {
      const { error: loyaltyError } = await this.admin.rpc(
        "finalize_loyalty_redemption",
        {
          p_actor_user_id: principal.user.id,
          p_apply: true,
          p_organization_id: organizationId,
          p_redemption_id: shipment.loyalty_redemption_id,
        },
      );
      if (loyaltyError) {
        throw databaseError("The loyalty redemption could not be finalized.");
      }
    }
    await this.audit(
      principal,
      outcome.status === "charged" ? "shipment.charged" : "shipment.declined",
      "shipment",
      shipment.id,
      {
        amount_cents: payableShipmentAmount(shipment),
        loyalty_discount_cents: Number(shipment.loyalty_discount_cents ?? 0),
        decline_reason: outcome.declineReason,
        source: outcome.source,
        stripe_payment_intent_id: outcome.paymentIntentId,
      },
    );
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        amountCents: payableShipmentAmount(shipment),
        source: outcome.source,
      },
      eventType:
        outcome.status === "charged"
          ? "shipment.charged"
          : "shipment.declined",
      memberId: shipment.member_id,
      requestKey: `billing-attempt:${billingAttemptId}:${outcome.status}`,
    });
    if (outcome.status === "declined") {
      console.info(
        JSON.stringify({
          event: "member.decline_notification.queued_by_database",
          memberId: shipment.member_id,
          organizationId,
          shipmentId: shipment.id,
        }),
      );
    }
  }

  private async ensureBillingAttempt(
    shipment: ShipmentPaymentRow,
    principal: StaffPrincipal,
    source: "release_processing" | "manual_retry",
    paymentIntentId: string | null,
  ): Promise<string> {
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.admin.rpc("record_billing_attempt", {
      p_actor_user_id: principal.user.id,
      p_amount_cents: payableShipmentAmount(shipment),
      p_attempt_kind: source === "release_processing" ? "charge" : "retry",
      p_brand_id: shipment.brand_id,
      p_idempotency_key: paymentIdempotencyKey(shipment, source),
      p_metadata: { source },
      p_organization_id: organizationId,
      p_shipment_id: shipment.id,
      p_stripe_payment_intent_id: paymentIntentId,
    });
    if (error) throw databaseError("The billing attempt could not be recorded.");
    const attemptId = Array.isArray(data) ? data[0] : data;
    if (typeof attemptId !== "string") {
      throw databaseError("The billing attempt id was not returned.");
    }
    return attemptId;
  }
}

export interface ScheduledRetryRow {
  amount_cents: number;
  attempt_number: number;
  brand_id?: string;
  billing_attempt_id: string;
  member_id: string;
  organization_id: string;
  shipment_id: string;
}

export interface ProcessingReleaseRow {
  brand_id?: string;
  id: string;
  organization_id: string;
}

export interface ProcessingAttemptRow {
  attempt_kind: "charge" | "retry";
  id: string;
  idempotency_key: string;
  shipments: ShipmentPaymentRow | ShipmentPaymentRow[] | null;
  status: "processing" | "queued";
}


export interface ProcessingRefundAttemptRow {
  amount_cents: number;
  id: string;
  idempotency_key: string;
  metadata: Record<string, unknown> | null;
  recovery_lease_token: string;
  shipments: ShipmentPaymentRow | ShipmentPaymentRow[] | null;
}


export interface RefundRecoveryClaimRow {
  billing_attempt_id: string;
  lease_token: string;
}


export interface MemberSideEffectRow {
  attempt_count: number;
  brand_id: string;
  command_id: string;
  effect_type: "auth_user_delete" | "stripe_customer_sync";
  lease_token: string;
  max_attempts: number;
  member_id: string;
  organization_id: string;
  outbox_id: string;
  payload: Record<string, unknown>;
  provider_subject_id: string;
}

export interface CoreClubScheduleReport {
  charged: number;
  claimedReleases: number;
  declined: number;
  failed: number;
  memberSideEffectFailures: number;
  memberSideEffects: number;
  recoveredAttempts: number;
  refundsRecovered: number;
  retryAttempts: number;
}

function safeMemberSideEffectErrorCode(error: unknown): string {
  if (error instanceof AppError && error.code === "activation_required") {
    return "ACTIVATION_REQUIRED";
  }
  if (error instanceof Stripe.errors.StripeError) {
    return `STRIPE_${error.type.replaceAll(/[^A-Za-z0-9_.:-]/g, "_").toUpperCase()}`;
  }
  return "PROVIDER_ERROR";
}

function safeStripeRecoveryErrorCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return `STRIPE_${error.type
      .replaceAll(/[^A-Za-z0-9_.:-]/g, "_")
      .toUpperCase()}`.slice(0, 100);
  }
  return "PROVIDER_ERROR";
}

function isRetryableStripeRecoveryError(error: unknown): boolean {
  return (
    !(error instanceof Stripe.errors.StripeError) ||
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  );
}

export async function executeMemberSideEffect(
  admin: SupabaseClient,
  stripe: Stripe,
  effect: MemberSideEffectRow,
): Promise<"applied" | "superseded"> {
  if (effect.effect_type === "stripe_customer_sync") {
    const payload = effect.payload ?? {};
    const address =
      payload.address && typeof payload.address === "object"
        ? (payload.address as Stripe.AddressParam)
        : payload.address === null
          ? ""
          : undefined;
    const phone =
      typeof payload.phone === "string"
        ? payload.phone
        : payload.phone === null
          ? ""
          : undefined;
    await stripe.customers.update(
      effect.provider_subject_id,
      {
        address,
        email: typeof payload.email === "string" ? payload.email : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        phone,
      },
      {
        idempotencyKey: [
          "member-side-effect",
          effect.organization_id,
          effect.brand_id,
          effect.member_id,
          effect.effect_type,
          effect.command_id,
        ].join(":"),
      },
    );
    return "applied";
  }

  const [memberReference, staffReference, platformReference] = await Promise.all([
    admin
      .from("members")
      .select("id")
      .eq("auth_user_id", effect.provider_subject_id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle(),
    admin
      .from("staff_users")
      .select("id")
      .eq("id", effect.provider_subject_id)
      .limit(1)
      .maybeSingle(),
    admin
      .from("platform_users")
      .select("id")
      .eq("id", effect.provider_subject_id)
      .limit(1)
      .maybeSingle(),
  ]);
  if (
    memberReference.error ||
    staffReference.error ||
    platformReference.error
  ) {
    throw databaseError(
      "Auth identity references could not be verified before deletion.",
    );
  }
  if (
    memberReference.data ||
    staffReference.data ||
    platformReference.data
  ) {
    return "superseded";
  }

  const { error } = await admin.auth.admin.deleteUser(effect.provider_subject_id);
  if (error && error.status !== 404) {
    throw error;
  }
  return "applied";
}

export async function processMemberSideEffects(
  admin: SupabaseClient,
  stripe: Stripe,
  asOf: Date,
): Promise<{ failed: number; processed: number }> {
  const { data, error } = await admin.rpc("claim_member_side_effects", {
    p_lease_seconds: 300,
    p_limit: 50,
    p_worker_id: `core-club:${asOf.toISOString()}`,
  });
  if (error) {
    throw databaseError("Member provider side effects could not be claimed.");
  }
  const effects = (data ?? []) as MemberSideEffectRow[];
  const results = await mapConcurrent(effects, 5, async (effect) => {
    let errorCode: string | null = null;
    let succeeded = true;
    try {
      const outcome = await executeMemberSideEffect(admin, stripe, effect);
      errorCode = outcome === "superseded" ? "SUPERSEDED" : null;
    } catch (error) {
      succeeded = false;
      errorCode = safeMemberSideEffectErrorCode(error);
    }
    const { error: completionError } = await admin.rpc(
      "complete_member_side_effect",
      {
        p_error_code: errorCode,
        p_lease_token: effect.lease_token,
        p_outbox_id: effect.outbox_id,
        p_succeeded: succeeded,
      },
    );
    if (completionError) {
      throw databaseError("A member provider side effect could not be finalized.");
    }
    return succeeded;
  });
  return {
    failed: results.filter((succeeded) => !succeeded).length,
    processed: results.length,
  };
}

async function attachSystemPaymentIntent(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  options: {
    attemptId?: string;
    attemptKind: "charge" | "retry";
    idempotencyKey: string;
    paymentIntentId: string | null;
  },
): Promise<string> {
  const { data, error } = await admin.rpc("record_billing_attempt", {
    p_actor_user_id: null,
    p_amount_cents: payableShipmentAmount(shipment),
    p_attempt_kind: options.attemptKind,
    p_brand_id: shipment.brand_id,
    p_idempotency_key: options.idempotencyKey,
    p_metadata: { automatic: true },
    p_organization_id: shipment.organization_id,
    p_shipment_id: shipment.id,
    p_stripe_payment_intent_id: options.paymentIntentId,
  });
  if (error) throw databaseError("The scheduled billing attempt could not be recorded.");
  const attemptId = Array.isArray(data) ? data[0] : data;
  if (typeof attemptId !== "string") {
    throw databaseError("The scheduled billing attempt id is unavailable.");
  }
  if (options.attemptId && options.attemptId !== attemptId) {
    throw databaseError("The claimed billing attempt changed unexpectedly.");
  }
  return attemptId;
}

async function applySystemPaymentOutcome(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  attemptId: string,
  outcome: {
    chargeId: string | null;
    declineCode: string | null;
    declineReason: string | null;
    paymentIntentId: string | null;
    status: "succeeded" | "declined";
  },
): Promise<void> {
  const { error } = await admin.rpc("apply_shipment_payment_event", {
    p_billing_attempt_id: attemptId,
    p_brand_id: shipment.brand_id,
    p_decline_code: outcome.declineCode,
    p_decline_reason: outcome.declineReason,
    p_event_created_at: new Date().toISOString(),
    p_metadata: { automatic: true },
    p_organization_id: shipment.organization_id,
    p_shipment_id: shipment.id,
    p_status: outcome.status,
    p_stripe_charge_id: outcome.chargeId,
    p_stripe_event_id: null,
    p_stripe_refund_id: null,
  });
  if (error) {
    throw databaseError(
      outcome.status === "succeeded"
        ? "The scheduled charge moved money but its local ledger did not update."
        : "The scheduled decline could not be recorded.",
    );
  }
}

async function applyRefundRecoveryFailure(
  admin: SupabaseClient,
  attempt: ProcessingRefundAttemptRow,
  shipment: ShipmentPaymentRow,
  errorCode: string,
): Promise<void> {
  const { error } = await admin.rpc("apply_shipment_payment_event", {
    p_billing_attempt_id: attempt.id,
    p_brand_id: shipment.brand_id,
    p_decline_code: errorCode,
    p_decline_reason: "Stripe rejected the refund request.",
    p_event_created_at: new Date().toISOString(),
    p_metadata: {
      automatic: true,
      recovery: true,
    },
    p_organization_id: shipment.organization_id,
    p_shipment_id: shipment.id,
    p_status: "failed",
    p_stripe_charge_id: shipment.stripe_charge_id,
    p_stripe_event_id: null,
    p_stripe_refund_id: null,
  });
  if (error) {
    throw databaseError("The failed refund attempt could not be finalized.");
  }
}

export async function recoverRefundAttempt(
  admin: SupabaseClient,
  stripe: Stripe,
  attempt: ProcessingRefundAttemptRow,
): Promise<"failed" | "refunded" | "retry"> {
  const shipment = oneRelation(attempt.shipments);
  if (!shipment) {
    throw databaseError("The refund recovery shipment is unavailable.");
  }
  if (
    !shipment.stripe_payment_intent_id ||
    shipment.organization_id.length === 0 ||
    shipment.brand_id.length === 0
  ) {
    await applyRefundRecoveryFailure(
      admin,
      attempt,
      shipment,
      "LOCAL_REFERENCE_MISSING",
    );
    return "failed";
  }
  try {
    const refund = await stripe.refunds.create(
      {
        amount: attempt.amount_cents,
        metadata: {
          billing_attempt_id: attempt.id,
          brand_id: shipment.brand_id,
          organization_id: shipment.organization_id,
          reason:
            typeof attempt.metadata?.reason === "string"
              ? attempt.metadata.reason
              : "",
          shipment_id: shipment.id,
        },
        payment_intent: shipment.stripe_payment_intent_id,
        reason: "requested_by_customer",
      },
      { idempotencyKey: attempt.idempotency_key },
    );
    const { error } = await admin.rpc("apply_shipment_payment_event", {
      p_billing_attempt_id: attempt.id,
      p_brand_id: shipment.brand_id,
      p_decline_code: null,
      p_decline_reason: null,
      p_event_created_at: new Date().toISOString(),
      p_metadata: {
        automatic: true,
        recovery: true,
      },
      p_organization_id: shipment.organization_id,
      p_shipment_id: shipment.id,
      p_status: "refunded",
      p_stripe_charge_id: shipment.stripe_charge_id,
      p_stripe_event_id: null,
      p_stripe_refund_id: refund.id,
    });
    if (error) {
      throw databaseError(
        "The recovered refund succeeded but its local ledger did not update.",
      );
    }
    return "refunded";
  } catch (error) {
    if (isRetryableStripeRecoveryError(error)) return "retry";
    await applyRefundRecoveryFailure(
      admin,
      attempt,
      shipment,
      safeStripeRecoveryErrorCode(error),
    );
    return "failed";
  }
}


export async function chargeSystemShipment(
  env: WorkerEnv,
  admin: SupabaseClient,
  stripe: Stripe,
  shipment: ShipmentPaymentRow,
  options: {
    attemptId?: string;
    attemptKind: "charge" | "retry";
    idempotencyKey: string;
  },
): Promise<"charged" | "declined"> {
  assertStripeBillingAuthority(env);
  const member = oneRelation(shipment.members);
  if (
    !member ||
    member.organization_id !== shipment.organization_id ||
    member.brand_id !== shipment.brand_id
  ) {
    throw new AppError(403, "forbidden", "Scheduled shipment tenant validation failed.");
  }
  await assertBrandOperationalAccess(
    admin,
    shipment.organization_id,
    shipment.brand_id,
  );
  const avalara = await prepareAvalaraTax(env, admin, shipment);
  let attemptId =
    options.attemptId ??
    (await attachSystemPaymentIntent(admin, shipment, {
      ...options,
      paymentIntentId: null,
    }));
  const payableAmount = payableShipmentAmount(shipment);
  if (payableAmount === 0) {
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId: null,
      declineCode: null,
      declineReason: null,
      paymentIntentId: null,
      status: "succeeded",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "commit");
    return "charged";
  }
  const paymentMethodId = await resolveStripePaymentMethod(stripe, admin, member);
  if (!member.stripe_customer_id || !paymentMethodId) {
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId: null,
      declineCode: "payment_method_missing",
      declineReason: "The member has no saved payment method.",
      paymentIntentId: null,
      status: "declined",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "void");
    return "declined";
  }

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: payableAmount,
        automatic_payment_methods: { enabled: true },
        confirm: true,
        currency: "usd",
        customer: member.stripe_customer_id,
        description: `Vinifera release ${shipment.release_id}`,
        metadata: {
          brand_id: shipment.brand_id,
          member_id: shipment.member_id,
          organization_id: shipment.organization_id,
          release_id: shipment.release_id,
          shipment_id: shipment.id,
        },
        off_session: true,
        payment_method: paymentMethodId,
      },
      { idempotencyKey: options.idempotencyKey },
    );
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeCardError)) {
      await finalizeAvalaraTax(admin, shipment, avalara, "void").catch(
        () => undefined,
      );
      throw new AppError(
        502,
        "upstream_error",
        "Stripe could not confirm a scheduled shipment payment.",
      );
    }
    const paymentIntentId = error.payment_intent?.id ?? null;
    attemptId = await attachSystemPaymentIntent(admin, shipment, {
      ...options,
      attemptId,
      paymentIntentId,
    });
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId: null,
      declineCode: paymentDeclineReason(error),
      declineReason: error.message,
      paymentIntentId,
      status: "declined",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "void");
    return "declined";
  }
  attemptId = await attachSystemPaymentIntent(admin, shipment, {
    ...options,
    attemptId,
    paymentIntentId: paymentIntent.id,
  });
  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id ?? null;
  if (paymentIntent.status !== "succeeded") {
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId,
      declineCode:
        paymentIntent.last_payment_error?.decline_code ?? paymentIntent.status,
      declineReason:
        paymentIntent.last_payment_error?.message ??
        "Stripe did not complete the payment.",
      paymentIntentId: paymentIntent.id,
      status: "declined",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "void");
    return "declined";
  }
  await applySystemPaymentOutcome(admin, shipment, attemptId, {
    chargeId,
    declineCode: null,
    declineReason: null,
    paymentIntentId: paymentIntent.id,
    status: "succeeded",
  });
  await finalizeAvalaraTax(admin, shipment, avalara, "commit");
  return "charged";
}


export function scheduledBackoff(asOf: Date): string {
  return new Date(asOf.getTime() + 15 * 60 * 1_000).toISOString();
}


export async function requeueSystemAttempt(
  admin: SupabaseClient,
  attemptId: string,
  shipmentId: string,
  asOf: Date,
): Promise<void> {
  const retryAt = scheduledBackoff(asOf);
  const [{ error: attemptError }, { error: shipmentError }] = await Promise.all([
    admin
      .from("billing_attempts")
      .update({
        scheduled_for: retryAt,
        started_at: null,
        status: "queued",
      })
      .eq("id", attemptId)
      .eq("status", "processing"),
    admin
      .from("shipments")
      .update({ next_retry_at: retryAt })
      .eq("id", shipmentId)
      .eq("status", "declined"),
  ]);
  if (attemptError || shipmentError) {
    throw databaseError("The scheduled payment attempt could not be requeued.");
  }
}

export async function executeScheduledRetry(
  retry: ScheduledRetryRow,
  charge: () => Promise<"charged" | "declined">,
  requeue: (retry: ScheduledRetryRow) => Promise<void>,
): Promise<"charged" | "declined" | "failed"> {
  try {
    return await charge();
  } catch {
    await requeue(retry);
    return "failed";
  }
}
