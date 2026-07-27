import { Building2, CreditCard, Grape, Package, Users } from "lucide-react";
import { useCallback, useMemo } from "react";
import { apiRequest } from "../api/client";
import type { OrganizationBrandOverview } from "../api/phase5";
import type { PlanTier } from "../api/types";
import { useRouter } from "../routes/router";
import {
  ActivationBlock,
  ErrorBlock,
  isActivationError,
  LoadingBlock,
} from "../shared/OperationalState";
import { FormFeedback } from "../shared/FormFeedback";
import { StaffShell } from "./StaffShell";
import { useStaffSession } from "./StaffSessionContext";
import { useApiResource } from "./phase2/useApiResource";
import { money } from "./phase2/format";

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

function MetricCard({
  icon,
  label,
  title,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  value: string;
}) {
  return (
    <section className="foundation-card" aria-labelledby={label}>
      <div className="foundation-card__icon foundation-card__icon--wine">
        {icon}
      </div>
      <div>
        <h2 id={label}>{title}</h2>
      </div>
      <dl>
        <div>
          <dt>Value</dt>
          <dd>{value}</dd>
        </div>
      </dl>
    </section>
  );
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

  const loadOverview = useCallback(
    () => apiRequest<OrganizationBrandOverview>("/api/organization/overview"),
    [],
  );
  const overview = useApiResource(loadOverview, [loadOverview]);

  const brandRows = useMemo(() => {
    if (overview.state.status !== "ready") return [];
    return [...overview.state.data.brands].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [overview.state]);

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
        <section
          className="foundation-card"
          aria-labelledby="organization-title"
        >
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

        <section
          className="foundation-card"
          aria-labelledby="subscription-title"
        >
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

      {overview.state.status === "loading" ? (
        <LoadingBlock label="Loading dashboard metrics" />
      ) : overview.state.status === "error" ? (
        isActivationError(overview.state.error) ? (
          <ActivationBlock
            title="Dashboard metrics await data"
            detail="The dashboard API is ready. Add the required environment credentials to activate live metrics."
          />
        ) : (
          <ErrorBlock
            error={overview.state.error}
            onRetry={() => void overview.refresh()}
          />
        )
      ) : (
        <>
          <div className="foundation-grid">
            <MetricCard
              icon={<Users aria-hidden="true" />}
              label="active-members-title"
              title="Active members"
              value={overview.state.data.activeMembers.toLocaleString()}
            />
            <MetricCard
              icon={<CreditCard aria-hidden="true" />}
              label="mrr-title"
              title="Monthly recurring revenue"
              value={money(overview.state.data.monthlyRecurringRevenueCents)}
            />
            <MetricCard
              icon={<Package aria-hidden="true" />}
              label="shipments-title"
              title="Shipments (last 30 days)"
              value={overview.state.data.shipmentsThisPeriod.toLocaleString()}
            />
            <MetricCard
              icon={<Building2 aria-hidden="true" />}
              label="brand-count-title"
              title="Active brands"
              value={overview.state.data.brandCount.toLocaleString()}
            />
          </div>

          {brandRows.length > 0 ? (
            <section
              className="operation-panel"
              aria-labelledby="brand-breakdown-title"
            >
              <div className="operation-panel__header">
                <h2 id="brand-breakdown-title">Brand breakdown</h2>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void overview.refresh()}
                >
                  Refresh
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Brand</th>
                      <th scope="col">Active members</th>
                      <th scope="col">MRR</th>
                      <th scope="col">Shipments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandRows.map((brand) => (
                      <tr key={brand.id}>
                        <th scope="row">{brand.name || "Unnamed"}</th>
                        <td>{brand.activeMembers.toLocaleString()}</td>
                        <td>{money(brand.monthlyRecurringRevenueCents)}</td>
                        <td>{brand.shipmentsThisPeriod.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section
              className="empty-state"
              aria-labelledby="empty-dashboard-title"
            >
              <span className="empty-state__icon" aria-hidden="true">
                <Grape />
              </span>
              <h2 id="empty-dashboard-title">Start the club loop</h2>
              <p>
                Create a club tier, add or import members, schedule a release,
                then process charges and fulfillment from the operation
                screens.
              </p>
            </section>
          )}
        </>
      )}
    </StaffShell>
  );
}
