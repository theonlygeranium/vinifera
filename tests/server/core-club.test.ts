import { describe, expect, it, vi } from "vitest";
import {
  createShippingProvider,
  executeScheduledRetry,
  isCompleteShippingContact,
  resumeProcessingReleaseShipments,
  SimulatedShippingProvider,
} from "../../server/services/core-club";

const address = {
  city: "Napa",
  country: "US",
  line1: "1 Wine Way",
  postalCode: "94558",
  state: "CA",
};

describe("Phase 2 shipping provider boundary", () => {
  it("never permits the deterministic simulator in production", () => {
    expect(() =>
      createShippingProvider({
        APP_ENV: "production",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "true",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "activation_required",
        status: 503,
      }),
    );
  });

  it("requires both test mode and an explicit simulator flag", () => {
    expect(() =>
      createShippingProvider({
        APP_ENV: "test",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "false",
      }),
    ).toThrowError(expect.objectContaining({ code: "activation_required" }));
    expect(
      createShippingProvider({
        APP_ENV: "test",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "true",
      }),
    ).toBeInstanceOf(SimulatedShippingProvider);
  });

  it("creates reproducible non-production labels without card or credential data", async () => {
    const provider = new SimulatedShippingProvider();
    const input = {
      externalId: "50000000-0000-4000-8000-000000000001",
      fromAddress: address,
      fromContact: {
        company: "Test Winery",
        name: "Test Winery",
        phone: "7075550100",
      },
      parcel: {
        heightInches: 6,
        lengthInches: 14,
        weightOunces: 96,
        widthInches: 12,
      },
      toAddress: { ...address, line1: "2 Member Lane" },
      toContact: { name: "Avery Vine", phone: "7075550101" },
    };

    const persisted: string[] = [];
    const first = await provider.createLabel(input, {
      persistExternalShipment: async (shipmentId, rateId) => {
        persisted.push(shipmentId, rateId);
      },
    });
    const second = await provider.createLabel(input, {
      externalRateId: first.rateId,
      externalShipmentId: first.providerReference,
      persistExternalShipment: async () => {
        throw new Error("Recovery must not persist a second shipment.");
      },
    });

    expect(first).toEqual(second);
    expect(persisted).toEqual([first.providerReference, first.rateId]);
    expect(first.trackingNumber).toMatch(/^1ZSIM\d{12}$/);
    expect(first.labelUrl).toMatch(/^https:\/\/example\.invalid\/labels\//);
  });

  it("rejects malformed addresses in deterministic tests", async () => {
    const result = await new SimulatedShippingProvider().validateAddress({
      ...address,
      line1: "",
      postalCode: "bad",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("The address is incomplete or invalid.");
  });

  it("rejects incomplete adult-signature contacts before calling a carrier", () => {
    expect(
      isCompleteShippingContact(
        { company: "Test Winery", name: "Test Winery", phone: "" },
        true,
      ),
    ).toBe(false);
    expect(
      isCompleteShippingContact({
        name: "Avery Vine",
        phone: "707-555-0101",
      }),
    ).toBe(true);
  });
});

describe("Phase 2 scheduled operations", () => {
  it("resumes every due processing release even when it was not newly claimed", async () => {
    const createShipments = vi.fn().mockResolvedValue(undefined);
    const failed = await resumeProcessingReleaseShipments(
      [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: "10000000-0000-4000-8000-000000000001",
        },
      ],
      createShipments,
    );

    expect(failed).toBe(0);
    expect(createShipments).toHaveBeenCalledWith({
      id: "60000000-0000-4000-8000-000000000001",
      organization_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("requeues a claimed decline retry when its provider call is transiently unavailable", async () => {
    const retry = {
      amount_cents: 12500,
      attempt_number: 2,
      billing_attempt_id: "70000000-0000-4000-8000-000000000001",
      member_id: "30000000-0000-4000-8000-000000000001",
      organization_id: "10000000-0000-4000-8000-000000000001",
      shipment_id: "50000000-0000-4000-8000-000000000001",
    };
    const requeue = vi.fn().mockResolvedValue(undefined);
    const result = await executeScheduledRetry(
      retry,
      vi.fn().mockRejectedValue(new Error("temporary Stripe timeout")),
      requeue,
    );

    expect(result).toBe("failed");
    expect(requeue).toHaveBeenCalledWith(retry);
  });
});
