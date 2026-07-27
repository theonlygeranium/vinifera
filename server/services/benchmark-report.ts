import { encodeCsvCell } from "../lib/csv";
import { AppError } from "../lib/errors";

export const BENCHMARK_MINIMUM_COHORT = 10;

export interface BenchmarkReportMetric {
  id: string;
  kAnonymous: boolean;
  label: string;
  organizationValue: number;
  peerMedian: number;
  peerP25: number;
  peerP75: number;
  percentile: number;
  sampleCountBand: string;
  sampleSize?: number;
  unit: "count" | "currency_cents" | "percent" | "ratio";
}

export interface BenchmarkReportInput {
  generatedAt: string;
  metrics: BenchmarkReportMetric[];
  organizationName: string;
  peerCount?: number;
  peerGroupLabel: string;
  period: string;
}

export interface BenchmarkReportArtifact {
  csv: string;
  filenameBase: string;
  html: string;
  pdf: Uint8Array;
  text: string;
}

function ascii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfText(value: string): string {
  return ascii(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMetricValue(value: number, unit: BenchmarkReportMetric["unit"]): string {
  if (!Number.isFinite(value)) return "Unavailable";
  if (unit === "currency_cents") {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 0,
      style: "currency",
    }).format(value / 100);
  }
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "ratio") return value.toFixed(2);
  return Math.round(value).toLocaleString("en-US");
}

/**
 * Produces a compact, deterministic, Worker-compatible PDF using only the
 * built-in Helvetica Type 1 font. The HTML, text, and CSV representations are
 * generated from the exact same metric rows and remain the accessible source.
 */
export function encodeBenchmarkPdf(input: {
  generatedDate: string;
  metrics: Array<{
    cohort: string;
    label: string;
    organizationValue: string;
    peerMedian: string;
    percentile: string;
  }>;
  organizationName: string;
  peerGroupLabel: string;
  period: string;
}): Uint8Array {
  const command: string[] = [];
  const fill = (red: number, green: number, blue: number): void => {
    command.push(`${red} ${green} ${blue} rg`);
  };
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
  ): void => {
    command.push(`${x} ${y} ${width} ${height} re f`);
  };
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void => {
    command.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    options: {
      color?: [number, number, number];
      font?: "F1" | "F2";
      max?: number;
    } = {},
  ): void => {
    const color = options.color ?? [0.14, 0.12, 0.13];
    const safe = pdfText(value).slice(0, options.max ?? 80);
    command.push(
      "BT",
      `${color[0]} ${color[1]} ${color[2]} rg`,
      `/${options.font ?? "F1"} ${size} Tf`,
      `1 0 0 1 ${x} ${y} Tm`,
      `(${safe}) Tj`,
      "ET",
    );
  };

  fill(0.294, 0.063, 0.149);
  rect(0, 680, 612, 112);
  fill(0.792, 0.631, 0.345);
  rect(44, 678, 524, 3);
  text("VINIFERA", 44, 754, 11, {
    color: [0.92, 0.82, 0.62],
    font: "F2",
    max: 20,
  });
  text("Peer Benchmark Report", 44, 716, 25, {
    color: [1, 1, 1],
    font: "F2",
    max: 40,
  });
  text(input.period, 462, 720, 12, {
    color: [1, 1, 1],
    font: "F2",
    max: 16,
  });
  text("ANONYMIZED QUARTERLY INSIGHT", 420, 700, 7, {
    color: [0.92, 0.82, 0.62],
    max: 30,
  });

  fill(0.969, 0.953, 0.918);
  rect(44, 608, 524, 48);
  text("WINERY", 58, 637, 7, { color: [0.4, 0.35, 0.32], font: "F2" });
  text(input.organizationName, 58, 619, 11, { font: "F2", max: 38 });
  text("PEER GROUP", 270, 637, 7, { color: [0.4, 0.35, 0.32], font: "F2" });
  text(input.peerGroupLabel, 270, 619, 10, { max: 35 });
  text("GENERATED", 480, 637, 7, { color: [0.4, 0.35, 0.32], font: "F2" });
  text(input.generatedDate, 480, 619, 10, { max: 12 });

  fill(0.294, 0.063, 0.149);
  rect(44, 566, 524, 26);
  const columns = [58, 275, 365, 452, 518];
  ["METRIC", "YOUR WINERY", "PEER MEDIAN", "PERCENTILE", "COHORT"].forEach(
    (label, index) =>
      text(label, columns[index] ?? 58, 575, 7, {
        color: [1, 1, 1],
        font: "F2",
        max: index === 0 ? 28 : 18,
      }),
  );
  const visibleMetrics = input.metrics.slice(0, 8);
  visibleMetrics.forEach((metric, index) => {
    const y = 538 - index * 38;
    if (index % 2 === 1) {
      fill(0.985, 0.976, 0.957);
      rect(44, y - 11, 524, 38);
    }
    text(metric.label, columns[0] ?? 58, y + 2, 9, {
      font: "F2",
      max: 34,
    });
    text(metric.organizationValue, columns[1] ?? 275, y + 2, 9, {
      max: 14,
    });
    text(metric.peerMedian, columns[2] ?? 365, y + 2, 9, { max: 14 });
    text(metric.percentile, columns[3] ?? 452, y + 2, 9, { max: 12 });
    text(metric.cohort, columns[4] ?? 518, y + 2, 8, { max: 9 });
    command.push("0.86 0.83 0.79 RG", "0.5 w");
    line(44, y - 11, 568, y - 11);
  });
  if (input.metrics.length > visibleMetrics.length) {
    text(
      `+ ${input.metrics.length - visibleMetrics.length} additional metric(s) in the accessible CSV`,
      58,
      219,
      8,
      { color: [0.35, 0.31, 0.3], max: 74 },
    );
  }

  fill(0.969, 0.953, 0.918);
  rect(44, 114, 524, 66);
  text("PRIVACY BY DESIGN", 58, 158, 8, {
    color: [0.294, 0.063, 0.149],
    font: "F2",
  });
  text(
    `Every displayed cohort meets Vinifera's minimum threshold of ${BENCHMARK_MINIMUM_COHORT} wineries.`,
    58,
    141,
    8,
    { max: 84 },
  );
  text(
    "Directional comparisons only. Not legal, tax, or financial advice.",
    58,
    126,
    8,
    { max: 84 },
  );
  command.push("0.294 0.063 0.149 RG", "0.8 w");
  line(44, 82, 568, 82);
  text("Vinifera | Wine club intelligence", 44, 62, 8, {
    color: [0.4, 0.35, 0.32],
  });
  text("1 / 1", 542, 62, 8, { color: [0.4, 0.35, 0.32], max: 10 });

  const commands = command.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  const offsets: number[] = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "binary"));
}

export function createBenchmarkReportArtifact(
  input: BenchmarkReportInput,
): BenchmarkReportArtifact {
  if (
    input.peerCount !== undefined &&
    (!Number.isInteger(input.peerCount) ||
      input.peerCount < BENCHMARK_MINIMUM_COHORT)
  ) {
    throw new AppError(
      409,
      "conflict",
      `Peer benchmark reports require at least ${BENCHMARK_MINIMUM_COHORT} participating wineries.`,
    );
  }
  if (
    !input.metrics.length ||
    input.metrics.some(
      (metric) =>
        metric.kAnonymous !== true ||
        (metric.sampleSize !== undefined &&
          metric.sampleSize < BENCHMARK_MINIMUM_COHORT) ||
        !metric.sampleCountBand.trim() ||
        !Number.isFinite(metric.organizationValue) ||
        !Number.isFinite(metric.peerMedian),
    )
  ) {
    throw new AppError(
      409,
      "conflict",
      "Peer benchmark metrics are unavailable until every reported cohort meets the privacy threshold.",
    );
  }
  const generatedDate = input.generatedAt.slice(0, 10);
  const filenameBase = `vinifera-peer-benchmark-${input.period.replaceAll(
    /[^a-z0-9-]/gi,
    "-",
  )}`;
  const rows = input.metrics.map((metric) => ({
    label: metric.label,
    organizationValue: formatMetricValue(
      metric.organizationValue,
      metric.unit,
    ),
    peerMedian: formatMetricValue(metric.peerMedian, metric.unit),
    peerP25: formatMetricValue(metric.peerP25, metric.unit),
    peerP75: formatMetricValue(metric.peerP75, metric.unit),
    percentile: `${Math.round(metric.percentile)}th`,
    sampleCountBand: metric.sampleCountBand,
  }));
  const csvHeaders = [
    "Metric",
    "Your winery",
    "Peer median",
    "Peer 25th percentile",
    "Peer 75th percentile",
    "Your percentile",
    "Anonymized cohort band",
  ];
  const csv = `\uFEFF${[
    csvHeaders.map(encodeCsvCell).join(","),
    ...rows.map((row) =>
      [
        row.label,
        row.organizationValue,
        row.peerMedian,
        row.peerP25,
        row.peerP75,
        row.percentile,
        row.sampleCountBand,
      ]
        .map(encodeCsvCell)
        .join(","),
    ),
  ].join("\r\n")}\r\n`;
  const textLines = [
    "Vinifera Peer Benchmark Report",
    `${input.organizationName} | ${input.period}`,
    `Peer group: ${input.peerGroupLabel}`,
    `Generated: ${generatedDate}`,
    `Privacy threshold: ${BENCHMARK_MINIMUM_COHORT} wineries`,
    "",
    ...rows.map(
      (row) =>
        `${row.label}: your winery ${row.organizationValue}; peer median ${row.peerMedian}; percentile ${row.percentile}; cohort ${row.sampleCountBand}.`,
    ),
    "",
    "Benchmarks are anonymized directional comparisons, not legal, tax, or financial advice.",
  ];
  const htmlRows = rows
    .map(
      (row) =>
        `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(
          row.organizationValue,
        )}</td><td>${escapeHtml(row.peerMedian)}</td><td>${escapeHtml(
          row.peerP25,
        )}</td><td>${escapeHtml(row.peerP75)}</td><td>${escapeHtml(
          row.percentile,
        )}</td><td>${escapeHtml(row.sampleCountBand)}</td></tr>`,
    )
    .join("");
  const html = `<section aria-labelledby="benchmark-title">
<h1 id="benchmark-title">Vinifera Peer Benchmark Report</h1>
<p>${escapeHtml(input.organizationName)} | ${escapeHtml(input.period)}</p>
<p>Peer group: ${escapeHtml(input.peerGroupLabel)}. Generated ${escapeHtml(
    generatedDate,
  )}. All reported cohorts contain at least ${BENCHMARK_MINIMUM_COHORT} wineries.</p>
<div role="region" aria-label="Peer benchmark metrics" tabindex="0">
<table><caption>Anonymized peer comparison</caption><thead><tr><th scope="col">Metric</th><th scope="col">Your winery</th><th scope="col">Peer median</th><th scope="col">Peer P25</th><th scope="col">Peer P75</th><th scope="col">Your percentile</th><th scope="col">Cohort</th></tr></thead><tbody>${htmlRows}</tbody></table>
</div>
<p>Benchmarks are anonymized directional comparisons, not legal, tax, or financial advice.</p>
</section>`;
  return {
    csv,
    filenameBase,
    html,
    pdf: encodeBenchmarkPdf({
      generatedDate,
      metrics: rows.map((row) => ({
        cohort: row.sampleCountBand,
        label: row.label,
        organizationValue: row.organizationValue,
        peerMedian: row.peerMedian,
        percentile: row.percentile,
      })),
      organizationName: input.organizationName,
      peerGroupLabel: input.peerGroupLabel,
      period: input.period,
    }),
    text: textLines.join("\n"),
  };
}

export function benchmarkSuppressionGuidance(input: {
  cohortBand?: string;
  organizationName: string;
  peerCount?: number;
  period: string;
}): { html: string; subject: string; text: string } {
  const subject = `Vinifera peer benchmark update for ${input.period}`;
  const cohortDescription =
    input.cohortBand?.trim() ||
    (input.peerCount !== undefined
      ? `${input.peerCount} participating wineries`
      : "too few qualifying participants");
  const text = `${input.organizationName}'s peer benchmark report was not generated because the anonymized cohort currently has ${cohortDescription}. At least ${BENCHMARK_MINIMUM_COHORT} wineries are required before peer metrics can be shared.`;
  return {
    html: `<h1>${escapeHtml(subject)}</h1><p>${escapeHtml(text)}</p><p>No peer values or estimates are included in this notice.</p>`,
    subject,
    text,
  };
}
