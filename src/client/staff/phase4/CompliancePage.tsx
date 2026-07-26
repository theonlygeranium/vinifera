import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  FileWarning,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { apiRequest, postJson } from "../../api/client";
import { queryPath } from "../../api/phase2";
import {
  type ComplianceDashboard,
  type ComplianceStatus,
  normalizeComplianceDashboard,
} from "../../api/phase4";
import { Link } from "../../routes/router";
import { FormFeedback } from "../../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  isActivationError,
  LoadingBlock,
} from "../../shared/OperationalState";
import { StaffShell } from "../StaffShell";
import { date, money, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";

function statusLabel(status: ComplianceStatus) {
  if (status === "non_compliant") return "Non-compliant";
  return sentence(status);
}

function shortIdentifier(value: string) {
  if (!value) return "Pending";
  return value.length > 10 ? `…${value.slice(-8)}` : value;
}

function checkFreshness(value?: string | null) {
  if (!value) return { label: "Awaiting check", state: "unknown" };
  const checkedAt = new Date(value).getTime();
  if (!Number.isFinite(checkedAt)) return { label: "Date unavailable", state: "unknown" };
  const ageHours = Math.max(0, (Date.now() - checkedAt) / 3_600_000);
  if (ageHours <= 24) return { label: "Fresh", state: "fresh" };
  if (ageHours <= 72) return { label: "Review age", state: "aging" };
  return { label: "Stale", state: "stale" };
}

function ProviderBanner({
  provider,
}: {
  provider: ComplianceDashboard["provider"];
}) {
  const content =
    provider.status === "active"
      ? {
          icon: <ShieldCheck aria-hidden="true" />,
          title: `${provider.name} checks are active`,
          detail: provider.lastSuccessfulCheckAt
            ? `Last successful provider check ${date(provider.lastSuccessfulCheckAt)}.`
            : "Live post-charge destination and tax checks are available.",
        }
      : provider.status === "configured"
        ? {
            icon: <PlugZap aria-hidden="true" />,
            title: `${provider.name} credentials are configured`,
            detail: "Activation will be confirmed after the first successful post-charge provider check.",
          }
      : provider.status === "degraded"
        ? {
            icon: <AlertTriangle aria-hidden="true" />,
            title: `${provider.name} is temporarily degraded`,
            detail: "Unknown results remain fail-closed. Do not generate a label until a compliant response is recorded.",
          }
        : {
            icon: <PlugZap aria-hidden="true" />,
            title: `${provider.name} activation is pending`,
            detail: "The production boundary is wired. Add API credentials to activate the post-charge destination and tax check.",
          };
  return (
    <section
      className={`compliance-provider compliance-provider--${provider.status}`}
      aria-labelledby="compliance-provider-title"
    >
      {content.icon}
      <div>
        <h2 id="compliance-provider-title">{content.title}</h2>
        <p>{content.detail}</p>
      </div>
      <span className={`status-pill status-pill--${provider.status}`}>
        {sentence(provider.status)}
      </span>
    </section>
  );
}

export function CompliancePage() {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiRequest<unknown>(
        queryPath("/api/compliance/dashboard", {
          status: status || undefined,
          limit: "100",
          offset: "0",
        }),
      ).then(normalizeComplianceDashboard),
    [status],
  );
  const compliance = useApiResource(load, [load]);
  const releaseIds = useMemo(
    () =>
      compliance.state.status === "ready"
        ? [...new Set(
            compliance.state.data.items
              .filter((item) => item.shipmentStatus === "charged")
              .map((item) => item.releaseId)
              .filter((value): value is string => Boolean(value)),
          )]
        : [],
    [compliance.state],
  );

  async function recheckShipment(shipmentId: string) {
    if (!shipmentId) return;
    setChecking(shipmentId);
    setFeedback(null);
    try {
      await postJson(`/api/compliance/shipments/${shipmentId}/check`);
      setFeedback("Post-charge compliance check completed.");
      await compliance.refresh();
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "The compliance check could not be completed.");
    } finally {
      setChecking(null);
    }
  }

  async function recheckRelease(releaseId: string) {
    setChecking(`release:${releaseId}`);
    setFeedback(null);
    try {
      await postJson(`/api/compliance/releases/${releaseId}/check`);
      setFeedback("Release post-charge compliance checks completed.");
      await compliance.refresh();
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "The release check could not be completed.");
    } finally {
      setChecking(null);
    }
  }

  return (
    <StaffShell
      title="Compliance"
      eyebrow="Club Operations"
      actions={
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={() => void compliance.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          <span>Refresh</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Fail-closed shipment controls</p>
          <h2>Shipping compliance</h2>
          <p>
            Review ShipCompliant destination decisions, actionable reasons,
            and tax estimates captured after a successful charge, immediately
            before label generation.
          </p>
        </div>
      </div>
      <FormFeedback message={feedback} />

      {compliance.state.status === "loading" ? (
        <LoadingBlock label="Loading compliance checks" />
      ) : compliance.state.status === "error" ? (
        isActivationError(compliance.state.error) ? (
          <ActivationBlock
            title="ShipCompliant is ready to connect"
            detail="The dashboard, fail-closed service boundary, and check actions are complete. Add API credentials later to activate live decisions."
          />
        ) : (
          <ErrorBlock error={compliance.state.error} onRetry={() => void compliance.refresh()} />
        )
      ) : (
        <>
          <ProviderBanner provider={compliance.state.data.provider} />
          <div className="metric-grid">
            <article className="metric-card">
              <span>Total checks</span>
              <strong>{compliance.state.data.summary.totalChecks.toLocaleString()}</strong>
              <small>Current filtered workspace</small>
            </article>
            <article className="metric-card metric-card--risk-low">
              <span>Compliant</span>
              <strong>{compliance.state.data.summary.compliant.toLocaleString()}</strong>
              <small>Eligible to proceed</small>
            </article>
            <article className="metric-card metric-card--risk-high">
              <span>Blocked or unknown</span>
              <strong>{(compliance.state.data.summary.nonCompliant + compliance.state.data.summary.unknown).toLocaleString()}</strong>
              <small>Label generation remains blocked</small>
            </article>
            <article className="metric-card">
              <span>Estimated tax</span>
              <strong>{money(compliance.state.data.summary.taxEstimateCents)}</strong>
              <small>Provider estimate for checked shipments</small>
            </article>
          </div>

          <section className="operation-panel compliance-panel" aria-labelledby="compliance-table-title">
            <div className="panel-heading panel-heading--split">
              <div>
                <h2 id="compliance-table-title">Post-charge label checks</h2>
                <p>Unknown outcomes are treated as non-compliant and block label generation until a provider response succeeds.</p>
              </div>
              <div className="operation-toolbar operation-toolbar--compact">
                <label className="form-field form-field--inline">
                  <span className="sr-only">Filter compliance status</span>
                  <select value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="">All statuses</option>
                    <option value="compliant">Compliant</option>
                    <option value="non_compliant">Non-compliant</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                {releaseIds.length === 1 ? (
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    onClick={() => void recheckRelease(releaseIds[0]!)}
                    disabled={
                      checking !== null ||
                      compliance.state.data.provider.status !== "active"
                    }
                  >
                    <ShieldCheck aria-hidden="true" />
                    {checking === `release:${releaseIds[0]}` ? "Checking…" : "Check release"}
                  </button>
                ) : null}
              </div>
            </div>
            {compliance.state.data.items.length === 0 ? (
              <EmptyBlock
                title="No compliance checks in this view"
                detail="Checks appear after a successful charge when a shipment reaches label generation."
              />
            ) : (
              <div
                className="data-table-wrap"
                role="region"
                aria-label="Shipment compliance decisions"
                tabIndex={0}
              >
                <table className="data-table compliance-table">
                  <caption className="sr-only">Shipment compliance decisions and tax estimates</caption>
                  <thead>
                    <tr>
                      <th scope="col">Member</th>
                      <th scope="col">Release</th>
                      <th scope="col">Destination</th>
                      <th scope="col">Decision</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Tax estimate</th>
                      <th scope="col">Provider response</th>
                      <th scope="col">Checked</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {compliance.state.data.items.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Member">
                          {item.memberId ? (
                            <Link className="table-primary" to={`/app/members/${item.memberId}`}>{item.memberName}</Link>
                          ) : (
                            <span className="table-primary">{item.memberName}</span>
                          )}
                          <small className="shipment-reference">
                            <span aria-hidden="true">
                              Shipment {shortIdentifier(item.shipmentId)}
                            </span>
                            <span className="sr-only">
                              Shipment identifier {item.shipmentId || "pending"}
                            </span>
                          </small>
                        </td>
                        <td data-label="Release">{item.releaseName || "—"}</td>
                        <td data-label="Destination">{item.state || "—"}</td>
                        <td data-label="Decision">
                          <span className={`status-pill status-pill--${item.status}`}>
                            {item.status === "compliant" ? <CheckCircle2 aria-hidden="true" /> : <FileWarning aria-hidden="true" />}
                            {statusLabel(item.status)}
                          </span>
                        </td>
                        <td data-label="Reason" className="compliance-reason">{item.reason || "No reason returned"}</td>
                        <td data-label="Tax estimate">{money(item.taxEstimateCents)}</td>
                        <td data-label="Provider response">
                          {item.responseId ? (
                            <span className="provider-response">
                              <span aria-hidden="true">{shortIdentifier(item.responseId)}</span>
                              <span className="sr-only">Provider response identifier {item.responseId}</span>
                            </span>
                          ) : "Not returned"}
                        </td>
                        <td data-label="Checked">
                          <span className="compliance-checked">
                            {date(item.checkedAt)}
                            <small className={`freshness-state freshness-state--${checkFreshness(item.checkedAt).state}`}>
                              {checkFreshness(item.checkedAt).label}
                            </small>
                          </span>
                        </td>
                        <td data-label="Action" className="table-actions">
                          {item.shipmentStatus === "charged" ? (
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              onClick={() => void recheckShipment(item.shipmentId)}
                              disabled={
                                !item.shipmentId ||
                                checking !== null ||
                                compliance.state.data!.provider.status !== "active"
                              }
                            >
                              {checking === item.shipmentId ? "Checking…" : "Recheck"}
                            </button>
                          ) : (
                            <span className="compliance-action-state">
                              {item.shipmentStatus
                                ? `Unavailable after ${sentence(item.shipmentStatus)}`
                                : "Shipment state unavailable"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="compliance-explainer" aria-labelledby="compliance-explainer-title">
            <Calculator aria-hidden="true" />
            <div>
              <h2 id="compliance-explainer-title">Provider tax and decision evidence</h2>
              <p>
                Vinifera stores the provider response ID with every decision.
                This post-charge check runs immediately before label generation.
                Final tax and filing obligations remain governed by the winery’s
                configured compliance account and applicable jurisdictions.
              </p>
            </div>
          </section>
        </>
      )}
    </StaffShell>
  );
}
