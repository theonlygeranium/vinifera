import {
  ArrowDownUp,
  BookOpenCheck,
  Calculator,
  CircleAlert,
  ExternalLink,
  Megaphone,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ApiError,
  apiRequest,
  deleteJson,
  patchJson,
  postJson,
} from "../../api/client";
import type {
  AvalaraFilingStatus,
  IntegrationLog,
  IntegrationLogsResponse,
  IntegrationSummary,
  IntegrationsResponse,
  IntegrationType,
} from "../../api/phase5";
import { Dialog } from "../../shared/Dialog";
import { FormFeedback } from "../../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
} from "../../shared/OperationalState";
import { date, money, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";
import { StaffShell } from "../StaffShell";
import { useBrandScope } from "./BrandScopeContext";

const PROVIDERS: Record<
  IntegrationType,
  {
    name: string;
    description: string;
    icon: typeof Megaphone;
    accent: string;
  }
> = {
  klaviyo: {
    name: "Klaviyo",
    description:
      "Member, segment, list, and consent-aware engagement synchronization.",
    icon: Megaphone,
    accent: "gold",
  },
  quickbooks: {
    name: "QuickBooks Online",
    description:
      "Daily sales receipts, refunds, tax lines, and monthly reconciliation.",
    icon: BookOpenCheck,
    accent: "green",
  },
  avalara: {
    name: "Avalara",
    description:
      "Real-time jurisdictional tax calculation, liability, and filing status.",
    icon: Calculator,
    accent: "blue",
  },
  meta: {
    name: "Meta Conversions API",
    description:
      "Consent-gated, server-side conversion attribution with hashed identity.",
    icon: ArrowDownUp,
    accent: "wine",
  },
};

type DraftConfig = {
  optedIn: boolean;
  apiKey: string;
  webhookSecret: string;
  accountId: string;
  companyCode: string;
  pixelId: string;
  testEventCode: string;
  accessToken: string;
  environment: "sandbox" | "production";
  graphApiVersion: string;
  listId: string;
  memberEmailField: string;
  memberTierField: string;
  churnRiskField: string;
  depositAccountRef: string;
  defaultItemRef: string;
  defaultCustomerRef: string;
  taxCodeRef: string;
  currencyCode: string;
  exchangeRate: string;
  syncFrequency: string;
  filingEnabled: boolean;
  consentConfirmed: boolean;
};

const EMPTY_DRAFT: DraftConfig = {
  optedIn: false,
  apiKey: "",
  webhookSecret: "",
  accountId: "",
  companyCode: "",
  pixelId: "",
  testEventCode: "",
  accessToken: "",
  environment: "sandbox",
  graphApiVersion: "",
  listId: "",
  memberEmailField: "email",
  memberTierField: "club_tier",
  churnRiskField: "churn_risk",
  depositAccountRef: "",
  defaultItemRef: "",
  defaultCustomerRef: "",
  taxCodeRef: "",
  currencyCode: "USD",
  exchangeRate: "1",
  syncFrequency: "daily",
  filingEnabled: false,
  consentConfirmed: false,
};

function stringConfig(
  config: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  return typeof config[key] === "string" ? String(config[key]) : fallback;
}

function draftFrom(summary: IntegrationSummary): DraftConfig {
  return {
    ...EMPTY_DRAFT,
    optedIn: summary.optedIn,
    accountId: stringConfig(summary.syncConfig, "accountId"),
    companyCode: stringConfig(summary.syncConfig, "companyCode"),
    pixelId: stringConfig(summary.syncConfig, "pixelId"),
    testEventCode: stringConfig(summary.syncConfig, "testEventCode"),
    listId: stringConfig(summary.syncConfig, "listId"),
    memberEmailField: stringConfig(
      summary.syncConfig,
      "memberEmailField",
      "email",
    ),
    memberTierField: stringConfig(
      summary.syncConfig,
      "memberTierField",
      "club_tier",
    ),
    churnRiskField: stringConfig(
      summary.syncConfig,
      "churnRiskField",
      "churn_risk",
    ),
    depositAccountRef: stringConfig(summary.syncConfig, "depositAccountRef"),
    defaultItemRef: stringConfig(summary.syncConfig, "defaultItemRef"),
    defaultCustomerRef: stringConfig(summary.syncConfig, "defaultCustomerRef"),
    taxCodeRef: stringConfig(summary.syncConfig, "taxCodeRef"),
    currencyCode: stringConfig(summary.syncConfig, "currencyCode", "USD"),
    exchangeRate: String(summary.syncConfig.exchangeRate ?? "1"),
    syncFrequency: stringConfig(
      summary.syncConfig,
      "syncFrequency",
      summary.type === "klaviyo" ? "hourly" : "daily",
    ),
    filingEnabled: summary.syncConfig.filingEnabled === true,
    environment:
      summary.syncConfig.environment === "production"
        ? "production"
        : "sandbox",
    graphApiVersion: stringConfig(summary.syncConfig, "graphApiVersion"),
  };
}

function statusDetail(summary: IntegrationSummary) {
  switch (summary.status) {
    case "active":
      return "The latest provider operation completed successfully.";
    case "configured":
      return "Credentials are stored, but no successful provider operation is recorded.";
    case "degraded":
      return "A newer provider operation failed after a prior success.";
    case "error":
      return "The provider rejected or could not complete its latest operation.";
    case "disconnected":
      return "The winery disconnected this provider.";
    default:
      return "The connector is wired and will activate after credentials and consent are supplied.";
  }
}

function formatTimestamp(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ConfigurationFields({
  type,
  draft,
  update,
}: {
  type: IntegrationType;
  draft: DraftConfig;
  update: <K extends keyof DraftConfig>(key: K, value: DraftConfig[K]) => void;
}) {
  if (type === "klaviyo") {
    return (
      <>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="klaviyo-api-key">Private API key</label>
            <input
              id="klaviyo-api-key"
              type="password"
              autoComplete="new-password"
              value={draft.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
              placeholder="Stored server-side only"
            />
          </div>
          <div className="form-field">
            <label htmlFor="klaviyo-webhook-secret">
              Webhook signing secret (optional)
            </label>
            <input
              id="klaviyo-webhook-secret"
              type="password"
              autoComplete="new-password"
              value={draft.webhookSecret}
              onChange={(event) => update("webhookSecret", event.target.value)}
              placeholder="Write-only for eligible accounts"
            />
          </div>
          <div className="form-field">
            <label htmlFor="klaviyo-list">Default member list ID</label>
            <input
              id="klaviyo-list"
              value={draft.listId}
              onChange={(event) => update("listId", event.target.value)}
            />
          </div>
        </div>
        <fieldset className="operation-fieldset">
          <legend>Vinifera to Klaviyo field mapping</legend>
          <div className="form-grid form-grid--three">
            <div className="form-field">
              <label htmlFor="map-email">Member email</label>
              <input
                id="map-email"
                value={draft.memberEmailField}
                onChange={(event) =>
                  update("memberEmailField", event.target.value)
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor="map-tier">Club tier</label>
              <input
                id="map-tier"
                value={draft.memberTierField}
                onChange={(event) =>
                  update("memberTierField", event.target.value)
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor="map-risk">Churn risk</label>
              <input
                id="map-risk"
                value={draft.churnRiskField}
                onChange={(event) =>
                  update("churnRiskField", event.target.value)
                }
              />
            </div>
          </div>
        </fieldset>
      </>
    );
  }

  if (type === "quickbooks") {
    return (
      <fieldset className="operation-fieldset">
        <legend>QuickBooks reference mapping</legend>
        <div className="form-grid form-grid--three">
          <div className="form-field">
            <label htmlFor="qb-deposit-account">
              Deposit account reference ID
            </label>
            <input
              id="qb-deposit-account"
              required
              value={draft.depositAccountRef}
              onChange={(event) =>
                update("depositAccountRef", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="qb-default-item">Default item reference ID</label>
            <input
              id="qb-default-item"
              required
              value={draft.defaultItemRef}
              onChange={(event) =>
                update("defaultItemRef", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="qb-default-customer">
              Default customer reference ID
            </label>
            <input
              id="qb-default-customer"
              required
              value={draft.defaultCustomerRef}
              onChange={(event) =>
                update("defaultCustomerRef", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="qb-tax-code">Tax code reference ID (optional)</label>
            <input
              id="qb-tax-code"
              value={draft.taxCodeRef}
              onChange={(event) => update("taxCodeRef", event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="qb-currency">Currency code</label>
            <input
              id="qb-currency"
              required
              inputMode="text"
              pattern="[A-Z]{3}"
              maxLength={3}
              value={draft.currencyCode}
              onChange={(event) =>
                update("currencyCode", event.target.value.toUpperCase())
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="qb-exchange-rate">Exchange rate</label>
            <input
              id="qb-exchange-rate"
              type="number"
              required
              min="0.000001"
              step="0.000001"
              value={draft.exchangeRate}
              onChange={(event) => update("exchangeRate", event.target.value)}
            />
          </div>
        </div>
        <p className="provider-oauth-note">
          Use QuickBooks object IDs, not display names. The exchange rate is
          recorded with non-USD receipts for reconciliation.
        </p>
      </fieldset>
    );
  }

  if (type === "avalara") {
    return (
      <>
        <div className="form-field">
          <label htmlFor="avalara-environment">Avalara environment</label>
          <select
            id="avalara-environment"
            value={draft.environment}
            onChange={(event) =>
              update(
                "environment",
                event.target.value === "production" ? "production" : "sandbox",
              )
            }
          >
            <option value="sandbox">Sandbox · REST v2</option>
            <option value="production">Production · REST v2</option>
          </select>
          <small>
            The server chooses an allowlisted Avalara base URL; arbitrary
            provider URLs are rejected.
          </small>
        </div>
        <div className="form-grid form-grid--three">
          <div className="form-field">
            <label htmlFor="avalara-key">License or API key</label>
            <input
              id="avalara-key"
              type="password"
              autoComplete="new-password"
              value={draft.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
              placeholder="Stored server-side only"
            />
          </div>
          <div className="form-field">
            <label htmlFor="avalara-account">Account ID</label>
            <input
              id="avalara-account"
              value={draft.accountId}
              onChange={(event) => update("accountId", event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="avalara-company">Company code</label>
            <input
              id="avalara-company"
              value={draft.companyCode}
              onChange={(event) => update("companyCode", event.target.value)}
            />
          </div>
        </div>
        <label className="consent-control">
          <input
            type="checkbox"
            checked={draft.filingEnabled}
            onChange={(event) => update("filingEnabled", event.target.checked)}
          />
          <span>
            <strong>Enable filing workflow after account validation</strong>
            <small>
              Filing remains inactive until Avalara confirms registration and
              nexus for each jurisdiction.
            </small>
          </span>
        </label>
      </>
    );
  }

  return (
    <>
      <div className="form-grid form-grid--three">
        <div className="form-field">
          <label htmlFor="meta-pixel">Dataset or pixel ID</label>
          <input
            id="meta-pixel"
            value={draft.pixelId}
            onChange={(event) => update("pixelId", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="meta-version">Graph API version</label>
          <input
            id="meta-version"
            required
            value={draft.graphApiVersion}
            onChange={(event) => update("graphApiVersion", event.target.value)}
            placeholder="Use server-approved version"
          />
        </div>
        <div className="form-field">
          <label htmlFor="meta-token">Conversions API access token</label>
          <input
            id="meta-token"
            type="password"
            autoComplete="new-password"
            value={draft.accessToken}
            onChange={(event) => update("accessToken", event.target.value)}
            placeholder="Stored server-side only"
          />
        </div>
        <div className="form-field">
          <label htmlFor="meta-test-event-code">Test event code</label>
          <input
            id="meta-test-event-code"
            value={draft.testEventCode}
            onChange={(event) =>
              update("testEventCode", event.target.value.toUpperCase())
            }
            pattern="TEST[A-Za-z0-9_-]{1,96}"
            maxLength={100}
            placeholder="TEST12345"
          />
          <small>
            Required outside production so rehearsals cannot enter the live
            Meta event stream.
          </small>
        </div>
      </div>
    </>
  );
}

export function IntegrationsPage() {
  const brandScope = useBrandScope();
  const load = useCallback(
    () => {
      if (!brandScope.activeBrandId || brandScope.activeBrandId === "all") {
        throw new ApiError("Select one brand to load its integrations.", {
          status: 400,
          code: "BRAND_SCOPE_REQUIRED",
        });
      }
      return apiRequest<IntegrationsResponse>("/api/integrations");
    },
    [brandScope.activeBrandId],
  );
  const resource = useApiResource(load, [load]);
  const [selectedType, setSelectedType] = useState<IntegrationType | null>(null);
  const [draft, setDraft] = useState<DraftConfig>(EMPTY_DRAFT);
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [reconciliation, setReconciliation] = useState<{
    period: string;
    viniferaRevenueCents: number;
    quickbooksRevenueCents: number;
    differenceCents: number;
    currency: string;
    status: string;
  } | null>(null);
  const [filingStatus, setFilingStatus] =
    useState<AvalaraFilingStatus | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);

  const summaries = resource.state.status === "ready" ? resource.state.data.items : [];
  const selected = useMemo(
    () => summaries.find((item) => item.type === selectedType) ?? null,
    [selectedType, summaries],
  );

  useEffect(() => {
    if (!selected) return;
    setDraft(draftFrom(selected));
    setReconciliation(null);
    setFilingStatus(null);
    setLogsLoading(true);
    void apiRequest<IntegrationLogsResponse>(
      `/api/integrations/${selected.type}/logs?limit=25`,
    )
      .then((response) => setLogs(response.items))
      .catch(() => setLogs([]))
      .finally(() => setLogsLoading(false));
    if (selected.type === "avalara") {
      setFilingLoading(true);
      void apiRequest<AvalaraFilingStatus>(
        "/api/integrations/avalara/filing",
      )
        .then(setFilingStatus)
        .catch(() => setFilingStatus(null))
        .finally(() => setFilingLoading(false));
    } else {
      setFilingLoading(false);
    }
  }, [selected]);

  function updateDraft<K extends keyof DraftConfig>(
    key: K,
    value: DraftConfig[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function openConfiguration(type: IntegrationType) {
    setFeedback(null);
    setSelectedType(type);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (!draft.optedIn || !draft.consentConfirmed) {
      setFeedback({
        kind: "error",
        message:
          "Explicit winery authorization and the data-sharing confirmation are required.",
      });
      return;
    }
    setBusy("save");
    setFeedback(null);
    const config =
      selected.type === "klaviyo"
        ? {
            churnRiskField: draft.churnRiskField,
            listId: draft.listId || null,
            memberEmailField: draft.memberEmailField,
            memberTierField: draft.memberTierField,
            syncFrequency: draft.syncFrequency,
          }
        : selected.type === "quickbooks"
          ? {
              currencyCode: draft.currencyCode,
              defaultCustomerRef: draft.defaultCustomerRef,
              defaultItemRef: draft.defaultItemRef,
              depositAccountRef: draft.depositAccountRef,
              exchangeRate: Number(draft.exchangeRate),
              syncFrequency: draft.syncFrequency,
              taxCodeRef: draft.taxCodeRef || null,
            }
          : selected.type === "avalara"
            ? {
                accountId: draft.accountId || null,
                companyCode: draft.companyCode || null,
                environment: draft.environment,
                filingEnabled: draft.filingEnabled,
                syncFrequency: draft.syncFrequency,
              }
            : {
                graphApiVersion: draft.graphApiVersion || null,
                pixelId: draft.pixelId || null,
                testEventCode: draft.testEventCode || null,
                syncFrequency: draft.syncFrequency,
              };
    const credentials = {
      ...(draft.apiKey
        ? selected.type === "avalara"
          ? { licenseKey: draft.apiKey }
          : { apiKey: draft.apiKey }
        : {}),
      ...(draft.webhookSecret ? { webhookSecret: draft.webhookSecret } : {}),
      ...(draft.accessToken ? { accessToken: draft.accessToken } : {}),
      ...(selected.type === "avalara" && draft.apiKey
        ? {
            accountId: draft.accountId,
            baseUrl:
              draft.environment === "production"
                ? "https://rest.avatax.com"
                : "https://sandbox-rest.avatax.com",
            companyCode: draft.companyCode,
          }
        : {}),
      ...(selected.type === "meta" && draft.accessToken
        ? {
            apiVersion: draft.graphApiVersion,
            pixelId: draft.pixelId,
            testEventCode: draft.testEventCode,
          }
        : {}),
    };
    try {
      if (
        selected.type === "quickbooks" &&
        selected.status === "activation_required"
      ) {
        await patchJson(`/api/integrations/${selected.type}`, {
          consentConfirmed: true,
          optedIn: draft.optedIn,
          syncConfig: config,
        });
        const authorization = await apiRequest<{ url: string }>(
          `/api/integrations/quickbooks/authorize?brandId=${encodeURIComponent(
            brandScope.activeBrandId!,
          )}`,
        );
        const target = new URL(authorization.url);
        if (target.protocol !== "https:") throw new Error("Unsafe OAuth URL");
        window.location.assign(target.toString());
        return;
      }
      const result =
        selected.status === "activation_required" ||
        selected.status === "disconnected"
          ? await postJson<Record<string, unknown>>(
              `/api/integrations/${selected.type}/connect`,
              {
                brandId: brandScope.activeBrandId,
                consentConfirmed: true,
                credentials,
                optedIn: draft.optedIn,
                syncConfig: config,
              },
            )
          : await patchJson<Record<string, unknown>>(
              `/api/integrations/${selected.type}`,
              {
                consentConfirmed: true,
                credentials,
                optedIn: draft.optedIn,
                syncConfig: config,
              },
            );
      setDraft((current) => ({
        ...current,
        apiKey: "",
        webhookSecret: "",
        accessToken: "",
      }));
      await resource.refresh();
      setFeedback({
        kind: "success",
        message: `${PROVIDERS[selected.type].name} configuration saved. Provider status: ${sentence(
          typeof result.status === "string" ? result.status : "configured",
        )}.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The integration configuration could not be saved.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function runSync() {
    if (!selected) return;
    setBusy("sync");
    setFeedback(null);
    try {
      const result = await postJson<{ jobId: string; status: string }>(
        `/api/integrations/${selected.type}/sync`,
      );
      setFeedback({
        kind: "success",
        message:
          result.status === "deduplicated"
            ? "An equivalent sync is already queued."
            : "The provider sync was queued. Refresh status to review its result.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The sync could not be queued.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!selected) return;
    setBusy("disconnect");
    setFeedback(null);
    try {
      await deleteJson(`/api/integrations/${selected.type}`);
      setFeedback({
        kind: "success",
        message:
          "The connector was disconnected. Historical minimized sync logs remain available for audit.",
      });
      await resource.refresh();
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The connector could not be disconnected.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function loadReconciliation() {
    const period = new Date().toISOString().slice(0, 7);
    setBusy("reconcile");
    setFeedback(null);
    try {
      const result = await apiRequest<typeof reconciliation>(
        `/api/integrations/quickbooks/reconciliation?period=${period}`,
      );
      setReconciliation(result);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The reconciliation report is not available.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function verifyFilingStatus() {
    if (!selected || selected.type !== "avalara") return;
    setBusy("filing");
    setFeedback(null);
    try {
      await postJson<{ jobId: string; status: string }>(
        "/api/integrations/avalara/filing/verify",
      );
      setFeedback({
        kind: "success",
        message:
          "Avalara filing verification was queued. The read-only snapshot will update after the worker completes.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "Avalara filing verification could not be queued.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <StaffShell title="Integrations" eyebrow="Scale & integrations">
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Connected operations</p>
          <h2>Provider control center</h2>
          <p>
            Authorize each provider explicitly, map only the required fields,
            and inspect every sync without exposing credentials in the browser.
          </p>
        </div>
      </div>

      {brandScope.activeBrandId === "all" ? (
        <EmptyBlock
          title="Select one brand"
          detail="Provider credentials, consent, mappings, and sync logs are isolated per brand and are unavailable in the organization aggregate scope."
        />
      ) : resource.state.status === "loading" ? (
        <LoadingBlock label="Loading integration health" />
      ) : resource.state.status === "error" ? (
        resource.state.error instanceof ApiError &&
        resource.state.error.status === 503 ? (
          <ActivationBlock
            title="Integration framework is ready"
            detail="Apply the Phase 5 migration and server bindings to activate provider configuration."
          />
        ) : (
          <ErrorBlock
            error={resource.state.error}
            onRetry={() => void resource.refresh()}
          />
        )
      ) : !resource.state.data.items.length ? (
        <EmptyBlock
          title="No connectors are available"
          detail="The server has not published a Phase 5 integration catalog for this organization."
        />
      ) : (
        <>
          <section className="integration-health" aria-label="Integration health">
            <div>
              <strong>{resource.state.data.health.active}</strong>
              <span>Active</span>
            </div>
            <div>
              <strong>{resource.state.data.health.degraded}</strong>
              <span>Needs attention</span>
            </div>
            <div>
              <strong>{resource.state.data.health.activationRequired}</strong>
              <span>Activation required</span>
            </div>
          </section>
          <div className="integration-grid">
            {resource.state.data.items.map((summary) => {
              const provider = PROVIDERS[summary.type];
              const Icon = provider.icon;
              return (
                <article
                  key={summary.type}
                  className={`integration-card integration-card--${provider.accent}`}
                >
                  <div className="integration-card__heading">
                    <span aria-hidden="true">
                      <Icon />
                    </span>
                    <div>
                      <h2>{provider.name}</h2>
                      <p>{provider.description}</p>
                    </div>
                    <span
                      className={`status-pill status-pill--integration-${summary.status}`}
                    >
                      {sentence(summary.status)}
                    </span>
                  </div>
                  <p className="integration-card__status">
                    {statusDetail(summary)}
                  </p>
                  <dl>
                    <div>
                      <dt>Last successful sync</dt>
                      <dd>{formatTimestamp(summary.lastSuccessAt)}</dd>
                    </div>
                    <div>
                      <dt>Authorization</dt>
                      <dd>{summary.optedIn ? "Granted" : "Not granted"}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="button button--secondary button--wide"
                    onClick={() => openConfiguration(summary.type)}
                  >
                    <PlugZap aria-hidden="true" />
                    Configure {provider.name}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}

      <Dialog
        open={Boolean(selected)}
        title={selected ? `${PROVIDERS[selected.type].name} connection` : ""}
        description={
          selected
            ? `${statusDetail(selected)} Secret values are write-only.`
            : ""
        }
        onClose={() => {
          setFeedback(null);
          setSelectedType(null);
        }}
      >
        {selected ? (
          <form className="operation-form" onSubmit={save}>
            <div aria-live="polite">
              <FormFeedback
                message={feedback?.message ?? null}
                kind={feedback?.kind ?? "error"}
              />
            </div>
            <section
              className={`integration-state integration-state--${selected.status}`}
              aria-label="Current provider status"
            >
              {selected.status === "degraded" ||
              selected.status === "error" ? (
                <CircleAlert aria-hidden="true" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              <div>
                <strong>{sentence(selected.status)}</strong>
                <span>{statusDetail(selected)}</span>
              </div>
            </section>

            <label className="consent-control">
              <input
                type="checkbox"
                checked={draft.optedIn}
                onChange={(event) => updateDraft("optedIn", event.target.checked)}
              />
              <span>
                <strong>Authorize this provider</strong>
                <small>
                  Vinifera sends only the mapped operational fields after this
                  winery opts in.
                </small>
              </span>
            </label>

            <ConfigurationFields
              type={selected.type}
              draft={draft}
              update={updateDraft}
            />

            <div className="form-field">
              <label htmlFor="sync-frequency">Scheduled sync frequency</label>
              <select
                id="sync-frequency"
                value={draft.syncFrequency}
                onChange={(event) =>
                  updateDraft("syncFrequency", event.target.value)
                }
              >
                <option value="realtime">Real-time events</option>
                <option value="hourly">Hourly batch</option>
                <option value="daily">Daily batch</option>
              </select>
            </div>

            <label className="consent-control consent-control--confirmation">
              <input
                type="checkbox"
                checked={draft.consentConfirmed}
                onChange={(event) =>
                  updateDraft("consentConfirmed", event.target.checked)
                }
              />
              <span>
                <strong>I confirm this winery authorizes data sharing</strong>
                <small>
                  Member consent is still checked per eligible event. Raw PII
                  never enters the Meta network payload; the server hashes
                  eligible source values before transmission.
                </small>
              </span>
            </label>

            <div className="dialog-action-row">
              <button
                className="button button--primary"
                disabled={busy !== null}
              >
                {busy === "save" ? "Saving…" : "Save connection"}
              </button>
              {selected.status === "active" ||
              selected.status === "configured" ||
              selected.status === "degraded" ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy !== null}
                  onClick={() => void runSync()}
                >
                  <RefreshCw aria-hidden="true" />
                  {busy === "sync" ? "Queueing…" : "Sync now"}
                </button>
              ) : null}
              {selected.type === "quickbooks" &&
              selected.status === "active" ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy !== null}
                  onClick={() => void loadReconciliation()}
                >
                  <BookOpenCheck aria-hidden="true" />
                  {busy === "reconcile" ? "Loading…" : "Reconcile month"}
                </button>
              ) : null}
              {selected.type === "avalara" &&
              selected.status === "active" &&
              draft.filingEnabled ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy !== null}
                  onClick={() => void verifyFilingStatus()}
                >
                  <BookOpenCheck aria-hidden="true" />
                  {busy === "filing" ? "Queueing…" : "Verify filing status"}
                </button>
              ) : null}
            </div>

            {reconciliation ? (
              <section className="reconciliation-summary" aria-live="polite">
                <h3>{reconciliation.period} reconciliation</h3>
                <dl>
                  <div>
                    <dt>Vinifera</dt>
                    <dd>{money(reconciliation.viniferaRevenueCents)}</dd>
                  </div>
                  <div>
                    <dt>QuickBooks</dt>
                    <dd>{money(reconciliation.quickbooksRevenueCents)}</dd>
                  </div>
                  <div>
                    <dt>Difference</dt>
                    <dd>{money(reconciliation.differenceCents)}</dd>
                  </div>
                </dl>
              </section>
            ) : null}

            {selected.type === "avalara" ? (
              <section
                className="reconciliation-summary"
                aria-labelledby="avalara-filing-title"
                aria-live="polite"
              >
                <h3 id="avalara-filing-title">Filing verification</h3>
                {filingLoading ? (
                  <p role="status">Loading filing status…</p>
                ) : !filingStatus?.verifiedAt ? (
                  <p>
                    No filing snapshot has been verified yet. Enable filing
                    verification, activate Avalara, then queue a read-only
                    check.
                  </p>
                ) : (
                  <>
                    <dl>
                      <div>
                        <dt>Registration</dt>
                        <dd>
                          {filingStatus.registered
                            ? "Active registration found"
                            : "No active registration"}
                        </dd>
                      </div>
                      <div>
                        <dt>Last verified</dt>
                        <dd>{formatTimestamp(filingStatus.verifiedAt)}</dd>
                      </div>
                      <div>
                        <dt>Freshness</dt>
                        <dd>
                          {filingStatus.stale
                            ? "Verification is stale"
                            : "Current"}
                        </dd>
                      </div>
                    </dl>
                    {filingStatus.registrations.length ? (
                      <div className="data-table-wrap" tabIndex={0}>
                        <table className="data-table integration-log__table">
                          <thead>
                            <tr>
                              <th scope="col">Region</th>
                              <th scope="col">Frequency</th>
                              <th scope="col">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filingStatus.registrations.map((registration) => (
                              <tr key={registration.filingCalendarId}>
                                <th scope="row">{registration.regionCode}</th>
                                <td>
                                  {registration.filingFrequency ?? "Unknown"}
                                </td>
                                <td>{sentence(registration.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p>No current filing registrations were returned.</p>
                    )}
                    {filingStatus.staleRegistrationCount > 0 ? (
                      <p>
                        {filingStatus.staleRegistrationCount} historical
                        registration
                        {filingStatus.staleRegistrationCount === 1 ? "" : "s"}{" "}
                        marked stale by a newer snapshot.
                      </p>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}

            <section className="integration-log" aria-labelledby="sync-log-title">
              <div className="panel-heading panel-heading--split">
                <div>
                  <h3 id="sync-log-title">Recent sync log</h3>
                  <p>Minimized counts and error codes; no provider payloads.</p>
                </div>
              </div>
              {logsLoading ? (
                <p role="status">Loading sync history…</p>
              ) : logs.length ? (
                <div className="data-table-wrap" tabIndex={0}>
                  <table className="data-table integration-log__table">
                    <thead>
                      <tr>
                        <th scope="col">Run</th>
                        <th scope="col">Status</th>
                        <th scope="col">Synced</th>
                        <th scope="col">Failed</th>
                        <th scope="col">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id}>
                          <th scope="row">
                            {log.syncType}
                            <small>{date(log.createdAt)}</small>
                          </th>
                          <td>{sentence(log.status)}</td>
                          <td>{log.recordsSynced}</td>
                          <td>{log.recordsFailed}</td>
                          <td>{log.errorCode ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No sync attempts are recorded.</p>
              )}
            </section>

            {selected.status !== "activation_required" &&
            selected.status !== "disconnected" ? (
              <button
                type="button"
                className="button button--danger"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                {busy === "disconnect"
                  ? "Disconnecting…"
                  : `Disconnect ${PROVIDERS[selected.type].name}`}
              </button>
            ) : null}
            {selected.type === "quickbooks" &&
            selected.status === "activation_required" ? (
              <p className="provider-oauth-note">
                <ExternalLink aria-hidden="true" />
                Saving opens Intuit’s HTTPS authorization page. Vinifera never
                asks for a QuickBooks password.
              </p>
            ) : null}
          </form>
        ) : null}
      </Dialog>
    </StaffShell>
  );
}
