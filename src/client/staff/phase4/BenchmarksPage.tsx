import {
  BarChart3,
  Building2,
  FileLock2,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useCallback, useState } from "react";
import { apiRequest, patchJson } from "../../api/client";
import {
  type BenchmarksDashboard,
  normalizeBenchmarksDashboard,
} from "../../api/phase4";
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

function metricValue(
  value: number | null | undefined,
  unit: BenchmarksDashboard["metrics"][number]["unit"],
) {
  if (value === null || value === undefined) return "—";
  if (unit === "cents") return money(value);
  if (unit === "percent") {
    const normalized = value > 1 && value <= 100 ? value / 100 : value;
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(normalized);
  }
  if (unit === "months") return `${value.toLocaleString()} mo.`;
  return value.toLocaleString();
}

function ordinal(value: number) {
  const rounded = Math.round(value);
  const remainder100 = Math.abs(rounded) % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${rounded}th`;
  const suffix =
    Math.abs(rounded) % 10 === 1
      ? "st"
      : Math.abs(rounded) % 10 === 2
        ? "nd"
        : Math.abs(rounded) % 10 === 3
          ? "rd"
          : "th";
  return `${rounded}${suffix}`;
}

function PeerGroupSummary({ dashboard }: { dashboard: BenchmarksDashboard }) {
  const peers = dashboard.peerGroup;
  return (
    <section className="benchmark-peer-summary" aria-labelledby="peer-group-title">
      <div>
        <UsersRound aria-hidden="true" />
        <span>
          <strong id="peer-group-title">Your anonymized peer group</strong>
          <small>
            {[peers?.region, peers?.tierDistribution, peers?.memberCountBand]
              .filter(Boolean)
              .join(" · ") || "Calculated from eligible participating wineries"}
          </small>
        </span>
      </div>
      <span className="status-pill status-pill--active">
        {dashboard.period || "Latest period"}
      </span>
    </section>
  );
}

export function BenchmarksPage() {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(
    () => apiRequest<unknown>("/api/benchmarks").then(normalizeBenchmarksDashboard),
    [],
  );
  const benchmarks = useApiResource(load, [load]);

  async function savePreferences(
    current: BenchmarksDashboard,
    patch: { optedIn?: boolean; quarterlyReportEnabled?: boolean },
  ) {
    setSaving(true);
    setFeedback(null);
    try {
      await patchJson("/api/benchmarks/preferences", {
        optedIn: patch.optedIn ?? current.optedIn,
        quarterlyReportEnabled:
          patch.quarterlyReportEnabled ?? current.quarterlyReport.enabled,
      });
      await benchmarks.refresh();
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "Benchmark preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StaffShell
      title="Peer Benchmarks"
      eyebrow="Growth Intelligence"
      actions={
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={() => void benchmarks.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          <span>Refresh</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Privacy-preserving intelligence</p>
          <h2>See where your club stands</h2>
          <p>
            Compare winery performance with anonymized, aggregated peers—never
            another winery’s identifiable records.
          </p>
        </div>
        {benchmarks.state.status === "ready" && benchmarks.state.data.generatedAt ? (
          <strong>Generated {date(benchmarks.state.data.generatedAt)}</strong>
        ) : null}
      </div>
      <FormFeedback message={feedback} />

      {benchmarks.state.status === "loading" ? (
        <LoadingBlock label="Loading peer benchmarks" />
      ) : benchmarks.state.status === "error" ? (
        isActivationError(benchmarks.state.error) ? (
          <ActivationBlock
            title="Peer benchmarking is ready to connect"
            detail="The opt-in surface is complete and will activate after the anonymized cohort views are deployed."
          />
        ) : (
          <ErrorBlock error={benchmarks.state.error} onRetry={() => void benchmarks.refresh()} />
        )
      ) : !benchmarks.state.data.eligible ? (
        <section className="operation-panel">
          <EmptyBlock
            title="Available on Estate and Reserve"
            detail={`Your ${sentence(benchmarks.state.data.subscriptionTier || "current")} plan keeps all winery data private. Upgrade to opt into aggregated peer intelligence.`}
          />
        </section>
      ) : !benchmarks.state.data.optedIn ? (
        <section className="benchmark-opt-in" aria-labelledby="benchmark-opt-in-title">
          <div className="benchmark-opt-in__intro">
            <BarChart3 aria-hidden="true" />
            <p className="eyebrow">Estate & Reserve intelligence</p>
            <h2 id="benchmark-opt-in-title">Join the anonymous benchmark pool</h2>
            <p>
              Vinifera compares performance only after at least{" "}
              {benchmarks.state.data.minimumPeerCount} eligible wineries are in
              a cohort. Results expose percentiles and aggregates—not names,
              member rows, or exact peer values.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void savePreferences(benchmarks.state.data!, { optedIn: true })}
              disabled={saving}
            >
              {saving ? "Joining…" : "Opt in to benchmarking"}
            </button>
          </div>
          <div className="benchmark-privacy-grid">
            <article>
              <FileLock2 aria-hidden="true" />
              <h3>Aggregated by design</h3>
              <p>Peer results remain hidden until the minimum cohort size is met.</p>
            </article>
            <article>
              <ShieldCheck aria-hidden="true" />
              <h3>No identifiable sharing</h3>
              <p>Names, emails, shipments, and winery identity never appear in peer results.</p>
            </article>
            <article>
              <Building2 aria-hidden="true" />
              <h3>Comparable cohorts</h3>
              <p>Region, club mix, and member-count bands keep comparisons useful.</p>
            </article>
          </div>
        </section>
      ) : (
        <>
          <PeerGroupSummary dashboard={benchmarks.state.data} />
          {benchmarks.state.data.metrics.length === 0 ? (
            <EmptyBlock
              title="Your cohort is still forming"
              detail={`Metrics remain hidden until at least ${benchmarks.state.data.minimumPeerCount} eligible wineries participate.`}
            />
          ) : (
            <div className="benchmark-grid">
              {benchmarks.state.data.metrics.map((metric) => {
                const maximum = Math.max(metric.organizationValue, metric.peerMedian, 1);
                return (
                  <article key={metric.id} className="operation-panel benchmark-card">
                    <div className="benchmark-card__heading">
                      <div>
                        <span>{metric.label}</span>
                        <strong>{metricValue(metric.organizationValue, metric.unit)}</strong>
                      </div>
                      {metric.percentile != null ? (
                        <b>{ordinal(metric.percentile)} percentile</b>
                      ) : null}
                    </div>
                    <div
                      className="benchmark-bars"
                      role="img"
                      aria-label={`${metric.label}: your winery ${metricValue(metric.organizationValue, metric.unit)}; peer median ${metricValue(metric.peerMedian, metric.unit)}.`}
                    >
                      <span>
                        <i>Winery</i>
                        <b><em style={{ width: `${(metric.organizationValue / maximum) * 100}%` }} /></b>
                      </span>
                      <span>
                        <i>Peer median</i>
                        <b><em className="benchmark-bars__peer" style={{ width: `${(metric.peerMedian / maximum) * 100}%` }} /></b>
                      </span>
                    </div>
                    <dl className="benchmark-card__detail">
                      <div><dt>Peer median</dt><dd>{metricValue(metric.peerMedian, metric.unit)}</dd></div>
                      <div><dt>Peer range</dt><dd>{metricValue(metric.peerP25, metric.unit)}–{metricValue(metric.peerP75, metric.unit)}</dd></div>
                      <div><dt>Cohort size</dt><dd>{metric.sampleCountBand} wineries</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
          <section className="operation-panel benchmark-report-setting" aria-labelledby="benchmark-report-title">
            <div>
              <h2 id="benchmark-report-title">Quarterly peer report</h2>
              <p>
                Receive a privacy-preserving performance brief.
                {benchmarks.state.data.quarterlyReport.nextScheduledAt
                  ? ` Next report ${date(benchmarks.state.data.quarterlyReport.nextScheduledAt)}.`
                  : ""}
              </p>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={benchmarks.state.data.quarterlyReport.enabled}
                onChange={(event) =>
                  void savePreferences(benchmarks.state.data!, {
                    quarterlyReportEnabled: event.target.checked,
                  })
                }
                disabled={saving}
              />
              <span aria-hidden="true" />
              {benchmarks.state.data.quarterlyReport.enabled ? "Enabled" : "Disabled"}
            </label>
          </section>
          <button
            type="button"
            className="benchmark-opt-out"
            onClick={() => void savePreferences(benchmarks.state.data!, { optedIn: false })}
            disabled={saving}
          >
            Leave benchmark pool
          </button>
        </>
      )}
    </StaffShell>
  );
}
