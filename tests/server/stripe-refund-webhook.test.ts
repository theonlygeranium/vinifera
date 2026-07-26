import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { recoverRefundAttempt } from "../../server/services/core-club";
import { ProductionFoundationService } from "../../server/services/production-foundation";
import type { WorkerEnv } from "../../server/types";

describe("Stripe shipment refund webhook reconciliation", () => {
  it("attaches a staff partial-refund event to the same attempt without replaying financials", async () => {
    const attemptId = "40000000-0000-4000-8000-000000000004";
    const organizationId = "10000000-0000-4000-8000-000000000001";
    const brandId = "20000000-0000-4000-8000-000000000002";
    const shipmentId = "30000000-0000-4000-8000-000000000003";
    const webhookSecret = "whsec_refund_reconciliation";
    const event = {
      api_version: "2026-02-25.clover",
      created: Math.floor(Date.now() / 1_000),
      data: {
        object: {
          amount_refunded: 4_000,
          id: "ch_StaffPartial1",
          object: "charge",
          payment_intent: "pi_StaffPartial1",
          refunds: {
            data: [
              {
                amount: 4_000,
                created: Math.floor(Date.now() / 1_000),
                id: "re_StaffPartial1",
                metadata: { billing_attempt_id: attemptId },
                object: "refund",
              },
            ],
            object: "list",
          },
        },
      },
      id: "evt_StaffPartialRefund1",
      livemode: false,
      object: "event",
      pending_webhooks: 1,
      type: "charge.refunded",
    };
    const payload = JSON.stringify(event);
    const signature = new Stripe("sk_test_refund_reconciliation").webhooks
      .generateTestHeaderString({
        payload,
        secret: webhookSecret,
      });
    const shipment = {
      brand_id: brandId,
      charge_amount_cents: 12_000,
      id: shipmentId,
      organization_id: organizationId,
      refund_amount_cents: 4_000,
      stripe_charge_id: "ch_StaffPartial1",
      stripe_payment_intent_id: "pi_StaffPartial1",
    };
    const attempt = {
      amount_cents: 4_000,
      id: attemptId,
      status: "refunded",
      stripe_event_id: null as string | null,
      stripe_refund_id: "re_StaffPartial1",
    };
    const financials = { lifetimeValueCents: 8_000, refundAmountCents: 4_000 };
    const rpc = vi.fn(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "record_billing_attempt") {
          throw new Error("refund webhook created a duplicate attempt");
        }
        expect(name).toBe("apply_shipment_payment_event");
        expect(parameters).toMatchObject({
          p_billing_attempt_id: attemptId,
          p_stripe_event_id: event.id,
          p_stripe_refund_id: "re_StaffPartial1",
        });
        attempt.stripe_event_id = event.id;
        return { data: "charged", error: null };
      },
    );
    const admin = {
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const builder: Record<string, unknown> = {};
        for (const method of ["eq", "in", "order", "select"]) {
          builder[method] = (...args: unknown[]) => {
            if (method === "eq") filters[String(args[0])] = args[1];
            return builder;
          };
        }
        builder.maybeSingle = async () => {
          if (table === "shipments") return { data: shipment, error: null };
          if (filters.stripe_event_id === event.id) {
            return {
              data: attempt.stripe_event_id ? { id: attempt.id } : null,
              error: null,
            };
          }
          return { data: null, error: null };
        };
        builder.then = (
          fulfilled: (value: {
            data: Array<typeof attempt>;
            error: null;
          }) => unknown,
        ) =>
          Promise.resolve({
            data:
              table === "billing_attempts" &&
              filters.attempt_kind === "refund"
                ? [attempt]
                : [],
            error: null,
          }).then(fulfilled);
        return builder;
      },
      rpc,
    };
    const env: WorkerEnv = {
      APP_ENV: "test",
      STRIPE_SECRET_KEY: "sk_test_refund_reconciliation",
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      SUPABASE_SECRET_KEY: "service-role-test-key",
      SUPABASE_URL: "https://vinifera-test.supabase.co",
    };
    const request = {
      get: () => undefined,
      headers: {},
      protocol: "https",
    };
    const response = { append: vi.fn() };
    const service = new ProductionFoundationService(
      env,
      request as never,
      response as never,
    );
    Object.defineProperty(service, "admin", { value: admin });

    await expect(
      service.handleStripeWebhook(Buffer.from(payload), signature),
    ).resolves.toEqual({ duplicate: false });
    expect(financials).toEqual({
      lifetimeValueCents: 8_000,
      refundAmountCents: 4_000,
    });
    expect(attempt.stripe_event_id).toBe(event.id);
    expect(rpc).toHaveBeenCalledTimes(1);

    await expect(
      service.handleStripeWebhook(Buffer.from(payload), signature),
    ).resolves.toEqual({ duplicate: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(financials).toEqual({
      lifetimeValueCents: 8_000,
      refundAmountCents: 4_000,
    });
  });
});

describe("Stripe shipment refund recovery", () => {
  const attempt = {
    amount_cents: 4_000,
    id: "40000000-0000-4000-8000-000000000014",
    idempotency_key:
      "shipment:30000000-0000-4000-8000-000000000013:refund:80000000-0000-4000-8000-000000000014",
    metadata: { reason: "customer_request" },
    recovery_lease_token: "refund-lease",
    shipments: {
      brand_id: "20000000-0000-4000-8000-000000000012",
      charge_amount_cents: 12_000,
      id: "30000000-0000-4000-8000-000000000013",
      loyalty_discount_cents: 0,
      loyalty_redemption_id: null,
      member_id: "50000000-0000-4000-8000-000000000015",
      organization_id: "10000000-0000-4000-8000-000000000011",
      release_id: "60000000-0000-4000-8000-000000000016",
      retry_count: 0,
      shipping_charge_cents: 0,
      status: "charged" as const,
      stripe_charge_id: "ch_Recovery",
      stripe_payment_intent_id: "pi_Recovery",
      tax_amount_cents: 0,
    },
  };

  it("leaves a retryable Stripe ambiguity processing for the leased scheduler", async () => {
    const rpc = vi.fn();
    const stripe = {
      refunds: {
        create: vi.fn().mockRejectedValue(
          new Stripe.errors.StripeConnectionError({
            message: "connection reset after request",
            type: "api_error",
          }),
        ),
      },
    } as unknown as Stripe;

    await expect(
      recoverRefundAttempt({ rpc } as never, stripe, attempt),
    ).resolves.toBe("retry");

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4_000,
        payment_intent: "pi_Recovery",
      }),
      { idempotencyKey: attempt.idempotency_key },
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a definitive Stripe rejection as a failed billing attempt", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const stripe = {
      refunds: {
        create: vi.fn().mockRejectedValue(
          new Stripe.errors.StripeInvalidRequestError({
            code: "charge_already_refunded",
            message: "Charge has already been refunded.",
            type: "invalid_request_error",
          }),
        ),
      },
    } as unknown as Stripe;

    await expect(
      recoverRefundAttempt({ rpc } as never, stripe, attempt),
    ).resolves.toBe("failed");

    expect(rpc).toHaveBeenCalledWith(
      "apply_shipment_payment_event",
      expect.objectContaining({
        p_billing_attempt_id: attempt.id,
        p_decline_code: "STRIPE_STRIPEINVALIDREQUESTERROR",
        p_decline_reason: "Stripe rejected the refund request.",
        p_organization_id: attempt.shipments.organization_id,
        p_shipment_id: attempt.shipments.id,
        p_status: "failed",
        p_stripe_charge_id: "ch_Recovery",
        p_stripe_event_id: null,
        p_stripe_refund_id: null,
      }),
    );
  });
});
