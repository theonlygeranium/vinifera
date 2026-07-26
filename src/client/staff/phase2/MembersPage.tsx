import {
  ChevronLeft,
  Download,
  Mail,
  PauseCircle,
  Phone,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRound,
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
  type ClubTier,
  type MemberDetail,
  type MemberStatus,
  type MemberSummary,
  type PageResult,
} from "../../api/phase2";
import { Link, useRouter } from "../../routes/router";
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
import { useStaffSession } from "../StaffSessionContext";
import { MemberChurnFactors } from "../phase3/ChurnWatchPage";
import { date, money, sentence } from "./format";
import { useApiResource } from "./useApiResource";

interface MemberFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthday: string;
  referredByMemberId: string;
  tierId: string;
  status: MemberStatus;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

const initialMember: MemberFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  birthday: "",
  referredByMemberId: "",
  tierId: "",
  status: "active",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
};

function statusClass(status: string) {
  return `status-pill status-pill--${status}`;
}

function MemberForm({
  values,
  tiers,
  busy,
  submitLabel,
  referrerOptions,
  excludeReferrerId,
  onChange,
  onSubmit,
}: {
  values: MemberFormValues;
  tiers: ClubTier[];
  busy: boolean;
  submitLabel: string;
  referrerOptions: MemberSummary[];
  excludeReferrerId?: string;
  onChange: (values: MemberFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function field(name: keyof MemberFormValues, value: string) {
    onChange({ ...values, [name]: value });
  }
  return (
    <form id="member-form" className="operation-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="member-first-name">First name</label>
          <input
            id="member-first-name"
            required
            autoComplete="given-name"
            value={values.firstName}
            onChange={(event) => field("firstName", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="member-last-name">Last name</label>
          <input
            id="member-last-name"
            required
            autoComplete="family-name"
            value={values.lastName}
            onChange={(event) => field("lastName", event.target.value)}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="member-birthday">Birthday (optional)</label>
          <input
            id="member-birthday"
            type="date"
            value={values.birthday}
            onChange={(event) => field("birthday", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="member-referrer">Referred by (optional)</label>
          <select
            id="member-referrer"
            value={values.referredByMemberId}
            onChange={(event) =>
              field("referredByMemberId", event.target.value)
            }
          >
            <option value="">No referring member</option>
            {referrerOptions
              .filter((member) => member.id !== excludeReferrerId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.firstName} {member.lastName} · {member.email}
                </option>
              ))}
          </select>
          <p className="field-message">
            Referral points are awarded by the server after eligibility checks.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="member-email">Email</label>
          <input
            id="member-email"
            required
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => field("email", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="member-phone">Phone</label>
          <input
            id="member-phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(event) => field("phone", event.target.value)}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="member-tier">Club tier</label>
          <select
            id="member-tier"
            required
            value={values.tierId}
            onChange={(event) => field("tierId", event.target.value)}
          >
            <option value="">Select a tier</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="member-status">Status</label>
          <select
            id="member-status"
            value={values.status}
            onChange={(event) =>
              field("status", event.target.value as MemberStatus)
            }
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <fieldset className="operation-fieldset">
        <legend>Shipping address</legend>
        <div className="form-field">
          <label htmlFor="member-address-1">Address line 1</label>
          <input
            id="member-address-1"
            required
            autoComplete="address-line1"
            value={values.line1}
            onChange={(event) => field("line1", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="member-address-2">Address line 2 (optional)</label>
          <input
            id="member-address-2"
            autoComplete="address-line2"
            value={values.line2}
            onChange={(event) => field("line2", event.target.value)}
          />
        </div>
        <div className="form-grid form-grid--address">
          <div className="form-field">
            <label htmlFor="member-city">City</label>
            <input
              id="member-city"
              required
              autoComplete="address-level2"
              value={values.city}
              onChange={(event) => field("city", event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="member-state">State</label>
            <input
              id="member-state"
              required
              maxLength={2}
              autoComplete="address-level1"
              value={values.state}
              onChange={(event) => field("state", event.target.value.toUpperCase())}
            />
          </div>
          <div className="form-field">
            <label htmlFor="member-postal-code">ZIP code</label>
            <input
              id="member-postal-code"
              required
              autoComplete="postal-code"
              value={values.postalCode}
              onChange={(event) => field("postalCode", event.target.value)}
            />
          </div>
        </div>
      </fieldset>
      <button className="button button--primary button--wide" disabled={busy}>
        {busy ? "Saving member…" : submitLabel}
      </button>
    </form>
  );
}

export function MembersPage() {
  const { navigate } = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [tierId, setTierId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [allBatch, setAllBatch] = useState<"pause" | "resume" | null>(null);
  const [memberForm, setMemberForm] = useState(initialMember);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  const loadMembers = useCallback(
    () =>
      apiRequest<PageResult<MemberSummary> | MemberSummary[]>(
        queryPath("/api/members", {
          search: query || undefined,
          status: status || undefined,
          tierId: tierId || undefined,
        }),
      ).then(asPageResult),
    [query, status, tierId],
  );
  const members = useApiResource(loadMembers, [loadMembers]);
  const loadTiers = useCallback(
    () => apiRequest<ClubTier[]>("/api/club-tiers"),
    [],
  );
  const tiers = useApiResource(loadTiers, [loadTiers]);

  const allSelected = useMemo(
    () =>
      Boolean(members.state.status === "ready" && members.state.data.items.length) &&
      members.state.status === "ready" &&
      members.state.data.items.every((member) => selected.includes(member.id)),
    [members.state, selected],
  );

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await postJson<MemberSummary>("/api/members", {
        firstName: memberForm.firstName,
        lastName: memberForm.lastName,
        email: memberForm.email,
        phone: memberForm.phone || null,
        birthday: memberForm.birthday || null,
        referredByMemberId: memberForm.referredByMemberId || null,
        tierId: memberForm.tierId,
        status: memberForm.status,
        address: {
          line1: memberForm.line1,
          line2: memberForm.line2 || null,
          city: memberForm.city,
          state: memberForm.state,
          postalCode: memberForm.postalCode,
          country: "US",
        },
      });
      setAddOpen(false);
      setMemberForm(initialMember);
      setFeedback({ message: "Member added to the live club roster.", kind: "success" });
      await members.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The member could not be saved.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function batch(action: "pause" | "resume") {
    if (!selected.length) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson("/api/members/batch", { memberIds: selected, action });
      setFeedback({
        message: `${selected.length} member${selected.length === 1 ? "" : "s"} updated.`,
        kind: "success",
      });
      setSelected([]);
      await members.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The batch update failed.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function exportMembers() {
    setBusy(true);
    setFeedback(null);
    try {
      await downloadApiFile(
        queryPath("/api/members/export", {
          search: query || undefined,
          status: status || undefined,
          tierId: tierId || undefined,
        }),
        "vinifera-members.csv",
      );
    } catch (error) {
      setFeedback({
        message: error instanceof ApiError ? error.message : "Export failed.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const tierOptions = tiers.state.status === "ready" ? tiers.state.data : [];
  const memberRows =
    members.state.status === "ready" ? members.state.data.items : [];

  async function batchAll() {
    if (!allBatch) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson("/api/members/batch", {
        action: allBatch,
        scope: "all",
      });
      setFeedback({
        message:
          allBatch === "pause"
            ? "All eligible active members were paused."
            : "All eligible paused members were reactivated.",
        kind: "success",
      });
      setAllBatch(null);
      setSelected([]);
      await members.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The roster-wide update failed.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell
      title="Members"
      eyebrow="Club Operations"
      actions={
        <>
          <Link className="button button--secondary button--compact" to="/app/import">
            <Upload aria-hidden="true" />
            <span>Import CSV</span>
          </Link>
          <button
            type="button"
            className="button button--primary button--compact"
            onClick={() => setAddOpen(true)}
          >
            <Plus aria-hidden="true" />
            <span>Add Member</span>
          </button>
        </>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Member CRM</p>
          <h2>Club roster</h2>
          <p>Search, update, assign, and export your winery’s live members.</p>
        </div>
        {members.state.status === "ready" ? (
          <strong>{members.state.data.total.toLocaleString()} members</strong>
        ) : null}
      </div>

      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>

      <section className="operation-panel" aria-labelledby="member-filters">
        <h2 id="member-filters" className="sr-only">
          Filter members
        </h2>
        <div className="operation-toolbar">
          <div className="search-control">
            <Search aria-hidden="true" />
            <label className="sr-only" htmlFor="member-search">
              Search members by name or email
            </label>
            <input
              id="member-search"
              type="search"
              placeholder="Search name or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="form-field form-field--inline">
            <label htmlFor="member-status-filter">Status</label>
            <select
              id="member-status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-field form-field--inline">
            <label htmlFor="member-tier-filter">Tier</label>
            <select
              id="member-tier-filter"
              value={tierId}
              onChange={(event) => setTierId(event.target.value)}
            >
              <option value="">All tiers</option>
              {tierOptions.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={exportMembers}
            disabled={busy}
          >
            <Download aria-hidden="true" />
            Export
          </button>
        </div>
        <div className="roster-actions">
          <span>Roster-wide actions</span>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => setAllBatch("pause")}
            disabled={busy}
          >
            <PauseCircle aria-hidden="true" />
            Pause all
          </button>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => setAllBatch("resume")}
            disabled={busy}
          >
            <PlayCircle aria-hidden="true" />
            Resume all
          </button>
        </div>

        {selected.length ? (
          <div className="batch-bar" aria-live="polite">
            <strong>{selected.length} selected</strong>
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={() => void batch("pause")}
              disabled={busy}
            >
              <PauseCircle aria-hidden="true" />
              Pause
            </button>
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={() => void batch("resume")}
              disabled={busy}
            >
              <PlayCircle aria-hidden="true" />
              Reactivate
            </button>
          </div>
        ) : null}

        {members.state.status === "loading" ? (
          <LoadingBlock label="Loading members" />
        ) : members.state.status === "error" ? (
          isActivationError(members.state.error) ? (
            <ActivationBlock
              title="Member CRM is ready to connect"
              detail="Deploy the Phase 2 member API and Supabase migration to activate this roster."
            />
          ) : (
            <ErrorBlock error={members.state.error} onRetry={() => void members.refresh()} />
          )
        ) : members.state.data.items.length === 0 ? (
          <EmptyBlock
            title="No members match this view"
            detail={
              query || status || tierId
                ? "Clear a filter or add a member to this segment."
                : "Add your first member or import a CSV to begin the club loop."
            }
            action={
              <button
                type="button"
                className="button button--primary"
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden="true" />
                Add member
              </button>
            }
          />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <caption>Winery members matching the current filters</caption>
              <thead>
                <tr>
                  <th scope="col" className="selection-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all visible members"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? memberRows.map((member) => member.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th scope="col">Member</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Lifetime value</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {memberRows.map((member) => (
                  <tr key={member.id}>
                    <td className="selection-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${member.firstName} ${member.lastName}`}
                        checked={selected.includes(member.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, member.id]
                              : current.filter((id) => id !== member.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Link className="table-primary" to={`/app/members/${member.id}`}>
                        {member.firstName} {member.lastName}
                      </Link>
                      <small>{member.email}</small>
                    </td>
                    <td>{member.tier?.name ?? "Unassigned"}</td>
                    <td>
                      <span className={statusClass(member.status)}>
                        {sentence(member.status)}
                      </span>
                    </td>
                    <td>{date(member.joinedAt)}</td>
                    <td>{money(member.lifetimeValueCents)}</td>
                    <td className="table-actions">
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        onClick={() => navigate(`/app/members/${member.id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={addOpen}
        title="Add member"
        description="Create a live member record and assign the first club tier."
        onClose={() => setAddOpen(false)}
      >
        <MemberForm
          values={memberForm}
          tiers={tierOptions}
          busy={busy}
          submitLabel="Add member"
          referrerOptions={memberRows}
          onChange={setMemberForm}
          onSubmit={saveMember}
        />
      </Dialog>
      <Dialog
        open={Boolean(allBatch)}
        title={allBatch === "pause" ? "Pause all active members?" : "Resume all paused members?"}
        description="This roster-wide action applies to eligible members across the organization, not only the current page or filters."
        onClose={() => setAllBatch(null)}
        footer={
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setAllBatch(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void batchAll()}
              disabled={busy}
            >
              {busy
                ? "Updating roster…"
                : allBatch === "pause"
                  ? "Confirm pause all"
                  : "Confirm resume all"}
            </button>
          </>
        }
      >
        <p className="muted-copy">
          Cancelled members remain cancelled. Every resulting status transition
          is recorded in the audit log.
        </p>
      </Dialog>
    </StaffShell>
  );
}

export function MemberDetailPage({ memberId }: { memberId: string }) {
  const { navigate } = useRouter();
  const { session } = useStaffSession();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);
  const load = useCallback(
    () => apiRequest<MemberDetail>(`/api/members/${memberId}`),
    [memberId],
  );
  const member = useApiResource(load, [load]);
  const loadTiers = useCallback(
    () => apiRequest<ClubTier[]>("/api/club-tiers"),
    [],
  );
  const tiers = useApiResource(loadTiers, [loadTiers]);
  const loadReferrers = useCallback(
    () =>
      apiRequest<PageResult<MemberSummary> | MemberSummary[]>(
        queryPath("/api/members", { limit: "100" }),
      ).then(asPageResult),
    [],
  );
  const referrers = useApiResource(loadReferrers, [loadReferrers]);

  async function transition(status: MemberStatus) {
    setBusy(true);
    setFeedback(null);
    try {
      await patchJson(`/api/members/${memberId}`, { status });
      setFeedback({
        message: `Member status changed to ${sentence(status)}.`,
        kind: "success",
      });
      await member.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The status could not be updated.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const record = member.state.status === "ready" ? member.state.data : null;
  const tierOptions = tiers.state.status === "ready" ? tiers.state.data : [];
  const [form, setForm] = useState(initialMember);

  function openEdit() {
    if (!record) return;
    setForm({
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      phone: record.phone ?? "",
      birthday: record.birthday ?? "",
      referredByMemberId:
        record.referredByMemberId === memberId
          ? ""
          : (record.referredByMemberId ?? ""),
      tierId: record.tier?.id ?? "",
      status: record.status,
      line1: record.address?.line1 ?? "",
      line2: record.address?.line2 ?? "",
      city: record.address?.city ?? "",
      state: record.address?.state ?? "",
      postalCode: record.address?.postalCode ?? "",
    });
    setEditOpen(true);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await patchJson(`/api/members/${memberId}`, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || null,
        birthday: form.birthday || null,
        referredByMemberId:
          form.referredByMemberId && form.referredByMemberId !== memberId
            ? form.referredByMemberId
            : null,
        tierId: form.tierId,
        status: form.status,
        address: {
          line1: form.line1,
          line2: form.line2 || null,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          country: "US",
        },
      });
      setEditOpen(false);
      setFeedback({ message: "Member profile updated.", kind: "success" });
      await member.refresh();
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError ? error.message : "The member could not be updated.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteMember() {
    setBusy(true);
    setDeleteError(null);
    try {
      await apiRequest(`/api/members/${memberId}`, { method: "DELETE" });
      navigate("/app/members", {
        replace: true,
        state: { notice: "Member record deleted." },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setDeleteError(
          "This member has shipment or payment history and cannot be deleted. Change the member status to Cancelled to preserve the audit trail.",
        );
      } else {
        setDeleteError(
          error instanceof ApiError
            ? error.message
            : "The member could not be deleted.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell
      title={record ? `${record.firstName} ${record.lastName}` : "Member detail"}
      eyebrow="Members"
      actions={
        <Link className="button button--secondary button--compact" to="/app/members">
          <ChevronLeft aria-hidden="true" />
          <span>All Members</span>
        </Link>
      }
    >
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>
      {member.state.status === "loading" ? (
        <LoadingBlock label="Loading member profile" />
      ) : member.state.status === "error" ? (
        isActivationError(member.state.error) ? (
          <ActivationBlock
            title="Member detail is ready to connect"
            detail="Deploy the member detail endpoint to activate this profile."
          />
        ) : (
          <ErrorBlock error={member.state.error} onRetry={() => void member.refresh()} />
        )
      ) : (
        <>
          <section className="member-profile-card" aria-labelledby="member-profile-name">
            <span className="member-profile-card__avatar" aria-hidden="true">
              <UserRound />
            </span>
            <div className="member-profile-card__identity">
              <p className="eyebrow eyebrow--wine">
                {member.state.data.membershipNumber ?? "Club member"}
              </p>
              <h2 id="member-profile-name">
                {member.state.data.firstName} {member.state.data.lastName}
              </h2>
              <div className="contact-links">
                <a href={`mailto:${member.state.data.email}`}>
                  <Mail aria-hidden="true" />
                  {member.state.data.email}
                </a>
                {member.state.data.phone ? (
                  <a href={`tel:${member.state.data.phone}`}>
                    <Phone aria-hidden="true" />
                    {member.state.data.phone}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="member-profile-card__actions">
              <span className={statusClass(member.state.data.status)}>
                {sentence(member.state.data.status)}
              </span>
              <button
                type="button"
                className="button button--secondary"
                onClick={openEdit}
              >
                Edit profile
              </button>
              {member.state.data.status === "active" ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void transition("paused")}
                  disabled={busy}
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void transition("active")}
                  disabled={busy}
                >
                  Reactivate
                </button>
              )}
              {["owner", "admin", "super_admin"].includes(
                session?.user?.role ?? "",
              ) ? (
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </button>
              ) : null}
            </div>
          </section>

          <div className="metric-grid">
            <article className="metric-card">
              <span>Club tier</span>
              <strong>{member.state.data.tier?.name ?? "Unassigned"}</strong>
              <small>Joined {date(member.state.data.joinedAt)}</small>
            </article>
            <article className="metric-card">
              <span>Lifetime value</span>
              <strong>{money(member.state.data.lifetimeValueCents)}</strong>
              <small>{member.state.data.orderCount ?? 0} recorded orders</small>
            </article>
            <article className="metric-card">
              <span>Churn risk</span>
              <strong>
                {member.state.data.churnRisk === "not_scored" ||
                !member.state.data.churnRisk
                  ? "Not scored"
                  : sentence(member.state.data.churnRisk)}
              </strong>
              <small>Scoring activates in Phase 3</small>
            </article>
            <article className="metric-card">
              <span>Next release</span>
              <strong>{date(member.state.data.nextReleaseAt)}</strong>
              <small>Based on scheduled tier releases</small>
            </article>
          </div>

          <MemberChurnFactors memberId={memberId} />

          <div className="detail-grid">
            <section className="operation-panel" aria-labelledby="member-activity-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow eyebrow--wine">Timeline</p>
                  <h2 id="member-activity-title">Activity</h2>
                </div>
              </div>
              {member.state.data.activity?.length ? (
                <ol className="activity-list">
                  {member.state.data.activity.map((activity) => (
                    <li key={activity.id}>
                      <span aria-hidden="true" />
                      <div>
                        <strong>{activity.title}</strong>
                        {activity.detail ? <p>{activity.detail}</p> : null}
                        <time dateTime={activity.occurredAt}>
                          {date(activity.occurredAt)}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyBlock
                  title="No activity recorded"
                  detail="Orders, status changes, payments, shipments, and communications will appear here."
                />
              )}
            </section>
            <aside className="operation-panel" aria-labelledby="shipping-address-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow eyebrow--wine">Fulfillment</p>
                  <h2 id="shipping-address-title">Shipping address</h2>
                </div>
              </div>
              {member.state.data.address ? (
                <address className="address-block">
                  {member.state.data.firstName} {member.state.data.lastName}
                  <br />
                  {member.state.data.address.line1}
                  <br />
                  {member.state.data.address.line2 ? (
                    <>
                      {member.state.data.address.line2}
                      <br />
                    </>
                  ) : null}
                  {member.state.data.address.city}, {member.state.data.address.state}{" "}
                  {member.state.data.address.postalCode}
                </address>
              ) : (
                <p className="muted-copy">No shipping address is on file.</p>
              )}
            </aside>
          </div>
        </>
      )}

      <Dialog
        open={editOpen}
        title="Edit member"
        description="Updates affect this member’s future club activity."
        onClose={() => setEditOpen(false)}
      >
        <MemberForm
          values={form}
          tiers={tierOptions}
          busy={busy}
          submitLabel="Save changes"
          referrerOptions={
            referrers.state.status === "ready" ? referrers.state.data.items : []
          }
          excludeReferrerId={memberId}
          onChange={setForm}
          onSubmit={saveEdit}
        />
      </Dialog>
      <Dialog
        open={deleteOpen}
        title="Delete this member?"
        description="Deletion is only permitted for records with no shipment or payment history."
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setDeleteOpen(false)}
            >
              Keep member
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => void deleteMember()}
              disabled={busy}
            >
              <Trash2 aria-hidden="true" />
              {busy ? "Deleting…" : "Delete member"}
            </button>
          </>
        }
      >
        <div aria-live="assertive">
          <FormFeedback message={deleteError} />
        </div>
        <p className="muted-copy">
          If this member has historical activity, use Cancelled status instead so
          financial and fulfillment records remain intact.
        </p>
      </Dialog>
    </StaffShell>
  );
}
