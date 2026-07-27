import { AppError, requireConfigured } from "../lib/errors";
import { sha256 } from "../lib/utils";
import { assertEasyPostTarget } from "../provider-targets";
import type { PostalAddress, WorkerEnv } from "../types";

const DEFAULT_ALLOWED_STATES = new Set([
  "AK",
  "AZ",
  "CA",
  "CO",
  "CT",
  "DC",
  "FL",
  "GA",
  "HI",
  "IA",
  "ID",
  "IL",
  "IN",
  "KS",
  "LA",
  "MA",
  "MD",
  "ME",
  "MI",
  "MN",
  "MO",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "TN",
  "TX",
  "VA",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
]);

export interface AddressValidationResult {
  address: PostalAddress;
  messages: string[];
  providerReference?: string;
  valid: boolean;
}

export interface LabelRequest {
  externalId: string;
  fromAddress: PostalAddress;
  fromContact: { company?: string; name: string; phone: string };
  parcel: {
    heightInches: number;
    lengthInches: number;
    weightOunces: number;
    widthInches: number;
  };
  toAddress: PostalAddress;
  toContact: { company?: string; name: string; phone: string };
}

export interface LabelResult {
  carrier: string;
  labelId: string;
  labelUrl: string;
  providerReference: string;
  rateId: string;
  rateCents: number;
  service: string;
  trackingNumber: string;
}

export interface LabelPurchaseRecovery {
  externalRateId?: string | null;
  externalShipmentId?: string | null;
  persistExternalShipment: (
    externalShipmentId: string,
    externalRateId: string,
  ) => Promise<void>;
}

export interface ShippingProvider {
  createLabel(
    input: LabelRequest,
    recovery?: LabelPurchaseRecovery,
  ): Promise<LabelResult>;
  validateAddress(address: PostalAddress): Promise<AddressValidationResult>;
}

function allowedStates(env: WorkerEnv): Set<string> {
  const configured = env.SHIPPING_ALLOWED_STATES?.split(",")
    .map((state) => state.trim().toUpperCase())
    .filter(Boolean);
  return configured?.length ? new Set(configured) : DEFAULT_ALLOWED_STATES;
}

/**
 * Phase 2's state whitelist is retained only as an explicitly inactive
 * emergency reference. It is not a legal compliance decision and is never
 * consulted by address validation, the compliance dashboard, or label
 * generation after the Phase 4 ShipCompliant gate was introduced.
 */
export function assessLegacyShippingWhitelist(
  env: WorkerEnv,
  address: PostalAddress,
): { allowed: boolean; reason: string | null } {
  const countryAllowed = address.country.toUpperCase() === "US";
  const stateAllowed = allowedStates(env).has(address.state.toUpperCase());
  return {
    allowed: countryAllowed && stateAllowed,
    reason: countryAllowed
      ? stateAllowed
        ? null
        : `The legacy Phase 2 whitelist did not include ${address.state.toUpperCase()}.`
      : "The legacy Phase 2 whitelist covered only United States destinations.",
  };
}

function deterministicDigits(hash: string, length: number): string {
  return hash
    .slice(0, length)
    .split("")
    .map((character) => (Number.parseInt(character, 16) % 10).toString())
    .join("");
}

export class SimulatedShippingProvider implements ShippingProvider {
  async validateAddress(address: PostalAddress): Promise<AddressValidationResult> {
    const valid =
      address.line1.trim().length >= 3 &&
      address.city.trim().length >= 2 &&
      /^[A-Z]{2}$/i.test(address.state) &&
      /^\d{5}(?:-\d{4})?$/.test(address.postalCode) &&
      address.country.toUpperCase() === "US";
    return {
      address: {
        ...address,
        country: address.country.toUpperCase(),
        state: address.state.toUpperCase(),
      },
      messages: valid ? [] : ["The address is incomplete or invalid."],
      valid,
    };
  }

  async createLabel(
    input: LabelRequest,
    recovery?: LabelPurchaseRecovery,
  ): Promise<LabelResult> {
    const hash = await sha256(JSON.stringify(input));
    const label = {
      carrier: "SIMULATED",
      labelId: `simlabel_${hash.slice(0, 18)}`,
      labelUrl: `https://example.invalid/labels/${hash.slice(0, 24)}.pdf`,
      providerReference:
        recovery?.externalShipmentId ?? `simshipment_${hash.slice(0, 18)}`,
      rateId: recovery?.externalRateId ?? `simrate_${hash.slice(0, 18)}`,
      rateCents: 1_595,
      service: "Ground",
      trackingNumber: `1ZSIM${deterministicDigits(hash, 12)}`,
    };
    if (!recovery) {
      throw new AppError(
        503,
        "activation_required",
        "Simulated label creation requires a durable database attempt lease.",
      );
    }
    if (!recovery.externalShipmentId) {
      await recovery.persistExternalShipment(
        label.providerReference,
        label.rateId,
      );
    }
    return label;
  }
}

interface EasyPostAddress {
  city?: string;
  country?: string;
  id?: string;
  message?: string;
  state?: string;
  street1?: string;
  street2?: string;
  verifications?: {
    delivery?: {
      errors?: Array<{ message?: string }>;
      success?: boolean;
    };
  };
  zip?: string;
}

interface EasyPostRate {
  carrier?: string;
  id?: string;
  rate?: string;
  service?: string;
}

interface EasyPostShipment {
  id?: string;
  lowest_rate?: EasyPostRate;
  postage_label?: { id?: string; label_file_type?: string; label_url?: string };
  rates?: EasyPostRate[];
  selected_rate?: EasyPostRate;
  tracker?: { tracking_code?: string };
  tracking_code?: string;
}

export class EasyPostShippingProvider implements ShippingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    authority: {
      appEnvironment: WorkerEnv["APP_ENV"];
      liveLabelsEnabled?: WorkerEnv["EASYPOST_LIVE_LABELS_ENABLED"];
    } = {
      appEnvironment: "test",
      liveLabelsEnabled: "false",
    },
  ) {
    assertEasyPostTarget({
      apiKey,
      appEnvironment: authority.appEnvironment,
      liveLabelsEnabled: authority.liveLabelsEnabled,
    });
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(`https://api.easypost.com/v2${path}`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "shipping.provider_request_failed",
          path,
          status: response.status,
        }),
      );
      throw new AppError(
        502,
        "upstream_error",
        "The shipping provider rejected the request.",
      );
    }
    return payload;
  }

  private async retrieve<T>(path: string): Promise<T> {
    const response = await this.fetcher(`https://api.easypost.com/v2${path}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        Accept: "application/json",
      },
      method: "GET",
    });
    const payload = (await response.json()) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "shipping.provider_retrieval_failed",
          path,
          status: response.status,
        }),
      );
      throw new AppError(
        502,
        "upstream_error",
        "The stored carrier shipment could not be retrieved.",
      );
    }
    return payload;
  }

  async validateAddress(address: PostalAddress): Promise<AddressValidationResult> {
    const result = await this.request<EasyPostAddress>("/addresses", {
      address: {
        city: address.city,
        country: address.country,
        state: address.state,
        street1: address.line1,
        street2: address.line2 || undefined,
        zip: address.postalCode,
      },
      verify: true,
    });
    const delivery = result.verifications?.delivery;
    const messages = (delivery?.errors ?? [])
      .map((error) => error.message)
      .filter((message): message is string => Boolean(message));
    return {
      address: {
        city: result.city ?? address.city,
        country: result.country ?? address.country,
        line1: result.street1 ?? address.line1,
        line2: result.street2 ?? address.line2,
        postalCode: result.zip ?? address.postalCode,
        state: result.state ?? address.state,
      },
      messages,
      providerReference: result.id,
      valid: delivery?.success === true,
    };
  }

  async createLabel(
    input: LabelRequest,
    recovery?: LabelPurchaseRecovery,
  ): Promise<LabelResult> {
    let shipment = recovery?.externalShipmentId
      ? await this.retrieve<EasyPostShipment>(
          `/shipments/${encodeURIComponent(recovery.externalShipmentId)}`,
        )
      : await this.request<EasyPostShipment>("/shipments", {
          shipment: {
            from_address: toEasyPostAddress(input.fromAddress, input.fromContact),
            options: {
              alcohol: true,
              delivery_confirmation: "ADULT_SIGNATURE",
            },
            parcel: {
              height: input.parcel.heightInches,
              length: input.parcel.lengthInches,
              weight: input.parcel.weightOunces,
              width: input.parcel.widthInches,
            },
            reference: input.externalId,
            to_address: toEasyPostAddress(input.toAddress, input.toContact),
          },
        });
    const rate =
      shipment.rates?.find((candidate) =>
        recovery?.externalRateId
          ? candidate.id === recovery.externalRateId
          : false,
      ) ??
      shipment.selected_rate ??
      shipment.lowest_rate ??
      [...(shipment.rates ?? [])].sort(
        (left, right) => Number(left.rate ?? Infinity) - Number(right.rate ?? Infinity),
      )[0];
    if (!shipment.id || !rate?.id) {
      throw new AppError(502, "upstream_error", "No carrier rate is available.");
    }
    if (!recovery?.externalShipmentId) {
      if (!recovery) {
        throw new AppError(
          503,
          "activation_required",
          "EasyPost label purchases require a durable database attempt lease.",
        );
      }
      await recovery.persistExternalShipment(shipment.id, rate.id);
    }
    const alreadyPurchased =
      Boolean(shipment.postage_label?.label_url) &&
      Boolean(shipment.tracking_code ?? shipment.tracker?.tracking_code);
    const purchased = alreadyPurchased
      ? shipment
      : await this.request<EasyPostShipment>(
          `/shipments/${shipment.id}/buy`,
          { rate: { id: rate.id } },
        );
    const purchasedRate = purchased.selected_rate ?? rate;
    const trackingNumber =
      purchased.tracking_code ?? purchased.tracker?.tracking_code;
    const labelUrl = purchased.postage_label?.label_url;
    if (!trackingNumber || !labelUrl) {
      throw new AppError(502, "upstream_error", "The carrier did not return a label.");
    }
    return {
      carrier: purchasedRate.carrier ?? "unknown",
      labelId:
        purchased.postage_label?.id ??
        `easypost_label_${(purchased.id ?? shipment.id).slice(0, 20)}`,
      labelUrl,
      providerReference: purchased.id ?? shipment.id,
      rateId: purchasedRate.id ?? rate.id,
      rateCents: Math.round(Number(purchasedRate.rate ?? 0) * 100),
      service: purchasedRate.service ?? "unknown",
      trackingNumber,
    };
  }
}

function toEasyPostAddress(
  address: PostalAddress,
  contact?: { company?: string; name: string; phone: string },
): Record<string, string | undefined> {
  return {
    city: address.city,
    company: contact?.company,
    country: address.country,
    name: contact?.name,
    phone: contact?.phone,
    state: address.state,
    street1: address.line1,
    street2: address.line2 || undefined,
    zip: address.postalCode,
  };
}

export function createShippingProvider(env: WorkerEnv): ShippingProvider {
  if (env.SHIPPING_PROVIDER === "simulated") {
    if (
      env.APP_ENV !== "test" ||
      env.SHIPPING_SIMULATOR_ENABLED !== "true"
    ) {
      throw new AppError(
        503,
        "activation_required",
        "The shipping simulator requires APP_ENV=test and SHIPPING_SIMULATOR_ENABLED=true.",
      );
    }
    return new SimulatedShippingProvider();
  }
  if (env.SHIPPING_PROVIDER === "easypost") {
    return new EasyPostShippingProvider(
      requireConfigured(env.EASYPOST_API_KEY, "EASYPOST_API_KEY"),
      fetch,
      {
        appEnvironment: env.APP_ENV,
        liveLabelsEnabled: env.EASYPOST_LIVE_LABELS_ENABLED,
      },
    );
  }
  throw new AppError(
    503,
    "activation_required",
    "SHIPPING_PROVIDER must be connected before shipping operations can run.",
  );
}

function isUsableShippingPhone(value: string): boolean {
  return value.replaceAll(/\D/g, "").length >= 10;
}

export function isCompleteShippingContact(
  contact: { company?: string; name: string; phone: string },
  requireCompany = false,
): boolean {
  return Boolean(
    contact.name.trim() &&
      isUsableShippingPhone(contact.phone) &&
      (!requireCompany || contact.company?.trim()),
  );
}
