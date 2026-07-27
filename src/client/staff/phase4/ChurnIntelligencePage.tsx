import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Beaker,
  BrainCircuit,
  CalendarClock,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { apiRequest, patchJson } from "../../api/client";
import { queryPath } from "../../api/phase2";
import {
  type ChurnIntelligenceItem,
  normalizeChurnIntelligence,
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
import { date, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";
import { RiskBadge } from "../phase3/ChurnWatchPage";

function percent(value?: number | null) {
  if (value === null || value === undefined) return "Awaiting outcomes";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function scoreFor(item: ChurnIntelligenceItem) {
  return item.source === "ml" ? (item.mlScore ?? item.rulesScore) : item.rulesScore;
}

function ModelStatus({
  mode,
  fallbackReason,
}: {
  mode: "ab_test" | "ml" | "rules_fallback";
  fallbackReason?: string | null;
}) {
  if (mode === "rules_fallback") {
    return (
      <section className="intelligence-status intelligence-status--fallback" aria-labelledby="model-status-title">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2 id="model-status-title">Rules engine is protecting score continuity</h2>
          <p>
            {fallbackReason ||
              "The ML model has not met its production gate. Existing explainable rules remain active with no scoring interruption."}
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="intelligence-status" aria-labelledby="model-status-title">
      {mode === "ab_test" ? <Beaker aria-hidden="true" /> : <BrainCircuit aria-hidden="true" />}
      <div>
        <h2 id="model-status-title">
          {mode === "ab_test" ? "ML and rules A/B validation is active" : "Validated ML scoring is active"}
        </h2>
        <p>
          {mode === "ab_test"
            ? "Both models are being measured against observed cancellations before any automatic promotion."
            : "Production scores use the validated model while the rules engine remains available as a fail-safe."}
        </p>
      </div>
    </section>
  );
}

function FactorList({ item }: { item: ChurnIntelligenceItem }) {
  if (!item.topFeatures.length) {
    return <p className="muted-copy">The latest scoring response did not include feature attribution.</p>;
  }
  return (
    <ol className="intelligence-factor-list">
      {item.topFeatures.map((factor) => (
        <li key={factor.id}>
          <span
            className={`churn-factor-list__icon churn-factor-list__icon--${factor.direction}`}
            aria-hidden="true"
          >
            {factor.direction === "raises" ? <ArrowUpRight /> : <ArrowDownRight />}
          </span>
          <span>
            <strong>{factor.label}</strong>
            <small>{factor.detail}</small>
          </span>
          <b>
            {factor.shapValue == null
              ? `${factor.impact > 0 ? "+" : ""}${factor.impact}`
              : `${factor.shapValue > 0 ? "+" : ""}${factor.shapValue.toFixed(3)}`}
          </b>
        </li>
      ))}
    </ol>
  );
}

export function ChurnIntelligencePage() {
  const [riskLevel, setRiskLevel] = useState("");
  const [search, setSearch] = useState("");
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiRequest<unknown>(
        queryPath("/api/churn-intelligence", {
          riskLevel: riskLevel || undefined,
          search: search || undefined,
        }),
      ).then(normalizeChurnIntelligence),
    [riskLevel, search],
  );
  const intelligence = useApiResource(load, [load]);
  const items = useMemo(
    () =>
      intelligence.state.status === "ready"
        ? [...intelligence.state.data.items].sort(
            (left, right) => scoreFor(right) - scoreFor(left),
          )
        : [],
    [intelligence.state],
  );
  const counts = useMemo(
    () => ({
      high: items.filter((item) => item.riskLevel === "high").length,
      medium: items.filter((item) => item.riskLevel === "medium").length,
      low: items.filter((item) => item.riskLevel === "low").length,
    }),
    [items],
  );

  async function acknowledgeAlert(
    alert: NonNullable<ChurnIntelligenceItem["alert"]>,
  ) {
    setAcknowledging(alert.id);
    setFeedback(null);
    try {
      await patchJson(`/api/churn-intelligence/alerts/${alert.id}`, {
        status: "acknowledged",
      });
      setFeedback("High-risk alert acknowledged.");
      await intelligence.refresh();
    } catch (caught) {
      setFeedback(
        caught instanceof Error
          ? caught.message
          : "The high-risk alert could not be acknowledged.",
      );
    } finally {
      setAcknowledging(null);
    }
  }

  return (
    <StaffShell
      title="AI Churn Watch"
      eyebrow="Growth Intelligence"
      actions={
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={() => void intelligence.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          <span>Refresh scores</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Validated retention intelligence</p>
          <h2>Explainable churn risk</h2>
          <p>
            Compare ML predictions with the rules baseline, inspect the score band,
            and understand the factors behind every member score.
          </p>
        </div>
        {intelligence.state.status === "ready" ? (
          <span className="calculation-stamp">
            <CalendarClock aria-hidden="true" />
            {intelligence.state.data.model?.trainedAt
              ? `Model trained ${date(intelligence.state.data.model.trainedAt)}`
              : "Rules fallback available"}
          </span>
        ) : null}
      </div>
      <FormFeedback message={feedback} />

      {intelligence.state.status === "loading" ? (
        <LoadingBlock label="Loading churn intelligence" />
      ) : intelligence.state.status === "error" ? (
        isActivationError(intelligence.state.error) ? (
          <ActivationBlock
            title="ML intelligence is ready to connect"
            detail="Rules-based scores remain available until the first model training and A/B validation run completes."
          />
        ) : (
          <ErrorBlock error={intelligence.state.error} onRetry={() => void intelligence.refresh()} />
        )
      ) : (
        <>
          <ModelStatus
            mode={intelligence.state.data.mode}
            fallbackReason={intelligence.state.data.fallbackReason}
          />
          <div className="metric-grid intelligence-metrics">
            <article className="metric-card">
              <span>Scoring mode</span>
              <strong>{intelligence.state.data.mode === "ab_test" ? "A/B test" : intelligence.state.data.mode === "ml" ? "ML active" : "Rules"}</strong>
              <small>{intelligence.state.data.model?.version ?? "Fail-safe baseline"}</small>
            </article>
            <article className="metric-card">
              <span>Model accuracy</span>
              <strong>{percent(intelligence.state.data.model?.metrics.accuracy)}</strong>
              <small>{intelligence.state.data.model?.algorithm ?? "Validation pending"}</small>
            </article>
            <article className="metric-card">
              <span>A/B sample</span>
              <strong>{intelligence.state.data.abTest?.sampleSize.toLocaleString() ?? "—"}</strong>
              <small>Observed outcome records</small>
            </article>
            <article className={`metric-card metric-card--drift-${intelligence.state.data.drift?.status ?? "stable"}`}>
              <span>Model drift</span>
              <strong>{sentence(intelligence.state.data.drift?.status ?? "stable")}</strong>
              <small>
                {intelligence.state.data.drift?.lastCheckedAt
                  ? `Checked ${date(intelligence.state.data.drift.lastCheckedAt)}`
                  : "Monitored each scoring run"}
              </small>
            </article>
          </div>

          {intelligence.state.data.mode === "ab_test" ? (
            <section className="operation-panel model-comparison" aria-labelledby="model-comparison-title">
              <div className="panel-heading">
                <div>
                  <h2 id="model-comparison-title">A/B model comparison</h2>
                  <p>Outcome accuracy is measured on the same validation period.</p>
                </div>
              </div>
              <div className="model-comparison__grid">
                <article>
                  <BrainCircuit aria-hidden="true" />
                  <span>ML model</span>
                  <strong>{percent(intelligence.state.data.abTest?.mlAccuracy)}</strong>
                </article>
                <article>
                  <ShieldCheck aria-hidden="true" />
                  <span>Rules baseline</span>
                  <strong>{percent(intelligence.state.data.abTest?.rulesAccuracy)}</strong>
                </article>
                <article>
                  <Beaker aria-hidden="true" />
                  <span>Validation window</span>
                  <strong>
                    {intelligence.state.data.abTest?.endsAt
                      ? date(intelligence.state.data.abTest.endsAt)
                      : "In progress"}
                  </strong>
                </article>
              </div>
            </section>
          ) : null}

          <section className="operation-panel churn-panel" aria-labelledby="intelligence-queue-title">
            <div className="panel-heading panel-heading--split">
              <div className="ai-heading">
                <Sparkles aria-hidden="true" />
                <div>
                  <h2 id="intelligence-queue-title">Member risk queue</h2>
                  <p>
                    {counts.high} high, {counts.medium} medium, and {counts.low} low risk in this view.
                  </p>
                </div>
              </div>
              <div className="operation-toolbar operation-toolbar--compact">
                <div className="search-control">
                  <Search aria-hidden="true" />
                  <label className="sr-only" htmlFor="intelligence-search">Search scored members</label>
                  <input
                    id="intelligence-search"
                    type="search"
                    placeholder="Search member"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <label className="form-field form-field--inline">
                  <span className="sr-only">Filter by risk level</span>
                  <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
                    <option value="">All risk levels</option>
                    <option value="high">High risk</option>
                    <option value="medium">Medium risk</option>
                    <option value="low">Low risk</option>
                  </select>
                </label>
              </div>
            </div>
            {items.length === 0 ? (
              <EmptyBlock
                title="No members match this risk view"
                detail="Scored production members will appear after a nightly model or rules run."
              />
            ) : (
              <div className="churn-watch-list intelligence-list">
                {items.map((item) => {
                  const score = scoreFor(item);
                  return (
                    <article key={item.memberId} className="churn-watch-row intelligence-row">
                      <span className="churn-watch-row__avatar" aria-hidden="true">
                        {item.memberName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                      </span>
                      <div className="churn-watch-row__identity">
                        <Link to={`/app/members/${item.memberId}`}>{item.memberName}</Link>
                        <small>{[item.tierName, item.email].filter(Boolean).join(" · ")}</small>
                      </div>
                      <div className="churn-watch-row__risk">
                        <RiskBadge level={item.riskLevel} score={score} />
                        <small>
                          {item.source === "ml" ? "ML score" : "Rules fallback"}
                          {item.confidenceBandLow != null && item.confidenceBandHigh != null
                            ? ` · ${item.confidenceBandLow}–${item.confidenceBandHigh}% calibrated uncertainty band`
                            : ""}
                        </small>
                      </div>
                      <div className="intelligence-row__compare">
                        <span>Rules <b>{item.rulesScore}</b></span>
                        <span>ML <b>{item.mlScore ?? "—"}</b></span>
                      </div>
                      {item.alert ? (
                        <aside
                          className={`high-risk-alert high-risk-alert--${item.alert.status}`}
                          aria-label={`High-risk alert for ${item.memberName}`}
                        >
                          <BellRing aria-hidden="true" />
                          <span>
                            <strong>
                              {item.alert.status === "open"
                                ? "High-risk alert needs review"
                                : "High-risk alert acknowledged"}
                            </strong>
                            <small>
                              {item.alert.status === "acknowledged"
                                ? [
                                    item.alert.acknowledgedByName,
                                    item.alert.acknowledgedAt
                                      ? date(item.alert.acknowledgedAt)
                                      : null,
                                  ].filter(Boolean).join(" · ") || "Review recorded"
                                : item.alert.createdAt
                                  ? `Created ${date(item.alert.createdAt)}`
                                  : "Generated by the latest scoring run"}
                            </small>
                          </span>
                          {item.alert.status === "open" ? (
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              onClick={() => void acknowledgeAlert(item.alert!)}
                              disabled={acknowledging !== null}
                            >
                              {acknowledging === item.alert.id
                                ? "Acknowledging…"
                                : "Acknowledge"}
                            </button>
                          ) : (
                            <span className="status-pill status-pill--active">
                              Acknowledged
                            </span>
                          )}
                        </aside>
                      ) : null}
                      <details className="churn-watch-row__factors intelligence-row__factors">
                        <summary>
                          <BrainCircuit aria-hidden="true" />
                          Why this score?
                        </summary>
                        <FactorList item={item} />
                      </details>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </StaffShell>
  );
}
