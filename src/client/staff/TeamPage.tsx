import { CircleAlert, Send, UserRoundPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiError, postJson } from "../api/client";
import { FormFeedback } from "../shared/FormFeedback";
import { StaffShell } from "./StaffShell";
import { useStaffSession } from "./StaffSessionContext";

type InvitationRole = "admin" | "manager" | "staff";

interface InvitationResult {
  expiresAt: string;
}

export function TeamPage() {
  const { session } = useStaffSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canManageTeam =
    session?.user?.role === "owner" || session?.user?.role === "admin";

  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canManageTeam) return;

    const normalizedEmail = email.trim().toLowerCase();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await postJson<InvitationResult>("/api/staff/invitations", {
        email: normalizedEmail,
        role,
      });
      setEmail("");
      setSuccess(
        `Invitation sent to ${normalizedEmail}. The secure link expires in 24 hours.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The invitation could not be sent. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canManageTeam) {
    return (
      <StaffShell title="Team" eyebrow="Workspace">
        <section
          className="operation-state operation-state--error"
          role="alert"
          aria-labelledby="team-forbidden-title"
        >
          <span className="operation-state__icon" aria-hidden="true">
            <CircleAlert />
          </span>
          <h2 id="team-forbidden-title">Team administration is restricted</h2>
          <p>
            Only organization owners and administrators can invite staff
            members or assign staff roles.
          </p>
        </section>
      </StaffShell>
    );
  }

  return (
    <StaffShell title="Team" eyebrow="Workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Staff access</p>
          <h2>Invite your winery team</h2>
          <p>
            Send a secure, 24-hour invitation and choose the staff member’s
            workspace role.
          </p>
        </div>
      </div>

      <section className="operation-panel" aria-labelledby="team-invite-title">
        <div className="panel-heading">
          <span className="operation-state__icon" aria-hidden="true">
            <UserRoundPlus />
          </span>
          <div>
            <h2 id="team-invite-title">New staff invitation</h2>
            <p>
              The recipient will set a password before entering this
              organization’s workspace.
            </p>
          </div>
        </div>

        <form className="operation-form" onSubmit={inviteStaff}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="team-invite-email">Work email</label>
              <input
                id="team-invite-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="team-invite-role">Role</label>
              <select
                id="team-invite-role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as InvitationRole)
                }
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
              </select>
            </div>
          </div>
          <FormFeedback message={error} />
          <div aria-live="polite">
            <FormFeedback message={success} kind="success" />
          </div>
          <p className="form-legal">
            Owners and admins can invite Admin, Manager, or Staff roles. Owner
            access cannot be delegated from this form.
          </p>
          <button
            className="button button--primary button--wide"
            type="submit"
            disabled={busy}
          >
            <Send aria-hidden="true" />
            {busy ? "Sending invitation…" : "Send invitation"}
          </button>
        </form>
      </section>
    </StaffShell>
  );
}
