import { ArrowUpRight, Edit3, Plus, Tags, Users } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { ApiError, apiRequest, patchJson, postJson } from "../../api/client";
import {
  asPageResult,
  type ClubTier,
  type MemberSummary,
  type PageResult,
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
import { money, sentence } from "./format";
import { useApiResource } from "./useApiResource";

interface TierForm {
  name: string;
  description: string;
  price: string;
  billingInterval: ClubTier["billingInterval"];
  bottleCount: string;
  frequency: ClubTier["frequency"];
  upgradePathId: string;
}

const initialTier: TierForm = {
  name: "",
  description: "",
  price: "",
  billingInterval: "quarterly",
  bottleCount: "3",
  frequency: "quarterly",
  upgradePathId: "",
};

function TierFormFields({
  values,
  tiers,
  editingId,
  busy,
  onChange,
  onSubmit,
}: {
  values: TierForm;
  tiers: ClubTier[];
  editingId?: string;
  busy: boolean;
  onChange: (values: TierForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function field(name: keyof TierForm, value: string) {
    onChange({ ...values, [name]: value });
  }
  return (
    <form id="tier-form" className="operation-form" onSubmit={onSubmit}>
      <div className="form-field">
        <label htmlFor="tier-name">Tier name</label>
        <input
          id="tier-name"
          required
          value={values.name}
          onChange={(event) => field("name", event.target.value)}
        />
      </div>
      <div className="form-field">
        <label htmlFor="tier-description">Description</label>
        <textarea
          id="tier-description"
          rows={3}
          value={values.description}
          onChange={(event) => field("description", event.target.value)}
        />
      </div>
      <div className="form-grid form-grid--three">
        <div className="form-field">
          <label htmlFor="tier-price">Membership price</label>
          <div className="money-input">
            <span aria-hidden="true">$</span>
            <input
              id="tier-price"
              required
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={values.price}
              onChange={(event) => field("price", event.target.value)}
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="tier-billing-interval">Billing interval</label>
          <select
            id="tier-billing-interval"
            value={values.billingInterval}
            onChange={(event) =>
              field(
                "billingInterval",
                event.target.value as ClubTier["billingInterval"],
              )
            }
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="tier-bottles">Included bottles</label>
          <input
            id="tier-bottles"
            required
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={values.bottleCount}
            onChange={(event) => field("bottleCount", event.target.value)}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="tier-frequency">Shipment frequency</label>
          <select
            id="tier-frequency"
            value={values.frequency}
            onChange={(event) =>
              field("frequency", event.target.value as ClubTier["frequency"])
            }
          >
            <option value="monthly">Monthly</option>
            <option value="bi_monthly">Every two months</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi_annual">Semi-annual</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="tier-upgrade">Upgrade path</label>
          <select
            id="tier-upgrade"
            value={values.upgradePathId}
            onChange={(event) => field("upgradePathId", event.target.value)}
          >
            <option value="">No upgrade path</option>
            {tiers
              .filter((tier) => tier.id !== editingId)
              .map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <p className="form-legal">
        Price and bottle changes apply to future releases only.
      </p>
      <button className="button button--primary button--wide" disabled={busy}>
        {busy ? "Saving tier…" : editingId ? "Save changes" : "Create tier"}
      </button>
    </form>
  );
}

export function ClubTiersPage() {
  const loadTiers = useCallback(
    () => apiRequest<ClubTier[]>("/api/club-tiers"),
    [],
  );
  const tiers = useApiResource(loadTiers, [loadTiers]);
  const loadMembers = useCallback(
    () =>
      apiRequest<PageResult<MemberSummary> | MemberSummary[]>("/api/members").then(
        asPageResult,
      ),
    [],
  );
  const members = useApiResource(loadMembers, [loadMembers]);
  const [formOpen, setFormOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [assignTier, setAssignTier] = useState<ClubTier | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [form, setForm] = useState<TierForm>(initialTier);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  function createTier() {
    setEditingId(undefined);
    setForm(initialTier);
    setFormOpen(true);
  }

  function editTier(tier: ClubTier) {
    setEditingId(tier.id);
    setForm({
      name: tier.name,
      description: tier.description ?? "",
      price: (tier.priceCents / 100).toFixed(2),
      billingInterval: tier.billingInterval,
      bottleCount: String(tier.bottleCount),
      frequency: tier.frequency,
      upgradePathId: tier.upgradePathId ?? "",
    });
    setFormOpen(true);
  }

  function openAssignment(tier: ClubTier) {
    setAssignTier(tier);
    setSelectedMembers([]);
    setAssignOpen(true);
  }

  async function saveTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const body = {
      name: form.name,
      description: form.description || null,
      priceCents: Math.round(Number(form.price) * 100),
      billingInterval: form.billingInterval,
      bottleCount: Number(form.bottleCount),
      frequency: form.frequency,
      upgradePathId: form.upgradePathId || null,
    };
    try {
      if (editingId) {
        await patchJson(`/api/club-tiers/${editingId}`, body);
      } else {
        await postJson("/api/club-tiers", body);
      }
      setFormOpen(false);
      setFeedback({
        message: editingId ? "Future tier terms updated." : "Club tier created.",
        kind: "success",
      });
      await tiers.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The tier could not be saved.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function assignMembers() {
    if (!assignTier || !selectedMembers.length) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson(`/api/club-tiers/${assignTier.id}/assign`, {
        memberIds: selectedMembers,
      });
      setAssignOpen(false);
      setFeedback({
        message: `${selectedMembers.length} member${
          selectedMembers.length === 1 ? "" : "s"
        } assigned to ${assignTier.name}.`,
        kind: "success",
      });
      await Promise.all([tiers.refresh(), members.refresh()]);
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "Members could not be assigned.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const tierList = tiers.state.status === "ready" ? tiers.state.data : [];
  const memberList =
    members.state.status === "ready" ? members.state.data.items : [];

  return (
    <StaffShell
      title="Club Tiers"
      eyebrow="Club Operations"
      actions={
        <button
          type="button"
          className="button button--primary button--compact"
          onClick={createTier}
        >
          <Plus aria-hidden="true" />
          <span>Create Tier</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Membership architecture</p>
          <h2>Club tiers</h2>
          <p>
            Define recurring value, included bottles, frequency, and upgrade
            paths.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>

      {tiers.state.status === "loading" ? (
        <LoadingBlock label="Loading club tiers" />
      ) : tiers.state.status === "error" ? (
        isActivationError(tiers.state.error) ? (
          <ActivationBlock
            title="Club tiers are ready to connect"
            detail="Deploy the Phase 2 tier API and database migration to activate this screen."
          />
        ) : (
          <ErrorBlock error={tiers.state.error} onRetry={() => void tiers.refresh()} />
        )
      ) : tiers.state.data.length === 0 ? (
        <EmptyBlock
          title="Create your first club tier"
          detail="Tiers must exist before members can be assigned and releases can be scheduled."
          action={
            <button type="button" className="button button--primary" onClick={createTier}>
              <Plus aria-hidden="true" />
              Create tier
            </button>
          }
        />
      ) : (
        <div className="tier-grid">
          {tiers.state.data.map((tier) => (
            <article className="tier-card" key={tier.id}>
              <header className="tier-card__header">
                <span className="tier-card__icon" aria-hidden="true">
                  <Tags />
                </span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => editTier(tier)}
                  aria-label={`Edit ${tier.name}`}
                >
                  <Edit3 aria-hidden="true" />
                </button>
              </header>
              <p className="eyebrow eyebrow--wine">{sentence(tier.frequency)}</p>
              <h2>{tier.name}</h2>
              <p>{tier.description || "No description has been added."}</p>
              <div className="tier-card__price">
                <strong>{money(tier.priceCents)}</strong>
                <span>per {tier.billingInterval}</span>
              </div>
              <dl>
                <div>
                  <dt>Included</dt>
                  <dd>{tier.bottleCount} bottles</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{tier.memberCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Upgrade path</dt>
                  <dd>
                    {tier.upgradePathId
                      ? tierList.find((item) => item.id === tier.upgradePathId)?.name ??
                        "Configured"
                      : "None"}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="button button--secondary button--wide"
                onClick={() => openAssignment(tier)}
              >
                <Users aria-hidden="true" />
                Assign members
                <ArrowUpRight aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}

      <Dialog
        open={formOpen}
        title={editingId ? "Edit club tier" : "Create club tier"}
        description="Tier changes are versioned for future releases."
        onClose={() => setFormOpen(false)}
      >
        <TierFormFields
          values={form}
          tiers={tierList}
          editingId={editingId}
          busy={busy}
          onChange={setForm}
          onSubmit={saveTier}
        />
      </Dialog>

      <Dialog
        open={assignOpen}
        title={`Assign members${assignTier ? ` to ${assignTier.name}` : ""}`}
        description="Only selected members will move to this tier."
        onClose={() => setAssignOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setAssignOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void assignMembers()}
              disabled={busy || selectedMembers.length === 0}
            >
              {busy ? "Assigning…" : `Assign ${selectedMembers.length || ""} members`}
            </button>
          </>
        }
      >
        {members.state.status === "loading" ? (
          <LoadingBlock label="Loading members" />
        ) : members.state.status === "error" ? (
          <ErrorBlock error={members.state.error} onRetry={() => void members.refresh()} />
        ) : memberList.length === 0 ? (
          <EmptyBlock
            title="No members to assign"
            detail="Add or import members before assigning this tier."
          />
        ) : (
          <fieldset className="selection-list">
            <legend className="sr-only">Members to assign</legend>
            {memberList.map((member) => (
              <label key={member.id}>
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(member.id)}
                  onChange={(event) =>
                    setSelectedMembers((current) =>
                      event.target.checked
                        ? [...current, member.id]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                <span>
                  <strong>
                    {member.firstName} {member.lastName}
                  </strong>
                  <small>
                    {member.email} · {member.tier?.name ?? "Unassigned"}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Dialog>
    </StaffShell>
  );
}
