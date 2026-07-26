import {
  AlertCircle,
  Cake,
  CheckCircle2,
  Clock3,
  Mail,
  PackageCheck,
  RefreshCw,
  Send,
  Truck,
  UserPlus,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, apiRequest, patchJson, postJson } from "../../api/client";
import {
  type EmailLogEntry,
  type EmailTemplate,
  type EmailTrigger,
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
import { StaffShell } from "../StaffShell";
import { asPageResult } from "../../api/phase2";
import { date, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";

const triggerPresentation: Record<
  EmailTrigger,
  { label: string; detail: string; icon: typeof Mail }
> = {
  welcome: {
    label: "Welcome email",
    detail: "When a new member joins",
    icon: UserPlus,
  },
  pre_shipment: {
    label: "Pre-shipment notice",
    detail: "Before release processing",
    icon: Clock3,
  },
  payment_decline: {
    label: "Payment decline",
    detail: "When a shipment charge fails",
    icon: AlertCircle,
  },
  shipped: {
    label: "Shipment shipped",
    detail: "When tracking is recorded",
    icon: Truck,
  },
  birthday: {
    label: "Birthday email",
    detail: "On a member’s birthday",
    icon: Cake,
  },
  re_engagement: {
    label: "Re-engagement email",
    detail: "After 60 days of inactivity",
    icon: RefreshCw,
  },
};

interface Draft {
  subject: string;
  body: string;
  enabled: boolean;
  daysBefore: string;
}

function draftFrom(template: EmailTemplate): Draft {
  return {
    subject: template.subject,
    body: template.body,
    enabled: template.enabled,
    daysBefore: String(template.daysBefore ?? 3),
  };
}

export function CommunicationsPage() {
  const loadTemplates = useCallback(
    () => apiRequest<EmailTemplate[]>("/api/email/templates"),
    [],
  );
  const templates = useApiResource(loadTemplates, [loadTemplates]);
  const loadLog = useCallback(
    () =>
      apiRequest<EmailLogEntry[] | { items: EmailLogEntry[]; total: number }>(
        "/api/email/log",
      ).then((result) => asPageResult(result).items),
    [],
  );
  const emailLog = useApiResource(loadLog, [loadLog]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [busy, setBusy] = useState<"save" | "preview" | "test" | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success" | "info";
  } | null>(null);

  const templateList =
    templates.state.status === "ready" ? templates.state.data : [];
  const selected = useMemo(
    () =>
      templateList.find((template) => template.id === selectedId) ??
      templateList[0] ??
      null,
    [selectedId, templateList],
  );

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setSelectedId(selected.id);
    setDraft(draftFrom(selected));
  }, [selected]);

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft) return;
    setBusy("save");
    setFeedback(null);
    try {
      await patchJson(`/api/email/templates/${selected.id}`, {
        subject: draft.subject,
        body: draft.body,
        enabled: draft.enabled,
        ...(selected.triggerType === "pre_shipment"
          ? { daysBefore: Number(draft.daysBefore) }
          : {}),
      });
      setFeedback({
        message: `${triggerPresentation[selected.triggerType].label} saved.`,
        kind: "success",
      });
      await templates.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The email template could not be saved.",
        kind: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function previewTemplate() {
    if (!selected || !draft || busy) return;
    setBusy("preview");
    setFeedback(null);
    try {
      const result = await postJson<{
        subject: string;
        body?: string;
        html?: string;
      }>(
        `/api/email/templates/${selected.id}/preview`,
        {
          subject: draft.subject,
          body: draft.body,
        },
      );
      setPreview({
        subject: result.subject,
        body: result.body ?? result.html ?? "",
      });
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The email preview could not be generated.",
        kind: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy("test");
    setFeedback(null);
    try {
      await postJson(`/api/email/templates/${selected.id}/test`, {
        email: testRecipient,
        recipient: testRecipient,
      });
      setTestOpen(false);
      setTestRecipient("");
      setFeedback({
        message: `Test email accepted for ${testRecipient}.`,
        kind: "success",
      });
      await emailLog.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The test email could not be sent.",
        kind: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <StaffShell title="Communications" eyebrow="Member Experience">
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Transactional automation</p>
          <h2>Email templates</h2>
          <p>
            Customize the six lifecycle emails connected to member, billing, and
            shipment events.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind ?? "error"}
        />
      </div>

      <div className="communications-primary">
        {templates.state.status === "loading" ? (
          <LoadingBlock label="Loading email templates" />
        ) : templates.state.status === "error" ? (
          isActivationError(templates.state.error) ? (
            <ActivationBlock
              title="Email automation is ready to connect"
              detail="Deploy the Phase 3 email template API. Resend delivery can remain inactive until its API key and sender domain are configured."
            />
          ) : (
            <ErrorBlock
              error={templates.state.error}
              onRetry={() => void templates.refresh()}
            />
          )
        ) : templateList.length === 0 ? (
          <EmptyBlock
            title="No templates are configured"
            detail="Seed the six transactional trigger templates to begin editing lifecycle email."
          />
        ) : (
          <div className="communications-layout">
          <aside className="template-rail" aria-label="Email templates">
            <div className="template-rail__heading">
              <h2>Trigger library</h2>
              <span>{templateList.filter((template) => template.enabled).length} enabled</span>
            </div>
            {templateList.map((template) => {
              const presentation = triggerPresentation[template.triggerType];
              const Icon = presentation.icon;
              const isSelected = selected?.id === template.id;
              return (
                <button
                  type="button"
                  key={template.id}
                  className={`template-rail__item${
                    isSelected ? " template-rail__item--active" : ""
                  }`}
                  onClick={() => setSelectedId(template.id)}
                  aria-pressed={isSelected}
                >
                  <span className="template-rail__icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span>
                    <strong>{presentation.label}</strong>
                    <small>{presentation.detail}</small>
                  </span>
                  <span
                    className={`status-pill status-pill--${
                      template.enabled ? "active" : "paused"
                    }`}
                  >
                    {template.enabled ? "Enabled" : "Disabled"}
                  </span>
                </button>
              );
            })}
          </aside>

          {selected && draft ? (
            <section className="email-editor" aria-labelledby="email-editor-title">
              <header className="email-editor__header">
                <div>
                  <p className="eyebrow eyebrow--wine">
                    {sentence(selected.triggerType)}
                  </p>
                  <h2 id="email-editor-title">
                    {triggerPresentation[selected.triggerType].label}
                  </h2>
                  <p>{triggerPresentation[selected.triggerType].detail}</p>
                </div>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) =>
                      setDraft({ ...draft, enabled: event.target.checked })
                    }
                  />
                  <span aria-hidden="true" />
                  {draft.enabled ? "Enabled" : "Disabled"}
                </label>
              </header>
              {selected.senderStatus === "activation_required" ? (
                <div className="email-activation-note" role="status">
                  <Mail aria-hidden="true" />
                  <p>
                    Editing is available. Sending will activate after Resend and
                    the winery sender domain are configured.
                  </p>
                </div>
              ) : null}
              <form className="operation-form" onSubmit={saveTemplate}>
                <div className="form-field">
                  <label htmlFor="email-subject">Subject line</label>
                  <input
                    id="email-subject"
                    required
                    maxLength={200}
                    value={draft.subject}
                    onChange={(event) =>
                      setDraft({ ...draft, subject: event.target.value })
                    }
                  />
                  <p className="field-message">
                    {draft.subject.length}/200 characters
                  </p>
                </div>
                <div className="form-field">
                  <label htmlFor="email-body">Email body</label>
                  <textarea
                    id="email-body"
                    required
                    rows={14}
                    value={draft.body}
                    onChange={(event) =>
                      setDraft({ ...draft, body: event.target.value })
                    }
                    aria-describedby="email-variable-help"
                  />
                  <p className="field-message" id="email-variable-help">
                    Supported variables are validated by the server before
                    saving and sending.
                  </p>
                </div>
                {selected.triggerType === "pre_shipment" ? (
                  <div className="form-field email-days-field">
                    <label htmlFor="email-days-before">
                      Send before processing
                    </label>
                    <div>
                      <input
                        id="email-days-before"
                        required
                        type="number"
                        min="1"
                        max="30"
                        value={draft.daysBefore}
                        onChange={(event) =>
                          setDraft({ ...draft, daysBefore: event.target.value })
                        }
                      />
                      <span>days</span>
                    </div>
                  </div>
                ) : null}
                <div className="email-editor__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => void previewTemplate()}
                    aria-busy={busy === "preview"}
                    aria-disabled={Boolean(busy)}
                  >
                    <PackageCheck aria-hidden="true" />
                    {busy === "preview" ? "Building preview…" : "Preview"}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setTestOpen(true)}
                    disabled={Boolean(busy)}
                  >
                    <Send aria-hidden="true" />
                    Send test
                  </button>
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={Boolean(busy)}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    {busy === "save" ? "Saving…" : "Save template"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          </div>
        )}
      </div>

      <section className="operation-panel communications-log" aria-labelledby="email-log-title">
        <div className="panel-heading panel-heading--split">
          <div>
            <p className="eyebrow eyebrow--wine">Delivery history</p>
            <h2 id="email-log-title">Sending log</h2>
            <p>Transactional delivery outcomes recorded by the email provider.</p>
          </div>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => void emailLog.refresh()}
            disabled={emailLog.state.status === "loading"}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </button>
        </div>
        {emailLog.state.status === "loading" ? (
          <LoadingBlock label="Loading sending log" />
        ) : emailLog.state.status === "error" ? (
          isActivationError(emailLog.state.error) ? (
            <ActivationBlock
              title="Sending log is ready"
              detail="Delivery events will appear after Resend is activated and a transactional email is attempted."
            />
          ) : (
            <ErrorBlock
              error={emailLog.state.error}
              onRetry={() => void emailLog.refresh()}
            />
          )
        ) : emailLog.state.data.length === 0 ? (
          <EmptyBlock
            title="No emails have been sent"
            detail="Test and triggered delivery events will be recorded here."
          />
        ) : (
          <div
            className="data-table-wrap"
            tabIndex={0}
            aria-label="Scrollable transactional email sending log"
          >
            <table className="data-table">
              <caption>Transactional email sending log</caption>
              <thead>
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Template</th>
                  <th scope="col">Status</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Provider detail</th>
                </tr>
              </thead>
              <tbody>
                {emailLog.state.data.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.recipient}</td>
                    <td>{entry.templateName}</td>
                    <td>
                      <span className={`status-pill status-pill--${entry.status}`}>
                        {sentence(entry.status)}
                      </span>
                    </td>
                    <td>{date(entry.createdAt)}</td>
                    <td>{entry.errorMessage ?? entry.providerId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(preview)}
        title="Email preview"
        description="Preview content is sanitized and personalized by the server."
        onClose={() => setPreview(null)}
      >
        {preview ? (
          <article className="email-preview">
            <header>
              <span>Subject</span>
              <strong>{preview.subject}</strong>
            </header>
            <div>
              {preview.body.split("\n").map((paragraph, index) => (
                <p key={`${paragraph}-${index}`}>{paragraph || "\u00a0"}</p>
              ))}
            </div>
          </article>
        ) : null}
      </Dialog>

      <Dialog
        open={testOpen}
        title="Send a test email"
        description="The test uses the saved provider configuration and is recorded in the sending log."
        onClose={() => setTestOpen(false)}
      >
        <form className="operation-form" onSubmit={sendTest}>
          <div className="form-field">
            <label htmlFor="test-email-recipient">Recipient email</label>
            <input
              id="test-email-recipient"
              type="email"
              required
              autoComplete="email"
              value={testRecipient}
              onChange={(event) => setTestRecipient(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="button button--primary button--wide"
            disabled={Boolean(busy)}
          >
            <Send aria-hidden="true" />
            {busy === "test" ? "Sending test…" : "Send test email"}
          </button>
        </form>
      </Dialog>
    </StaffShell>
  );
}
