import { Building2, CreditCard, Grape } from "lucide-react";
import type { PlanTier } from "../api/types";
import { useRouter } from "../routes/router";
import { FormFeedback } from "../shared/FormFeedback";
import { StaffShell } from "./StaffShell";
import { useStaffSession } from "./StaffSessionContext";

const planNames: Record<PlanTier, string> = {
  vine: "Vine",
  cellar: "Cellar",
  estate: "Estate",
  reserve: "Reserve",
};

function sentenceCase(value?: string | null) {
  if (!value) return "Not configured";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function StaffDashboard() {
  const { location } = useRouter();
  const { session } = useStaffSession();
  const notice =
    typeof location.state === "object" &&
    location.state !== null &&
    "notice" in location.state &&
    typeof location.state.notice === "string"
      ? location.state.notice
      : null;
  const user = session?.user;
  const organization = session?.organization;

  return (
    <StaffShell title="Dashboard">
      <FormFeedback message={notice} kind="success" />
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div>
          <p className="eyebrow">Workspace ready</p>
          <h2 id="welcome-title">
            {organization?.name
              ? `Welcome to ${organization.name}`
              : "Welcome to Vinifera"}
          </h2>
          <p>
            Run the complete club loop from member onboarding through release
            billing and fulfillment.
          </p>
        </div>
        <span className="welcome-panel__mark" aria-hidden="true">
          <Grape />
        </span>
      </section>

      <div className="foundation-grid">
        <section className="foundation-card" aria-labelledby="organization-title">
          <div className="foundation-card__icon foundation-card__icon--wine">
            <Building2 aria-hidden="true" />
          </div>
          <div>
            <h2 id="organization-title">Organization</h2>
            <p>Your staff workspace is isolated to one winery tenant.</p>
          </div>
          <dl>
            <div>
              <dt>Name</dt>
              <dd>{organization?.name ?? "Pending setup"}</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd>{sentenceCase(user?.role)}</dd>
            </div>
          </dl>
        </section>

        <section className="foundation-card" aria-labelledby="subscription-title">
          <div className="foundation-card__icon foundation-card__icon--gold">
            <CreditCard aria-hidden="true" />
          </div>
          <div>
            <h2 id="subscription-title">Subscription</h2>
            <p>Billing status is synchronized from Stripe test mode.</p>
          </div>
          <dl>
            <div>
              <dt>Plan</dt>
              <dd>
                {organization?.planTier
                  ? planNames[organization.planTier]
                  : "Not selected"}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{sentenceCase(organization?.subscriptionStatus)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="empty-state" aria-labelledby="empty-dashboard-title">
        <span className="empty-state__icon" aria-hidden="true">
          <Grape />
        </span>
        <h2 id="empty-dashboard-title">Start the club loop</h2>
        <p>
          Create a club tier, add or import members, schedule a release, then
          process charges and fulfillment from the operation screens.
        </p>
      </section>
    </StaffShell>
  );
}
