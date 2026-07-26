import { AppError } from "../lib/errors";
import type {
  CloudflareCustomHostnameClient,
  CustomHostnameResult,
} from "./cloudflare-domains";

export interface CustomHostnameWriteClaim {
  attemptId: string;
  disposition: "busy" | "completed" | "create" | "lookup" | "reconcile";
  leaseToken: string | null;
  providerHostnameId: string | null;
}

export interface CustomHostnameWriteStore {
  claim(input: {
    brandId: string;
    hostname: string;
    leaseOwner: string;
    organizationId: string;
  }): Promise<CustomHostnameWriteClaim>;
  complete(attemptId: string, leaseToken: string): Promise<void>;
  markLookupRequired(
    attemptId: string,
    leaseToken: string,
    errorCode: string,
  ): Promise<void>;
  recordProviderResult(
    attemptId: string,
    leaseToken: string,
    providerHostnameId: string,
  ): Promise<void>;
  releaseLookup(
    attemptId: string,
    leaseToken: string,
    errorCode: string,
  ): Promise<void>;
}

function requireLease(claim: CustomHostnameWriteClaim): string {
  if (!claim.leaseToken) {
    throw new AppError(
      503,
      "activation_required",
      "The custom-hostname write lease is unavailable.",
    );
  }
  return claim.leaseToken;
}

export async function executeRetrySafeCustomHostnameWrite(input: {
  brandId: string;
  client: Pick<
    CloudflareCustomHostnameClient,
    "createHostname" | "findHostname" | "getHostname"
  >;
  hostname: string;
  leaseOwner: string;
  organizationId: string;
  persist: (result: CustomHostnameResult) => Promise<void>;
  store: CustomHostnameWriteStore;
}): Promise<CustomHostnameResult> {
  const claim = await input.store.claim({
    brandId: input.brandId,
    hostname: input.hostname,
    leaseOwner: input.leaseOwner,
    organizationId: input.organizationId,
  });
  if (claim.disposition === "busy") {
    throw new AppError(
      409,
      "conflict",
      "Custom-hostname reconciliation is already in progress.",
    );
  }

  let result: CustomHostnameResult | null = null;
  if (claim.disposition === "create") {
    const leaseToken = requireLease(claim);
    try {
      result = await input.client.createHostname(
        input.hostname,
        input.brandId,
      );
    } catch {
      await input.store
        .markLookupRequired(
          claim.attemptId,
          leaseToken,
          "CREATE_RESULT_UNKNOWN",
        )
        .catch(() => undefined);
      throw new AppError(
        502,
        "upstream_error",
        "The custom-hostname creation result requires provider reconciliation.",
      );
    }
  } else if (claim.providerHostnameId) {
    result = await input.client.getHostname(claim.providerHostnameId);
  } else if (claim.disposition === "lookup") {
    const leaseToken = requireLease(claim);
    result = await input.client.findHostname(input.hostname, input.brandId);
    if (!result) {
      await input.store.releaseLookup(
        claim.attemptId,
        leaseToken,
        "PROVIDER_HOSTNAME_NOT_FOUND",
      );
      throw new AppError(
        503,
        "activation_required",
        "The custom-hostname result is awaiting provider reconciliation.",
      );
    }
  } else {
    throw new AppError(
      503,
      "activation_required",
      "The custom-hostname provider identity is unavailable.",
    );
  }

  if (
    !result.externalId ||
    result.hostname !== input.hostname
  ) {
    throw new AppError(
      502,
      "upstream_error",
      "The custom-hostname provider returned an invalid target.",
    );
  }

  if (
    claim.disposition === "create" ||
    claim.disposition === "lookup"
  ) {
    const leaseToken = requireLease(claim);
    await input.store.recordProviderResult(
      claim.attemptId,
      leaseToken,
      result.externalId,
    );
  }
  await input.persist(result);
  if (claim.disposition !== "completed") {
    const leaseToken = requireLease(claim);
    await input.store.complete(claim.attemptId, leaseToken);
  }
  return result;
}
