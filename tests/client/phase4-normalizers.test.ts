import { describe, expect, it } from "vitest";
import {
  normalizeAnalyticsDashboard,
  normalizeBenchmarksDashboard,
  normalizeChurnIntelligence,
  normalizeComplianceDashboard,
} from "../../src/client/api/phase4";

describe("Phase 4 API normalizers", () => {
  it("normalizes analytics percentages and rejects malformed chart rows", () => {
    const dashboard = normalizeAnalyticsDashboard({
      range: { preset: "90d" },
      summary: {
        activeMembers: "42",
        fulfillmentRate: 97.5,
        memberGrowthRate: 0.08,
      },
      members: {
        trend: [
          { period: "June", active: "40", newMembers: 4 },
          { active: 42 },
        ],
        cohorts: [{ cohort: "Q2", values: [100, 82, null] }],
      },
    });

    expect(dashboard.range.preset).toBe("90d");
    expect(dashboard.summary.activeMembers).toBe(42);
    expect(dashboard.summary.fulfillmentRate).toBe(0.975);
    expect(dashboard.summary.memberGrowthRate).toBe(0.08);
    expect(dashboard.members.trend).toHaveLength(1);
    expect(dashboard.members.cohorts[0]?.values).toEqual([1, 0.82, null]);
  });

  it("normalizes the production database-shaped analytics payload", () => {
    const dashboard = normalizeAnalyticsDashboard({
      period: { from: "2026-07-01", to: "2026-07-31" },
      revenue: {
        mrrCents: 120_000,
        arrCents: 1_440_000,
        arpmCents: 4_000,
        revenueChurnCents: 18_000,
      },
      members: {
        active: 30,
        netGrowth: 3,
        averageLtvCents: 225_000,
      },
      shipments: {
        fulfillmentRate: 0.95,
        averageValueCents: 18_500,
        declineRate: 0.05,
        shippingCostRatio: 0.08,
      },
      engagement: {
        emailOpenRate: 0.6,
        emailClickRate: 0.2,
        portalLogins: 90,
        loyaltyPointsRedeemed: 15,
      },
      series: [{
        date: "2026-07-31",
        mrrCents: 120_000,
        activeMembers: 30,
        newMembers: 5,
        cancelledMembers: 2,
        revenueChurnCents: 18_000,
        attemptedShipments: 20,
        fulfilledShipments: 19,
        declinedAttempts: 1,
        shipmentValueCents: 351_500,
        shippingCostCents: 28_120,
        netRevenueCents: 351_500,
        emailsSent: 100,
        emailOpens: 60,
        emailClicks: 20,
        portalLogins: 90,
        loyaltyPointsRedeemed: 15,
      }],
      tierDistribution: [{
        tierId: "tier-1",
        tierName: "Estate",
        activeMembers: 30,
        monthlyRevenueCents: 120_000,
        averageLtvCents: 225_000,
      }],
      tenureDistribution: [
        { bucket: "0-3 months", members: 8 },
        { bucket: "1-2 years", members: 22 },
      ],
      cohortRetention: [
        { cohortMonth: "2026-06", monthsSinceJoin: 0, retentionRate: 1 },
        { cohortMonth: "2026-06", monthsSinceJoin: 1, retentionRate: 0.9 },
      ],
      declineReasons: [{ reason: "Expired card", attempts: 1 }],
    });

    expect(dashboard.summary).toMatchObject({
      activeMembers: 30,
      arpmCents: 4_000,
      arrCents: 1_440_000,
      averageLtvCents: 225_000,
      averageShipmentValueCents: 18_500,
      declineRate: 0.05,
      emailClickRate: 0.2,
      emailOpenRate: 0.6,
      fulfillmentRate: 0.95,
      loyaltyPointsRedeemed: 15,
      loyaltyRedemptionRate: 0.5,
      memberGrowthRate: 3 / 27,
      mrrCents: 120_000,
      portalLogins: 90,
      portalLoginsPerMember: 3,
      revenueChurnCents: 18_000,
      shippingCostRatio: 0.08,
    });
    expect(dashboard.revenue.byTier[0]).toMatchObject({
      arrCents: 1_440_000,
      memberCount: 30,
      mrrCents: 120_000,
    });
    expect(dashboard.members.ltvByTier[0]?.ltvCents).toBe(225_000);
    expect(dashboard.members.tenureDistribution).toEqual([
      { bucket: "0-3 months", members: 8 },
      { bucket: "1-2 years", members: 22 },
    ]);
    expect(dashboard.members.cohorts[0]?.values).toEqual([1, 0.9]);
    expect(dashboard.shipments.trend[0]).toMatchObject({
      averageValueCents: 18_500,
      declined: 1,
      fulfillmentRate: 0.95,
      revenueCents: 351_500,
      shippingCostCents: 28_120,
    });
    expect(dashboard.shipments.declineReasons[0]).toMatchObject({
      count: 1,
      rate: 1,
    });
    expect(dashboard.engagement.trend[0]).toMatchObject({
      emailClickRate: 0.2,
      emailOpenRate: 0.6,
      loyaltyRedemptionRate: 0.5,
      portalLoginsPerMember: 3,
    });
  });

  it("keeps churn scoring fail-safe when an ML mode is unavailable", () => {
    const intelligence = normalizeChurnIntelligence({
      mode: "unexpected",
      fallbackReason: "Insufficient validated outcomes",
      items: [{
        memberId: "member-1",
        memberName: "Avery Vine",
        score: 76,
        contributingFactors: [{
          label: "Payment declines",
          detail: "Two declines",
          points: 18,
        }],
        alert: {
          id: "alert-1",
          status: "open",
          createdAt: "2026-07-26T12:00:00.000Z",
        },
      }],
    });

    expect(intelligence.mode).toBe("rules_fallback");
    expect(intelligence.fallbackReason).toBe("Insufficient validated outcomes");
    expect(intelligence.items[0]).toMatchObject({
      rulesScore: 76,
      riskLevel: "high",
      source: "rules",
    });
    expect(intelligence.items[0]?.topFeatures[0]?.direction).toBe("raises");
    expect(intelligence.items[0]?.alert).toMatchObject({
      id: "alert-1",
      status: "open",
    });
  });

  it("preserves benchmark privacy and compliance activation states", () => {
    const benchmarks = normalizeBenchmarksDashboard({
      eligible: true,
      subscriptionTier: "estate",
      optedIn: false,
      minimumPeerCount: 8,
      quarterlyReport: {},
    });
    const compliance = normalizeComplianceDashboard({
      provider: { name: "ShipCompliant" },
      summary: { unknown: "3" },
      items: [{
        id: "check-1",
        shipmentId: "shipment-1",
        memberName: "Avery Vine",
        status: "provider_timeout",
      }],
    });

    expect(benchmarks).toMatchObject({
      eligible: true,
      optedIn: false,
      minimumPeerCount: 10,
    });
    expect(compliance.provider.status).toBe("activation_required");
    expect(compliance.summary.unknown).toBe(3);
    expect(compliance.items[0]?.status).toBe("unknown");
  });
});
