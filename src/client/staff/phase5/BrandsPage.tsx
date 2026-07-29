import {
  Building2,
  CreditCard,
  Grape,
  Layers3,
  Plus,
  Users,
  Wine,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { ApiError, apiRequest, patchJson, postJson } from "../../api/client";
import type { Brand, OrganizationBrandOverview } from "../../api/phase5";
import { Dialog } from "../../shared/Dialog";
import { FormFeedback } from "../../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
} from "../../shared/OperationalState";
import { money, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";
import { useStaffSession } from "../StaffSessionContext";
import { StaffShell } from "../StaffShell";
import { useBrandScope } from "./BrandScopeContext";

interface BrandDraft {
  name: string;
  slug: string;
  description: string;
  billingMode: "shared" | "independent";
}

const EMPTY_BRAND: BrandDraft = {
  name: "",
  slug: "",
  description: "",
  billingMode: "shared",
};

export function BrandsPage() {
  const brandScope = useBrandScope();
  const { session } = useStaffSession();
  const canManageBrands =
    session?.user?.role === "owner" || session?.user?.role === "admin";
  const loadOverview = useCallback(() => {
    const scope =
      brandScope.activeBrandId === "all"
        ? "all"
        : (brandScope.activeBrandId ?? "");
    return apiRequest<OrganizationBrandOverview>(
      `/api/organization/overview?brandId=${encodeURIComponent(scope)}`,
    );
  }, [brandScope.activeBrandId]);
  const overview = useApiResource(loadOverview, [loadOverview]);
  const overviewData =
    overview.state.status === "ready" ? overview.state.data : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [draft, setDraft] = useState<BrandDraft>(EMPTY_BRAND);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const activeName = useMemo(() => {
    if (brandScope.activeBrandId === "all") return "All brands";
    return brandScope.activeBrand?.name ?? "Organization";
  }, [brandScope.activeBrand, brandScope.activeBrandId]);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_BRAND);
    setFeedback(null);
    setDialogOpen(true);
  }

  function openEdit(brand: Brand) {
    setEditing(brand);
    setDraft({
      name: brand.name,
      slug: brand.slug ?? "",
      description: brand.description ?? "",
      billingMode: brand.billingMode,
    });
    setFeedback(null);
    setDialogOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageBrands) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (editing) {
        await patchJson(`/api/brands/${editing.id}`, {
          name: draft.name,
          description: draft.description || null,
          billingMode: draft.billingMode,
        });
      } else {
        await postJson("/api/brands", {
          name: draft.name,
          slug: draft.slug,
          description: draft.description || null,
          billingMode: draft.billingMode,
        });
      }
      await brandScope.refresh();
      await overview.refresh();
      setDialogOpen(false);
      setFeedback({
        kind: "success",
        message: editing
          ? "Brand settings updated."
          : "Brand created. Add tiers, members, and releases inside its selected scope.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The brand could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell
      title="Brands"
      eyebrow="Multi-brand tenancy"
      actions={
        canManageBrands ? (
          <button
            type="button"
            className="button button--primary button--compact"
            onClick={openCreate}
          >
            <Plus aria-hidden="true" />
            <span>Add brand</span>
          </button>
        ) : null
      }
    >
      <div aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind ?? "error"}
        />
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Organization control</p>
          <h2>{activeName} overview</h2>
          <p>
            Brand data remains independently scoped. Organization-wide totals
            are available only when the server grants all-brand access.
          </p>
        </div>
      </div>

      {overview.state.status === "loading" ? (
        <LoadingBlock label="Loading brand overview" />
      ) : overview.state.status === "error" ? (
        overview.state.error instanceof ApiError &&
        overview.state.error.status === 503 ? (
          <ActivationBlock
            title="Multi-brand architecture is ready"
            detail="Apply the Phase 5 migration to create the default brand and enable organization-level views."
          />
        ) : (
          <ErrorBlock
            error={overview.state.error}
            onRetry={() => void overview.refresh()}
          />
        )
      ) : overviewData ? (
        <>
          <section className="brand-overview-grid" aria-label="Brand totals">
            <article>
              <Layers3 aria-hidden="true" />
              <span>Brands</span>
              <strong>{overviewData.brandCount}</strong>
            </article>
            <article>
              <Users aria-hidden="true" />
              <span>Active members</span>
              <strong>{overviewData.activeMembers}</strong>
            </article>
            <article>
              <CreditCard aria-hidden="true" />
              <span>Monthly recurring revenue</span>
              <strong>
                {money(overviewData.monthlyRecurringRevenueCents)}
              </strong>
            </article>
            <article>
              <Wine aria-hidden="true" />
              <span>Shipments this period</span>
              <strong>{overviewData.shipmentsThisPeriod}</strong>
            </article>
          </section>

          <section className="operation-panel" aria-labelledby="brand-list-title">
            <div className="panel-heading panel-heading--split">
              <div>
                <p className="eyebrow eyebrow--wine">Club portfolio</p>
                <h2 id="brand-list-title">Managed brands</h2>
                <p>
                  Tiers, members, releases, templates, compliance, and optional
                  billing remain brand-scoped.
                </p>
              </div>
              {canManageBrands ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={openCreate}
                >
                  <Plus aria-hidden="true" />
                  Create brand
                </button>
              ) : null}
            </div>
            {brandScope.status === "loading" ? (
              <p role="status">Loading brand access…</p>
            ) : brandScope.brands.length ? (
              <div className="brand-management-list">
                {brandScope.brands.map((brand) => {
                  const metrics = overviewData.brands.find(
                    (item) => item.id === brand.id,
                  );
                  return (
                    <article key={brand.id}>
                      <span className="brand-management-list__mark" aria-hidden="true">
                        <Building2 />
                      </span>
                      <div>
                        <div className="brand-management-list__title">
                          <h3>{brand.name}</h3>
                          {brand.isDefault ? (
                            <span className="status-pill status-pill--active">
                              Default
                            </span>
                          ) : null}
                          <span
                            className={`status-pill status-pill--${brand.domainStatus}`}
                          >
                            Portal {sentence(brand.domainStatus)}
                          </span>
                        </div>
                        <p>
                          {brand.description ||
                            "No brand description has been added."}
                        </p>
                        <dl>
                          <div>
                            <dt>Members</dt>
                            <dd>{metrics?.activeMembers ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>MRR</dt>
                            <dd>
                              {metrics
                                ? money(metrics.monthlyRecurringRevenueCents)
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>Billing</dt>
                            <dd>
                              {brand.billingMode === "independent"
                                ? "Independent"
                                : "Shared"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="brand-management-list__actions">
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          onClick={() => brandScope.setActiveBrandId(brand.id)}
                        >
                          <Grape aria-hidden="true" />
                          Work in brand
                        </button>
                        {canManageBrands ? (
                          <button
                            type="button"
                            className="button button--ghost button--compact"
                            onClick={() => openEdit(brand)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyBlock
                title="No brand is configured"
                detail="Create the organization’s default club brand before assigning operational data."
                action={canManageBrands ? (
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={openCreate}
                  >
                    Create first brand
                  </button>
                ) : undefined}
              />
            )}
          </section>
        </>
      ) : null}

      <Dialog
        open={dialogOpen && canManageBrands}
        title={editing ? `Edit ${editing.name}` : "Create a brand"}
        description="Brand creation is additive and does not move existing records implicitly."
        onClose={() => setDialogOpen(false)}
      >
        <form className="operation-form" onSubmit={save}>
          <div className="form-field">
            <label htmlFor="brand-name">Brand name</label>
            <input
              id="brand-name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                  slug: editing
                    ? current.slug
                    : event.target.value
                        .toLowerCase()
                        .trim()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                }))
              }
            />
          </div>
          {!editing ? (
            <div className="form-field">
              <label htmlFor="brand-slug">Brand URL slug</label>
              <input
                id="brand-slug"
                required
                maxLength={100}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                value={draft.slug}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    slug: event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ""),
                  }))
                }
              />
              <small>
                Lowercase letters, numbers, and single hyphens only.
              </small>
            </div>
          ) : null}
          <div className="form-field">
            <label htmlFor="brand-description">Description (optional)</label>
            <textarea
              id="brand-description"
              maxLength={500}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <fieldset className="operation-fieldset">
            <legend>Subscription billing</legend>
            <label className="radio-control">
              <input
                type="radio"
                name="billing-mode"
                value="shared"
                checked={draft.billingMode === "shared"}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    billingMode: "shared",
                  }))
                }
              />
              <span>
                <strong>Shared organization subscription</strong>
                <small>Use the winery’s existing Vinifera subscription.</small>
              </span>
            </label>
            <label className="radio-control">
              <input
                type="radio"
                name="billing-mode"
                value="independent"
                checked={draft.billingMode === "independent"}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    billingMode: "independent",
                  }))
                }
              />
              <span>
                <strong>Independent brand subscription</strong>
                <small>
                  Activate a separate Stripe subscription after provider setup.
                </small>
              </span>
            </label>
          </fieldset>
          <button className="button button--primary" disabled={busy}>
            {busy ? "Saving brand…" : editing ? "Save changes" : "Create brand"}
          </button>
        </form>
      </Dialog>
    </StaffShell>
  );
}
