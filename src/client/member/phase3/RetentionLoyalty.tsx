import {
  ArrowDown,
  CheckCircle2,
  CirclePause,
  Coins,
  Gift,
  HeartHandshake,
  Repeat2,
  Sparkles,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { ApiError, apiRequest, postJson } from "../../api/client";
import {
  type CancelFlowStepConfig,
  type CancelStepId,
  type LoyaltyAccount,
  type MemberCancelFlow,
  normalizeLoyaltyAccount,
  normalizeMemberCancelFlow,
} from "../../api/phase3";
import { Dialog } from "../../shared/Dialog";
import { FormFeedback } from "../../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  isActivationError,
  LoadingBlock,
} from "../../shared/OperationalState";
import { date, money, sentence } from "../../staff/phase2/format";
import { useApiResource } from "../../staff/phase2/useApiResource";

const cancelStepIcons: Record<CancelStepId, typeof CirclePause> = {
  pause: CirclePause,
  downgrade: ArrowDown,
  swap: Repeat2,
  confirm: CheckCircle2,
};

function formatPoints(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function MemberRetentionControls() {
  const load = useCallback(
    () =>
      apiRequest<MemberCancelFlow>("/api/member/cancel-flow").then(
        normalizeMemberCancelFlow,
      ),
    [],
  );
  const flow = useApiResource(load, [load]);
  const [flowOpen, setFlowOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [startedFlow, setStartedFlow] = useState<MemberCancelFlow | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pauseMonths, setPauseMonths] = useState("1");
  const [selectedTierId, setSelectedTierId] = useState("");
  const [selectedSwapId, setSelectedSwapId] = useState("");
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  const configuredFlow =
    startedFlow ??
    (flow.state.status === "ready" ? flow.state.data : null);
  const activeSteps = useMemo(
    () =>
      configuredFlow
        ? [...configuredFlow.steps]
            .filter((step) => step.enabled)
            .sort((left, right) => left.order - right.order)
        : [],
    [configuredFlow],
  );
  const currentStep = activeSteps[activeIndex] ?? null;

  async function beginAttempt() {
    try {
      const result = await postJson<MemberCancelFlow>(
        "/api/member/cancel-flow",
        { confirmed: true },
      );
      const normalized = normalizeMemberCancelFlow(result);
      setStartedFlow(normalized);
      return normalized;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 405)
      ) {
        return configuredFlow;
      }
      throw error;
    }
  }

  async function openCancelFlow() {
    if (busy) return;
    setActiveIndex(0);
    setPauseMonths("1");
    setSelectedTierId("");
    setSelectedSwapId("");
    setFinalConfirmed(false);
    setFeedback(null);
    setBusy(true);
    try {
      const attempt = await beginAttempt();
      if (!attempt) {
        throw new Error("Membership options are still loading.");
      }
      setFlowOpen(true);
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "We could not start the cancellation flow.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function record(
    step: CancelStepId,
    outcome: "continued" | "paused" | "downgraded" | "swapped" | "cancelled",
    options?: { offerId?: string; metadata?: Record<string, unknown> },
    attemptFlow = configuredFlow,
  ) {
    const stepConfig = attemptFlow?.steps.find(
      (candidate) => candidate.id === step,
    );
    return postJson<{ message?: string }>("/api/member/cancel-flow/events", {
      step,
      outcome,
      offerId: options?.offerId,
      metadata: options?.metadata,
      action: outcome,
      attemptId: attemptFlow?.attemptId,
      stepId: stepConfig?.stepId ?? step,
      details: {
        ...options?.metadata,
        ...(options?.offerId ? { offerId: options.offerId } : {}),
      },
    });
  }

  async function acceptOffer(
    outcome: "paused" | "downgraded" | "swapped",
  ) {
    if (!currentStep) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await record(
        currentStep.id,
        outcome,
        {
          offerId:
            outcome === "downgraded"
              ? selectedTierId
              : outcome === "swapped"
                ? selectedSwapId
                : undefined,
          metadata:
            outcome === "paused" ? { months: Number(pauseMonths) } : undefined,
        },
        configuredFlow,
      );
      setFlowOpen(false);
      setFeedback({
        message:
          result.message ??
          (outcome === "paused"
            ? "Your membership pause is confirmed."
            : outcome === "downgraded"
              ? "Your club tier change is confirmed."
              : "Your next shipment swap is confirmed."),
        kind: "success",
      });
      await flow.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "We could not apply that membership option.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function continueFlow() {
    if (!currentStep) return;
    setBusy(true);
    setFeedback(null);
    try {
      await record(currentStep.id, "continued", undefined, configuredFlow);
      setActiveIndex((index) => Math.min(index + 1, activeSteps.length - 1));
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "We could not continue the cancellation flow.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function cancelMembership() {
    if (!finalConfirmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await record(
        "confirm",
        "cancelled",
        undefined,
        configuredFlow,
      );
      setFlowOpen(false);
      setFeedback({
        message:
          result.message ??
          "Your membership cancellation has been confirmed.",
        kind: "success",
      });
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "Your membership could not be cancelled.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function directPause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const attempt = await beginAttempt();
      if (!attempt) throw new Error("Membership options are still loading.");
      const result = await record(
        "pause",
        "paused",
        {
          metadata: {
            months: Number(pauseMonths),
            source: "direct_portal_action",
          },
        },
        attempt,
      );
      setPauseOpen(false);
      setFeedback({
        message: result.message ?? "Your membership pause is confirmed.",
        kind: "success",
      });
      await flow.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "Your membership could not be paused.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="portal-retention-feedback" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      <button type="button" onClick={() => setPauseOpen(true)}>
        <CirclePause aria-hidden="true" />
        <span>
          <strong>Pause membership</strong>
          <small>Take a one- or three-month break</small>
        </span>
      </button>
      <button
        type="button"
        className="portal-action--danger"
        onClick={() => void openCancelFlow()}
        aria-busy={busy}
        aria-disabled={busy}
      >
        <HeartHandshake aria-hidden="true" />
        <span>
          <strong>Cancel membership</strong>
          <small>Review every available option and cancellation impact</small>
        </span>
      </button>

      <Dialog
        open={pauseOpen}
        title="Pause your membership"
        description="Choose a pause length. Your membership remains active and resumes automatically."
        onClose={() => setPauseOpen(false)}
      >
        {flow.state.status === "loading" ? (
          <LoadingBlock label="Loading membership options" />
        ) : flow.state.status === "error" ? (
          isActivationError(flow.state.error) ? (
            <ActivationBlock
              title="Membership pause is ready to connect"
              detail="Your winery must activate the Phase 3 retention service before this action can be completed."
            />
          ) : (
            <ErrorBlock error={flow.state.error} onRetry={() => void flow.refresh()} />
          )
        ) : (
          <form className="operation-form" onSubmit={directPause}>
            <fieldset className="member-choice-list">
              <legend>Pause length</legend>
              {[
                ["1", "One month", "Resume automatically after one month"],
                ["3", "Three months", "Resume automatically after three months"],
              ].map(([value, title, detail]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="direct-pause-length"
                    value={value}
                    checked={pauseMonths === value}
                    onChange={(event) => setPauseMonths(event.target.value)}
                  />
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              className="button button--primary button--wide"
              disabled={busy}
            >
              <CirclePause aria-hidden="true" />
              {busy ? "Confirming pause…" : "Confirm membership pause"}
            </button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={flowOpen}
        title="Membership options"
        description="You can leave at any time. First, review alternatives that may fit better."
        onClose={() => setFlowOpen(false)}
      >
        {flow.state.status === "loading" ? (
          <LoadingBlock label="Loading membership options" />
        ) : flow.state.status === "error" ? (
          isActivationError(flow.state.error) ? (
            <ActivationBlock
              title="Cancellation is ready to connect"
              detail="Your winery must activate the Phase 3 cancel-flow service before this request can be completed."
            />
          ) : (
            <ErrorBlock error={flow.state.error} onRetry={() => void flow.refresh()} />
          )
        ) : activeSteps.length === 0 ? (
          <EmptyBlock
            title="No cancellation steps are configured"
            detail="Contact your winery for help managing this membership."
          />
        ) : currentStep ? (
          <CancelStep
            step={currentStep}
            index={activeIndex}
            total={activeSteps.length}
            flow={configuredFlow ?? flow.state.data}
            pauseMonths={pauseMonths}
            selectedTierId={selectedTierId}
            selectedSwapId={selectedSwapId}
            finalConfirmed={finalConfirmed}
            busy={busy}
            onPauseMonths={setPauseMonths}
            onTier={setSelectedTierId}
            onSwap={setSelectedSwapId}
            onFinalConfirmed={setFinalConfirmed}
            onAccept={acceptOffer}
            onContinue={continueFlow}
            onCancel={cancelMembership}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function CancelStep({
  step,
  index,
  total,
  flow,
  pauseMonths,
  selectedTierId,
  selectedSwapId,
  finalConfirmed,
  busy,
  onPauseMonths,
  onTier,
  onSwap,
  onFinalConfirmed,
  onAccept,
  onContinue,
  onCancel,
}: {
  step: CancelFlowStepConfig;
  index: number;
  total: number;
  flow: MemberCancelFlow;
  pauseMonths: string;
  selectedTierId: string;
  selectedSwapId: string;
  finalConfirmed: boolean;
  busy: boolean;
  onPauseMonths: (value: string) => void;
  onTier: (value: string) => void;
  onSwap: (value: string) => void;
  onFinalConfirmed: (value: boolean) => void;
  onAccept: (outcome: "paused" | "downgraded" | "swapped") => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const Icon = cancelStepIcons[step.id];
  return (
    <div className="cancel-flow-step">
      <div className="cancel-flow-progress">
        <div>
          <span>
            Step {index + 1} of {total}
          </span>
          <strong>{step.title}</strong>
        </div>
        <div
          role="progressbar"
          aria-label="Cancellation progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
        >
          <span style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
      </div>
      <div className="cancel-flow-step__intro">
        <span aria-hidden="true">
          <Icon />
        </span>
        <div>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </div>
      </div>

      {step.id === "pause" ? (
        <fieldset className="member-choice-list">
          <legend>Choose a pause length</legend>
          {[
            ["1", "Pause for one month"],
            ["3", "Pause for three months"],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="cancel-pause-length"
                value={value}
                checked={pauseMonths === value}
                onChange={(event) => onPauseMonths(event.target.value)}
              />
              <span>
                <strong>{label}</strong>
                <small>Your current tier and points stay intact</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {step.id === "downgrade" ? (
        flow.lowerTiers.length ? (
          <fieldset className="member-choice-list">
            <legend>Available lower tiers</legend>
            {flow.lowerTiers.map((tier) => (
              <label key={tier.id}>
                <input
                  type="radio"
                  name="cancel-downgrade-tier"
                  value={tier.id}
                  checked={selectedTierId === tier.id}
                  onChange={(event) => onTier(event.target.value)}
                />
                <span>
                  <strong>{tier.name}</strong>
                  <small>
                    {tier.bottleCount} bottles · {money(tier.priceCents)}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="cancel-flow-unavailable">
            No lower-priced tier is currently available.
          </p>
        )
      ) : null}

      {step.id === "swap" ? (
        flow.swapOptions.length ? (
          <fieldset className="member-choice-list">
            <legend>Available shipment swaps</legend>
            {flow.swapOptions.map((wine, index) => {
              const id = wine.id ?? `${wine.name}-${index}`;
              return (
                <label key={id}>
                  <input
                    type="radio"
                    name="cancel-swap-wine"
                    value={id}
                    checked={selectedSwapId === id}
                    onChange={(event) => onSwap(event.target.value)}
                  />
                  <span>
                    <strong>{wine.name}</strong>
                    <small>
                      Quantity {wine.quantity}
                      {wine.priceCents ? ` · ${money(wine.priceCents)}` : ""}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <p className="cancel-flow-unavailable">
            No swaps are available for the next shipment.
          </p>
        )
      ) : null}

      {step.id === "confirm" ? (
        <div className="cancel-loss-summary">
          <div>
            <Gift aria-hidden="true" />
            <span>
              <strong>{formatPoints(flow.loyaltyBalance)} loyalty points</strong>
              <small>will no longer be available after cancellation</small>
            </span>
          </div>
          {flow.benefitsAtRisk.length ? (
            <ul>
              {flow.benefitsAtRisk.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
          ) : null}
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={finalConfirmed}
              onChange={(event) => onFinalConfirmed(event.target.checked)}
            />
            <span>
              I understand this ends my active membership and the listed
              benefits.
            </span>
          </label>
        </div>
      ) : null}

      <div className="cancel-flow-step__actions">
        {step.id === "pause" ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => onAccept("paused")}
            disabled={busy}
          >
            Pause membership
          </button>
        ) : step.id === "downgrade" ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => onAccept("downgraded")}
            disabled={busy || !selectedTierId}
          >
            Switch tier
          </button>
        ) : step.id === "swap" ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => onAccept("swapped")}
            disabled={busy || !selectedSwapId}
          >
            Swap next shipment
          </button>
        ) : (
          <button
            type="button"
            className="button button--danger"
            onClick={onCancel}
            disabled={busy || !finalConfirmed}
          >
            Cancel membership
          </button>
        )}
        {step.id !== "confirm" ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={onContinue}
            disabled={busy}
          >
            Continue cancellation
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MemberLoyaltyPanel({
  shipmentId,
}: {
  shipmentId?: string | null;
}) {
  const load = useCallback(
    () =>
      apiRequest<LoyaltyAccount>("/api/member/loyalty").then(
        normalizeLoyaltyAccount,
      ),
    [],
  );
  const loyalty = useApiResource(load, [load]);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [redemptionKey, setRedemptionKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      loyalty.state.status !== "ready" ||
      !shipmentId ||
      !redemptionKey
    ) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postJson<{ message?: string }>(
        "/api/member/loyalty/redeem",
        {
          idempotencyKey: redemptionKey,
          points: Number(redeemPoints),
          shipmentId,
        },
      );
      setRedeemOpen(false);
      setRedeemPoints("");
      setFeedback({
        message:
          result.message ??
          "Your points redemption was applied to an eligible upcoming shipment.",
        kind: "success",
      });
      await loyalty.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "Your points could not be redeemed.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function openRedemption() {
    setRedeemPoints("");
    setRedemptionKey(crypto.randomUUID());
    setRedeemOpen(true);
  }

  return (
    <section className="portal-loyalty" aria-labelledby="portal-loyalty-title">
      <div aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      {loyalty.state.status === "loading" ? (
        <LoadingBlock label="Loading your loyalty points" />
      ) : loyalty.state.status === "error" ? (
        isActivationError(loyalty.state.error) ? (
          <ActivationBlock
            title="Your loyalty ledger is ready"
            detail="Your winery will activate points after the Phase 3 loyalty program is connected."
          />
        ) : (
          <ErrorBlock error={loyalty.state.error} onRetry={() => void loyalty.refresh()} />
        )
      ) : (
        <>
          <header className="portal-loyalty__header">
            <div>
              <p className="eyebrow eyebrow--wine">
                {loyalty.state.data.tierName ?? "Loyalty member"} ·{" "}
                {loyalty.state.data.multiplier}× earning
              </p>
              <h2 id="portal-loyalty-title">Vine Points</h2>
              <p>Every award, redemption, and expiration is shown below.</p>
            </div>
            <div className="portal-loyalty__balance">
              <Sparkles aria-hidden="true" />
              <strong>{formatPoints(loyalty.state.data.availablePoints)}</strong>
              <span>available points</span>
            </div>
          </header>
          <div className="portal-loyalty__summary">
            <div>
              <span>Redemption rate</span>
              <strong>
                {formatPoints(loyalty.state.data.redemptionRate.points)} points ={" "}
                {money(loyalty.state.data.redemptionRate.discountCents)}
              </strong>
            </div>
            <div>
              <span>Expiring next</span>
              <strong>
                {formatPoints(loyalty.state.data.expiringPoints ?? 0)} points
              </strong>
              <small>{date(loyalty.state.data.nextExpirationAt)}</small>
            </div>
            <button
              type="button"
              className="button button--primary"
              onClick={openRedemption}
              disabled={
                loyalty.state.data.availablePoints <= 0 || !shipmentId
              }
            >
              <Gift aria-hidden="true" />
              Redeem points
            </button>
          </div>
          {loyalty.state.data.ledger.length ? (
            <div
              className="data-table-wrap"
              tabIndex={0}
              aria-label="Scrollable loyalty points ledger"
            >
              <table className="data-table loyalty-ledger-table">
                <caption>Your complete loyalty points ledger</caption>
                <thead>
                  <tr>
                    <th scope="col">Activity</th>
                    <th scope="col">Points</th>
                    <th scope="col">Recorded</th>
                    <th scope="col">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {loyalty.state.data.ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <span className="table-primary">{entry.reason}</span>
                        <small>{sentence(entry.type)}</small>
                      </td>
                      <td>
                        <span
                          className={
                            entry.points >= 0
                              ? "points-change points-change--positive"
                              : "points-change points-change--negative"
                          }
                        >
                          {entry.points >= 0 ? "+" : ""}
                          {formatPoints(entry.points)}
                        </span>
                      </td>
                      <td>{date(entry.createdAt)}</td>
                      <td>{date(entry.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyBlock
              title="No points activity yet"
              detail="Shipment, referral, event, birthday, and anniversary awards will appear here."
            />
          )}
        </>
      )}
      <Dialog
        open={redeemOpen}
        title="Redeem Vine Points"
        description="Apply points to an eligible upcoming shipment using your winery’s current redemption rate."
        onClose={() => setRedeemOpen(false)}
      >
        {loyalty.state.status === "ready" ? (
          <form className="operation-form" onSubmit={redeem}>
            <div className="form-field">
              <label htmlFor="member-redeem-points">Points to redeem</label>
              <div className="points-input">
                <Coins aria-hidden="true" />
                <input
                  id="member-redeem-points"
                  required
                  type="number"
                  min={loyalty.state.data.redemptionRate.points}
                  max={loyalty.state.data.availablePoints}
                  step={loyalty.state.data.redemptionRate.points}
                  value={redeemPoints}
                  onChange={(event) => setRedeemPoints(event.target.value)}
                />
              </div>
              <p className="field-message">
              Available: {formatPoints(loyalty.state.data.availablePoints)}{" "}
                points
                {!shipmentId
                  ? " · No eligible upcoming shipment is available"
                  : ""}
              </p>
            </div>
            <button
              type="submit"
              className="button button--primary button--wide"
              disabled={busy || !redeemPoints}
            >
              <Gift aria-hidden="true" />
              {busy ? "Redeeming…" : "Apply redemption"}
            </button>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
