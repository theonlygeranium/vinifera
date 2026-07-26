import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useMemo,
  useState,
} from "react";
import { apiRequest } from "../../api/client";
import {
  type ChurnScore,
  type ChurnSummary,
  type RiskLevel,
  normalizeChurnScore,
  normalizeChurnSummary,
} from "../../api/phase3";
import { queryPath } from "../../api/phase2";
import { Link } from "../../routes/router";
import {
  ActivationBlock,
  EmptyBlock,
  ErrorBlock,
  isActivationError,
  LoadingBlock,
} from "../../shared/OperationalState";
import { StaffShell } from "../StaffShell";
import { date, sentence } from "../phase2/format";
import { useApiResource } from "../phase2/useApiResource";

export function RiskBadge({
  level,
  score,
}: {
  level: RiskLevel;
  score?: number;
}) {
  return (
    <span className={`risk-badge risk-badge--${level}`}>
      <span className="risk-badge__dot" aria-hidden="true" />
      {sentence(level)} risk{score === undefined ? "" : ` · ${score}%`}
    </span>
  );
}

export function FactorList({
  factors,
}: {
  factors: ChurnScore["contributingFactors"];
}) {
  if (!factors.length) {
    return (
      <p className="muted-copy">
        No contributing factors were returned by the latest scoring run.
      </p>
    );
  }
  return (
    <ul className="churn-factor-list">
      {factors.map((factor) => (
        <li key={factor.id}>
          <span
            className={`churn-factor-list__icon churn-factor-list__icon--${factor.direction}`}
            aria-hidden="true"
          >
            {factor.direction === "raises" ? <ArrowUpRight /> : <ArrowDownRight />}
          </span>
          <span>
            <strong>{factor.label}</strong>
            <small>{factor.detail}</small>
          </span>
          <b>
            {factor.points > 0 ? "+" : ""}
            {factor.points}
          </b>
        </li>
      ))}
    </ul>
  );
}

export function ChurnWatchPage() {
  const [riskLevel, setRiskLevel] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(
    () =>
      apiRequest<ChurnSummary | ChurnScore[]>(
        queryPath("/api/churn-scores", {
          riskLevel: riskLevel || undefined,
          search: search || undefined,
        }),
      ).then(normalizeChurnSummary),
    [riskLevel, search],
  );
  const churn = useApiResource(load, [load]);
  const scores = useMemo(
    () =>
      churn.state.status === "ready"
        ? [...churn.state.data.items].sort((left, right) => right.score - left.score)
        : [],
    [churn.state],
  );

  return (
    <StaffShell
      title="AI Churn Watch"
      eyebrow="Member Experience"
      actions={
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={() => void churn.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          <span>Refresh Scores</span>
        </button>
      }
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Rules-based retention signals</p>
          <h2>AI Churn Watch</h2>
          <p>
            Prioritize outreach using explainable nightly scores from member,
            payment, shipment, email, and portal behavior.
          </p>
        </div>
        {churn.state.status === "ready" && churn.state.data.calculatedAt ? (
          <span className="calculation-stamp">
            <CalendarClock aria-hidden="true" />
            Calculated {date(churn.state.data.calculatedAt)}
          </span>
        ) : null}
      </div>

      <div className="metric-grid churn-metrics">
        {churn.state.status === "ready" ? (
          <>
          <article className="metric-card">
            <span>Members scored</span>
            <strong>{churn.state.data.scoredCount.toLocaleString()}</strong>
            <small>Nightly rules-based calculation</small>
          </article>
          <article className="metric-card metric-card--risk-high">
            <span>High risk</span>
            <strong>{churn.state.data.highCount.toLocaleString()}</strong>
            <small>Score 61–100</small>
          </article>
          <article className="metric-card metric-card--risk-medium">
            <span>Medium risk</span>
            <strong>{churn.state.data.mediumCount.toLocaleString()}</strong>
            <small>Score 31–60</small>
          </article>
          <article className="metric-card metric-card--risk-low">
            <span>Low risk</span>
            <strong>{churn.state.data.lowCount.toLocaleString()}</strong>
            <small>Score 0–30</small>
          </article>
          </>
        ) : (
          <>
            {["Members scored", "High risk", "Medium risk", "Low risk"].map(
              (label) => (
                <article
                  key={label}
                  className="metric-card metric-card--placeholder"
                  aria-hidden="true"
                >
                  <span>{label}</span>
                  <strong>—</strong>
                  <small>Loading current scores</small>
                </article>
              ),
            )}
          </>
        )}
      </div>

      <section className="operation-panel churn-panel" aria-labelledby="churn-list-title">
        <div className="panel-heading panel-heading--split">
          <div>
            <div className="ai-heading">
              <Sparkles aria-hidden="true" />
              <div>
                <h2 id="churn-list-title">Member risk queue</h2>
                <p>Highest score first. Every score includes its contributing factors.</p>
              </div>
            </div>
          </div>
          <div className="operation-toolbar operation-toolbar--compact">
            <div className="search-control">
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="churn-search">
                Search scored members
              </label>
              <input
                id="churn-search"
                type="search"
                placeholder="Search member"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="form-field form-field--inline">
              <label className="sr-only" htmlFor="churn-risk-filter">
                Filter by risk level
              </label>
              <select
                id="churn-risk-filter"
                value={riskLevel}
                onChange={(event) => setRiskLevel(event.target.value)}
              >
                <option value="">All risk levels</option>
                <option value="high">High risk</option>
                <option value="medium">Medium risk</option>
                <option value="low">Low risk</option>
              </select>
            </div>
          </div>
        </div>
        {churn.state.status === "loading" ? (
          <LoadingBlock label="Loading churn scores" />
        ) : churn.state.status === "error" ? (
          isActivationError(churn.state.error) ? (
            <ActivationBlock
              title="Churn scoring is ready to connect"
              detail="Deploy the Phase 3 rules engine and run the first nightly score calculation."
            />
          ) : (
            <ErrorBlock error={churn.state.error} onRetry={() => void churn.refresh()} />
          )
        ) : scores.length === 0 ? (
          <EmptyBlock
            title="No members match this risk view"
            detail="Run scoring after member behavioral data is available or clear the current filters."
          />
        ) : (
          <div className="churn-watch-list">
            {scores.map((member) => (
              <article key={member.memberId} className="churn-watch-row">
                <span className="churn-watch-row__avatar" aria-hidden="true">
                  {member.memberName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <div className="churn-watch-row__identity">
                  <Link to={`/app/members/${member.memberId}`}>
                    {member.memberName}
                  </Link>
                  <small>
                    {[member.tierName, member.email].filter(Boolean).join(" · ")}
                  </small>
                </div>
                <div className="churn-watch-row__risk">
                  <RiskBadge level={member.riskLevel} score={member.score} />
                  <div
                    className={`risk-meter risk-meter--${member.riskLevel}`}
                    role="progressbar"
                    aria-label={`${member.memberName} churn risk`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={member.score}
                  >
                    <span style={{ width: `${member.score}%` }} />
                  </div>
                </div>
                <details className="churn-watch-row__factors">
                  <summary>
                    <Users aria-hidden="true" />
                    {member.contributingFactors.length} factors
                  </summary>
                  <FactorList factors={member.contributingFactors} />
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
    </StaffShell>
  );
}

export function MemberChurnFactors({ memberId }: { memberId: string }) {
  const load = useCallback(
    () =>
      apiRequest<ChurnScore>(
        `/api/members/${memberId}/churn-score`,
      ).then(normalizeChurnScore),
    [memberId],
  );
  const churn = useApiResource(load, [load]);

  return (
    <section className="operation-panel member-churn-panel" aria-labelledby="member-churn-title">
      <div className="panel-heading panel-heading--split">
        <div className="ai-heading">
          <Sparkles aria-hidden="true" />
          <div>
            <p className="eyebrow eyebrow--wine">Explainable score</p>
            <h2 id="member-churn-title">Churn risk factors</h2>
          </div>
        </div>
        {churn.state.status === "ready" ? (
          <RiskBadge
            level={churn.state.data.riskLevel}
            score={churn.state.data.score}
          />
        ) : null}
      </div>
      {churn.state.status === "loading" ? (
        <LoadingBlock label="Loading member risk factors" />
      ) : churn.state.status === "error" ? (
        isActivationError(churn.state.error) ? (
          <ActivationBlock
            title="Member scoring awaits activation"
            detail="Factors will appear after the first Phase 3 scoring batch."
          />
        ) : (
          <ErrorBlock error={churn.state.error} onRetry={() => void churn.refresh()} />
        )
      ) : (
        <>
          <div className="member-risk-summary">
            <div
              className={`risk-score-ring risk-score-ring--${churn.state.data.riskLevel}`}
              style={
                {
                  "--risk-score": `${churn.state.data.score * 3.6}deg`,
                } as CSSProperties
              }
              aria-label={`Churn risk score ${churn.state.data.score} out of 100`}
            >
              <strong>{churn.state.data.score}</strong>
              <span>of 100</span>
            </div>
            <div>
              <h3>{sentence(churn.state.data.riskLevel)} risk</h3>
              <p>
                Calculated {date(churn.state.data.calculatedAt)} from the current
                rules-based model. ML prediction is intentionally deferred to
                Phase 4.
              </p>
            </div>
          </div>
          <FactorList factors={churn.state.data.contributingFactors} />
        </>
      )}
    </section>
  );
}
