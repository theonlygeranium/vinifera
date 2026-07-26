import { describe, expect, it, vi } from "vitest";
import { AvalaraClient } from "../../server/integrations/avalara";
import {
  quickBooksRefundDeltaLineFinancials,
  quickBooksShipmentLineFinancials,
  resolveQuickBooksAccountMapping,
} from "../../server/services/integrations";

const address = {
  city: "Napa",
  country: "US",
  line1: "1 Winery Way",
  postalCode: "94558",
  state: "CA",
};

describe("Phase 5 tax and accounting facts", () => {
  it("sends durable wine, shipping, customer, and exemption mappings to Avalara", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      const body = JSON.parse(await request.text());
      expect(body).toMatchObject({
        customerCode: "ava-customer-42",
        entityUseCode: "A",
        exemptionNo: "CERT-2026-42",
      });
      expect(body.lines).toEqual([
        expect.objectContaining({
          amount: 85,
          itemCode: "wine-tier-reserve",
          taxCode: "P0000000",
        }),
        expect.objectContaining({
          amount: 15,
          itemCode: "shipping-standard",
          taxCode: "FR020000",
        }),
      ]);
      return new Response(
        JSON.stringify({
          code: "shipment-42",
          currencyCode: "USD",
          id: 42,
          lines: [
            {
              exemptAmount: 5,
              itemCode: "wine-tier-reserve",
              tax: 6.2,
            },
            {
              exemptAmount: 0,
              itemCode: "shipping-standard",
              tax: 1.05,
            },
          ],
          status: "Saved",
          totalAmount: 100,
          totalTax: 7.25,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    });
    const client = new AvalaraClient(
      {
        accountId: "account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "license",
      },
      { fetcher },
    );

    await expect(
      client.createTaxQuote({
        currencyCode: "USD",
        customerCode: "ava-customer-42",
        destination: address,
        entityUseCode: "A",
        exemptionNumber: "CERT-2026-42",
        lines: [
          {
            amountCents: 8_500,
            description: "Reserve tier wine",
            itemCode: "wine-tier-reserve",
            kind: "wine",
            quantity: 1,
            taxCode: "P0000000",
          },
          {
            amountCents: 1_500,
            description: "Shipping",
            itemCode: "shipping-standard",
            kind: "shipping",
            quantity: 1,
            taxCode: "FR020000",
          },
        ],
        origin: address,
        transactionCode: "shipment-42",
        transactionDate: "2026-07-26",
      }),
    ).resolves.toMatchObject({
      exemptAmountCents: 500,
      shippingTaxCents: 105,
      taxCents: 725,
      totalCents: 10_000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("exposes filing registration as a read-only verification request", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("GET");
      expect(request.url).toContain("/filingcalendars");
      expect(request.url).toContain("$filter=active%20eq%20true");
      expect(await request.text()).toBe("");
      return new Response(
        JSON.stringify({
          value: [
            {
              active: true,
              filingFrequencyCode: "Monthly",
              id: 17,
              region: "CA",
              status: "Active",
            },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    });
    const client = new AvalaraClient(
      {
        accountId: "account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "license",
      },
      { fetcher },
    );

    await expect(client.getFilingRegistrationStatus()).resolves.toMatchObject({
      registered: true,
      registrations: [
        {
          filingCalendarId: 17,
          filingFrequency: "Monthly",
          regionCode: "CA",
          status: "active",
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("attributes duplicate Avalara item codes by provider line number", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: "shipment-duplicate-items",
          currencyCode: "USD",
          id: 43,
          lines: [
            { itemCode: "shared-item", lineNumber: 2, tax: 1.05 },
            { itemCode: "shared-item", lineNumber: 1, tax: 6.2 },
          ],
          status: "Saved",
          totalAmount: 100,
          totalTax: 7.25,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );
    const client = new AvalaraClient(
      {
        accountId: "account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "license",
      },
      { fetcher },
    );

    await expect(
      client.createTaxQuote({
        currencyCode: "USD",
        customerCode: "customer",
        destination: address,
        lines: [
          {
            amountCents: 8_500,
            description: "Wine",
            itemCode: "shared-item",
            kind: "wine",
            quantity: 1,
            taxCode: "P0000000",
          },
          {
            amountCents: 1_500,
            description: "Shipping",
            itemCode: "shared-item",
            kind: "shipping",
            quantity: 1,
            taxCode: "FR020000",
          },
        ],
        origin: address,
        transactionCode: "shipment-duplicate-items",
        transactionDate: "2026-07-26",
      }),
    ).resolves.toMatchObject({ shippingTaxCents: 105 });
  });

  it("resolves exact QuickBooks tier mappings before the single fallback", () => {
    const fallback = {
      club_tier_id: null,
      mapping_kind: "membership",
      quickbooks_account_id: "fallback-account",
      quickbooks_item_id: "fallback-item",
    };
    const exact = {
      club_tier_id: "tier-reserve",
      mapping_kind: "membership",
      quickbooks_account_id: "reserve-account",
      quickbooks_item_id: "reserve-item",
    };

    expect(
      resolveQuickBooksAccountMapping(
        [fallback, exact],
        "membership",
        "tier-reserve",
      ),
    ).toBe(exact);
    expect(
      resolveQuickBooksAccountMapping(
        [exact, fallback],
        "membership",
        "tier-cellar",
      ),
    ).toBe(fallback);
  });

  it("keeps shipping as a separate sale fact and apportions refund deltas", () => {
    const shipment = {
      charge_amount_cents: 10_000,
      loyalty_discount_cents: 500,
      shipping_charge_cents: 1_500,
      tax_amount_cents: 800,
    };

    expect(quickBooksShipmentLineFinancials(shipment)).toEqual({
      shippingCents: 1_500,
      taxCents: 800,
      totalCents: 10_300,
      wineCents: 8_000,
    });
    expect(quickBooksShipmentLineFinancials(shipment, 5_150)).toEqual({
      shippingCents: 750,
      taxCents: 400,
      totalCents: 5_150,
      wineCents: 4_000,
    });
    expect(
      quickBooksRefundDeltaLineFinancials(shipment, 2_060, 5_150),
    ).toEqual({
      shippingCents: 450,
      taxCents: 240,
      totalCents: 3_090,
      wineCents: 2_400,
    });
  });
});
