import {
  CalendarCheck,
  Coins,
  Gift,
  MinusCircle,
  PlusCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { ApiError, apiRequest, postJson } from "../../api/client";
import {
  type LoyaltyAccount,
  type LoyaltyMembersResult,
  normalizeLoyaltyAccount,
} from "../../api/phase3";
import { asPageResult, queryPath } from "../../api/phase2";
import { Link } from "../../routes/router";
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
import { date, money, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";

function points(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function LoyaltyPage() {
  const [search, setSearch] = useState("");
  const loadMembers = useCallback(
    () =>
      apiRequest<LoyaltyMembersResult>(
        queryPath("/api/loyalty/members", {
          search: search || undefined,
        }),
      ).then(asPageResult),
    [search],
  );
  const members = useApiResource(loadMembers, [loadMembers]);
  const memberList =
    members.state.status === "ready" ? members.state.data.items : [];
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const activeMemberId =
    selectedMemberId &&
    memberList.some((member) => member.memberId === selectedMemberId)
      ? selectedMemberId
      : (memberList[0]?.memberId ?? null);
  const loadAccount = useCallback(
    () =>
      activeMemberId
        ? apiRequest<LoyaltyAccount>(
            `/api/loyalty/members/${activeMemberId}`,
          ).then(normalizeLoyaltyAccount)
        : Promise.resolve(null),
    [activeMemberId],
  );
  const account = useApiResource<LoyaltyAccount | null>(loadAccount, [
    loadAccount,
  ]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [reason, setReason] = useState("");
  const [eventId, setEventId] = useState("");
  const [attendanceReason, setAttendanceReason] = useState("");
  const [attendanceDate, setAttendanceDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);

  const summary = useMemo(
    () => ({
      members: members.state.status === "ready" ? members.state.data.total : 0,
      points: memberList.reduce(
        (total, member) => total + member.availablePoints,
        0,
      ),
      multiplied: memberList.filter((member) => member.multiplier > 1).length,
    }),
    [memberList, members.state],
  );

  async function adjustPoints(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMemberId || Number(adjustment) === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson(`/api/loyalty/members/${activeMemberId}/adjust`, {
        points: Number(adjustment),
        reason,
      });
      setAdjustOpen(false);
      setAdjustment("");
      setReason("");
      setFeedback({
        message: "Loyalty adjustment recorded in the member ledger.",
        kind: "success",
      });
      await Promise.all([members.refresh(), account.refresh()]);
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "The loyalty adjustment could not be recorded.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function openAttendance() {
    setEventId(crypto.randomUUID());
    setAttendanceReason("");
    setAttendanceDate("");
    setAttendanceOpen(true);
  }

  async function recordAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMemberId || !eventId || !attendanceReason.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postJson(`/api/loyalty/members/${activeMemberId}/events`, {
        eventId,
        eventType: "event_attendance",
        reason: attendanceReason.trim(),
        ...(attendanceDate
          ? {
              occurredAt: new Date(
                `${attendanceDate}T12:00:00.000Z`,
              ).toISOString(),
            }
          : {}),
      });
      setAttendanceOpen(false);
      setFeedback({
        message: "Event attendance recorded in the member loyalty ledger.",
        kind: "success",
      });
      await Promise.all([members.refresh(), account.refresh()]);
    } catch (error) {
      setFeedback({
        message:
          error instanceof ApiError
            ? error.message
            : "Event attendance could not be recorded.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const selectedAccount =
    account.state.status === "ready" ? account.state.data : null;

  return (
    <StaffShell
      title="Loyalty & Rewards"
      eyebrow="Member Experience"
      actions={
        <>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={openAttendance}
            disabled={!activeMemberId}
          >
            <CalendarCheck aria-hidden="true" />
            <span>Record Attendance</span>
          </button>
          <button
            type="button"
            className="button button--primary button--compact"
            onClick={() => setAdjustOpen(true)}
            disabled={!activeMemberId}
          >
            <Coins aria-hidden="true" />
            <span>Adjust Points</span>
          </button>
        </>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Points program</p>
          <h2>Loyalty balances and ledger</h2>
          <p>
            Review earned, redeemed, adjusted, and expiring points with tier
            multipliers applied by the server.
          </p>
        </div>
      </div>
      <div className="staff-live-region" aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind === "success" ? "success" : "error"}
        />
      </div>

      {members.state.status === "ready" ? (
        <div className="metric-grid loyalty-metrics">
          <article className="metric-card">
            <span>Loyalty members</span>
            <strong>{summary.members.toLocaleString()}</strong>
            <small>Members with a points account</small>
          </article>
          <article className="metric-card">
            <span>Available points</span>
            <strong>{points(summary.points)}</strong>
            <small>Across the current result set</small>
          </article>
          <article className="metric-card">
            <span>Bonus multiplier</span>
            <strong>{summary.multiplied.toLocaleString()}</strong>
            <small>Members earning above 1×</small>
          </article>
          <article className="metric-card">
            <span>Default redemption</span>
            <strong>100 pts</strong>
            <small>Equals $10 unless winery config changes</small>
          </article>
        </div>
      ) : null}

      {members.state.status === "loading" ? (
        <LoadingBlock label="Loading loyalty members" />
      ) : members.state.status === "error" ? (
        isActivationError(members.state.error) ? (
          <ActivationBlock
            title="Loyalty accounts are ready to connect"
            detail="Deploy the Phase 3 points engine to activate balances, multipliers, expiration, and redemption."
          />
        ) : (
          <ErrorBlock error={members.state.error} onRetry={() => void members.refresh()} />
        )
      ) : memberList.length === 0 ? (
        <EmptyBlock
          title="No loyalty accounts match this view"
          detail="Points accounts are created from live member activity and program rules."
        />
      ) : (
        <div className="loyalty-layout">
          <section className="operation-panel loyalty-member-panel" aria-labelledby="loyalty-members-title">
            <div className="panel-heading">
              <div>
                <h2 id="loyalty-members-title">Member balances</h2>
                <p>Select a member to inspect the full ledger.</p>
              </div>
            </div>
            <div className="search-control loyalty-search">
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="loyalty-search">
                Search loyalty members
              </label>
              <input
                id="loyalty-search"
                type="search"
                placeholder="Search name or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="loyalty-member-list">
              {memberList.map((member) => (
                <button
                  type="button"
                  key={member.memberId}
                  className={
                    activeMemberId === member.memberId
                      ? "loyalty-member-list__item loyalty-member-list__item--active"
                      : "loyalty-member-list__item"
                  }
                  onClick={() => setSelectedMemberId(member.memberId)}
                  aria-pressed={activeMemberId === member.memberId}
                >
                  <span className="avatar" aria-hidden="true">
                    {member.memberName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span>
                    <strong>{member.memberName}</strong>
                    <small>
                      {member.tierName ?? "No tier"} · {member.multiplier}×
                    </small>
                  </span>
                  <b>{points(member.availablePoints)} pts</b>
                </button>
              ))}
            </div>
          </section>

          <section className="operation-panel loyalty-ledger-panel" aria-labelledby="loyalty-ledger-title">
            {account.state.status === "loading" ? (
              <LoadingBlock label="Loading loyalty ledger" />
            ) : account.state.status === "error" ? (
              isActivationError(account.state.error) ? (
                <ActivationBlock
                  title="Member ledger awaits activation"
                  detail="The selected member’s awards and redemptions will appear after the loyalty service is deployed."
                />
              ) : (
                <ErrorBlock
                  error={account.state.error}
                  onRetry={() => void account.refresh()}
                />
              )
            ) : selectedAccount ? (
              <>
                <header className="loyalty-account-header">
                  <div>
                    <p className="eyebrow eyebrow--wine">
                      {selectedAccount.tierName ?? "Loyalty member"} ·{" "}
                      {selectedAccount.multiplier}× earning
                    </p>
                    <h2 id="loyalty-ledger-title">
                      {selectedAccount.memberName}
                    </h2>
                    <Link to={`/app/members/${selectedAccount.memberId}`}>
                      View member profile
                    </Link>
                  </div>
                  <div className="loyalty-balance">
                    <Gift aria-hidden="true" />
                    <span>Available balance</span>
                    <strong>{points(selectedAccount.availablePoints)}</strong>
                    <small>points</small>
                  </div>
                </header>
                <div className="loyalty-account-summary">
                  <div>
                    <span>Pending</span>
                    <strong>{points(selectedAccount.pendingPoints ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Expiring next</span>
                    <strong>{points(selectedAccount.expiringPoints ?? 0)}</strong>
                    <small>{date(selectedAccount.nextExpirationAt)}</small>
                  </div>
                  <div>
                    <span>Redemption value</span>
                    <strong>
                      {points(selectedAccount.redemptionRate.points)} pts ={" "}
                      {money(selectedAccount.redemptionRate.discountCents)}
                    </strong>
                  </div>
                </div>
                {selectedAccount.ledger.length ? (
                  <div
                    className="data-table-wrap"
                    tabIndex={0}
                    aria-label={`Scrollable loyalty ledger for ${selectedAccount.memberName}`}
                  >
                    <table className="data-table loyalty-ledger-table">
                      <caption>
                        Loyalty points ledger for {selectedAccount.memberName}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Activity</th>
                          <th scope="col">Type</th>
                          <th scope="col">Points</th>
                          <th scope="col">Recorded</th>
                          <th scope="col">Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAccount.ledger.map((entry) => (
                          <tr key={entry.id}>
                            <td>{entry.reason}</td>
                            <td>{sentence(entry.type)}</td>
                            <td>
                              <span
                                className={
                                  entry.points >= 0
                                    ? "points-change points-change--positive"
                                    : "points-change points-change--negative"
                                }
                              >
                                {entry.points >= 0 ? "+" : ""}
                                {points(entry.points)}
                              </span>
                            </td>
                            <td>{date(entry.createdAt)}</td>
                            <td>{date(entry.expiresAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyBlock
                    title="No loyalty activity"
                    detail="Awards, manual adjustments, redemptions, and expirations will appear here."
                  />
                )}
              </>
            ) : (
              <EmptyBlock
                title="Select a member"
                detail="Choose a loyalty account to inspect its balance and ledger."
              />
            )}
          </section>
        </div>
      )}

      <section className="integration-banner loyalty-rules-note" aria-labelledby="loyalty-rules-title">
        <Sparkles aria-hidden="true" />
        <div>
          <h2 id="loyalty-rules-title">Server-enforced loyalty rules</h2>
          <p>
            Shipment, event, referral, birthday, anniversary, tier multiplier,
            24-month expiration, and redemption rules are calculated by the
            audited points engine—not in the browser.
          </p>
        </div>
      </section>

      <Dialog
        open={attendanceOpen}
        title="Record event attendance"
        description="Record a verified winery event once; duplicate submissions use the same idempotency key."
        onClose={() => setAttendanceOpen(false)}
      >
        <form className="operation-form" onSubmit={recordAttendance}>
          <div className="form-field">
            <label htmlFor="loyalty-event-reason">Event name or reason</label>
            <input
              id="loyalty-event-reason"
              required
              maxLength={500}
              value={attendanceReason}
              onChange={(event) => setAttendanceReason(event.target.value)}
              placeholder="Summer release tasting"
            />
          </div>
          <div className="form-field">
            <label htmlFor="loyalty-event-date">
              Attendance date (optional)
            </label>
            <input
              id="loyalty-event-date"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={attendanceDate}
              onChange={(event) => setAttendanceDate(event.target.value)}
            />
          </div>
          <p className="form-legal">
            Attendance awards 50 base points. The points engine applies this
            member’s {selectedAccount?.multiplier ?? "current"}× tier multiplier
            and records the staff actor, event, and timestamp.
          </p>
          <button
            type="submit"
            className="button button--primary button--wide"
            disabled={busy || !attendanceReason.trim()}
          >
            <CalendarCheck aria-hidden="true" />
            {busy ? "Recording attendance…" : "Record event attendance"}
          </button>
        </form>
      </Dialog>

      <Dialog
        open={adjustOpen}
        title="Adjust loyalty points"
        description="Use a positive number to award points or a negative number to deduct them."
        onClose={() => setAdjustOpen(false)}
      >
        <form className="operation-form" onSubmit={adjustPoints}>
          <div className="form-field">
            <label htmlFor="loyalty-adjustment">Points adjustment</label>
            <div className="points-input">
              {Number(adjustment) < 0 ? (
                <MinusCircle aria-hidden="true" />
              ) : (
                <PlusCircle aria-hidden="true" />
              )}
              <input
                id="loyalty-adjustment"
                required
                type="number"
                step="1"
                max="100000"
                min="-100000"
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="loyalty-reason">Reason</label>
            <textarea
              id="loyalty-reason"
              required
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <p className="form-legal">
            This adjustment records the signed-in staff member and timestamp in
            the audit log.
          </p>
          <button
            type="submit"
            className="button button--primary button--wide"
            disabled={busy || !adjustment || Number(adjustment) === 0}
          >
            <Coins aria-hidden="true" />
            {busy ? "Recording adjustment…" : "Record adjustment"}
          </button>
        </form>
      </Dialog>
    </StaffShell>
  );
}
