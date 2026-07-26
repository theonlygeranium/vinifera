import {
  Barcode,
  Boxes,
  CheckCircle2,
  Download,
  PackageCheck,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  ApiError,
  apiRequest,
  downloadApiFile,
  patchJson,
  postJson,
} from "../../api/client";
import {
  asPageResult,
  queryPath,
  type PageResult,
  type Shipment,
  type ShipmentStatus,
} from "../../api/phase2";
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

function statusClass(status: string) {
  return `status-pill status-pill--${status}`;
}

function ShipmentTable({
  shipments,
  selected,
  onSelected,
  actions,
  caption,
}: {
  shipments: Shipment[];
  selected?: string[];
  onSelected?: (ids: string[]) => void;
  actions?: (shipment: Shipment) => React.ReactNode;
  caption: string;
}) {
  const allSelected =
    Boolean(shipments.length && selected) &&
    shipments.every((shipment) => selected?.includes(shipment.id));
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {selected && onSelected ? (
              <th scope="col" className="selection-cell">
                <input
                  type="checkbox"
                  aria-label="Select all visible shipments"
                  checked={allSelected}
                  onChange={(event) =>
                    onSelected(
                      event.target.checked
                        ? shipments.map((shipment) => shipment.id)
                        : [],
                    )
                  }
                />
              </th>
            ) : null}
            <th scope="col">Member</th>
            <th scope="col">Release</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Carrier / tracking</th>
            {actions ? (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {shipments.map((shipment) => (
            <tr key={shipment.id}>
              {selected && onSelected ? (
                <td className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label={`Select shipment for ${shipment.memberName}`}
                    checked={selected.includes(shipment.id)}
                    onChange={(event) =>
                      onSelected(
                        event.target.checked
                          ? [...selected, shipment.id]
                          : selected.filter((id) => id !== shipment.id),
                      )
                    }
                  />
                </td>
              ) : null}
              <td>
                <span className="table-primary">{shipment.memberName}</span>
                <small>{shipment.memberEmail ?? shipment.tierName ?? "Member"}</small>
              </td>
              <td>{shipment.releaseName}</td>
              <td>{money(shipment.chargeAmountCents)}</td>
              <td>
                <span className={statusClass(shipment.status)}>
                  {sentence(shipment.status)}
                </span>
              </td>
              <td>
                {shipment.carrier || shipment.trackingNumber ? (
                  <>
                    <span className="table-primary">
                      {shipment.carrier ?? "Carrier pending"}
                    </span>
                    <small>{shipment.trackingNumber ?? "Tracking pending"}</small>
                  </>
                ) : (
                  "—"
                )}
              </td>
              {actions ? <td className="table-actions">{actions(shipment)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShipmentsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [refundShipment, setRefundShipment] = useState<Shipment | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);
  const load = useCallback(
    () =>
      apiRequest<PageResult<Shipment> | Shipment[]>(
        queryPath("/api/shipments", {
          query: query || undefined,
          status: status || undefined,
        }),
      ).then(asPageResult),
    [query, status],
  );
  const shipments = useApiResource(load, [load]);
  const rows = shipments.state.status === "ready" ? shipments.state.data.items : [];
  const counts = useMemo(
    () => ({
      total: shipments.state.status === "ready" ? shipments.state.data.total : 0,
      ready: rows.filter((row) =>
        ["charged", "label_created", "packed"].includes(row.status),
      ).length,
      inTransit: rows.filter((row) => row.status === "shipped").length,
      delivered: rows.filter((row) => row.status === "delivered").length,
    }),
    [rows, shipments.state],
  );

  async function refund() {
    if (!refundShipment) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson(`/api/shipments/${refundShipment.id}/refund`);
      setFeedback({
        message: `The recorded charge for ${refundShipment.memberName} was refunded.`,
        kind: "success",
      });
      setRefundShipment(null);
      await shipments.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The refund could not complete.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell title="Shipments" eyebrow="Club Operations">
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Release logistics</p>
          <h2>Shipment queue</h2>
          <p>Follow every paid shipment from release processing to delivery.</p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      <div className="metric-grid">
        <article className="metric-card">
          <span>Total shipments</span>
          <strong>{counts.total}</strong>
          <small>Current filtered queue</small>
        </article>
        <article className="metric-card">
          <span>Ready to fulfill</span>
          <strong>{counts.ready}</strong>
          <small>Charged, labeled, or packed</small>
        </article>
        <article className="metric-card">
          <span>In transit</span>
          <strong>{counts.inTransit}</strong>
          <small>Carrier handoff recorded</small>
        </article>
        <article className="metric-card">
          <span>Delivered</span>
          <strong>{counts.delivered}</strong>
          <small>Completion confirmed</small>
        </article>
      </div>
      <section className="operation-panel" aria-labelledby="shipment-table-title">
        <div className="panel-heading panel-heading--split">
          <div>
            <h2 id="shipment-table-title">All shipments</h2>
            <p>Search by member, email, tracking, or release.</p>
          </div>
          <button type="button" className="button button--secondary" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            Print view
          </button>
        </div>
        <div className="operation-toolbar">
          <div className="search-control">
            <Search aria-hidden="true" />
            <label className="sr-only" htmlFor="shipment-search">
              Search shipments
            </label>
            <input
              id="shipment-search"
              type="search"
              placeholder="Member, tracking, or release"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="form-field form-field--inline">
            <label htmlFor="shipment-status">Status</label>
            <select
              id="shipment-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {[
                "pending",
                "charged",
                "declined",
                "label_created",
                "packed",
                "shipped",
                "delivered",
                "cancelled",
                "refunded",
              ].map((value) => (
                <option value={value} key={value}>
                  {sentence(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {shipments.state.status === "loading" ? (
          <LoadingBlock label="Loading shipment queue" />
        ) : shipments.state.status === "error" ? (
          isActivationError(shipments.state.error) ? (
            <ActivationBlock
              title="Shipment operations are ready to connect"
              detail="Process a release and deploy the shipment API to activate the queue."
            />
          ) : (
            <ErrorBlock error={shipments.state.error} onRetry={() => void shipments.refresh()} />
          )
        ) : rows.length === 0 ? (
          <EmptyBlock
            title="No shipments match this view"
            detail="Shipments are created when a scheduled release is processed."
          />
        ) : (
          <ShipmentTable
            shipments={rows}
            caption="Shipments matching the current filters"
            actions={(shipment) =>
              ["charged", "label_created", "packed", "shipped", "delivered"].includes(
                shipment.status,
              ) ? (
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => setRefundShipment(shipment)}
                >
                  Refund
                </button>
              ) : null
            }
          />
        )}
      </section>
      <Dialog
        open={Boolean(refundShipment)}
        title="Refund this shipment charge?"
        description="Stripe receives a full refund request and Vinifera records the staff action."
        onClose={() => setRefundShipment(null)}
        footer={
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setRefundShipment(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => void refund()}
              disabled={busy}
            >
              {busy ? "Refunding…" : "Confirm refund"}
            </button>
          </>
        }
      >
        <p className="muted-copy">
          Refund {refundShipment ? money(refundShipment.chargeAmountCents) : ""}{" "}
          for {refundShipment?.memberName}. This cannot be undone in Vinifera.
        </p>
      </Dialog>
    </StaffShell>
  );
}

export function RecoveryPage() {
  const load = useCallback(
    () =>
      apiRequest<PageResult<Shipment> | Shipment[]>("/api/recovery").then(
        asPageResult,
      ),
    [],
  );
  const recovery = useApiResource(load, [load]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);
  const rows = recovery.state.status === "ready" ? recovery.state.data.items : [];

  async function retry(shipment: Shipment) {
    setBusyId(shipment.id);
    setFeedback(null);
    try {
      await postJson(`/api/shipments/${shipment.id}/retry`, {
        source: "staff_manual",
      });
      setFeedback({
        message: `Retry requested for ${shipment.memberName}.`,
        kind: "success",
      });
      await recovery.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The charge could not be retried.",
        kind: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <StaffShell title="Payment Recovery" eyebrow="Club Operations">
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Decline management</p>
          <h2>Recovery queue</h2>
          <p>
            Review decline reasons, retry history, and the next automatic attempt.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      <div className="metric-grid">
        <article className="metric-card">
          <span>Open declines</span>
          <strong>{rows.length}</strong>
          <small>Awaiting recovery</small>
        </article>
        <article className="metric-card">
          <span>Value at risk</span>
          <strong>
            {money(rows.reduce((sum, row) => sum + row.chargeAmountCents, 0))}
          </strong>
          <small>Across the visible queue</small>
        </article>
        <article className="metric-card">
          <span>Retry cadence</span>
          <strong>Day 1 · 3 · 7</strong>
          <small>Automatic schedule</small>
        </article>
        <article className="metric-card">
          <span>Payment update</span>
          <strong>Member portal</strong>
          <small>Stripe-hosted secure flow</small>
        </article>
      </div>
      <section className="operation-panel" aria-labelledby="recovery-title">
        <div className="panel-heading">
          <div>
            <h2 id="recovery-title">Declined charges</h2>
            <p>Every retry and refund is recorded in the billing audit log.</p>
          </div>
        </div>
        {recovery.state.status === "loading" ? (
          <LoadingBlock label="Loading recovery queue" />
        ) : recovery.state.status === "error" ? (
          isActivationError(recovery.state.error) ? (
            <ActivationBlock
              title="Payment recovery is ready to connect"
              detail="The recovery queue activates after release billing and Stripe test-mode webhooks are deployed."
            />
          ) : (
            <ErrorBlock error={recovery.state.error} onRetry={() => void recovery.refresh()} />
          )
        ) : rows.length === 0 ? (
          <EmptyBlock
            title="No open declines"
            detail="Declined release charges will enter this queue automatically."
          />
        ) : (
          <div className="recovery-list">
            {rows.map((shipment) => (
              <article className="recovery-card" key={shipment.id}>
                <div className="recovery-card__status">
                  <RefreshCw aria-hidden="true" />
                  <span className={statusClass(shipment.status)}>
                    {sentence(shipment.status)}
                  </span>
                </div>
                <div>
                  <h3>{shipment.memberName}</h3>
                  <p>{shipment.releaseName}</p>
                  <strong>{money(shipment.chargeAmountCents)}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Reason</dt>
                    <dd>{shipment.declineReason || "Issuer declined charge"}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{shipment.retryCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Next retry</dt>
                    <dd>{date(shipment.nextRetryDate)}</dd>
                  </div>
                </dl>
                <div className="recovery-card__actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void retry(shipment)}
                    disabled={busyId === shipment.id}
                  >
                    <RotateCcw aria-hidden="true" />
                    {busyId === shipment.id ? "Retrying…" : "Retry now"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </StaffShell>
  );
}

export function FulfillmentPage() {
  const load = useCallback(
    () =>
      apiRequest<PageResult<Shipment> | Shipment[]>(
        "/api/shipments?fulfillment=true",
      ).then(asPageResult),
    [],
  );
  const fulfillment = useApiResource(load, [load]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scanShipment, setScanShipment] = useState<Shipment | null>(null);
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);
  const rows =
    fulfillment.state.status === "ready"
      ? fulfillment.state.data.items.filter((shipment) =>
          ["charged", "label_created", "packed", "shipped"].includes(
            shipment.status,
          ),
        )
      : [];
  const selectedRows = rows.filter((shipment) => selected.includes(shipment.id));
  const pickListReleaseId =
    selectedRows.length > 0 &&
    selectedRows.every(
      (shipment) => shipment.releaseId === selectedRows[0]?.releaseId,
    )
      ? selectedRows[0]?.releaseId
      : undefined;

  async function labels() {
    if (!selected.length) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postJson<{ labelCount: number }>(
        "/api/shipments/labels",
        { shipmentIds: selected },
      );
      setFeedback({
        message: `${result.labelCount ?? selected.length} shipping labels generated.`,
        kind: "success",
      });
      setSelected([]);
      await fulfillment.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "Labels could not be generated.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function pickList() {
    if (!pickListReleaseId) {
      setFeedback({
        message:
          selectedRows.length === 0
            ? "Select at least one shipment before generating a pick list."
            : "Choose shipments from one release at a time for a pick list.",
        kind: "error",
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await downloadApiFile(
        queryPath("/api/shipments/pick-list", {
          releaseId: pickListReleaseId,
        }),
        "vinifera-pick-list.pdf",
      );
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "Pick list generation failed.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmPack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scanShipment) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson(`/api/shipments/${scanShipment.id}/pack`, { barcode });
      setScanShipment(null);
      setBarcode("");
      setFeedback({
        message: `Pack confirmed for ${scanShipment.memberName}.`,
        kind: "success",
      });
      await fulfillment.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The pack scan did not match.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function advance(shipment: Shipment) {
    const next: Partial<Record<ShipmentStatus, ShipmentStatus>> = {
      label_created: "packed",
      packed: "shipped",
      shipped: "delivered",
    };
    const status = next[shipment.status];
    if (!status) return;
    setBusy(true);
    setFeedback(null);
    try {
      await patchJson(`/api/shipments/${shipment.id}/status`, { status });
      setFeedback({
        message: `${shipment.memberName} marked ${sentence(status)}.`,
        kind: "success",
      });
      await fulfillment.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The shipment status could not be updated.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell
      title="Fulfillment"
      eyebrow="Club Operations"
      actions={
        <button
          type="button"
          className="button button--primary button--compact"
          disabled={busy || selected.length === 0}
          onClick={() => void labels()}
        >
          <Truck aria-hidden="true" />
          <span>Generate Labels</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Pack and ship</p>
          <h2>Fulfillment station</h2>
          <p>
            Validate addresses, create carrier labels, print pick lists, and
            scan packed shipments.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      <section className="integration-banner" aria-labelledby="carrier-title">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2 id="carrier-title">Carrier and compliance boundary</h2>
          <p>
            Label actions call the live carrier adapter. Until credentials are
            configured, the server returns an explicit activation response.
            Phase 2 state-whitelist compliance runs before every label.
          </p>
        </div>
      </section>
      <section className="operation-panel" aria-labelledby="fulfillment-title">
        <div className="panel-heading panel-heading--split">
          <div>
            <h2 id="fulfillment-title">Fulfillment queue</h2>
            <p>{selected.length} shipments selected</p>
          </div>
          <div className="panel-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void pickList()}
              disabled={busy || selected.length === 0}
            >
              <Download aria-hidden="true" />
              Pick list
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void labels()}
              disabled={busy || selected.length === 0}
            >
              <Truck aria-hidden="true" />
              Labels
            </button>
          </div>
        </div>
        {fulfillment.state.status === "loading" ? (
          <LoadingBlock label="Loading fulfillment queue" />
        ) : fulfillment.state.status === "error" ? (
          isActivationError(fulfillment.state.error) ? (
            <ActivationBlock
              title="Fulfillment is ready to connect"
              detail="Deploy the shipment API. Carrier label actions can remain unconfigured until credentials are available."
            />
          ) : (
            <ErrorBlock
              error={fulfillment.state.error}
              onRetry={() => void fulfillment.refresh()}
            />
          )
        ) : rows.length === 0 ? (
          <EmptyBlock
            title="Nothing is ready to pack"
            detail="Successfully charged shipments will appear here."
          />
        ) : (
          <ShipmentTable
            shipments={rows}
            selected={selected}
            onSelected={setSelected}
            caption="Shipments eligible for fulfillment"
            actions={(shipment) => (
              <>
                {shipment.status === "label_created" ? (
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    onClick={() => setScanShipment(shipment)}
                  >
                    <Barcode aria-hidden="true" />
                    Scan pack
                  </button>
                ) : null}
                {["packed", "shipped"].includes(shipment.status) ? (
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    disabled={busy}
                    onClick={() => void advance(shipment)}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    Advance
                  </button>
                ) : null}
              </>
            )}
          />
        )}
      </section>
      <Dialog
        open={Boolean(scanShipment)}
        title="Scan to confirm pack"
        description={`Confirm each bottle for ${scanShipment?.memberName ?? "this shipment"}.`}
        onClose={() => setScanShipment(null)}
      >
        <form className="operation-form" onSubmit={confirmPack}>
          {scanShipment?.items?.length ? (
            <ul className="item-list">
              {scanShipment.items.map((item, index) => (
                <li key={item.id ?? `${item.name}-${index}`}>
                  <PackageCheck aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>Quantity {item.quantity}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="form-field">
            <label htmlFor="pack-barcode">Shipment or item barcode</label>
            <input
              id="pack-barcode"
              required
              autoFocus
              autoComplete="off"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
            />
          </div>
          <button className="button button--primary button--wide" disabled={busy}>
            <Barcode aria-hidden="true" />
            {busy ? "Checking scan…" : "Confirm pack"}
          </button>
        </form>
      </Dialog>
    </StaffShell>
  );
}
