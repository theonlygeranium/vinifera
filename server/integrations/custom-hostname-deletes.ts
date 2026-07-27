import { AppError } from "../lib/errors";
import type {
  CloudflareCustomHostnameClient,
  CustomHostnameResult,
} from "./cloudflare-domains";

export interface CustomHostnameDeleteClaim {
  attemptId: string;
  disposition: "busy" | "completed" | "delete" | "lookup" | "reconcile";
  leaseToken: string | null;
}

export interface CustomHostnameDeleteStore {
  authorizeDeleteAfterLookup(
    attemptId: string,
    leaseToken: string,
  ): Promise<void>;
  claim(input: {
    brandId: string;
    hostname: string;
    leaseOwner: string;
    organizationId: string;
    providerHostnameId: string;
  }): Promise<CustomHostnameDeleteClaim>;
  complete(attemptId: string, leaseToken: string): Promise<void>;
  markLookupRequired(
    attemptId: string,
    leaseToken: string,
    errorCode: string,
  ): Promise<void>;
  recordProviderAbsent(attemptId: string, leaseToken: string): Promise<void>;
  releaseLookup(
    attemptId: string,
    leaseToken: string,
    errorCode: string,
  ): Promise<void>;
}

function requireLease(claim: CustomHostnameDeleteClaim): string {
  if (!claim.leaseToken) {
    throw new AppError(
      503,
      "activation_required",
      "The custom-hostname deletion lease is unavailable.",
    );
  }
  return claim.leaseToken;
}

async function deleteOnce(input: {
  attemptId: string;
  client: Pick<CloudflareCustomHostnameClient, "deleteHostname">;
  leaseToken: string;
  providerHostnameId: string;
  store: CustomHostnameDeleteStore;
}): Promise<void> {
  try {
    await input.client.deleteHostname(input.providerHostnameId);
  } catch {
    await input.store
      .markLookupRequired(
        input.attemptId,
        input.leaseToken,
        "DELETE_RESULT_UNKNOWN",
      )
      .catch(() => undefined);
    throw new AppError(
      502,
      "upstream_error",
      "The custom-hostname deletion result requires provider reconciliation.",
    );
  }
}

export async function executeRetrySafeCustomHostnameDelete(input: {
  brandId: string;
  client: Pick<
    CloudflareCustomHostnameClient,
    "deleteHostname" | "findHostnameById"
  >;
  hostname: string;
  leaseOwner: string;
  organizationId: string;
  providerHostnameId: string;
  store: CustomHostnameDeleteStore;
}): Promise<void> {
  const claim = await input.store.claim({
    brandId: input.brandId,
    hostname: input.hostname,
    leaseOwner: input.leaseOwner,
    organizationId: input.organizationId,
    providerHostnameId: input.providerHostnameId,
  });
  if (claim.disposition === "busy") {
    throw new AppError(
      409,
      "conflict",
      "Custom-hostname deletion reconciliation is already in progress.",
    );
  }
  if (claim.disposition === "completed") return;

  const leaseToken = requireLease(claim);
  if (claim.disposition === "delete") {
    await deleteOnce({
      attemptId: claim.attemptId,
      client: input.client,
      leaseToken,
      providerHostnameId: input.providerHostnameId,
      store: input.store,
    });
    await input.store.recordProviderAbsent(claim.attemptId, leaseToken);
  } else if (claim.disposition === "lookup") {
    let providerResult: CustomHostnameResult | null;
    try {
      providerResult = await input.client.findHostnameById(
        input.providerHostnameId,
      );
    } catch {
      await input.store
        .releaseLookup(
          claim.attemptId,
          leaseToken,
          "DELETE_LOOKUP_UNAVAILABLE",
        )
        .catch(() => undefined);
      throw new AppError(
        502,
        "upstream_error",
        "The custom-hostname deletion lookup is unavailable.",
      );
    }
    if (providerResult) {
      if (
        providerResult.externalId !== input.providerHostnameId ||
        providerResult.hostname !== input.hostname
      ) {
        await input.store
          .releaseLookup(
            claim.attemptId,
            leaseToken,
            "DELETE_LOOKUP_TARGET_MISMATCH",
          )
          .catch(() => undefined);
        throw new AppError(
          502,
          "upstream_error",
          "The custom-hostname deletion lookup returned an invalid target.",
        );
      }
      await input.store.authorizeDeleteAfterLookup(
        claim.attemptId,
        leaseToken,
      );
      await deleteOnce({
        attemptId: claim.attemptId,
        client: input.client,
        leaseToken,
        providerHostnameId: input.providerHostnameId,
        store: input.store,
      });
    }
    await input.store.recordProviderAbsent(claim.attemptId, leaseToken);
  }

  await input.store.complete(claim.attemptId, leaseToken);
}
