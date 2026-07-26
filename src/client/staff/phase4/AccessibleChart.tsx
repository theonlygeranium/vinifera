import { Download } from "lucide-react";
import type { ReactNode } from "react";

export interface ChartSeries {
  id: string;
  label: string;
  color: "wine" | "gold" | "green" | "blush";
  values: number[];
}

function safeMaximum(series: ChartSeries[]) {
  return Math.max(
    1,
    ...series.flatMap((entry) => entry.values).filter(Number.isFinite),
  );
}

function chartPath(values: number[], maximum: number) {
  if (!values.length) return "";
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 88 - (Math.max(0, value) / maximum) * 76;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function AccessibleLineChart({
  title,
  description,
  labels,
  series,
  valueLabel,
  onExport,
  exporting,
  summary,
  supplement,
}: {
  title: string;
  description: string;
  labels: string[];
  series: ChartSeries[];
  valueLabel: (value: number) => string;
  onExport: () => void;
  exporting?: boolean;
  summary?: ReactNode;
  supplement?: ReactNode;
}) {
  const maximum = safeMaximum(series);
  return (
    <article className="operation-panel analytics-widget">
      <div className="panel-heading panel-heading--split">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={onExport}
          disabled={exporting}
        >
          <Download aria-hidden="true" />
          {exporting ? "Exporting…" : "CSV"}
        </button>
      </div>
      {summary}
      {labels.length === 0 || series.every((entry) => entry.values.length === 0) ? (
        <p className="analytics-widget__empty">
          No live observations exist for this date range yet.
        </p>
      ) : (
        <>
          <div className="chart-legend" aria-hidden="true">
            {series.map((entry) => (
              <span key={entry.id}>
                <i className={`chart-swatch chart-swatch--${entry.color}`} />
                {entry.label}
              </span>
            ))}
          </div>
          <svg
            className="analytics-line-chart"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title}. ${description}. A data table follows.`}
          >
            {[12, 31, 50, 69, 88].map((y) => (
              <line
                key={y}
                className="analytics-chart-gridline"
                x1="0"
                x2="100"
                y1={y}
                y2={y}
              />
            ))}
            {series.map((entry) => (
              <path
                key={entry.id}
                className={`analytics-chart-line analytics-chart-line--${entry.color}`}
                d={chartPath(entry.values, maximum)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="analytics-chart-axis" aria-hidden="true">
            {labels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <details className="analytics-data-details">
            <summary>View chart as a data table</summary>
            <div
              className="data-table-wrap"
              role="region"
              aria-label={`${title} data table`}
              tabIndex={0}
            >
              <table className="data-table data-table--analytics">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    {series.map((entry) => (
                      <th scope="col" key={entry.id}>{entry.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((label, index) => (
                    <tr key={`${label}-${index}`}>
                      <th scope="row">{label}</th>
                      {series.map((entry) => (
                        <td key={entry.id}>{valueLabel(entry.values[index] ?? 0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {supplement}
    </article>
  );
}

export function AccessibleBarChart({
  title,
  description,
  labels,
  values,
  valueLabel,
  color = "wine",
  onExport,
  exporting,
  summary,
  supplement,
  valueColumnLabel = "Value",
  additionalColumns = [],
}: {
  title: string;
  description: string;
  labels: string[];
  values: number[];
  valueLabel: (value: number) => string;
  color?: ChartSeries["color"];
  onExport: () => void;
  exporting?: boolean;
  summary?: ReactNode;
  supplement?: ReactNode;
  valueColumnLabel?: string;
  additionalColumns?: Array<{
    id: string;
    label: string;
    values: number[];
    valueLabel: (value: number) => string;
  }>;
}) {
  const maximum = Math.max(1, ...values.filter(Number.isFinite));
  return (
    <article className="operation-panel analytics-widget">
      <div className="panel-heading panel-heading--split">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={onExport}
          disabled={exporting}
        >
          <Download aria-hidden="true" />
          {exporting ? "Exporting…" : "CSV"}
        </button>
      </div>
      {summary}
      {labels.length === 0 ? (
        <p className="analytics-widget__empty">
          No live observations exist for this date range yet.
        </p>
      ) : (
        <>
          <div
            className="analytics-bar-chart"
            role="img"
            aria-label={`${title}. ${description}. A data table follows.`}
          >
            {labels.map((label, index) => {
              const value = values[index] ?? 0;
              return (
                <div key={`${label}-${index}`} className="analytics-bar-chart__column">
                  <span
                    className={`analytics-bar-chart__bar analytics-bar-chart__bar--${color}`}
                    style={{ height: `${Math.max(3, (value / maximum) * 100)}%` }}
                    aria-hidden="true"
                  />
                  <small>{label}</small>
                </div>
              );
            })}
          </div>
          <details className="analytics-data-details">
            <summary>View chart as a data table</summary>
            <div
              className="data-table-wrap"
              role="region"
              aria-label={`${title} data table`}
              tabIndex={0}
            >
              <table className="data-table data-table--analytics">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">{valueColumnLabel}</th>
                    {additionalColumns.map((column) => (
                      <th scope="col" key={column.id}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((label, index) => (
                    <tr key={`${label}-${index}`}>
                      <th scope="row">{label}</th>
                      <td>{valueLabel(values[index] ?? 0)}</td>
                      {additionalColumns.map((column) => (
                        <td key={column.id}>
                          {column.valueLabel(column.values[index] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {supplement}
    </article>
  );
}
