export const ANALYTICS_EVENT_TYPES = new Set([
  "analytics.dashboard_viewed",
  "analytics.report_scheduled",
  "analytics.widget_exported",
  "benchmark.dashboard_viewed",
  "benchmark.opted_in",
  "benchmark.report_generated",
  "churn.alert_acknowledged",
  "churn.dashboard_viewed",
  "compliance.dashboard_viewed",
  "email.clicked",
  "email.opened",
  "email.sent",
  "loyalty.redeemed",
  "member.cancelled",
  "member.created",
  "member.updated",
  "portal.login",
  "release.created",
  "release.processed",
  "release.scheduled",
  "shipment.charged",
  "shipment.compliance_checked",
  "shipment.declined",
  "shipment.delivered",
  "shipment.label_created",
  "shipment.shipped",
]);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function analyticsEventIdempotencyKey(input: {
  actorUserId: string | null;
  eventType: string;
  organizationId: string;
  requestKey: string;
}): Promise<string> {
  return sha256(
    JSON.stringify({
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      organizationId: input.organizationId,
      requestKey: input.requestKey,
      version: "vinifera-analytics-event-v1",
    }),
  );
}

export async function runFailureIsolatedAnalyticsWrite(
  write: () => Promise<void>,
  onFailure: (error: unknown) => void = () => undefined,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Observability must never make an authoritative business operation fail.
    }
    return false;
  }
}
