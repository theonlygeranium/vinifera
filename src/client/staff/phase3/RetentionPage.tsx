import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CirclePause,
  HeartHandshake,
  RefreshCw,
  Repeat2,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest, patchJson } from "../../api/client";
import {
  type CancelFlowAnalytics,
  type CancelFlowConfig,
  type CancelFlowStepConfig,
  type CancelStepId,
  normalizeCancelFlowConfig,
} from "../../api/phase3";
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

const stepIcons: Record<CancelStepId, typeof CirclePause> = {
  pause: CirclePause,
  downgrade: ArrowDown,
  swap: Repeat2,
  confirm: CheckCircle2,
};

function ordered(steps: CancelFlowStepConfig[]) {
  return [...steps].sort((left, right) => left.order - right.order);
}

export function RetentionPage() {
  const loadConfig = useCallback(
    () =>
      apiRequest<CancelFlowConfig>("/api/cancel-flow/config").then(
        normalizeCancelFlowConfig,
      ),
    [],
  );
  const configResource = useApiResource(loadConfig, [loadConfig]);
  const loadAnalytics = useCallback(
    () => apiRequest<CancelFlowAnalytics>("/api/cancel-flow/analytics"),
    [],
  );
  const analytics = useApiResource(loadAnalytics, [loadAnalytics]);
  const [steps, setSteps] = useState<CancelFlowStepConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  useEffect(() => {
    if (configResource.state.status === "ready") {
      setSteps(ordered(configResource.state.data.steps));
    }
  }, [configResource.state]);

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const next = [...steps];
    const current = next[index];
    const target = next[nextIndex];
    if (!current || !target) return;
    next[index] = target;
    next[nextIndex] = current;
    setSteps(next.map((step, order) => ({ ...step, order: order + 1 })));
  }

  function toggle(stepId: CancelStepId) {
    setSteps((current) =>
      current.map((step) =>
        step.id === stepId ? { ...step, enabled: !step.enabled } : step,
      ),
    );
  }

  async function save() {
    setBusy(true);
    setFeedback(null);
    try {
      await patchJson("/api/cancel-flow/config", {
        steps: steps.map((step) => ({
          id: step.id,
          stepId: step.stepId,
          enabled: step.enabled,
          order: step.order,
          position: step.order,
        })),
      });
      setFeedback({
        message: "Cancel-flow order and availability saved.",
        kind: "success",
      });
      await configResource.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The cancel-flow settings could not be saved.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const analyticsSteps = useMemo(
    () =>
      analytics.state.status === "ready"
        ? [...analytics.state.data.steps].sort(
            (left, right) => right.conversionRate - left.conversionRate,
          )
        : [],
    [analytics.state],
  );

  return (
    <StaffShell
      title="Cancel Flow"
      eyebrow="Member Experience"
      actions={
        <button
          type="button"
          className="button button--primary button--compact"
          onClick={() => void save()}
          disabled={busy || steps.length === 0}
        >
          <CheckCircle2 aria-hidden="true" />
          <span>{busy ? "Saving…" : "Save Flow"}</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Retention intervention</p>
          <h2>Cancel-flow retention</h2>
          <p>
            Give members relevant alternatives before a final cancellation while
            preserving an honest, unobstructed exit.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>

      <div className="retention-layout">
        <section className="operation-panel" aria-labelledby="cancel-flow-config-title">
          <div className="panel-heading">
            <div className="ai-heading">
              <SlidersHorizontal aria-hidden="true" />
              <div>
                <h2 id="cancel-flow-config-title">Flow order and visibility</h2>
                <p>
                  Reorder offers with keyboard-accessible controls. Final
                  confirmation remains the last enabled step.
                </p>
              </div>
            </div>
          </div>
          {configResource.state.status === "loading" ? (
            <LoadingBlock label="Loading cancel-flow settings" />
          ) : configResource.state.status === "error" ? (
            isActivationError(configResource.state.error) ? (
              <ActivationBlock
                title="Cancel-flow settings are ready to connect"
                detail="Deploy the Phase 3 retention configuration API to activate these controls."
              />
            ) : (
              <ErrorBlock
                error={configResource.state.error}
                onRetry={() => void configResource.refresh()}
              />
            )
          ) : steps.length === 0 ? (
            <EmptyBlock
              title="No cancel-flow steps are configured"
              detail="Seed pause, downgrade, swap, and final confirmation steps."
            />
          ) : (
            <ol className="cancel-step-settings">
              {steps.map((step, index) => {
                const Icon = stepIcons[step.id];
                return (
                  <li key={step.id}>
                    <span className="cancel-step-settings__number">
                      {index + 1}
                    </span>
                    <span className="cancel-step-settings__icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="cancel-step-settings__copy">
                      <strong>{step.title}</strong>
                      <small>
                        {step.description || `${sentence(step.id)} retention step`}
                      </small>
                    </span>
                    <label className="toggle-control">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={() => toggle(step.id)}
                        disabled={step.id === "confirm"}
                      />
                      <span aria-hidden="true" />
                      {step.enabled ? "Enabled" : "Disabled"}
                    </label>
                    <div className="cancel-step-settings__move">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0 || step.id === "confirm"}
                        aria-label={`Move ${step.title} earlier`}
                      >
                        <ArrowUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => move(index, 1)}
                        disabled={
                          index === steps.length - 1 ||
                          steps[index + 1]?.id === "confirm" ||
                          step.id === "confirm"
                        }
                        aria-label={`Move ${step.title} later`}
                      >
                        <ArrowDown aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="retention-preview" aria-labelledby="retention-preview-title">
          <header>
            <HeartHandshake aria-hidden="true" />
            <div>
              <p className="eyebrow">Member preview</p>
              <h2 id="retention-preview-title">A clear path to stay—or leave</h2>
            </div>
          </header>
          <ol>
            {steps
              .filter((step) => step.enabled)
              .map((step, index) => {
                const Icon = stepIcons[step.id];
                return (
                  <li key={step.id}>
                    <span>{index + 1}</span>
                    <Icon aria-hidden="true" />
                    <div>
                      <strong>{step.title}</strong>
                      <small>{sentence(step.id)}</small>
                    </div>
                  </li>
                );
              })}
          </ol>
          <p>
            Offers use live tier, shipment, and loyalty data. No outcome is
            assumed until the member makes an authenticated choice.
          </p>
        </aside>
      </div>

      <section className="operation-panel retention-analytics" aria-labelledby="retention-analytics-title">
        <div className="panel-heading panel-heading--split">
          <div>
            <p className="eyebrow eyebrow--wine">Observed outcomes</p>
            <h2 id="retention-analytics-title">Cancel-flow analytics</h2>
            <p>Conversion is calculated from recorded member decisions only.</p>
          </div>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => void analytics.refresh()}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </button>
        </div>
        {analytics.state.status === "loading" ? (
          <LoadingBlock label="Loading retention analytics" />
        ) : analytics.state.status === "error" ? (
          isActivationError(analytics.state.error) ? (
            <ActivationBlock
              title="Retention analytics await member decisions"
              detail="Metrics will activate after authenticated members enter the cancel flow."
            />
          ) : (
            <ErrorBlock
              error={analytics.state.error}
              onRetry={() => void analytics.refresh()}
            />
          )
        ) : (
          <>
            <div className="metric-grid">
              <article className="metric-card">
                <span>Attempts</span>
                <strong>{analytics.state.data.attempts.toLocaleString()}</strong>
                <small>Authenticated cancel-flow starts</small>
              </article>
              <article className="metric-card metric-card--risk-low">
                <span>Members retained</span>
                <strong>{analytics.state.data.retained.toLocaleString()}</strong>
                <small>Accepted pause, downgrade, or swap</small>
              </article>
              <article className="metric-card">
                <span>Retention rate</span>
                <strong>{analytics.state.data.retentionRate.toFixed(1)}%</strong>
                <small>Retained divided by completed attempts</small>
              </article>
              <article className="metric-card">
                <span>Cancelled</span>
                <strong>{analytics.state.data.cancelled.toLocaleString()}</strong>
                <small>Completed final confirmation</small>
              </article>
            </div>
            {analyticsSteps.length ? (
              <div className="retention-step-analytics">
                {analyticsSteps.map((step) => (
                  <article key={step.step}>
                    <div>
                      <strong>{sentence(step.step)}</strong>
                      <span>{step.intercepted} retained</span>
                    </div>
                    <div
                      className="retention-meter"
                      role="progressbar"
                      aria-label={`${sentence(step.step)} conversion rate`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={step.conversionRate}
                    >
                      <span style={{ width: `${step.conversionRate}%` }} />
                    </div>
                    <b>{step.conversionRate.toFixed(1)}%</b>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyBlock
                title="No cancel-flow outcomes yet"
                detail="Step conversion rates will appear after the first completed attempt."
              />
            )}
            {analytics.state.data.recentOutcomes.length ? (
              <div
                className="data-table-wrap retention-outcome-table"
                tabIndex={0}
                aria-label="Scrollable recent cancel-flow outcomes"
              >
                <table className="data-table">
                  <caption>Recent member cancel-flow outcomes</caption>
                  <thead>
                    <tr>
                      <th scope="col">Member</th>
                      <th scope="col">Step</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.state.data.recentOutcomes.map((outcome) => (
                      <tr key={outcome.id}>
                        <td>
                          <Link
                            className="table-primary"
                            to={`/app/members/${outcome.memberId}`}
                          >
                            {outcome.memberName}
                          </Link>
                        </td>
                        <td>{sentence(outcome.step)}</td>
                        <td>
                          <span className="status-pill status-pill--active">
                            {sentence(outcome.outcome)}
                          </span>
                        </td>
                        <td>{date(outcome.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </section>
    </StaffShell>
  );
}
