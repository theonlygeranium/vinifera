import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  PackageCheck,
  Plus,
  Wine,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { ApiError, apiRequest, postJson } from "../../api/client";
import {
  type ClubTier,
  type Release,
  type ReleaseWine,
} from "../../api/phase2";
import { Link } from "../../routes/router";
import { Dialog } from "../../shared/Dialog";
import { FormFeedback } from "../../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  isActivationError,
  LoadingBlock,
} from "../../shared/OperationalState";
import { StaffShell } from "../StaffShell";
import { date, money, sentence } from "./format";
import { useApiResource } from "./useApiResource";

interface ReleaseForm {
  name: string;
  description: string;
  processingDate: string;
  embargoDate: string;
  tierIds: string[];
  tierPrices: Record<string, string>;
  wines: ReleaseWine[];
}

const initialRelease: ReleaseForm = {
  name: "",
  description: "",
  processingDate: "",
  embargoDate: "",
  tierIds: [],
  tierPrices: {},
  wines: [{ name: "", quantity: 1 }],
};

function statusClass(status: string) {
  return `status-pill status-pill--${status}`;
}

function ReleaseFormFields({
  values,
  tiers,
  busy,
  onChange,
  onSubmit,
}: {
  values: ReleaseForm;
  tiers: ClubTier[];
  busy: boolean;
  onChange: (values: ReleaseForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function field(name: keyof ReleaseForm, value: ReleaseForm[keyof ReleaseForm]) {
    onChange({ ...values, [name]: value });
  }
  function wineField(index: number, name: keyof ReleaseWine, value: string) {
    const wines = values.wines.map((wine, wineIndex) =>
      wineIndex === index
        ? { ...wine, [name]: name === "quantity" ? Number(value) : value }
        : wine,
    );
    field("wines", wines);
  }
  function toggleTier(tier: ClubTier, checked: boolean) {
    const tierIds = checked
        ? [...values.tierIds, tier.id]
        : values.tierIds.filter((id) => id !== tier.id);
    const tierPrices =
      checked && !values.tierPrices[tier.id]
        ? {
            ...values.tierPrices,
            [tier.id]: (tier.priceCents / 100).toFixed(2),
          }
        : values.tierPrices;
    onChange({ ...values, tierIds, tierPrices });
  }

  return (
    <form id="release-form" className="operation-form" onSubmit={onSubmit}>
      <div className="form-field">
        <label htmlFor="release-name">Release name</label>
        <input
          id="release-name"
          required
          value={values.name}
          onChange={(event) => field("name", event.target.value)}
          placeholder="Fall 2026 Release"
        />
      </div>
      <div className="form-field">
        <label htmlFor="release-description">Description</label>
        <textarea
          id="release-description"
          rows={3}
          value={values.description}
          onChange={(event) => field("description", event.target.value)}
        />
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="release-processing">Processing date</label>
          <input
            id="release-processing"
            required
            type="date"
            value={values.processingDate}
            onChange={(event) => field("processingDate", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="release-embargo">Contents visible after</label>
          <input
            id="release-embargo"
            required
            type="date"
            max={values.processingDate || undefined}
            value={values.embargoDate}
            onChange={(event) => field("embargoDate", event.target.value)}
          />
        </div>
      </div>
      <fieldset className="operation-fieldset">
        <legend>Participating tiers and pricing</legend>
        {tiers.length ? (
          <div className="release-tier-picker">
            {tiers.map((tier) => {
              const selected = values.tierIds.includes(tier.id);
              return (
                <div key={tier.id} className={selected ? "is-selected" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => toggleTier(tier, event.target.checked)}
                    />
                    <span>
                      <strong>{tier.name}</strong>
                      <small>
                        {tier.memberCount} members · {tier.bottleCount} bottles
                      </small>
                    </span>
                  </label>
                  {selected ? (
                    <div className="form-field">
                      <label htmlFor={`release-price-${tier.id}`}>
                        Charge amount
                      </label>
                      <div className="money-input">
                        <span aria-hidden="true">$</span>
                        <input
                          id={`release-price-${tier.id}`}
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={values.tierPrices[tier.id] ?? ""}
                          onChange={(event) =>
                            field("tierPrices", {
                              ...values.tierPrices,
                              [tier.id]: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted-copy">Create a club tier before this release.</p>
        )}
      </fieldset>
      <fieldset className="operation-fieldset">
        <legend>Included wines</legend>
        <div className="wine-builder">
          {values.wines.map((wine, index) => (
            <div className="wine-builder__row" key={`wine-${index}`}>
              <div className="form-field">
                <label htmlFor={`wine-name-${index}`}>Wine {index + 1}</label>
                <input
                  id={`wine-name-${index}`}
                  required
                  value={wine.name}
                  onChange={(event) => wineField(index, "name", event.target.value)}
                  placeholder="2023 Estate Cabernet"
                />
              </div>
              <div className="form-field">
                <label htmlFor={`wine-quantity-${index}`}>Quantity</label>
                <input
                  id={`wine-quantity-${index}`}
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={wine.quantity}
                  onChange={(event) =>
                    wineField(index, "quantity", event.target.value)
                  }
                />
              </div>
              {values.wines.length > 1 ? (
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() =>
                    field(
                      "wines",
                      values.wines.filter((_, wineIndex) => wineIndex !== index),
                    )
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={() =>
            field("wines", [...values.wines, { name: "", quantity: 1 }])
          }
        >
          <Plus aria-hidden="true" />
          Add wine
        </button>
      </fieldset>
      <button
        className="button button--primary button--wide"
        disabled={busy || values.tierIds.length === 0}
      >
        {busy ? "Scheduling release…" : "Create scheduled release"}
      </button>
    </form>
  );
}

export function ReleasesPage() {
  const loadReleases = useCallback(
    () => apiRequest<Release[]>("/api/releases"),
    [],
  );
  const releases = useApiResource(loadReleases, [loadReleases]);
  const loadTiers = useCallback(
    () => apiRequest<ClubTier[]>("/api/club-tiers"),
    [],
  );
  const tiers = useApiResource(loadTiers, [loadTiers]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(initialRelease);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  const sortedReleases = useMemo(
    () =>
      releases.state.status === "ready"
        ? [...releases.state.data].sort((left, right) =>
            left.processingDate.localeCompare(right.processingDate),
          )
        : [],
    [releases.state],
  );

  async function createRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await postJson("/api/releases", {
        name: form.name,
        description: form.description || null,
        processingDate: form.processingDate,
        embargoDate: form.embargoDate,
        status: "scheduled",
        tiers: form.tierIds.map((tierId) => ({
          tierId,
          priceCents: Math.round(Number(form.tierPrices[tierId]) * 100),
        })),
        wines: form.wines.map((wine) => ({
          name: wine.name,
          quantity: wine.quantity,
        })),
      });
      setForm(initialRelease);
      setFormOpen(false);
      setFeedback({ message: "Release added to the live schedule.", kind: "success" });
      await releases.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The release could not be scheduled.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const tierList = tiers.state.status === "ready" ? tiers.state.data : [];

  return (
    <StaffShell
      title="Release Schedule"
      eyebrow="Club Operations"
      actions={
        <button
          type="button"
          className="button button--primary button--compact"
          onClick={() => setFormOpen(true)}
        >
          <Plus aria-hidden="true" />
          <span>Add Release</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Annual club calendar</p>
          <h2>Release schedule</h2>
          <p>
            Coordinate contents, embargo dates, member charges, and fulfillment.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>

      {releases.state.status === "loading" ? (
        <LoadingBlock label="Loading release calendar" />
      ) : releases.state.status === "error" ? (
        isActivationError(releases.state.error) ? (
          <ActivationBlock
            title="Release scheduling is ready to connect"
            detail="Deploy the release API and Phase 2 schema to activate the calendar."
          />
        ) : (
          <ErrorBlock
            error={releases.state.error}
            onRetry={() => void releases.refresh()}
          />
        )
      ) : sortedReleases.length === 0 ? (
        <EmptyBlock
          title="No releases scheduled"
          detail="Create a release after your club tiers and members are ready."
          action={
            <button
              type="button"
              className="button button--primary"
              onClick={() => setFormOpen(true)}
            >
              <CalendarDays aria-hidden="true" />
              Schedule release
            </button>
          }
        />
      ) : (
        <section className="release-calendar" aria-labelledby="release-calendar-title">
          <h2 id="release-calendar-title" className="sr-only">
            Scheduled releases
          </h2>
          {sortedReleases.map((release) => (
            <article className="release-card" key={release.id}>
              <div className="release-card__date">
                <CalendarDays aria-hidden="true" />
                <time dateTime={release.processingDate}>
                  {date(release.processingDate)}
                </time>
                <span>Processing date</span>
              </div>
              <div className="release-card__body">
                <div className="release-card__title">
                  <div>
                    <span className={statusClass(release.status)}>
                      {sentence(release.status)}
                    </span>
                    <h3>{release.name}</h3>
                  </div>
                  <Link
                    className="button button--secondary button--compact"
                    to={`/app/releases/${release.id}`}
                  >
                    Manage release
                  </Link>
                </div>
                <p>{release.description || "No release description."}</p>
                <ul className="release-card__meta">
                  <li>
                    <CheckCircle2 aria-hidden="true" />
                    Club tiers:{" "}
                    {release.tiers.map((tier) => tier.name).join(", ")}
                  </li>
                  <li>
                    <Wine aria-hidden="true" />
                    {release.wines.reduce((sum, wine) => sum + wine.quantity, 0)}{" "}
                    bottles
                  </li>
                  <li>
                    <UsersIcon />
                    {release.memberCount ?? 0} members
                  </li>
                  <li>
                    <Clock3 aria-hidden="true" />
                    Embargo {date(release.embargoDate)}
                  </li>
                </ul>
              </div>
            </article>
          ))}
        </section>
      )}

      <Dialog
        open={formOpen}
        title="Schedule a release"
        description="Members cannot see contents until the embargo date."
        onClose={() => setFormOpen(false)}
      >
        <ReleaseFormFields
          values={form}
          tiers={tierList}
          busy={busy}
          onChange={setForm}
          onSubmit={createRelease}
        />
      </Dialog>
    </StaffShell>
  );
}

function UsersIcon() {
  return <PackageCheck aria-hidden="true" />;
}

export function ReleaseDetailPage({ releaseId }: { releaseId: string }) {
  const load = useCallback(
    () => apiRequest<Release>(`/api/releases/${releaseId}`),
    [releaseId],
  );
  const release = useApiResource(load, [load]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  async function processRelease() {
    if (!confirmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postJson<{
        charged?: number;
        declined?: number;
        successfulChargeCount?: number;
        declinedChargeCount?: number;
      }>(`/api/releases/${releaseId}/process`, { confirmed: true });
      setConfirmOpen(false);
      setConfirmed(false);
      setFeedback({
        message: `Billing run recorded ${
          result.successfulChargeCount ?? result.charged ?? 0
        } successful and ${
          result.declinedChargeCount ?? result.declined ?? 0
        } declined charges.`,
        kind: "success",
      });
      await release.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The release could not be processed.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const record = release.state.status === "ready" ? release.state.data : null;
  return (
    <StaffShell
      title={record?.name ?? "Release detail"}
      eyebrow="Release Schedule"
      actions={
        <Link className="button button--secondary button--compact" to="/app/releases">
          <ChevronLeft aria-hidden="true" />
          <span>All Releases</span>
        </Link>
      }
    >
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      {release.state.status === "loading" ? (
        <LoadingBlock label="Loading release" />
      ) : release.state.status === "error" ? (
        isActivationError(release.state.error) ? (
          <ActivationBlock
            title="Release detail is ready to connect"
            detail="Deploy the release detail API to activate this screen."
          />
        ) : (
          <ErrorBlock error={release.state.error} onRetry={() => void release.refresh()} />
        )
      ) : (
        <>
          <section className="release-hero" aria-labelledby="release-detail-title">
            <div>
              <span className={statusClass(release.state.data.status)}>
                {sentence(release.state.data.status)}
              </span>
              <h2 id="release-detail-title">{release.state.data.name}</h2>
              <p>{release.state.data.description || "No release description."}</p>
            </div>
            {["draft", "scheduled"].includes(release.state.data.status) ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setConfirmOpen(true)}
              >
                <CircleDollarSign aria-hidden="true" />
                Process release
              </button>
            ) : null}
          </section>
          <div className="metric-grid">
            <article className="metric-card">
              <span>Processing date</span>
              <strong>{date(release.state.data.processingDate)}</strong>
              <small>Charges and labels begin on this date</small>
            </article>
            <article className="metric-card">
              <span>Members</span>
              <strong>{release.state.data.memberCount ?? 0}</strong>
              <small>{release.state.data.tiers.length} participating tiers</small>
            </article>
            <article className="metric-card">
              <span>Successful charges</span>
              <strong>{release.state.data.successfulChargeCount ?? 0}</strong>
              <small>{money(release.state.data.grossAmountCents)}</small>
            </article>
            <article className="metric-card">
              <span>Declines</span>
              <strong>{release.state.data.declinedChargeCount ?? 0}</strong>
              <small>Managed in payment recovery</small>
            </article>
          </div>
          <div className="detail-grid">
            <section className="operation-panel" aria-labelledby="release-wines-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow eyebrow--wine">Contents</p>
                  <h2 id="release-wines-title">Included wines</h2>
                </div>
              </div>
              <ul className="item-list">
                {release.state.data.wines.map((wine, index) => (
                  <li key={wine.id ?? `${wine.name}-${index}`}>
                    <Wine aria-hidden="true" />
                    <span>
                      <strong>{wine.name}</strong>
                      <small>Quantity {wine.quantity}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="operation-panel" aria-labelledby="release-tiers-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow eyebrow--wine">Participation</p>
                  <h2 id="release-tiers-title">Club tiers</h2>
                </div>
              </div>
              <ul className="item-list">
                {release.state.data.tiers.map((tier) => (
                  <li key={tier.id}>
                    <CheckCircle2 aria-hidden="true" />
                    <span>
                      <strong>{tier.name}</strong>
                      <small>
                        {tier.bottleCount} bottles · {money(tier.priceCents)}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      <Dialog
        open={confirmOpen}
        title="Process this release?"
        description="This action creates shipments and attempts Stripe test-mode charges for every eligible member."
        onClose={() => {
          setConfirmOpen(false);
          setConfirmed(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!confirmed || busy}
              onClick={() => void processRelease()}
            >
              {busy ? "Processing…" : "Run billing"}
            </button>
          </>
        }
      >
        <div className="confirmation-copy">
          <p>
            Vinifera records each success and decline independently. A partial
            failure will not roll back successful charges.
          </p>
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand this starts a Stripe test-mode billing run and creates
              shipment records.
            </span>
          </label>
        </div>
      </Dialog>
    </StaffShell>
  );
}
