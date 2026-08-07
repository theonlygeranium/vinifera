import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENT_TYPES,
  analyticsEventIdempotencyKey,
  runFailureIsolatedAnalyticsWrite,
} from "../../server/lib/analytics-events";
import {
  aggregateAnalyticsDashboards,
  composeChurnIntelligenceDto,
  enforceModelGuardrails,
  mlArtifactHash,
  normalizeAnalyticsDashboard,
  normalizeChurnBrowserDto,
  normalizeMemberChurnDto,
  normalizeMlOperationsDto,
  observeScheduleTasks,
  priorQuarterStart,
  resolveAnalyticsRange,
  runScheduledMlTrainingIfNeeded,
  sanitizeAnalyticsEventData,
  shouldRunMlScoringAfterLifecycle,
  validateProductionMlTrainingRun,
} from "../../server/services/analytics";
import {
  benchmarkSuppressionGuidance,
  createBenchmarkReportArtifact,
} from "../../server/services/benchmark-report";
import {
  complianceRequestFingerprint,
  createComplianceProvider,
  isShipCompliantTimeout,
  permitsLabelGeneration,
  ShipCompliantProvider,
  withAuditableComplianceId,
} from "../../server/services/compliance";
import {
  providerTargetPolicy,
  sha256ProviderTarget,
} from "../../server/provider-targets";
import {
  CHURN_FEATURE_NAMES,
  decodeMlTrainingDatasetRow,
  selectDecisionThreshold,
  trainTemporalLogisticModel,
  type MlTrainingExample,
} from "../../server/services/ml-training";
import {
  EasyPostShippingProvider,
  SimulatedShippingProvider,
  type LabelRequest,
} from "../../server/services/core-club";
import type { WorkerEnv } from "../../server/types";

const complianceRequest = {
  destination: {
    city: "Napa",
    country: "US",
    line1: "123 Main Street",
    postalCode: "94558",
    state: "CA",
  },
  organizationId: "11111111-1111-4111-8111-111111111111",
  origin: {
    city: "Napa",
    country: "US",
    line1: "1 Winery Road",
    postalCode: "94558",
    state: "CA",
  },
  recipient: {
    dateOfBirth: "1980-01-01",
    name: "Test Member",
  },
  shipment: {
    bottleCount: 6,
    chargeAmountCents: 12_000,
    id: "22222222-2222-4222-8222-222222222222",
    yearToDateBottleCount: 18,
  },
};

const reportMetrics = [
  {
    id: "member-retention",
    kAnonymous: true,
    label: "Member retention",
    organizationValue: 0.92,
    peerMedian: 0.86,
    peerP25: 0.8,
    peerP75: 0.9,
    percentile: 78,
    sampleCountBand: "25-49",
    unit: "percent" as const,
  },
  {
    id: "shipment-value",
    kAnonymous: true,
    label: "Average shipment value",
    organizationValue: 17_500,
    peerMedian: 15_100,
    peerP25: 13_000,
    peerP75: 18_200,
    percentile: 71,
    sampleCountBand: "25-49",
    unit: "currency_cents" as const,
  },
];

const labelRequest: LabelRequest = {
  externalId: "22222222-2222-4222-8222-222222222222",
  fromAddress: complianceRequest.origin,
  fromContact: {
    company: "Vinifera Estate",
    name: "Shipping",
    phone: "7075550100",
  },
  parcel: {
    heightInches: 6,
    lengthInches: 14,
    weightOunces: 288,
    widthInches: 12,
  },
  toAddress: complianceRequest.destination,
  toContact: {
    name: "Test Member",
    phone: "7075550111",
  },
};

describe("Phase 4 compliance controls", () => {
  it("permits labels only for an exact compliant decision", () => {
    expect(permitsLabelGeneration("compliant")).toBe(true);
    expect(permitsLabelGeneration("non_compliant")).toBe(false);
    expect(permitsLabelGeneration("unknown")).toBe(false);
  });

  it("keeps the simulator test-only", () => {
    expect(() =>
      createComplianceProvider({
        APP_ENV: "production",
        COMPLIANCE_PROVIDER: "simulated",
        COMPLIANCE_SIMULATOR_ENABLED: "true",
      }),
    ).toThrow(/available only/i);
  });

  it("requires auditable account and license mappings for activation", () => {
    const incomplete: WorkerEnv = {
      COMPLIANCE_PROVIDER: "shipcompliant",
      SHIPCOMPLIANT_API_KEY: "key",
      SHIPCOMPLIANT_API_SECRET: "secret",
      SHIPCOMPLIANT_BASE_URL: "https://sandbox.example.test",
      SHIPCOMPLIANT_CHECK_PATH: "/shipment/check",
      SHIPCOMPLIANT_CONTRACT_VERSION: "sandbox-v1",
      SHIPCOMPLIANT_ENDPOINT_MODE: "sandbox",
    };
    expect(() => createComplianceProvider(incomplete)).toThrow(
      /SHIPCOMPLIANT_ACCOUNT_ID/,
    );
    expect(() =>
      createComplianceProvider({
        ...incomplete,
        SHIPCOMPLIANT_ACCOUNT_ID: "sandbox-account",
      }),
    ).toThrow(/SHIPCOMPLIANT_LICENSE_ID/);
  });

  it("maps an incomplete provider response to unknown and caches OAuth", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      const endpoint = String(url);
      calls.push(endpoint);
      if (endpoint.endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "server-only-token", expires_in: 600 }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          reason: null,
          response_id: null,
          status: "compliant",
          tax_estimate_cents: 875,
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }) as typeof fetch;
    const provider = new ShipCompliantProvider(
      {
        accountId: "sandbox-account",
        appEnvironment: "test",
        apiKey: "key",
        apiSecret: "secret",
        baseUrl: "https://sandbox.example.test",
        checkPath: "/shipment/check",
        contractVersion: "sandbox-v1",
        endpointMode: "sandbox",
        licenseId: "sandbox-license",
        targetPolicy: {
          ...providerTargetPolicy,
          shipCompliant: {
            ...providerTargetPolicy.shipCompliant,
            stagingSandboxOriginSha256: [
              sha256ProviderTarget("https://sandbox.example.test"),
            ],
          },
        },
        tokenPath: "/oauth/token",
      },
      fetcher,
    );
    const first = await provider.checkShipment(complianceRequest);
    const second = await provider.checkShipment(complianceRequest);
    expect(first.status).toBe("unknown");
    expect(first.reason).toMatch(/incomplete/i);
    expect(second.status).toBe("unknown");
    expect(
      withAuditableComplianceId(first, () => "deterministic-id"),
    ).toMatchObject({
      providerResponseId: "local-deterministic-id",
      status: "unknown",
    });
    expect(calls.filter((url) => url.endsWith("/oauth/token"))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith("/shipment/check"))).toHaveLength(
      2,
    );
  });

  it("distinguishes deadline aborts from generic provider transport failures", async () => {
    const configuration = {
      accountId: "sandbox-account",
      appEnvironment: "test" as const,
      apiKey: "key",
      apiSecret: "secret",
      baseUrl: "https://sandbox.example.test",
      checkPath: "/shipment/check",
      contractVersion: "sandbox-v1",
      endpointMode: "sandbox" as const,
      licenseId: "sandbox-license",
      targetPolicy: {
        ...providerTargetPolicy,
        shipCompliant: {
          ...providerTargetPolicy.shipCompliant,
          stagingSandboxOriginSha256: [
            sha256ProviderTarget("https://sandbox.example.test"),
          ],
        },
      },
      tokenPath: "/oauth/token",
    };
    const failingProvider = (failure: Error) =>
      new ShipCompliantProvider(
        configuration,
        (async (url: string | URL | Request) => {
          if (String(url).endsWith("/oauth/token")) {
            return new Response(
              JSON.stringify({
                access_token: "server-only-token",
                expires_in: 600,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          throw failure;
        }) as typeof fetch,
      );
    let transportError: unknown;
    let timeoutError: unknown;
    let tokenBodyTimeoutError: unknown;
    let checkBodyTimeoutError: unknown;
    try {
      await failingProvider(new TypeError("connection reset")).checkShipment(
        complianceRequest,
      );
    } catch (error) {
      transportError = error;
    }
    try {
      await failingProvider(
        new DOMException("deadline exceeded", "TimeoutError"),
      ).checkShipment(complianceRequest);
    } catch (error) {
      timeoutError = error;
    }
    const timeoutBodyResponse = () =>
      ({
        json: vi.fn().mockRejectedValue(
          new DOMException("body deadline exceeded", "TimeoutError"),
        ),
        ok: true,
      }) as unknown as Response;
    try {
      await new ShipCompliantProvider(
        configuration,
        (async () => timeoutBodyResponse()) as typeof fetch,
      ).checkShipment(complianceRequest);
    } catch (error) {
      tokenBodyTimeoutError = error;
    }
    try {
      await new ShipCompliantProvider(
        configuration,
        (async (url: string | URL | Request) => {
          if (String(url).endsWith("/oauth/token")) {
            return new Response(
              JSON.stringify({
                access_token: "server-only-token",
                expires_in: 600,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          return timeoutBodyResponse();
        }) as typeof fetch,
      ).checkShipment(complianceRequest);
    } catch (error) {
      checkBodyTimeoutError = error;
    }
    expect(isShipCompliantTimeout(transportError)).toBe(false);
    expect(isShipCompliantTimeout(timeoutError)).toBe(true);
    expect(isShipCompliantTimeout(tokenBodyTimeoutError)).toBe(true);
    expect(isShipCompliantTimeout(checkBodyTimeoutError)).toBe(true);
  });

  it("fingerprints canonical compliance inputs without persisting raw PII", async () => {
    const checkedAt = new Date("2026-07-26T12:00:00.000Z");
    const first = await complianceRequestFingerprint(
      complianceRequest,
      checkedAt,
    );
    const canonicalEquivalent = await complianceRequestFingerprint(
      {
        ...complianceRequest,
        destination: {
          ...complianceRequest.destination,
          city: "  NAPA ",
          line1: "123   MAIN STREET",
          state: "ca",
        },
      },
      checkedAt,
    );
    const differentVolume = await complianceRequestFingerprint(
      {
        ...complianceRequest,
        shipment: {
          ...complianceRequest.shipment,
          yearToDateBottleCount:
            complianceRequest.shipment.yearToDateBottleCount + 1,
        },
      },
      checkedAt,
    );
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalEquivalent).toBe(first);
    expect(differentVolume).not.toBe(first);
    expect(first).not.toContain(String(complianceRequest.recipient.dateOfBirth));
  });

  it("persists the EasyPost shipment before the irreversible buy", async () => {
    const events: string[] = [];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/shipments") && init?.method === "POST") {
        events.push("create");
        return new Response(
          JSON.stringify({
            id: "shp_created123",
            rates: [
              {
                carrier: "UPS",
                id: "rate_123",
                rate: "15.95",
                service: "Ground",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/shipments/shp_created123/buy")) {
        expect(events).toEqual(["create", "persist"]);
        events.push("buy");
        return new Response(
          JSON.stringify({
            id: "shp_created123",
            postage_label: {
              id: "pl_123",
              label_url: "https://labels.example.test/label.pdf",
            },
            selected_rate: {
              carrier: "UPS",
              id: "rate_123",
              rate: "15.95",
              service: "Ground",
            },
            tracking_code: "TRACK123",
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected EasyPost call: ${url}`);
    }) as typeof fetch;
    const provider = new EasyPostShippingProvider(
      "EZTKtestcredential",
      fetcher,
    );
    const result = await provider.createLabel(labelRequest, {
      persistExternalShipment: async (shipmentId, rateId) => {
        expect(shipmentId).toBe("shp_created123");
        expect(rateId).toBe("rate_123");
        events.push("persist");
      },
    });
    expect(events).toEqual(["create", "persist", "buy"]);
    expect(result).toMatchObject({
      labelId: "pl_123",
      providerReference: "shp_created123",
      trackingNumber: "TRACK123",
    });
  });

  it("retrieves a stored EasyPost shipment on recovery without creating another", async () => {
    const calls: string[] = [];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(
        JSON.stringify({
          id: "shp_stored123",
          postage_label: {
            id: "pl_stored",
            label_url: "https://labels.example.test/stored.pdf",
          },
          selected_rate: {
            carrier: "FedEx",
            id: "rate_stored",
            rate: "12.50",
            service: "Ground",
          },
          tracking_code: "RECOVERED123",
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new EasyPostShippingProvider(
      "EZTKtestcredential",
      fetcher,
    );
    const result = await provider.createLabel(labelRequest, {
      externalRateId: "rate_stored",
      externalShipmentId: "shp_stored123",
      persistExternalShipment: async () => {
        throw new Error("Recovery must not create or persist a second shipment.");
      },
    });
    expect(calls).toEqual([
      "GET https://api.easypost.com/v2/shipments/shp_stored123",
    ]);
    expect(result.trackingNumber).toBe("RECOVERED123");
  });

  it("refuses to substitute a different EasyPost rate during recovery", async () => {
    const calls: string[] = [];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(
        JSON.stringify({
          id: "shp_stored123",
          rates: [
            {
              carrier: "UPS",
              id: "rate_repriced",
              rate: "18.50",
              service: "Ground",
            },
          ],
          selected_rate: {
            carrier: "UPS",
            id: "rate_repriced",
            rate: "18.50",
            service: "Ground",
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new EasyPostShippingProvider(
      "EZTKtestcredential",
      fetcher,
    );

    await expect(
      provider.createLabel(labelRequest, {
        externalRateId: "rate_persisted",
        externalShipmentId: "shp_stored123",
        persistExternalShipment: async () => {
          throw new Error("Recovery must not persist a different rate.");
        },
      }),
    ).rejects.toMatchObject({
      code: "upstream_error",
      message: "The carrier did not return the persisted rate.",
    });
    expect(calls).toEqual([
      "GET https://api.easypost.com/v2/shipments/shp_stored123",
    ]);
  });

  it("uses the durable attempt callback for simulated labels too", async () => {
    const provider = new SimulatedShippingProvider();
    await expect(provider.createLabel(labelRequest)).rejects.toThrow(
      /durable database attempt lease/i,
    );
    const persisted: string[] = [];
    const created = await provider.createLabel(
      { ...labelRequest, externalId: "vinifera:simulated:label:stable" },
      {
        persistExternalShipment: async (shipmentId, rateId) => {
          persisted.push(shipmentId, rateId);
        },
      },
    );
    expect(persisted).toEqual([
      created.providerReference,
      created.rateId,
    ]);
    const recovered = await provider.createLabel(
      { ...labelRequest, externalId: "vinifera:simulated:label:stable" },
      {
        externalRateId: created.rateId,
        externalShipmentId: created.providerReference,
        persistExternalShipment: async () => {
          throw new Error("A recovered label must not create a second shipment.");
        },
      },
    );
    expect(recovered).toEqual(created);
  });
});

describe("Phase 4 analytics boundaries", () => {
  it("normalizes probability and explicit-score fields without changing metric scale", () => {
    expect(
      normalizeMemberChurnDto({
        confidence_high_probability: 0.81,
        confidence_low_probability: 0.65,
        ml_probability: 0.73,
        rules_score: 82,
      }),
    ).toMatchObject({
      confidenceBandHigh: 81,
      confidenceBandLow: 65,
      mlScore: 73,
      rulesScore: 82,
    });
    const payload = normalizeChurnBrowserDto({
      items: [{ ml_score: 1, rules_probability: 0.34 }],
      model: { metrics: { aucRoc: 0.84 } },
    });
    expect(payload.items).toEqual([
      expect.objectContaining({ mlScore: 1, rulesScore: 34 }),
    ]);
    expect(payload.model).toEqual({ metrics: { aucRoc: 0.84 } });
  });

  it("falls back when a model misses the activation AUC", () => {
    expect(
      enforceModelGuardrails({
        mode: "ml",
        model: { metrics: { aucRoc: 0.81 } },
      }),
    ).toMatchObject({
      mode: "rules_fallback",
      fallbackReason: expect.stringMatching(/0.82/),
    });
    expect(
      enforceModelGuardrails({
        abTest: {
          endedAt: "2026-07-26T00:00:00.000Z",
          mlSuperior: true,
          modelVersionId: "model-1",
          startedAt: "2026-06-25T00:00:00.000Z",
          status: "completed",
        },
        drift: {
          lastCheckedAt: "2026-07-26",
          modelVersionId: "model-1",
          score: 0.064,
          status: "stable",
        },
        mode: "ml",
        model: {
          cancellationCount: 80,
          dataSource: "production_history",
          deploymentStatus: "production",
          id: "model-1",
          metrics: { aucRoc: 0.85 },
          trainingDataSize: 700,
        },
      }, new Date("2026-07-26T18:00:00.000Z")),
    ).toMatchObject({ mode: "ml" });
  });

  it("falls back when drift evidence is stale or belongs to another model", () => {
    const payload = {
      abTest: {
        endedAt: "2026-07-01T00:00:00.000Z",
        mlSuperior: true,
        modelVersionId: "model-1",
        startedAt: "2026-06-01T00:00:00.000Z",
        status: "completed",
      },
      mode: "ml",
      model: {
        cancellationCount: 80,
        dataSource: "production_history",
        deploymentStatus: "production",
        id: "model-1",
        metrics: { aucRoc: 0.85 },
        trainingDataSize: 700,
      },
      items: [
        {
          effectiveScore: 81,
          effectiveSource: "ml",
          mlScore: 81,
          riskLevel: "medium",
          rulesScore: 42,
        },
      ],
    };
    const stale = enforceModelGuardrails(
      {
        ...payload,
        drift: {
          lastCheckedAt: "2026-07-10",
          modelVersionId: "model-1",
          score: 0.064,
          status: "stable",
        },
      },
      new Date("2026-07-26T18:00:00.000Z"),
    );
    expect(stale).toMatchObject({
      items: [
        {
          effectiveScore: 42,
          effectiveSource: "rules",
          mlScore: 81,
          rulesScore: 42,
          source: "rules",
        },
      ],
      mode: "rules_fallback",
    });
    expect(
      enforceModelGuardrails(
        {
          ...payload,
          drift: {
            lastCheckedAt: "2026-07-26",
            modelVersionId: "model-2",
            score: 0.064,
            status: "stable",
          },
        },
        new Date("2026-07-26T18:00:00.000Z"),
      ),
    ).toMatchObject({ mode: "rules_fallback" });
  });

  it("normalizes the persisted ML operations contract and maps degraded drift", () => {
    const operations = normalizeMlOperationsDto({
      experiment: {
        completed_at: "2026-07-05T00:00:00.000Z",
        id: "experiment-1",
        ml_auc: 0.85,
        ml_superior: true,
        model_version_id: "model-1",
        rules_auc: 0.7,
        started_at: "2026-06-01T00:00:00.000Z",
        status: "completed",
      },
      latest_drift: {
        model_version_id: "model-1",
        population_stability_index: 0.24,
        retraining_required: true,
        snapshot_date: "2026-07-26",
        status: "degraded",
      },
      production_model: {
        cancellation_count: 80,
        deployment_status: "production",
        id: "model-1",
        metrics: { auc_roc: 0.85 },
        training_data_size: 700,
        training_source: "production_history",
      },
    });
    expect(operations).toMatchObject({
      abTest: {
        mlSuperior: true,
        status: "completed",
      },
      drift: {
        score: 0.24,
        status: "retraining",
      },
      mode: "ml",
      model: {
        deploymentStatus: "production",
        trainingSource: "production_history",
      },
    });
    expect(enforceModelGuardrails(operations)).toMatchObject({
      mode: "rules_fallback",
      fallbackReason: expect.stringMatching(/drift/i),
    });
  });

  it("does not normalize absent drift evidence as stable", () => {
    expect(
      normalizeMlOperationsDto({
        production_model: {
          id: "model-1",
        },
      }),
    ).toMatchObject({
      drift: {
        lastCheckedAt: null,
        modelVersionId: null,
        status: "warning",
      },
    });
  });

  it("separates production validation from a replacement shadow experiment", () => {
    const operations = normalizeMlOperationsDto({
      ab_test_experiment: {
        id: "experiment-2",
        model_version_id: "model-2",
        planned_end_at: "2026-08-25T00:00:00.000Z",
        started_at: "2026-07-26T00:00:00.000Z",
        status: "running",
      },
      ab_test_model: {
        deployment_status: "ab_test",
        id: "model-2",
      },
      production_drift: {
        model_version_id: "model-1",
        population_stability_index: 0.05,
        retraining_required: false,
        snapshot_date: "2026-07-26",
        status: "stable",
      },
      production_experiment: {
        completed_at: "2026-07-01T00:00:00.000Z",
        id: "experiment-1",
        ml_auc: 0.85,
        ml_superior: true,
        model_version_id: "model-1",
        rules_auc: 0.72,
        started_at: "2026-06-01T00:00:00.000Z",
        status: "completed",
      },
      production_model: {
        cancellation_count: 80,
        deployment_status: "production",
        id: "model-1",
        metrics: { auc_roc: 0.85 },
        training_data_size: 700,
        training_source: "production_history",
      },
    });
    expect(operations).toMatchObject({
      abTest: {
        modelVersionId: "model-2",
        status: "running",
      },
      productionValidation: {
        modelVersionId: "model-1",
        status: "completed",
      },
    });
    expect(
      enforceModelGuardrails(
        operations,
        new Date("2026-07-26T18:00:00.000Z"),
      ),
    ).toMatchObject({ mode: "ml" });
  });

  it("preserves all DB churn rows and maps five feature contributions", () => {
    const features = Array.from({ length: 5 }, (_, index) => ({
      contribution: index % 2 ? -0.1 * (index + 1) : 0.1 * (index + 1),
      direction: index % 2 ? "decrease" : "increase",
      feature: `feature_${index + 1}`,
      value: index,
    }));
    const dto = composeChurnIntelligenceDto(
      [
        {
          confidence_interval_high: 0.82,
          confidence_interval_low: 0.61,
          effective_source: "rules",
          alert_id: "alert-1",
          alert_created_at: "2026-07-26T00:00:00.000Z",
          member_id: "member-1",
          ml_probability: 0.73,
          rules_score: 82,
          top_features: features,
          total_count: 2,
        },
        {
          effective_source: "rules",
          member_id: "member-2",
          ml_probability: 0.12,
          rules_score: 18,
          top_features: [],
          total_count: 2,
        },
      ],
      { fallback: true },
    );
    expect(dto.mode).toBe("rules_fallback");
    expect(dto.total).toBe(2);
    expect(dto.items).toHaveLength(2);
    expect(dto.items).toEqual([
      expect.objectContaining({
        confidenceBandHigh: 82,
        confidenceBandLow: 61,
        memberId: "member-1",
        mlScore: 73,
        rulesScore: 82,
        source: "rules",
        alert: expect.objectContaining({
          id: "alert-1",
          status: "open",
        }),
        topFeatures: [
          expect.objectContaining({
            direction: "raises",
            id: "feature_1",
            shapValue: 0.1,
          }),
          expect.objectContaining({ direction: "lowers", id: "feature_2" }),
          expect.objectContaining({ id: "feature_3" }),
          expect.objectContaining({ id: "feature_4" }),
          expect.objectContaining({ id: "feature_5" }),
        ],
      }),
      expect.objectContaining({ memberId: "member-2", rulesScore: 18 }),
    ]);
  });

  it("rejects analytics event PII and validates explicit ranges", () => {
    expect(() =>
      sanitizeAnalyticsEventData({ member_email: "person@example.com" }),
    ).toThrow(/non-identifying/i);
    expect(sanitizeAnalyticsEventData({ route: "/app/analytics" })).toEqual({
      route: "/app/analytics",
    });
    expect(
      resolveAnalyticsRange(
        "custom",
        { from: "2026-07-01", to: "2026-07-26" },
        new Date("2026-07-26T12:00:00Z"),
      ),
    ).toEqual({
      from: "2026-07-01",
      preset: "custom",
      to: "2026-07-26",
    });
  });

  it("uses an allowlisted taxonomy and stable event retry identity", async () => {
    expect(ANALYTICS_EVENT_TYPES.has("analytics.dashboard_viewed")).toBe(true);
    expect(ANALYTICS_EVENT_TYPES.has("anything.the_client_wants")).toBe(false);
    const input = {
      actorUserId: "staff-1",
      eventType: "analytics.dashboard_viewed",
      organizationId: "organization-1",
      requestKey: "dashboard-view-2026-07-26",
    };
    const first = await analyticsEventIdempotencyKey(input);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await analyticsEventIdempotencyKey(input)).toBe(first);
    expect(
      await analyticsEventIdempotencyKey({
        ...input,
        requestKey: "dashboard-view-2026-07-27",
      }),
    ).not.toBe(first);
  });

  it("keeps analytics write failures isolated from business operations", async () => {
    const failures: unknown[] = [];
    await expect(
      runFailureIsolatedAnalyticsWrite(
        async () => {
          throw new Error("analytics unavailable");
        },
        (error) => failures.push(error),
      ),
    ).resolves.toBe(false);
    expect(failures).toHaveLength(1);
  });

  it("hashes immutable model artifacts independently of run UUID and key order", async () => {
    const left = await mlArtifactHash({
      dataset: {
        hash: "a".repeat(64),
        source: "production_history",
      },
      model: { coefficients: { b: 2, a: 1 }, intercept: -0.25 },
    });
    const right = await mlArtifactHash({
      model: { intercept: -0.25, coefficients: { a: 1, b: 2 } },
      dataset: {
        source: "production_history",
        hash: "a".repeat(64),
      },
    });
    expect(left).toBe(right);
  });

  it("fails closed when persisted training provenance drifts from the request", () => {
    const run = {
      actual_training_ratio: 0.8,
      cancellation_count: 80,
      cross_validation_folds: 5,
      feature_schema_version: "vinifera-churn-v1",
      holdout_end: "2026-04-27",
      holdout_row_count: 120,
      holdout_start: "2026-01-27",
      member_count: 600,
      source: "production_history",
      split_strategy: "temporal_80_20_member_disjoint",
      status: "ready",
      temporal_split: true,
      training_cutoff: "2026-01-26",
      training_row_count: 480,
    };
    expect(
      validateProductionMlTrainingRun(run, {
        holdoutEnd: "2026-04-27",
        holdoutStart: "2026-01-27",
        trainingCutoff: "2026-01-26",
      }),
    ).toMatchObject({
      cancellationCount: 80,
      holdoutRowCount: 120,
      memberCount: 600,
      status: "ready",
      trainingRowCount: 480,
    });
    expect(() =>
      validateProductionMlTrainingRun(
        { ...run, source: "synthetic_fixture" },
        {
          holdoutEnd: "2026-04-27",
          holdoutStart: "2026-01-27",
          trainingCutoff: "2026-01-26",
        },
      ),
    ).toThrow(/provenance/i);
    expect(() =>
      validateProductionMlTrainingRun(
        { ...run, member_count: 601 },
        {
          holdoutEnd: "2026-04-27",
          holdoutStart: "2026-01-27",
          trainingCutoff: "2026-01-26",
        },
      ),
    ).toThrow(/provenance/i);
  });

  it("triggers one training path for monthly plus one-shot drift signals", async () => {
    let calls = 0;
    await expect(
      runScheduledMlTrainingIfNeeded({
        lifecycle: { retrainingRequired: true, retrainingTriggered: true },
        monthly: true,
        train: async () => {
          calls += 1;
        },
      }),
    ).resolves.toBe(true);
    expect(calls).toBe(1);
    await expect(
      runScheduledMlTrainingIfNeeded({
        lifecycle: {
          retrainingRequired: true,
          retrainingTriggered: false,
        },
        monthly: false,
        train: async () => {
          calls += 1;
        },
      }),
    ).resolves.toBe(false);
    expect(calls).toBe(1);
  });

  it("conservatively suppresses the full score batch on aggregate drift", () => {
    expect(
      shouldRunMlScoringAfterLifecycle({
        retrainingModelIds: ["model-1"],
        retrainingRequired: true,
      }),
    ).toBe(false);
    expect(
      shouldRunMlScoringAfterLifecycle({
        retrainingModelIds: [],
        retrainingRequired: false,
      }),
    ).toBe(true);
  });

  it("maps the DB raw analytics shape into the canonical browser contract", () => {
    const dashboard = normalizeAnalyticsDashboard(
      {
        cohort_retention: [
          {
            cohort_month: "2026-01-01",
            months_since_join: 0,
            retention_rate: 1,
          },
          {
            cohort_month: "2026-01-01",
            months_since_join: 1,
            retention_rate: 0.9,
          },
        ],
        decline_reasons: [{ attempts: 2, reason: "insufficient_funds" }],
        engagement: {
          email_click_rate: 0.2,
          email_open_rate: 0.55,
          portal_logins: 20,
        },
        members: {
          active: 100,
          average_ltv_cents: 44_000,
          net_growth: 5,
        },
        revenue: {
          arpm_cents: 12_500,
          arr_cents: 15_000_000,
          mrr_cents: 1_250_000,
          revenue_churn_cents: 25_000,
        },
        series: [
          {
            active_members: 100,
            attempted_shipments: 50,
            cancelled_members: 2,
            date: "2026-07-01",
            declined_attempts: 2,
            email_clicks: 20,
            email_opens: 55,
            emails_sent: 100,
            fulfilled_shipments: 47,
            mrr_cents: 1_250_000,
            new_members: 7,
          },
        ],
        shipments: {
          attempted: 50,
          average_value_cents: 18_000,
          decline_rate: 0.04,
          fulfilled: 47,
          fulfillment_rate: 0.94,
          shipping_cost_ratio: 0.08,
        },
        tier_distribution: [
          {
            active_members: 80,
            monthly_revenue_cents: 960_000,
            tier_id: "tier-1",
            tier_name: "Estate",
          },
        ],
      },
      {
        from: "2026-07-01",
        preset: "30d",
        to: "2026-07-26",
      },
      {
        layout: [
          {
            enabled: true,
            id: "member-growth",
            order: 0,
            size: "half",
          },
        ],
      },
    );
    expect(dashboard.summary).toMatchObject({
      activeMembers: 100,
      emailOpenRate: 0.55,
      fulfillmentRate: 0.94,
      mrrCents: 1_250_000,
    });
    expect(dashboard.revenue).toMatchObject({
      byTier: [
        {
          arrCents: 11_520_000,
          memberCount: 80,
          mrrCents: 960_000,
          tierId: "tier-1",
        },
      ],
    });
    expect(dashboard.members).toMatchObject({
      cohorts: [{ cohort: "2026-01-01", values: [1, 0.9] }],
      trend: [
        expect.objectContaining({
          active: 100,
          cancelled: 2,
          netGrowth: 5,
          newMembers: 7,
        }),
      ],
    });
    expect(dashboard.layout).toEqual({
      widgets: [
        {
          enabled: true,
          id: "member-growth",
          order: 0,
          size: "half",
        },
      ],
    });
  });

  it("aggregates authorized brand analytics with weighted organization rates", () => {
    const range = {
      from: "2026-07-01",
      preset: "30d" as const,
      to: "2026-07-26",
    };
    const dashboard = aggregateAnalyticsDashboards(
      [
        {
          brandId: "11111111-1111-4111-8111-111111111111",
          brandName: "Estate",
          payload: {
            engagement: {
              email_click_rate: 0.2,
              email_open_rate: 0.5,
              portal_logins: 10,
              trend: [
                {
                  active_members: 100,
                  email_clicks: 2,
                  email_opens: 5,
                  emails_sent: 10,
                  loyalty_points_earned: 100,
                  loyalty_points_redeemed: 10,
                  metric_date: "2026-07-01",
                  portal_logins: 10,
                },
              ],
            },
            members: {
              active: 100,
              average_ltv_cents: 50_000,
              net_growth: 10,
              trend: [
                {
                  active: 100,
                  cancelled: 2,
                  net_growth: 10,
                  new_members: 12,
                  period: "2026-07-01",
                },
              ],
            },
            revenue: {
              arr_cents: 12_000_000,
              mrr_cents: 1_000_000,
              trend: [
                {
                  active_members: 100,
                  mrr_cents: 1_000_000,
                  period: "2026-07-01",
                },
              ],
            },
            shipments: {
              attempted: 100,
              decline_rate: 0.05,
              fulfilled: 90,
              fulfillment_rate: 0.9,
              trend: [
                {
                  attempted_shipments: 100,
                  declined_attempts: 5,
                  fulfilled_shipments: 90,
                  gross_revenue_cents: 1_000_000,
                  period: "2026-07-01",
                  shipment_value_cents: 900_000,
                  shipping_cost_cents: 100_000,
                },
              ],
            },
          },
        },
        {
          brandId: "22222222-2222-4222-8222-222222222222",
          brandName: "Reserve",
          payload: {
            engagement: {
              email_click_rate: 0.4,
              email_open_rate: 0.75,
              portal_logins: 5,
              trend: [
                {
                  active_members: 50,
                  email_clicks: 400,
                  email_opens: 750,
                  emails_sent: 1_000,
                  loyalty_points_earned: 10,
                  loyalty_points_redeemed: 5,
                  metric_date: "2026-07-01",
                  portal_logins: 5,
                },
              ],
            },
            members: {
              active: 50,
              average_ltv_cents: 80_000,
              net_growth: 5,
              trend: [
                {
                  active: 50,
                  cancelled: 1,
                  net_growth: 5,
                  new_members: 6,
                  period: "2026-07-01",
                },
              ],
            },
            revenue: {
              arr_cents: 9_000_000,
              mrr_cents: 750_000,
              trend: [
                {
                  active_members: 50,
                  mrr_cents: 750_000,
                  period: "2026-07-01",
                },
              ],
            },
            shipments: {
              attempted: 50,
              decline_rate: 0.1,
              fulfilled: 40,
              fulfillment_rate: 0.8,
              trend: [
                {
                  attempted_shipments: 50,
                  declined_attempts: 5,
                  fulfilled_shipments: 40,
                  gross_revenue_cents: 500_000,
                  period: "2026-07-01",
                  shipment_value_cents: 800_000,
                  shipping_cost_cents: 25_000,
                },
              ],
            },
          },
        },
      ],
      range,
    );

    expect(dashboard.scope).toEqual(
      expect.objectContaining({ brandCount: 2, type: "all" }),
    );
    expect(dashboard.summary).toMatchObject({
      activeMembers: 150,
      arrCents: 21_000_000,
      averageLtvCents: 60_000,
      mrrCents: 1_750_000,
      portalLogins: 15,
      portalLoginsPerMember: 0.1,
    });
    expect(
      (dashboard.summary as Record<string, number>).emailOpenRate,
    ).toBeCloseTo(755 / 1_010);
    expect(
      (dashboard.summary as Record<string, number>).loyaltyRedemptionRate,
    ).toBeCloseTo(15 / 110);
    expect(
      (dashboard.summary as Record<string, number>)
        .averageShipmentValueCents,
    ).toBeCloseTo(1_700_000 / 130);
    expect(
      (dashboard.summary as Record<string, number>).shippingCostRatio,
    ).toBeCloseTo(125_000 / 1_500_000);
    expect(dashboard.members).toMatchObject({
      trend: [
        expect.objectContaining({
          active: 150,
          netGrowth: 15,
          period: "2026-07-01",
        }),
      ],
    });
    expect(dashboard.shipments).toMatchObject({
      trend: [
        expect.objectContaining({
          attempted: 150,
          declined: 10,
          fulfillmentRate: 130 / 150,
        }),
      ],
    });
  });

  it("maps the production DB dashboard contract without fixture-only metrics", () => {
    const dashboard = normalizeAnalyticsDashboard(
      {
        engagement: {
          email_click_rate: 0.18,
          email_open_rate: 0.52,
          loyalty_redemption_rate: 0.04,
          portal_logins: 14,
          trend: [
            {
              active_members: 10,
              date: "2026-07-01",
              email_clicks: 18,
              email_opens: 52,
              emails_sent: 100,
              loyalty_redemption_rate: 0.03,
              portal_logins: 9,
            },
          ],
        },
        members: {
          active: 10,
          average_ltv_cents: 44_000,
          cohort_retention: [
            {
              cohort_month: "2026-01-01",
              months_since_join: 0,
              retention_rate: 1,
            },
          ],
          net_growth: 2,
          tenure_distribution: [
            { bucket: "0-3 months", members: 2 },
          ],
          trend: [
            {
              active_members: 10,
              cancelled_members: 1,
              date: "2026-07-01",
              new_members: 3,
            },
          ],
        },
        revenue: {
          arpm_cents: 12_000,
          arr_cents: 1_440_000,
          by_tier: [
            {
              active_members: 10,
              average_ltv_cents: 44_000,
              monthly_revenue_cents: 120_000,
              tier_id: "tier-1",
              tier_name: "Estate",
            },
          ],
          mrr_cents: 120_000,
          revenue_churn_cents: 4_500,
          trend: [
            {
              active_members: 10,
              date: "2026-07-01",
              mrr_cents: 120_000,
              revenue_churn_cents: 4_500,
            },
          ],
        },
        shipments: {
          attempted: 5,
          average_value_cents: 18_000,
          decline_rate: 0.2,
          decline_reasons: [{ attempts: 1, reason: "insufficient_funds" }],
          fulfilled: 4,
          fulfillment_rate: 0.8,
          shipping_cost_ratio: 0.06,
          trend: [
            {
              attempted_shipments: 5,
              date: "2026-07-01",
              declined_attempts: 1,
              fulfilled_shipments: 4,
              net_revenue_cents: 72_000,
              shipment_value_cents: 72_000,
              shipping_cost_cents: 4_320,
            },
          ],
        },
        summary: {
          active_members: 10,
          loyalty_redemption_rate: 0.04,
          loyalty_points_redeemed: 12,
          portal_logins: 14,
        },
      },
      {
        from: "2026-07-01",
        preset: "30d",
        to: "2026-07-26",
      },
    );
    expect(dashboard).toMatchObject({
      engagement: {
        acquisition: [],
        trend: [
          {
            emailClickRate: 0.18,
            emailOpenRate: 0.52,
            loyaltyRedemptionRate: 0.03,
            portalLoginsPerMember: 0.9,
          },
        ],
      },
      generatedAt: null,
      members: {
        cohorts: [{ cohort: "2026-01-01", values: [1] }],
        ltvByTier: [{ ltvCents: 44_000, tierId: "tier-1" }],
        tenureDistribution: [{ bucket: "0-3 months", members: 2 }],
        trend: [
          {
            active: 10,
            cancelled: 1,
            netGrowth: 2,
            newMembers: 3,
          },
        ],
      },
      revenue: {
        byTier: [
          {
            arrCents: 1_440_000,
            memberCount: 10,
            mrrCents: 120_000,
          },
        ],
        trend: [
          {
            arpmCents: 12_000,
            arrCents: 1_440_000,
            revenueChurnCents: 4_500,
          },
        ],
      },
      shipments: {
        declineReasons: [
          {
            count: 1,
            rate: 1,
            reason: "insufficient_funds",
          },
        ],
        trend: [
          {
            attempted: 5,
            averageValueCents: 18_000,
            charged: 4,
            declined: 1,
            fulfillmentRate: 0.8,
            revenueCents: 72_000,
            shippingCostCents: 4_320,
          },
        ],
      },
      summary: {
        activeMembers: 10,
        arpmCents: 12_000,
        averageLtvCents: 44_000,
        averageShipmentValueCents: 18_000,
        declineRate: 0.2,
        emailClickRate: 0.18,
        emailOpenRate: 0.52,
        fulfillmentRate: 0.8,
        loyaltyRedemptionRate: 0.04,
        memberGrowthRate: 0.25,
        mrrCents: 120_000,
        portalLoginsPerMember: 1.4,
        portalLogins: 14,
        loyaltyPointsRedeemed: 12,
        revenueChurnCents: 4_500,
        shippingCostRatio: 0.06,
      },
    });
  });

  it("uses a real prior-quarter start date for benchmark aggregation", () => {
    expect(priorQuarterStart(new Date("2026-07-01T09:00:00.000Z"))).toBe(
      "2026-04-01",
    );
    expect(priorQuarterStart(new Date("2026-01-01T09:00:00.000Z"))).toBe(
      "2025-10-01",
    );
  });

  it("observes every independent schedule branch before reporting failures", async () => {
    const completed: string[] = [];
    const failures = await observeScheduleTasks([
      {
        name: "failed branch",
        run: async () => {
          completed.push("failed");
          throw new Error("expected failure");
        },
      },
      {
        name: "healthy branch",
        run: async () => {
          completed.push("healthy");
        },
      },
    ]);
    expect(completed.sort()).toEqual(["failed", "healthy"]);
    expect(failures).toEqual([
      expect.objectContaining({ name: "failed branch" }),
    ]);
  });
});

describe("Phase 4 benchmark artifacts", () => {
  it("suppresses non-k-anonymous cohorts and provides non-metric guidance", () => {
    expect(() =>
      createBenchmarkReportArtifact({
        generatedAt: "2026-07-26T00:00:00.000Z",
        metrics: reportMetrics.map((metric) => ({
          ...metric,
          kAnonymous: false,
        })),
        organizationName: "Vinifera Estate",
        peerGroupLabel: "West Coast estate clubs",
        period: "2026-Q2",
      }),
    ).toThrow(/privacy threshold/i);
    const guidance = benchmarkSuppressionGuidance({
      cohortBand: "Fewer than 10",
      organizationName: "Vinifera Estate",
      period: "2026-Q2",
    });
    expect(guidance.text).not.toMatch(/median|percentile/i);
    expect(guidance.text).toMatch(/not generated/i);
  });

  it("creates deterministic polished PDF plus accessible HTML, text, and CSV", async () => {
    const artifact = createBenchmarkReportArtifact({
      generatedAt: "2026-07-26T00:00:00.000Z",
      metrics: reportMetrics,
      organizationName: "Vinifera Estate",
      peerCount: 32,
      peerGroupLabel: "West Coast estate clubs",
      period: "2026-Q2",
    });
    const pdfText = Buffer.from(artifact.pdf).toString("binary");
    expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfText).toContain("0.294 0.063 0.149 rg");
    expect(pdfText).toContain("Peer Benchmark Report");
    expect(pdfText).toContain("PRIVACY BY DESIGN");
    expect(pdfText.endsWith("%%EOF\n")).toBe(true);
    expect(artifact.html).toContain("<table>");
    expect(artifact.html).toContain("<th scope=\"col\">Metric</th>");
    expect(artifact.csv).toContain("Anonymized cohort band");
    expect(artifact.text).toContain("Member retention");

    const output = process.env.VINIFERA_BENCHMARK_PDF_FIXTURE;
    if (output) {
      const path = resolve(output);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifact.pdf);
    }
  });
});

describe("Phase 4 deterministic ML trainer", () => {
  it("uses temporal holdout and five expanding folds without activating fixtures", () => {
    const rows: MlTrainingExample[] = Array.from({ length: 600 }, (_, index) => {
      const risk = (index % 20) / 19;
      const outcome = risk > 0.64 ? 1 : 0;
      const features = Object.fromEntries(
        CHURN_FEATURE_NAMES.map((feature, featureIndex) => [
          feature,
          feature.includes("rate") || feature.includes("per_month")
            ? feature.includes("decline") ||
              feature.includes("observed_expected")
              ? risk
              : 1 - risk
            : risk * (featureIndex + 1) * 10,
        ]),
      );
      if (index % 50 === 0) {
        delete features.average_shipment_value_cents;
      }
      return {
        features,
        memberId: `fixture-${String(index).padStart(4, "0")}`,
        observedAt: new Date(
          Date.UTC(2024, 0, 1 + index),
        ).toISOString(),
        outcome,
        rulesProbability: 0.5,
      };
    });
    const result = trainTemporalLogisticModel(rows, "synthetic_fixture");
    expect(result.training.size).toBe(480);
    expect(result.holdout.size).toBe(120);
    expect(result.folds).toHaveLength(5);
    expect(result.holdout.metrics.aucRoc).toBeGreaterThan(0.9);
    expect(result.holdout.metrics.confusionMatrix).toEqual(
      expect.objectContaining({
        trueNegative: expect.any(Number),
        truePositive: expect.any(Number),
      }),
    );
    expect(result.holdout.metrics.calibration.length).toBeGreaterThan(0);
    expect(Object.keys(result.featureBaselineBins)).toEqual(
      expect.arrayContaining([...CHURN_FEATURE_NAMES]),
    );
    for (const shares of Object.values(result.featureBaselineBins)) {
      expect(shares).toHaveLength(4);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 5);
      expect(shares.every((share) => share > 0)).toBe(true);
    }
    expect(
      result.featureBaselineBins.decline_count,
    ).not.toEqual([0.158655, 0.341345, 0.341345, 0.158655]);
    expect(result.featureMedians.average_shipment_value_cents).toEqual(
      expect.any(Number),
    );
    expect(result.decisionThreshold).toBeGreaterThanOrEqual(0.05);
    expect(result.decisionThreshold).toBeLessThanOrEqual(0.95);
    expect(result.holdout.rulesBaseline.aucRoc).toBe(0.5);
    expect(result.eligibility.eligibleForExperiment).toBe(false);
    expect(result.eligibility.eligibleForPromotion).toBe(false);
    expect(result.eligibility.reasons.join(" ")).toMatch(/synthetic/i);
  });

  it("honors persisted production split and fold assignments", () => {
    const rows: MlTrainingExample[] = Array.from({ length: 720 }, (_, index) => {
      const split = index < 600 ? "train" : "holdout";
      const fold =
        split === "holdout"
          ? null
          : index < 100
            ? 0
            : (Math.floor((index - 100) / 100) + 1) as 1 | 2 | 3 | 4 | 5;
      const outcome = (index % 4 === 0 ? 1 : 0) as 0 | 1;
      return {
        features: Object.fromEntries(
          CHURN_FEATURE_NAMES.map((feature, featureIndex) => [
            feature,
            outcome * 2 + (index % 17) / 17 + featureIndex / 100,
          ]),
        ),
        fold,
        memberId: `assigned-${String(index).padStart(4, "0")}`,
        observedAt: new Date(Date.UTC(2024, 0, 1 + index)).toISOString(),
        outcome,
        rulesProbability: 0.3,
        split,
        temporalOrderAt: new Date(
          Date.UTC(2020, 0, 1 + index),
        ).toISOString(),
      };
    });
    const shuffled = [...rows.slice(360), ...rows.slice(0, 360)];
    const result = trainTemporalLogisticModel(
      shuffled,
      "production_history",
    );
    expect(result.training.size).toBe(600);
    expect(result.holdout.size).toBe(120);
    expect(result.folds).toHaveLength(5);
    expect(result.folds.map((fold) => fold.trainingSize)).toEqual([
      100,
      200,
      300,
      400,
      500,
    ]);
    expect(result.folds.map((fold) => fold.validationSize)).toEqual([
      100,
      100,
      100,
      100,
      100,
    ]);
    expect(result.eligibility.eligibleForExperiment).toBe(true);
  });

  it("selects a deterministic training-only decision threshold", () => {
    const labels = [0, 0, 1, 1];
    const probabilities = [0.05, 0.15, 0.35, 0.45];
    expect(selectDecisionThreshold(labels, probabilities)).toBe(0.35);
    expect(selectDecisionThreshold(labels, probabilities)).toBe(0.35);
  });

  it("rejects malformed persisted feature values instead of imputing corruption", () => {
    expect(() =>
      decodeMlTrainingDatasetRow({
        churned_within_90_days: false,
        features: {
          average_shipment_value_cents: "12500",
        },
        fold: 0,
        member_id: "member-1",
        observed_at: "2025-01-01T00:00:00.000Z",
        row_id: "row-1",
        rules_probability: 0.2,
        split: "train",
        temporal_order_at: "2022-01-01T00:00:00.000Z",
      }),
    ).toThrow(/not a finite number/i);
  });

  it("fails closed when assigned observations overlap the temporal holdout", () => {
    const rows: MlTrainingExample[] = Array.from({ length: 36 }, (_, index) => {
      const split = index < 30 ? "train" : "holdout";
      const fold =
        split === "holdout"
          ? null
          : Math.min(5, Math.floor(index / 5)) as 0 | 1 | 2 | 3 | 4 | 5;
      return {
        features: Object.fromEntries(
          CHURN_FEATURE_NAMES.map((feature) => [feature, index]),
        ),
        fold,
        memberId: `overlap-${index}`,
        observedAt:
          split === "train"
            ? "2025-06-01T00:00:00.000Z"
            : "2025-05-01T00:00:00.000Z",
        outcome: (index % 2) as 0 | 1,
        rulesProbability: 0.5,
        split,
        temporalOrderAt: new Date(
          Date.UTC(2020, 0, 1 + index),
        ).toISOString(),
      };
    });
    expect(() =>
      trainTemporalLogisticModel(rows, "production_history"),
    ).toThrow(/strictly precede holdout/i);
  });
});
