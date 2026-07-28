import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiError, postJson } from "../../api/client";
import {
  type ImportPreview,
  type ImportResult,
  uploadImportPreview,
} from "../../api/phase2";
import { Link } from "../../routes/router";
import { FormFeedback } from "../../shared/FormFeedback";
import { EmptyBlock } from "../../shared/OperationalState";
import { StaffShell } from "../StaffShell";

const targetFields = [
  { value: "", label: "Do not import" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "clubTier", label: "Club tier" },
  { value: "status", label: "Status" },
  { value: "joinDate", label: "Join date" },
  { value: "line1", label: "Address line 1" },
  { value: "line2", label: "Address line 2" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "postalCode", label: "ZIP code" },
  { value: "country", label: "Country code" },
] as const;

export function ImportMembersPage() {
  const [source, setSource] = useState<"commerce7" | "winedirect" | "generic">(
    "generic",
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setResult(null);
    if (!file) {
      setFeedback({ message: "Choose a CSV file to continue.", kind: "error" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFeedback({ message: "Only .csv files are accepted.", kind: "error" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback({
        message: "CSV files must be 5 MB or smaller.",
        kind: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const next = await uploadImportPreview(file, source);
      setPreview(next);
      setMapping(next.suggestedMapping);
      setFeedback({
        message: `Validated ${next.validation.validCount + next.validation.invalidCount} rows. Review the mapping before importing.`,
        kind: "success",
      });
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "Vinifera could not validate that file.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function importMembers() {
    if (!preview) return;
    setBusy(true);
    setFeedback(null);
    try {
      const next = await postJson<ImportResult>("/api/members/import", {
        uploadToken: preview.uploadToken,
        mapping,
      });
      setResult(next);
      setFeedback({
        message: `${next.importedCount} ${
          next.importedCount === 1 ? "member" : "members"
        } imported into the live roster.`,
        kind: "success",
      });
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The import could not complete.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const hasRequiredMappings =
    Object.values(mapping).includes("firstName") &&
    Object.values(mapping).includes("lastName") &&
    Object.values(mapping).includes("email");

  return (
    <StaffShell
      title="Import Members"
      eyebrow="Members"
      actions={
        <Link className="button button--secondary button--compact" to="/app/members">
          <ChevronLeft aria-hidden="true" />
          <span>All Members</span>
        </Link>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">CSV migration</p>
          <h2>Move your club to Vinifera</h2>
          <p>
            Upload, map, validate, and preview member records before any live
            insert occurs.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>

      <div className="import-layout">
        <section className="operation-panel" aria-labelledby="upload-title">
          <div className="panel-heading">
            <div>
              <span className="step-number" aria-hidden="true">
                1
              </span>
              <h2 id="upload-title">Upload and validate</h2>
            </div>
          </div>
          <form className="operation-form" onSubmit={createPreview}>
            <div className="form-field">
              <label htmlFor="import-source">Source format</label>
              <select
                id="import-source"
                value={source}
                onChange={(event) =>
                  setSource(
                    event.target.value as
                      | "commerce7"
                      | "winedirect"
                      | "generic",
                  )
                }
              >
                <option value="generic">Generic CSV</option>
                <option value="commerce7">Commerce7 export</option>
                <option value="winedirect">WineDirect export</option>
              </select>
            </div>
            <label className="file-drop" htmlFor="member-csv">
              <FileSpreadsheet aria-hidden="true" />
              <strong>{file?.name ?? "Choose a member CSV"}</strong>
              <span>
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB selected`
                  : "CSV only, up to 5 MB"}
              </span>
              <input
                id="member-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPreview(null);
                  setResult(null);
                }}
              />
            </label>
            <button
              className="button button--primary button--wide"
              disabled={busy || !file}
            >
              <Upload aria-hidden="true" />
              {busy ? "Validating file…" : "Upload and preview"}
            </button>
          </form>
        </section>

        <aside className="operation-panel import-guidance" aria-labelledby="import-guidance-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow eyebrow--wine">Before you upload</p>
              <h2 id="import-guidance-title">Import safeguards</h2>
            </div>
          </div>
          <ul className="check-list">
            <li>
              <CheckCircle2 aria-hidden="true" />
              File type and size are checked before upload.
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              Email, required fields, and duplicates are validated server-side.
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              No records are inserted until you confirm the preview.
            </li>
          </ul>
        </aside>
      </div>

      {preview ? (
        <>
          <section className="operation-panel" aria-labelledby="mapping-title">
            <div className="panel-heading">
              <div>
                <span className="step-number" aria-hidden="true">
                  2
                </span>
                <h2 id="mapping-title">Map columns</h2>
                <p>First name, last name, and email are required.</p>
              </div>
            </div>
            <div className="mapping-grid">
              {preview.columns.map((column) => (
                <div className="mapping-row" key={column}>
                  <label htmlFor={`mapping-${column}`}>{column}</label>
                  <span aria-hidden="true">→</span>
                  <select
                    id={`mapping-${column}`}
                    value={mapping[column] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [column]: event.target.value,
                      }))
                    }
                  >
                    {targetFields.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <section className="operation-panel" aria-labelledby="preview-title">
            <div className="panel-heading panel-heading--split">
              <div>
                <span className="step-number" aria-hidden="true">
                  3
                </span>
                <h2 id="preview-title">Review first 10 rows</h2>
              </div>
              <div className="validation-summary" aria-live="polite">
                <span className="validation-summary__valid">
                  {preview.validation.validCount} valid
                </span>
                <span className="validation-summary__invalid">
                  {preview.validation.invalidCount} needs attention
                </span>
              </div>
            </div>
            {preview.rows.length ? (
              <div className="data-table-wrap">
                <table className="data-table data-table--preview">
                  <caption>First ten validated rows from the selected CSV</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      {preview.columns.map((column) => (
                        <th scope="col" key={column}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 10).map((row, index) => (
                      <tr key={`preview-${index}`}>
                        <th scope="row">{index + 2}</th>
                        {preview.columns.map((column) => (
                          <td key={column}>{row[column] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyBlock
                title="No rows found"
                detail="Choose another CSV with a header and at least one member row."
              />
            )}
            {preview.validation.errors.length ? (
              <div className="validation-errors" role="region" aria-labelledby="validation-errors-title">
                <h3 id="validation-errors-title">
                  <AlertTriangle aria-hidden="true" />
                  Validation errors
                </h3>
                <ul>
                  {preview.validation.errors.map((error, index) => (
                    <li key={`${error.row}-${index}`}>
                      Row {error.row}
                      {error.field ? `, ${error.field}` : ""}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button
              type="button"
              className="button button--primary"
              disabled={
                busy ||
                preview.validation.validCount === 0 ||
                !hasRequiredMappings ||
                Boolean(result)
              }
              onClick={() => void importMembers()}
            >
              {busy
                ? "Importing members…"
                : `Import ${preview.validation.validCount} valid members`}
            </button>
          </section>
        </>
      ) : null}

      {result?.errors.length ? (
        <section className="operation-panel" aria-labelledby="import-result-errors">
          <h2 id="import-result-errors">Rows skipped during import</h2>
          <ul className="error-report">
            {result.errors.map((error, index) => (
              <li key={`${error.row}-${index}`}>
                Row {error.row}: {error.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </StaffShell>
  );
}
