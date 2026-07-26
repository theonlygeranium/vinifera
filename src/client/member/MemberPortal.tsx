import {
  CalendarDays,
  CreditCard,
  Grape,
  History,
  LogOut,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Truck,
  Wine,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, apiRequest, patchJson, postJson } from "../api/client";
import { type Address, type PortalShipment } from "../api/phase2";
import { useRouter } from "../routes/router";
import { Dialog } from "../shared/Dialog";
import { FormFeedback } from "../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  isActivationError,
  LoadingBlock,
} from "../shared/OperationalState";
import { useApiResource } from "../staff/phase2/useApiResource";
import { date, money, sentence } from "../staff/phase2/format";
import { useMemberSession } from "./MemberSessionContext";
import {
  MemberLoyaltyPanel,
  MemberRetentionControls,
} from "./phase3/RetentionLoyalty";
import { useMobileRuntime } from "../mobile/MobileRuntime";
import { clearNativeSession } from "../mobile/native-session";
import { MemberBrand } from "./MemberBranding";
import { MetaPrivacyControl } from "./MetaPrivacyControl";

const blankAddress: Address = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

export function MemberPortal() {
  const { navigate } = useRouter();
  const { session, clear } = useMemberSession();
  const mobile = useMobileRuntime();
  const loadShipments = useCallback(
    () => apiRequest<PortalShipment[]>("/api/member/shipments"),
    [],
  );
  const shipments = useApiResource(loadShipments, [loadShipments]);
  const [addressOpen, setAddressOpen] = useState(false);
  const [address, setAddress] = useState<Address>(blankAddress);
  const [busy, setBusy] = useState<"logout" | "address" | "billing" | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    kind: "error" | "success";
  } | null>(null);
  const paymentPortalAttemptId = useRef<string | null>(null);

  const sortedShipments = useMemo(
    () =>
      shipments.state.status === "ready"
        ? [...shipments.state.data].sort((left, right) =>
            (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
          )
        : [],
    [shipments.state],
  );
  const upcoming = sortedShipments.find((shipment) =>
    ["pending", "charged", "label_created", "packed"].includes(shipment.status),
  );

  async function logout() {
    setBusy("logout");
    setFeedback(null);
    try {
      if (mobile.native) {
        await clearNativeSession();
      } else {
        await postJson("/api/auth/member/logout");
      }
      clear();
      navigate("/portal/login", { replace: true });
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof ApiError
            ? caught.message
            : "We could not sign you out. Please try again.",
        kind: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  function editAddress() {
    setAddress(upcoming?.address ?? blankAddress);
    setAddressOpen(true);
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("address");
    setFeedback(null);
    try {
      await patchJson("/api/member/profile/address", {
        ...address,
        line2: address.line2 || null,
        country: address.country || "US",
      });
      setAddressOpen(false);
      setFeedback({
        message: "Your shipping address was updated for future shipments.",
        kind: "success",
      });
      await shipments.refresh();
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof ApiError
            ? caught.message
            : "Your address could not be updated.",
        kind: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function updatePayment() {
    setBusy("billing");
    setFeedback(null);
    try {
      paymentPortalAttemptId.current ??= crypto.randomUUID();
      const result = await postJson<{ url: string }>(
        "/api/member/billing/portal",
        { attemptId: paymentPortalAttemptId.current },
      );
      const target = new URL(result.url, window.location.origin);
      if (
        target.protocol !== "https:" &&
        target.origin !== window.location.origin
      ) {
        throw new Error("Invalid billing URL");
      }
      window.location.assign(target.toString());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        paymentPortalAttemptId.current = null;
      }
      setFeedback({
        message:
          caught instanceof ApiError
            ? caught.message
            : "Secure payment updates are wired and will activate with Stripe.",
        kind: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  const user = session?.user;
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email;
  const firstName = user?.firstName || "Member";
  const organizationName = session?.organization?.name || "Your winery";

  return (
    <div className="member-app">
      <header className="member-topbar">
        <MemberBrand compact inverse homeHref="/portal" />
        <div className="member-topbar__account">
          <span className="member-topbar__name">{name}</span>
          <button
            type="button"
            className="button button--member-ghost"
            onClick={() => void logout()}
            disabled={busy === "logout"}
          >
            <LogOut aria-hidden="true" />
            <span>{busy === "logout" ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </header>

      <main className="member-content">
        {mobile.native && !mobile.online ? (
          <aside className="mobile-connectivity-banner" role="status">
            <strong>Offline read-only mode</strong>
            <span>
              Recent shipments and loyalty activity are loaded from encrypted
              device storage. Account changes resume after reconnection.
            </span>
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={() => void mobile.refreshBootstrap()}
            >
              Retry connection
            </button>
          </aside>
        ) : null}
        <div aria-live="polite">
          <FormFeedback
            message={feedback?.message ?? null}
            kind={feedback?.kind === "success" ? "success" : "error"}
          />
        </div>
        <section className="member-hero" aria-labelledby="member-welcome">
          <div>
            <p className="member-hero__organization">{organizationName}</p>
            <h1 id="member-welcome">Welcome, {firstName}</h1>
            <p>Manage your membership, shipments, address, and payment method.</p>
          </div>
          <span className="member-hero__mark" aria-hidden="true">
            <Grape />
          </span>
        </section>

        {shipments.state.status === "loading" ? (
          <LoadingBlock label="Loading your shipments" />
        ) : shipments.state.status === "error" &&
          mobile.bootstrap.status !== "cached" ? (
          isActivationError(shipments.state.error) ? (
            <ActivationBlock
              title="Your shipment portal is ready"
              detail="Your winery will activate live shipment data after completing its Phase 2 connection."
            />
          ) : (
            <ErrorBlock
              error={shipments.state.error}
              onRetry={() => void shipments.refresh()}
            />
          )
        ) : (
          <>
            {shipments.state.status === "error" &&
            mobile.bootstrap.status === "cached" ? (
              <section
                className="operation-panel mobile-offline-snapshot"
                aria-labelledby="offline-snapshot-title"
              >
                <div className="panel-heading panel-heading--split">
                  <div>
                    <p className="eyebrow eyebrow--wine">Encrypted snapshot</p>
                    <h2 id="offline-snapshot-title">Recent mobile activity</h2>
                  </div>
                  <span className="status-pill status-pill--pending">
                    Read only
                  </span>
                </div>
                <div className="mobile-offline-grid">
                  <div>
                    <h3>Shipments</h3>
                    {mobile.bootstrap.data.recentShipments.length ? (
                      <ul>
                        {mobile.bootstrap.data.recentShipments.map((shipment) => (
                          <li key={shipment.id}>
                            <strong>{shipment.releaseName}</strong>
                            <span>{sentence(shipment.status)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No cached shipments.</p>
                    )}
                  </div>
                  <div>
                    <h3>Loyalty activity</h3>
                    {mobile.bootstrap.data.loyaltyLedger.length ? (
                      <ul>
                        {mobile.bootstrap.data.loyaltyLedger.map((entry) => (
                          <li key={entry.id}>
                            <strong>{entry.description}</strong>
                            <span>{entry.points > 0 ? "+" : ""}{entry.points} pts</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No cached loyalty activity.</p>
                    )}
                  </div>
                </div>
              </section>
            ) : null}
            {upcoming ? (
              <section className="portal-next-shipment" aria-labelledby="next-shipment-title">
                <div className="portal-next-shipment__main">
                  <span className="portal-next-shipment__icon" aria-hidden="true">
                    <PackageCheck />
                  </span>
                  <div>
                    <p className="eyebrow eyebrow--wine">Next shipment</p>
                    <h2 id="next-shipment-title">{upcoming.releaseName}</h2>
                    <p>
                      {upcoming.displayContents
                        ? upcoming.items
                            ?.map((item) => `${item.quantity}× ${item.name}`)
                            .join(" · ") || "Contents are being finalized."
                        : "Contents will appear after the winery’s embargo date."}
                    </p>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{sentence(upcoming.status)}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>{money(upcoming.chargeAmountCents)}</dd>
                  </div>
                  <div>
                    <dt>Tracking</dt>
                    <dd>{upcoming.trackingNumber ?? "Not assigned"}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <EmptyBlock
                title="No upcoming shipment"
                detail="Your winery’s next scheduled club release will appear here."
              />
            )}

            <fieldset
              className="portal-actions"
              aria-labelledby="portal-actions-title"
              disabled={mobile.native && !mobile.online}
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow eyebrow--wine">Manage membership</p>
                  <h2 id="portal-actions-title">Account actions</h2>
                </div>
              </div>
              <div className="portal-action-grid">
                <button type="button" onClick={editAddress}>
                  <MapPin aria-hidden="true" />
                  <span>
                    <strong>Shipping address</strong>
                    <small>Update where future club releases are sent</small>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void updatePayment()}
                  disabled={busy === "billing"}
                >
                  <CreditCard aria-hidden="true" />
                  <span>
                    <strong>
                      {busy === "billing" ? "Opening Stripe…" : "Payment method"}
                    </strong>
                    <small>Use Stripe’s secure payment update page</small>
                  </span>
                </button>
                <MemberRetentionControls />
              </div>
            </fieldset>

            <MemberLoyaltyPanel shipmentId={upcoming?.id ?? null} />

            <MetaPrivacyControl />

            <section className="operation-panel portal-history" aria-labelledby="shipment-history-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow eyebrow--wine">Club history</p>
                  <h2 id="shipment-history-title">Shipment history</h2>
                </div>
              </div>
              {sortedShipments.length ? (
                <div className="portal-shipment-list">
                  {sortedShipments.map((shipment) => (
                    <article key={shipment.id}>
                      <span className="portal-shipment-list__icon" aria-hidden="true">
                        {shipment.status === "delivered" ? <Wine /> : <Truck />}
                      </span>
                      <div>
                        <h3>{shipment.releaseName}</h3>
                        <p>
                          {shipment.displayContents
                            ? shipment.items
                                ?.map((item) => `${item.quantity}× ${item.name}`)
                                .join(" · ") || "No item detail available."
                            : "Contents hidden until embargo lifts."}
                        </p>
                        <span>
                          <CalendarDays aria-hidden="true" />
                          {date(shipment.createdAt)}
                        </span>
                      </div>
                      <div>
                        <span className={`status-pill status-pill--${shipment.status}`}>
                          {sentence(shipment.status)}
                        </span>
                        <strong>{money(shipment.chargeAmountCents)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyBlock
                  title="No shipment history"
                  detail="Completed and upcoming club shipments will appear here."
                />
              )}
            </section>
            <section className="member-security" aria-labelledby="member-security-title">
              <ShieldCheck aria-hidden="true" />
              <div>
                <h2 id="member-security-title">Secure member access</h2>
                <p>
                  Your session is separate from winery staff accounts. Payment
                  details stay with Stripe and are never stored by Vinifera.
                </p>
              </div>
            </section>
          </>
        )}
      </main>

      <Dialog
        open={addressOpen}
        title="Update shipping address"
        description="This address applies to future shipments that have not been labeled."
        onClose={() => setAddressOpen(false)}
      >
        <form className="operation-form" onSubmit={saveAddress}>
          <div className="form-field">
            <label htmlFor="portal-address-1">Address line 1</label>
            <input
              id="portal-address-1"
              required
              autoComplete="address-line1"
              value={address.line1}
              onChange={(event) =>
                setAddress({ ...address, line1: event.target.value })
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="portal-address-2">Address line 2 (optional)</label>
            <input
              id="portal-address-2"
              autoComplete="address-line2"
              value={address.line2 ?? ""}
              onChange={(event) =>
                setAddress({ ...address, line2: event.target.value })
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="portal-city">City</label>
            <input
              id="portal-city"
              required
              autoComplete="address-level2"
              value={address.city}
              onChange={(event) =>
                setAddress({ ...address, city: event.target.value })
              }
            />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="portal-state">State</label>
              <input
                id="portal-state"
                required
                maxLength={2}
                autoComplete="address-level1"
                value={address.state}
                onChange={(event) =>
                  setAddress({
                    ...address,
                    state: event.target.value.toUpperCase(),
                  })
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor="portal-postal-code">ZIP code</label>
              <input
                id="portal-postal-code"
                required
                autoComplete="postal-code"
                value={address.postalCode}
                onChange={(event) =>
                  setAddress({ ...address, postalCode: event.target.value })
                }
              />
            </div>
          </div>
          <button
            className="button button--primary button--wide"
            disabled={busy === "address"}
          >
            {busy === "address" ? "Saving address…" : "Save address"}
          </button>
        </form>
      </Dialog>
    </div>
  );
}
