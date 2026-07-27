import {
  CalendarClock,
  Download,
  LayoutGrid,
  MailCheck,
  RefreshCw,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  apiRequest,
  downloadApiFile,
  patchJson,
  postJson,
} from "../../api/client";
import {
  type AnalyticsDashboard,
  type AnalyticsRange,
  type AnalyticsRangePreset,
  type AnalyticsWidgetLayout,
  type ScheduledReport,
  normalizeAnalyticsDashboard,
  normalizeScheduledReports,
} from "../../api/phase4";
import { queryPath } from "../../api/phase2";
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
import { date, money } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";
import { useBrandScope } from "../phase5/BrandScopeContext";
import {
  AccessibleBarChart,
  AccessibleLineChart,
} from "./AccessibleChart";

const knownWidgets = [
  { id: "revenue-by-tier", title: "Revenue by club tier", category: "Revenue", defaultSize: "half" as const },
  { id: "member-growth", title: "Member growth", category: "Members", defaultSize: "half" as const },
  { id: "member-cohorts", title: "Cohort retention", category: "Members", defaultSize: "full" as const },
  { id: "ltv-by-tier", title: "Lifetime value by tier", category: "Revenue", defaultSize: "half" as const },
  { id: "shipment-operations", title: "Shipment health", category: "Shipments", defaultSize: "half" as const },
  { id: "engagement", title: "Member engagement", category: "Engagement", defaultSize: "half" as const },
  { id: "acquisition", title: "Acquisition performance", category: "Engagement", defaultSize: "half" as const },
];

const rangeOptions: Array<{ value: AnalyticsRangePreset; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

function percent(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function compactMoney(cents?: number | null) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

function WidgetMetrics({
  items,
}: {
  items: Array<{ label: string; value: string; detail?: string }>;
}) {
  return (
    <dl className="analytics-widget-metrics">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>
            <span>{item.value}</span>
            {item.detail ? <small>{item.detail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RevenueTrend({ dashboard }: { dashboard: AnalyticsDashboard }) {
  if (!dashboard.revenue.trend.length) return null;
  return (
    <details className="analytics-data-details analytics-supplement">
      <summary>View recurring revenue trend</summary>
      <div
        className="data-table-wrap"
        role="region"
        aria-label="Recurring revenue trend data"
        tabIndex={0}
      >
        <table className="data-table data-table--analytics">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">MRR</th>
              <th scope="col">ARR</th>
              <th scope="col">ARPM</th>
              <th scope="col">Revenue churn</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.revenue.trend.map((item) => (
              <tr key={item.period}>
                <th scope="row">{item.period}</th>
                <td>{money(item.mrrCents)}</td>
                <td>{money(item.arrCents)}</td>
                <td>{money(item.arpmCents)}</td>
                <td>{money(item.revenueChurnCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function TenureDistribution({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const rows = dashboard.members.tenureDistribution;
  if (!rows.length) {
    return (
      <p className="analytics-supplement analytics-supplement--empty">
        No member tenure distribution exists for this date range.
      </p>
    );
  }
  const maximum = Math.max(1, ...rows.map((item) => item.members));
  return (
    <section className="analytics-supplement" aria-labelledby="tenure-distribution-title">
      <h3 id="tenure-distribution-title">Member tenure distribution</h3>
      <ul className="analytics-distribution-list">
        {rows.map((item) => (
          <li key={item.bucket}>
            <span>{item.bucket}</span>
            <b aria-hidden="true">
              <i style={{ width: `${(item.members / maximum) * 100}%` }} />
            </b>
            <strong>{item.members.toLocaleString()}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeclineReasons({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const reasons = dashboard.shipments.declineReasons;
  if (!reasons.length) {
    return (
      <p className="analytics-supplement analytics-supplement--empty">
        No payment decline reasons were recorded in this date range.
      </p>
    );
  }
  return (
    <section className="analytics-supplement" aria-labelledby="decline-reasons-title">
      <h3 id="decline-reasons-title">Payment decline reasons</h3>
      <ul className="analytics-reason-list">
        {reasons.map((item) => (
          <li key={item.reason}>
            <span>{item.reason}</span>
            <strong>{item.count.toLocaleString()}</strong>
            <small>{percent(item.rate)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function effectiveWidgets(dashboard: AnalyticsDashboard) {
  const available = dashboard.availableWidgets.length
    ? dashboard.availableWidgets
    : knownWidgets;
  if (!dashboard.layout.widgets.length) {
    return available.map((widget, index) => ({
      id: widget.id,
      enabled: true,
      order: index,
      size: widget.defaultSize,
    }));
  }
  return dashboard.layout.widgets;
}

function WidgetSettingsDialog({
  open,
  dashboard,
  onClose,
  onSaved,
}: {
  open: boolean;
  dashboard: AnalyticsDashboard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const available = dashboard.availableWidgets.length
    ? dashboard.availableWidgets
    : knownWidgets;
  const [layout, setLayout] = useState<AnalyticsWidgetLayout[]>(() =>
    effectiveWidgets(dashboard),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  function update(id: string, patch: Partial<AnalyticsWidgetLayout>) {
    setLayout((current) =>
      current.map((widget) => widget.id === id ? { ...widget, ...patch } : widget),
    );
  }

  function move(id: string, offset: -1 | 1) {
    setLayout((current) => {
      const ordered = [...current].sort((left, right) => left.order - right.order);
      const index = ordered.findIndex((widget) => widget.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
      return ordered.map((widget, order) => ({ ...widget, order }));
    });
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      await patchJson("/api/analytics/layout", { widgets: layout });
      onSaved();
      onClose();
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "The layout could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Configure analytics"
      description="Choose which live widgets appear and how much room each receives."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save dashboard"}
          </button>
        </>
      }
    >
      <FormFeedback message={feedback} />
      <ul className="widget-settings">
        {[...layout].sort((left, right) => left.order - right.order).map((widget, index) => {
          const definition = available.find((candidate) => candidate.id === widget.id);
          return (
            <li key={widget.id}>
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={widget.enabled}
                  onChange={(event) => update(widget.id, { enabled: event.target.checked })}
                />
                <span aria-hidden="true" />
                <b>{definition?.title ?? widget.id}</b>
              </label>
              <label className="form-field form-field--compact">
                <span>Width</span>
                <select
                  value={widget.size}
                  onChange={(event) =>
                    update(widget.id, { size: event.target.value === "full" ? "full" : "half" })
                  }
                >
                  <option value="half">Half width</option>
                  <option value="full">Full width</option>
                </select>
              </label>
              <div className="widget-settings__move">
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => move(widget.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${definition?.title ?? widget.id} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={() => move(widget.id, 1)}
                  disabled={index === layout.length - 1}
                  aria-label={`Move ${definition?.title ?? widget.id} later`}
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function ReportsDialog({
  open,
  reports,
  onClose,
  onSaved,
}: {
  open: boolean;
  reports: ReturnType<typeof useApiResource<ScheduledReport[]>>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function schedule(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await postJson("/api/analytics/reports", {
        frequency,
        recipientEmail,
        enabled: true,
        widgetIds: knownWidgets.map((widget) => widget.id),
      });
      setRecipientEmail("");
      onSaved();
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "The report could not be scheduled.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(report: ScheduledReport) {
    setSaving(true);
    setFeedback(null);
    try {
      await patchJson(`/api/analytics/reports/${report.id}`, {
        enabled: !report.enabled,
      });
      onSaved();
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "The report could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Scheduled reports"
      description="Send a live analytics snapshot weekly or monthly."
      onClose={onClose}
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          Done
        </button>
      }
    >
      <FormFeedback message={feedback} />
      <form className="operation-form scheduled-report-form" onSubmit={schedule}>
        <div className="form-grid">
          <label className="form-field">
            <span>Frequency</span>
            <select value={frequency} onChange={(event) => setFrequency(event.target.value === "monthly" ? "monthly" : "weekly")}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="form-field">
            <span>Recipient email</span>
            <input
              type="email"
              required
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="reports@winery.com"
            />
          </label>
        </div>
        <button className="button button--primary" type="submit" disabled={saving}>
          {saving ? "Scheduling…" : "Schedule report"}
        </button>
      </form>
      {reports.state.status === "loading" ? (
        <LoadingBlock label="Loading report schedules" />
      ) : reports.state.status === "error" ? (
        isActivationError(reports.state.error) ? (
          <ActivationBlock
            title="Report delivery is ready to connect"
            detail="Schedules will begin once the transactional email provider is configured."
          />
        ) : (
          <ErrorBlock error={reports.state.error} onRetry={() => void reports.refresh()} />
        )
      ) : reports.state.data.length === 0 ? (
        <EmptyBlock title="No reports scheduled" detail="Create a recurring snapshot for winery operators." />
      ) : (
        <ul className="scheduled-report-list">
          {reports.state.data.map((report) => (
            <li key={report.id}>
              <span>
                <strong>{report.recipientEmail}</strong>
                <small>
                  {report.frequency === "weekly" ? "Weekly" : "Monthly"}
                  {report.nextSendAt ? ` · next ${date(report.nextSendAt)}` : ""}
                </small>
              </span>
              <button
                type="button"
                className="button button--secondary button--compact"
                onClick={() => void toggle(report)}
                disabled={saving}
              >
                {report.enabled ? "Pause" : "Resume"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function AnalyticsPage() {
  const brandScope = useBrandScope();
  const allBrands = brandScope.activeBrandId === "all";
  const [range, setRange] = useState<AnalyticsRange>({
    preset: "30d",
    from: null,
    to: null,
  });
  const [draftRange, setDraftRange] = useState<AnalyticsRange>(range);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiRequest<unknown>(
        queryPath("/api/analytics/dashboard", {
          scope: allBrands ? "all" : undefined,
          range: range.preset,
          from: range.preset === "custom" ? range.from ?? undefined : undefined,
          to: range.preset === "custom" ? range.to ?? undefined : undefined,
        }),
      ).then(normalizeAnalyticsDashboard),
    [allBrands, brandScope.activeBrandId, range],
  );
  const dashboard = useApiResource(load, [load]);
  const loadReports = useCallback(
    () =>
      allBrands
        ? Promise.resolve([])
        : apiRequest<unknown>("/api/analytics/reports").then(
            normalizeScheduledReports,
          ),
    [allBrands, brandScope.activeBrandId],
  );
  const reports = useApiResource(loadReports, [loadReports]);
  const visibleLayout = useMemo(() => {
    if (dashboard.state.status !== "ready") return [];
    return effectiveWidgets(dashboard.state.data)
      .filter((widget) => widget.enabled)
      .sort((left, right) => left.order - right.order);
  }, [dashboard.state]);

  async function exportWidget(widgetId: string) {
    setExporting(widgetId);
    setFeedback(null);
    try {
      await downloadApiFile(
        queryPath("/api/analytics/export", {
          scope: allBrands ? "all" : undefined,
          widgetId,
          range: range.preset,
          from: range.preset === "custom" ? range.from ?? undefined : undefined,
          to: range.preset === "custom" ? range.to ?? undefined : undefined,
        }),
        `vinifera-${widgetId}.csv`,
      );
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "The CSV could not be exported.");
    } finally {
      setExporting(null);
    }
  }

  function applyRange(event: FormEvent) {
    event.preventDefault();
    setRange(draftRange);
  }

  return (
    <StaffShell
      title="Analytics"
      eyebrow="Growth Intelligence"
      actions={
        <>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => setReportsOpen(true)}
            disabled={allBrands}
            title={
              allBrands
                ? "Scheduled reports are configured inside one brand."
                : undefined
            }
          >
            <MailCheck aria-hidden="true" />
            <span>Reports</span>
          </button>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => setSettingsOpen(true)}
            disabled={allBrands || dashboard.state.status !== "ready"}
            title={
              allBrands
                ? "Dashboard layouts are configured inside one brand."
                : undefined
            }
          >
            <LayoutGrid aria-hidden="true" />
            <span>Widgets</span>
          </button>
        </>
      }
    >
      <div className="page-heading analytics-page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Live winery performance</p>
          <h2>Growth at a glance</h2>
          <p>
            {allBrands
              ? "Revenue, membership, shipments, and engagement aggregated across every authorized brand."
              : "Revenue, membership, shipments, and engagement from the active brand’s production records."}
          </p>
        </div>
        {dashboard.state.status === "ready" && dashboard.state.data.generatedAt ? (
          <span className="calculation-stamp">
            <CalendarClock aria-hidden="true" />
            Updated {date(dashboard.state.data.generatedAt)}
          </span>
        ) : null}
      </div>

      <form className="analytics-range-toolbar" onSubmit={applyRange}>
        <label className="form-field form-field--inline">
          <span>Date range</span>
          <select
            value={draftRange.preset}
            onChange={(event) =>
              setDraftRange((current) => ({
                ...current,
                preset: event.target.value as AnalyticsRangePreset,
              }))
            }
          >
            {rangeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {draftRange.preset === "custom" ? (
          <>
            <label className="form-field form-field--inline">
              <span>From</span>
              <input
                type="date"
                required
                value={draftRange.from ?? ""}
                onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))}
              />
            </label>
            <label className="form-field form-field--inline">
              <span>To</span>
              <input
                type="date"
                required
                min={draftRange.from ?? undefined}
                value={draftRange.to ?? ""}
                onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))}
              />
            </label>
          </>
        ) : null}
        <button className="button button--primary" type="submit">Apply</button>
        <button type="button" className="button button--secondary" onClick={() => void dashboard.refresh()}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </button>
      </form>
      <FormFeedback message={feedback} />

      {dashboard.state.status === "loading" ? (
        <>
          <div className="metric-grid" aria-hidden="true">
            {["ARR", "Average lifetime value", "Active members", "Fulfillment"].map((label) => (
              <article key={label} className="metric-card metric-card--placeholder">
                <span>{label}</span><strong>—</strong><small>Loading live analytics</small>
              </article>
            ))}
          </div>
          <LoadingBlock label="Loading analytics dashboard" />
        </>
      ) : dashboard.state.status === "error" ? (
        isActivationError(dashboard.state.error) ? (
          <ActivationBlock
            title="Analytics is ready to connect"
            detail="The dashboard will populate from production events after the Phase 4 database views are deployed."
          />
        ) : (
          <ErrorBlock error={dashboard.state.error} onRetry={() => void dashboard.refresh()} />
        )
      ) : (
        <>
          <div className="metric-grid">
            <article className="metric-card">
              <span>Annual recurring revenue</span>
              <strong>{compactMoney(dashboard.state.data.summary.arrCents)}</strong>
              <small>{compactMoney(dashboard.state.data.summary.mrrCents)} monthly recurring</small>
            </article>
            <article className="metric-card">
              <span>Average lifetime value</span>
              <strong>{compactMoney(dashboard.state.data.summary.averageLtvCents)}</strong>
              <small>{money(dashboard.state.data.summary.arpmCents)} revenue per member</small>
            </article>
            <article className="metric-card">
              <span>Active members</span>
              <strong>{dashboard.state.data.summary.activeMembers.toLocaleString()}</strong>
              <small>{percent(dashboard.state.data.summary.memberGrowthRate)} net growth</small>
            </article>
            <article className="metric-card">
              <span>Fulfillment rate</span>
              <strong>{percent(dashboard.state.data.summary.fulfillmentRate)}</strong>
              <small>{percent(dashboard.state.data.summary.declineRate)} payment decline rate</small>
            </article>
          </div>

          {visibleLayout.length === 0 ? (
            <EmptyBlock
              title="No dashboard widgets selected"
              detail="Choose Widgets to add live analytics panels."
              action={<button type="button" className="button button--primary" onClick={() => setSettingsOpen(true)}>Configure widgets</button>}
            />
          ) : (
            <div className="analytics-widget-grid">
              {visibleLayout.map((layout) => {
                const data = dashboard.state.data!;
                let widget = null;
                if (layout.id === "revenue-by-tier") {
                  widget = (
                    <AccessibleBarChart
                      title="Revenue by club tier"
                      description="Annualized recurring revenue by membership tier."
                      labels={data.revenue.byTier.map((item) => item.tierName)}
                      values={data.revenue.byTier.map((item) => item.arrCents)}
                      valueLabel={money}
                      valueColumnLabel="ARR"
                      additionalColumns={[
                        {
                          id: "mrr",
                          label: "MRR",
                          values: data.revenue.byTier.map((item) => item.mrrCents),
                          valueLabel: money,
                        },
                        {
                          id: "members",
                          label: "Members",
                          values: data.revenue.byTier.map((item) => item.memberCount),
                          valueLabel: (value) => value.toLocaleString(),
                        },
                      ]}
                      summary={
                        <WidgetMetrics
                          items={[
                            { label: "MRR", value: money(data.summary.mrrCents) },
                            { label: "ARR", value: money(data.summary.arrCents) },
                            { label: "ARPM", value: money(data.summary.arpmCents) },
                            { label: "Revenue churn", value: money(data.summary.revenueChurnCents) },
                          ]}
                        />
                      }
                      supplement={<RevenueTrend dashboard={data} />}
                      onExport={() => void exportWidget(layout.id)}
                      exporting={exporting === layout.id}
                    />
                  );
                } else if (layout.id === "member-growth") {
                  widget = (
                    <AccessibleLineChart
                      title="Member growth"
                      description="Active membership and new joins over time."
                      labels={data.members.trend.map((item) => item.period)}
                      series={[
                        { id: "active", label: "Active", color: "wine", values: data.members.trend.map((item) => item.active) },
                        { id: "new", label: "New", color: "gold", values: data.members.trend.map((item) => item.newMembers) },
                        { id: "cancelled", label: "Cancelled", color: "blush", values: data.members.trend.map((item) => item.cancelled) },
                        { id: "net", label: "Net growth", color: "green", values: data.members.trend.map((item) => item.netGrowth) },
                      ]}
                      valueLabel={(value) => value.toLocaleString()}
                      summary={
                        <WidgetMetrics
                          items={[
                            { label: "Active members", value: data.summary.activeMembers.toLocaleString() },
                            { label: "Net growth", value: percent(data.summary.memberGrowthRate) },
                          ]}
                        />
                      }
                      supplement={<TenureDistribution dashboard={data} />}
                      onExport={() => void exportWidget(layout.id)}
                      exporting={exporting === layout.id}
                    />
                  );
                } else if (layout.id === "member-cohorts") {
                  widget = <CohortWidget dashboard={data} onExport={() => void exportWidget(layout.id)} exporting={exporting === layout.id} />;
                } else if (layout.id === "ltv-by-tier") {
                  widget = (
                    <AccessibleBarChart
                      title="Lifetime value by tier"
                      description="Observed member lifetime value from completed payments."
                      labels={data.members.ltvByTier.map((item) => item.tierName)}
                      values={data.members.ltvByTier.map((item) => item.ltvCents)}
                      valueLabel={money}
                      color="gold"
                      summary={
                        <WidgetMetrics
                          items={[
                            { label: "Average LTV", value: money(data.summary.averageLtvCents) },
                          ]}
                        />
                      }
                      onExport={() => void exportWidget(layout.id)}
                      exporting={exporting === layout.id}
                    />
                  );
                } else if (layout.id === "shipment-operations") {
                  widget = (
                    <AccessibleLineChart
                      title="Shipment health"
                      description="Fulfillment and payment decline rates by release period."
                      labels={data.shipments.trend.map((item) => item.period)}
                      series={[
                        { id: "fulfilled", label: "Fulfilled", color: "green", values: data.shipments.trend.map((item) => item.fulfillmentRate) },
                        { id: "declined", label: "Declined", color: "blush", values: data.shipments.trend.map((item) => item.attempted ? item.declined / item.attempted : 0) },
                      ]}
                      valueLabel={percent}
                      summary={
                        <WidgetMetrics
                          items={[
                            { label: "Fulfillment", value: percent(data.summary.fulfillmentRate) },
                            { label: "Average shipment", value: money(data.summary.averageShipmentValueCents) },
                            { label: "Decline rate", value: percent(data.summary.declineRate) },
                            { label: "Shipping cost ratio", value: percent(data.summary.shippingCostRatio) },
                          ]}
                        />
                      }
                      supplement={<DeclineReasons dashboard={data} />}
                      onExport={() => void exportWidget(layout.id)}
                      exporting={exporting === layout.id}
                    />
                  );
                } else if (layout.id === "engagement") {
                  widget = (
                    <AccessibleLineChart
                      title="Member engagement"
                      description="Email response and loyalty redemption signals."
                      labels={data.engagement.trend.map((item) => item.period)}
                      series={[
                        { id: "open", label: "Email open rate", color: "wine", values: data.engagement.trend.map((item) => item.emailOpenRate) },
                        { id: "click", label: "Email click rate", color: "blush", values: data.engagement.trend.map((item) => item.emailClickRate) },
                        { id: "loyalty", label: "Loyalty redemption", color: "gold", values: data.engagement.trend.map((item) => item.loyaltyRedemptionRate) },
                      ]}
                      valueLabel={percent}
                      summary={
                        <WidgetMetrics
                          items={[
                            { label: "Email open rate", value: percent(data.summary.emailOpenRate) },
                            { label: "Email click rate", value: percent(data.summary.emailClickRate) },
                            {
                              label: "Portal logins / member",
                              value: data.summary.portalLoginsPerMember.toLocaleString(undefined, { maximumFractionDigits: 1 }),
                              detail: `${data.summary.portalLogins.toLocaleString()} total logins`,
                            },
                            {
                              label: "Loyalty redemption",
                              value: percent(data.summary.loyaltyRedemptionRate),
                              detail: `${data.summary.loyaltyPointsRedeemed.toLocaleString()} points redeemed`,
                            },
                          ]}
                        />
                      }
                      onExport={() => void exportWidget(layout.id)}
                      exporting={exporting === layout.id}
                    />
                  );
                } else if (layout.id === "acquisition") {
                  widget = <AcquisitionWidget dashboard={data} onExport={() => void exportWidget(layout.id)} exporting={exporting === layout.id} />;
                }
                return widget ? (
                  <div key={layout.id} className={`analytics-widget-slot analytics-widget-slot--${layout.size}`}>
                    {widget}
                  </div>
                ) : null;
              })}
            </div>
          )}
          <WidgetSettingsDialog
            key={dashboard.state.data.generatedAt ?? "dashboard-layout"}
            open={settingsOpen}
            dashboard={dashboard.state.data}
            onClose={() => setSettingsOpen(false)}
            onSaved={() => void dashboard.refresh()}
          />
        </>
      )}
      <ReportsDialog
        open={reportsOpen}
        reports={reports}
        onClose={() => setReportsOpen(false)}
        onSaved={() => void reports.refresh()}
      />
    </StaffShell>
  );
}

function CohortWidget({
  dashboard,
  onExport,
  exporting,
}: {
  dashboard: AnalyticsDashboard;
  onExport: () => void;
  exporting: boolean;
}) {
  const longest = Math.max(0, ...dashboard.members.cohorts.map((cohort) => cohort.values.length));
  return (
    <article className="operation-panel analytics-widget">
      <div className="panel-heading panel-heading--split">
        <div><h2>Cohort retention</h2><p>Share of each joining cohort still active by membership month.</p></div>
        <button type="button" className="button button--secondary button--compact" onClick={onExport} disabled={exporting}>
          <Download aria-hidden="true" />{exporting ? "Exporting…" : "CSV"}
        </button>
      </div>
      {dashboard.members.cohorts.length === 0 ? (
        <p className="analytics-widget__empty">No member cohorts exist for this date range yet.</p>
      ) : (
        <div
          className="data-table-wrap"
          role="region"
          aria-label="Cohort retention data table"
          tabIndex={0}
        >
          <table className="data-table data-table--analytics cohort-table">
            <caption className="sr-only">Cohort retention by membership month</caption>
            <thead><tr><th scope="col">Cohort</th>{Array.from({ length: longest }, (_, index) => <th scope="col" key={index}>M{index}</th>)}</tr></thead>
            <tbody>
              {dashboard.members.cohorts.map((cohort) => (
                <tr key={cohort.cohort}>
                  <th scope="row">{cohort.cohort}</th>
                  {Array.from({ length: longest }, (_, index) => {
                    const value = cohort.values[index];
                    return (
                      <td key={index}>
                        {value == null ? "—" : <span className="cohort-cell" style={{ "--retention": value } as React.CSSProperties}>{percent(value)}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function AcquisitionWidget({
  dashboard,
  onExport,
  exporting,
}: {
  dashboard: AnalyticsDashboard;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <article className="operation-panel analytics-widget">
      <div className="panel-heading panel-heading--split">
        <div><h2>Acquisition performance</h2><p>Production member attribution and customer acquisition cost.</p></div>
        <button type="button" className="button button--secondary button--compact" onClick={onExport} disabled={exporting}>
          <Download aria-hidden="true" />{exporting ? "Exporting…" : "CSV"}
        </button>
      </div>
      {dashboard.engagement.acquisition.length === 0 ? (
        <p className="analytics-widget__empty">No attributed acquisitions exist for this date range yet.</p>
      ) : (
        <div
          className="data-table-wrap"
          role="region"
          aria-label="Acquisition performance data table"
          tabIndex={0}
        >
          <table className="data-table data-table--analytics">
            <thead><tr><th scope="col">Source</th><th scope="col">Members</th><th scope="col">Conversion</th><th scope="col">CAC</th></tr></thead>
            <tbody>
              {dashboard.engagement.acquisition.map((item) => (
                <tr key={item.source}><th scope="row">{item.source}</th><td>{item.members.toLocaleString()}</td><td>{percent(item.conversionRate)}</td><td>{money(item.cacCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
