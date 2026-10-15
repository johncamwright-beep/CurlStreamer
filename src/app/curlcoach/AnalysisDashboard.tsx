"use client";

import { useState, type ReactNode } from "react";
import type { AnalysisShot } from "@/lib/curlcoach/advanced-analysis";
import { analysisCoverage } from "@/lib/curlcoach/advanced-analysis";
import { family, type CoachGame } from "@/lib/curlcoach/event";
import {
  report,
  shotTypes,
  turns,
  executions,
  type RosterEntry,
} from "@/lib/curlcoach/model";
import { missTags } from "@/lib/curlcoach/report-misses";
import { technicalSummary } from "@/lib/curlcoach/technical";
import {
  difficultySummary,
  difficultyLabels,
  difficultyPAE,
} from "@/lib/curlcoach/difficulty";
import {
  shotSubtypes,
  weightLabels,
  resultLabels,
} from "@/lib/curlcoach/shot-subtypes";
import {
  reviewLink,
  reviewStart,
  videoTime,
  supportedVideo,
} from "@/lib/curlcoach/review";
import "./analysis-dashboard.css";

export const ANALYSIS_TABS = {
  performance: "Shot Performance",
  misses: "Miss Analysis",
  technical: "Technical Review",
  advanced: "Advanced Analysis",
} as const;
export type AnalysisTab = keyof typeof ANALYSIS_TABS;
type NavigationProps = {
  tab: AnalysisTab;
  onTabChange: (tab: AnalysisTab) => void;
};
export function AnalysisNavigation({ tab, onTabChange }: NavigationProps) {
  const tabs = Object.keys(ANALYSIS_TABS) as AnalysisTab[];
  return (
    <div
      className="analysis-navigation"
      role="tablist"
      aria-label="Analysis reports"
    >
      {tabs.map((key, index) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`analysis-tab-${key}`}
          aria-controls="analysis-report"
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => onTabChange(key)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              onTabChange(tabs[next]);
              document.getElementById(`analysis-tab-${tabs[next]}`)?.focus();
            }
          }}
        >
          {ANALYSIS_TABS[key]}
        </button>
      ))}
    </div>
  );
}
const percent = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
const share = (count: number, total: number) =>
  total ? (count / total) * 100 : null;
const isMiss = (shot: AnalysisShot) =>
  shot.execution !== null && shot.execution !== "Make";
function group(
  shots: AnalysisShot[],
  key: (shot: AnalysisShot) => string | null | undefined,
) {
  const groups = new Map<string, AnalysisShot[]>();
  shots.forEach((shot) => {
    const value = key(shot);
    if (value != null) groups.set(value, [...(groups.get(value) ?? []), shot]);
  });
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}
function Panel({
  title,
  extra,
  children,
  className = "",
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`analysis-panel ${className}`}>
      <div className="analysis-panelhead">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
function Bar({
  label,
  value,
  count,
  onClick,
  tone = "blue",
}: {
  label: string;
  value: number | null;
  count: ReactNode;
  onClick?: () => void;
  tone?: string;
}) {
  return (
    <div className={`analysis-bar analysis-tone-${tone}`}>
      {onClick ? (
        <button type="button" onClick={onClick}>
          {label} <span aria-hidden="true">›</span>
        </button>
      ) : (
        <span>{label}</span>
      )}
      <div className="analysis-track" aria-hidden="true">
        <div style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </div>
      <strong>{percent(value)}</strong>
      <span className="analysis-count">{count}</span>
    </div>
  );
}
function Columns({ left, right }: { left: string; right: string }) {
  return (
    <div className="analysis-columns">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
function Kpi({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="analysis-kpi">
      <div className="analysis-muted">{label}</div>
      <div className="analysis-value">{value}</div>
      <div className="analysis-muted">{detail}</div>
    </div>
  );
}
function Execution({ shots }: { shots: AnalysisShot[] }) {
  const classified = shots.filter((shot) => shot.execution !== null);
  return (
    <div className="analysis-execution">
      <span className="analysis-muted">Execution</span>
      <div className="analysis-segments" aria-hidden="true">
        {executions.map((execution, index) => (
          <span
            key={execution}
            className={`analysis-outcome-${index}`}
            style={{
              flex: classified.filter((shot) => shot.execution === execution)
                .length,
            }}
          />
        ))}
      </div>
      {executions.map((execution, index) => (
        <span className="analysis-key" key={execution}>
          <i className={`analysis-outcome-${index}`} />
          {execution === "Xmiss" ? "Miss" : execution}{" "}
          {classified.filter((shot) => shot.execution === execution).length}
        </span>
      ))}
    </div>
  );
}
function Trend({
  shots,
  games,
}: {
  shots: AnalysisShot[];
  games: CoachGame[];
}) {
  const points = games.flatMap((game) => {
    const value = report(shots.filter((shot) => shot.gameId === game.id));
    return value.percent === null ? [] : [{ game, value }];
  });
  if (!points.length) return <p className="analysis-empty">No graded shots</p>;
  const w = Math.max(420, points.length * 85),
    h = 180;
  const x = (index: number) =>
    points.length === 1 ? w / 2 : 42 + (index * (w - 84)) / (points.length - 1);
  const y = (value: number) => 140 - value;
  return (
    <div className="analysis-chart-scroll">
      <svg
        className={`analysis-chart${points.length <= 8 ? " analysis-chart-compact" : ""}`}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Shooting percentage by game"
        style={{ minWidth: points.length > 6 ? w : undefined }}
      >
        {[0, 50, 100].map((n) => (
          <g key={n}>
            <line x1="35" x2={w - 25} y1={y(n)} y2={y(n)} />
            <text x="27" y={y(n) + 4} textAnchor="end">
              {n}
            </text>
          </g>
        ))}
        <polyline
          points={points
            .map((point, i) => `${x(i)},${y(point.value.percent!)}`)
            .join(" ")}
        />
        {points.map((point, i) => (
          <g key={point.game.id}>
            <title>{`${point.game.label}: ${percent(point.value.percent)} · ${point.value.scored} graded shots`}</title>
            <circle cx={x(i)} cy={y(point.value.percent!)} r="4" />
            <text
              className="analysis-chartvalue"
              x={x(i)}
              y={y(point.value.percent!) - 12}
              textAnchor="middle"
            >
              {percent(point.value.percent)}
            </text>
            <text x={x(i)} y="168" textAnchor="middle">
              Game {games.indexOf(point.game) + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
type Review = { label: string; ids: string[]; tab: AnalysisTab };
export default function AnalysisDashboard({
  shots: input,
  games,
  players,
  tab,
  onTabChange,
}: NavigationProps & {
  shots: AnalysisShot[];
  games: CoachGame[];
  players: RosterEntry[];
}) {
  const [focus, setFocus] = useState("all");
  const [calledWeight, setCalledWeight] = useState("");
  const [allSubtypes, setAllSubtypes] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const shots = input.filter((shot) => !shot.excluded);
  const graded = report(shots),
    classified = shots.filter((shot) => shot.execution !== null),
    misses = classified.filter(isMiss);
  const changeFocus = (value: string) => {
    setFocus(value);
    setAllSubtypes(false);
    setReview(null);
  };
  const showReview = (label: string, rows: AnalysisShot[]) =>
    setReview({
      label,
      ids: rows.map((shot) => `${shot.gameId}:${shot.id}`),
      tab,
    });
  const reviewed = review
    ? shots.filter((shot) => review.ids.includes(`${shot.gameId}:${shot.id}`))
    : [];
  const reviewContent = review?.tab === tab && (
    <section className="analysis-review" aria-label="Review shots">
      <div className="analysis-panelhead">
        <h3>
          {review.label} · {reviewed.length} shots
        </h3>
        <button
          type="button"
          onClick={() => setReview(null)}
          aria-label="Close shot review"
        >
          Close
        </button>
      </div>
      {reviewed.length === 0 ? (
        <p className="analysis-empty">No matching shots</p>
      ) : (
        reviewed.map((shot) => {
          const game = games.find((game) => game.id === shot.gameId),
            video = shot.videoReview;
          const link =
            reviewLink(video) ??
            (video && supportedVideo(video.url) ? video.url : null);
          return (
            <article
              key={`${shot.gameId}-${shot.id}`}
              className="analysis-review-shot"
            >
              <h4>
                {game?.label ?? "Game"} ·{" "}
                {players.find((player) => player.id === shot.playerId)?.name ??
                  shot.position}
              </h4>
              <div className="analysis-muted">
                End {shot.end} · Stone {shot.stone} ·{" "}
                {shot.type ?? "Type not recorded"} ·{" "}
                {shot.grade === null ? "Not graded" : `${shot.grade}/5`}
              </div>
              {shot.note && <p>{shot.note}</p>}
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {reviewStart(video) === null
                    ? "Open game recording"
                    : `Review video from ${videoTime(reviewStart(video)!)}`}
                  {video?.estimated ? " (approximate)" : ""} ↗
                </a>
              ) : (
                <span className="analysis-muted">No linked recording</span>
              )}
            </article>
          );
        })
      )}
    </section>
  );
  let content: ReactNode;
  if (tab === "performance") {
    const typed = shotTypes
      .map((type) => ({
        type,
        rows: shots.filter((shot) => shot.type === type),
      }))
      .filter((row) => row.rows.length);
    content = (
      <>
        <section
          className="analysis-panel analysis-overview"
          aria-label="Performance overview"
        >
          <div className="analysis-kpis">
            <Kpi
              label="Overall shooting"
              value={percent(graded.percent)}
              detail={`${graded.scored} graded shots`}
            />
            {(["Draws", "Hits"] as const).map((label) => {
              const rows = shots.filter((shot) => family(shot) === label);
              return (
                <Kpi
                  key={label}
                  label={label}
                  value={percent(report(rows).percent)}
                  detail={`${report(rows).scored} graded shots`}
                />
              );
            })}
            <Kpi
              label="Recorded outcomes"
              value={
                <>
                  {classified.length}
                  <small> / {shots.length}</small>
                </>
              }
              detail={`${shots.length - classified.length} not recorded`}
            />
          </div>
          <Execution shots={shots} />
        </section>
        <div className="analysis-grid">
          <Panel title="Performance by shot">
            <Columns left="Shot type" right="Shooting · Shots" />
            {typed.length ? (
              typed.map(({ type, rows }) => (
                <Bar
                  key={type}
                  label={type}
                  value={report(rows).percent}
                  count={rows.length}
                  onClick={() => {
                    changeFocus(type);
                    onTabChange("advanced");
                  }}
                />
              ))
            ) : (
              <p className="analysis-empty">No shots</p>
            )}
          </Panel>
          <div className="analysis-stack">
            <Panel
              title="Performance over time"
              extra={<span className="analysis-muted">Shooting %</span>}
            >
              <Trend shots={shots} games={games} />
            </Panel>
            <Panel title="Performance by turn">
              <Columns left="Turn / target" right="Shooting · Shots" />
              {turns
                .map((turn) => ({
                  turn,
                  rows: shots.filter((shot) => shot.turn === turn),
                }))
                .filter((row) => row.rows.length)
                .map(({ turn, rows }) => (
                  <Bar
                    key={turn}
                    label={turn}
                    value={report(rows).percent}
                    count={rows.length}
                  />
                ))}
              {!shots.some((shot) => shot.turn) && (
                <p className="analysis-empty">No recorded turns</p>
              )}
            </Panel>
          </div>
        </div>
      </>
    );
  } else if (tab === "misses") {
    const reasons = missTags
      .map((tag) => ({
        tag,
        rows: misses.filter((shot) => shot.deficiency === tag),
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
    const tagged = reasons.reduce((total, row) => total + row.rows.length, 0);
    const noDeficiency = misses.filter(
      (shot) => shot.deficiency === "Make",
    ).length;
    const reasonsRecorded = misses.filter(
      (shot) => shot.deficiency !== null,
    ).length;
    const reasonsMissing = misses.length - reasonsRecorded;
    const byType = group(classified, (shot) => shot.type)
      .map(([label, rows]) => ({
        label,
        rows,
        count: rows.filter(isMiss).length,
      }))
      .filter((row) => row.count)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    content = (
      <>
        <section
          className="analysis-panel analysis-overview"
          aria-label="Miss overview"
        >
          <div className="analysis-kpis analysis-three">
            <Kpi
              label="Partial or missed"
              value={percent(share(misses.length, classified.length))}
              detail={`${misses.length} of ${classified.length} recorded outcomes`}
            />
            <Kpi
              label="Complete misses"
              value={misses.filter((shot) => shot.execution === "Xmiss").length}
              detail="Execution: Miss"
            />
            <Kpi
              label="Reasons recorded"
              value={
                <>
                  {reasonsRecorded}
                  <small> / {misses.length}</small>
                </>
              }
              detail={`${reasonsMissing} not recorded`}
            />
          </div>
          <Execution shots={shots} />
        </section>
        <div className="analysis-grid analysis-equal">
          <Panel title="Recorded reasons">
            <Columns left="Coach assessment" right="Share · Shots" />
            {reasons.map(({ tag, rows }) => (
              <Bar
                key={tag}
                label={tag}
                value={share(rows.length, misses.length)}
                count={rows.length}
                tone="amber"
              />
            ))}
            <Bar
              label="No deficiency"
              value={share(noDeficiency, misses.length)}
              count={noDeficiency}
              tone="green"
            />
            <Bar
              label="Not recorded"
              value={share(reasonsMissing, misses.length)}
              count={reasonsMissing}
              tone="muted"
            />
          </Panel>
          <Panel title="Where misses repeat">
            <Columns left="Shot type" right="Rate · Misses" />
            {byType.map(({ label, rows, count }) => (
              <Bar
                key={label}
                label={label}
                value={share(count, rows.length)}
                count={`${count}/${rows.length}`}
                tone="red"
              />
            ))}
            {!byType.length && (
              <p className="analysis-empty">No partial or missed outcomes</p>
            )}
          </Panel>
        </div>
        <Panel title="Practice priorities" className="analysis-priorities">
          <div className="analysis-focusgrid">
            {reasons
              .filter((row) => row.rows.length)
              .slice(0, 2)
              .map(({ tag, rows }) => {
                const [type, subset] = group(
                  rows,
                  (shot) => shot.type ?? "Type not recorded",
                )[0];
                const total = classified.filter(
                  (shot) => (shot.type ?? "Type not recorded") === type,
                ).length;
                return (
                  <div className="analysis-focus" key={tag}>
                    <h3>
                      {tag} · {type}
                    </h3>
                    <div className="analysis-muted">
                      {subset.length} / {total} recorded outcomes ·{" "}
                      {percent(share(subset.length, total))}
                    </div>
                    <button
                      type="button"
                      onClick={() => showReview(`${tag} · ${type}`, subset)}
                    >
                      Review {subset.length} shots →
                    </button>
                  </div>
                );
              })}
            {!tagged && (
              <p className="analysis-empty">No recorded miss patterns</p>
            )}
          </div>
          {reviewContent}
        </Panel>
      </>
    );
  } else if (tab === "technical") {
    const groups = technicalSummary(shots);
    const candidates = groups
      .filter((g) => g.field !== "release")
      .flatMap((g) =>
        g.rows
          .filter((row) => row.count && row.label !== "On broom")
          .map((row) => ({ ...row, field: g.field })),
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, 2);
    content = (
      <div className="analysis-grid analysis-equal">
        {groups.map((g) => (
          <Panel
            key={g.field}
            title={
              g.field === "line"
                ? "Line accuracy"
                : g.field === "release"
                  ? "Release patterns"
                  : "Delivery observations"
            }
            extra={
              <span className="analysis-coverage">
                {g.recorded} / {g.total} recorded
              </span>
            }
          >
            {g.field === "line" && (
              <div className="analysis-linehero">
                <strong>
                  {percent(
                    g.rows.find((row) => row.label === "On broom")?.percent ??
                      null,
                  )}
                </strong>
                <span className="analysis-muted">On broom</span>
              </div>
            )}
            {g.field !== "technical" ? (
              g.rows
                .filter((row) => g.field === "line" || row.count)
                .sort((a, b) => (g.field === "line" ? 0 : b.count - a.count))
                .map((row) => (
                  <Bar
                    key={row.label}
                    label={row.label}
                    value={row.percent}
                    count={row.count}
                    tone={g.field === "line" ? "green" : "blue"}
                  />
                ))
            ) : (
              <div className="analysis-tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Observation</th>
                      <th>Shots</th>
                      <th>Of recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows
                      .filter((row) => row.count)
                      .sort((a, b) => b.count - a.count)
                      .map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td>{row.count}</td>
                          <td>{percent(row.percent)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {!g.recorded && (
              <p className="analysis-empty">No recorded observations</p>
            )}
            <div className="analysis-foot">{g.unrecorded} not recorded</div>
          </Panel>
        ))}
        <Panel title="Review priorities">
          <div className="analysis-stack">
            {candidates.map((row) => (
              <div className="analysis-focus" key={`${row.field}-${row.label}`}>
                <h3>{row.label}</h3>
                <div className="analysis-muted">
                  {row.misses} / {row.classified} partial or missed ·{" "}
                  {percent(row.missPercent)}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    showReview(
                      row.label,
                      shots.filter((shot) => shot[row.field] === row.label),
                    )
                  }
                >
                  Review {row.count} shots →
                </button>
              </div>
            ))}
            {!candidates.length && (
              <p className="analysis-empty">No recorded review patterns</p>
            )}
          </div>
          {reviewContent}
        </Panel>
      </div>
    );
  } else {
    const focused =
      focus === "all" ? shots : shots.filter((shot) => shot.type === focus);
    const coverage = analysisCoverage(focused),
      difficulty = difficultySummary(focused);
    const subtypes = group(focused, (shot) => shot.shotSubtype),
      weights = group(focused, (shot) => shot.intendedWeight);
    const called = weights.some(([weight]) => weight === calledWeight)
      ? calledWeight
      : (weights[0]?.[0] ?? "");
    const calledShots = focused.filter(
        (shot) => shot.intendedWeight === called,
      ),
      observed = calledShots.filter(
        (shot) => shot.observedDestination !== null,
      );
    const assessed = focused.filter((shot) => shot.resultObservations !== null);
    const tags = new Map<string, AnalysisShot[]>();
    assessed.forEach((shot) =>
      new Set(shot.resultObservations!).forEach((tag) =>
        tags.set(tag, [...(tags.get(tag) ?? []), shot]),
      ),
    );
    const rankedTags = [...tags.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);
    content = (
      <>
        <div className="analysis-local-focus">
          <label>
            Shot focus
            <select
              value={focus}
              onChange={(event) => changeFocus(event.target.value)}
            >
              <option value="all">All shot types</option>
              {shotTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <span className="analysis-muted">{focused.length} shots</span>
        </div>
        <div className="analysis-grid analysis-equal">
          <Panel
            title="Shot subtypes"
            extra={
              <span className="analysis-coverage">
                {coverage.subtyped} / {coverage.eligible} recorded
              </span>
            }
          >
            <Columns
              left={
                allSubtypes ? "All recorded sub-shots" : "Most played sub-shots"
              }
              right="Shooting · Shots"
            />
            {(allSubtypes ? subtypes : subtypes.slice(0, 5)).map(
              ([id, rows]) => (
                <Bar
                  key={id}
                  label={
                    shotSubtypes.find((subtype) => subtype.id === id)?.name ??
                    id
                  }
                  value={report(rows).percent}
                  count={rows.length}
                />
              ),
            )}
            {!subtypes.length && (
              <p className="analysis-empty">No recorded sub-shots</p>
            )}
            {subtypes.length > 5 && (
              <button
                className="analysis-link"
                type="button"
                aria-expanded={allSubtypes}
                onClick={() => setAllSubtypes(!allSubtypes)}
              >
                {allSubtypes
                  ? "Show fewer sub-shots"
                  : `Show all ${subtypes.length} sub-shots`}{" "}
                →
              </button>
            )}
          </Panel>
          <Panel
            title="Called vs observed weight"
            extra={
              <label className="analysis-local-label">
                Called weight
                <select
                  value={called}
                  disabled={!weights.length}
                  onChange={(event) => setCalledWeight(event.target.value)}
                >
                  {!weights.length && <option value="">Not recorded</option>}
                  {weights.map(([weight]) => (
                    <option value={weight} key={weight}>
                      {weightLabels[weight] ?? weight}
                    </option>
                  ))}
                </select>
              </label>
            }
          >
            <Columns
              left="Observed weight / destination"
              right="Share · Shots"
            />
            {group(observed, (shot) => shot.observedDestination).map(
              ([destination, rows]) => (
                <Bar
                  key={destination}
                  label={weightLabels[destination] ?? destination}
                  value={share(rows.length, observed.length)}
                  count={rows.length}
                />
              ),
            )}
            {!observed.length && (
              <p className="analysis-empty">No observed weights recorded</p>
            )}
            <div className="analysis-foot">
              {observed.length} / {calledShots.length} observations recorded
            </div>
          </Panel>
          <Panel
            title="Result observations"
            extra={
              <span className="analysis-coverage">
                {assessed.length} / {focused.length} assessed
              </span>
            }
          >
            <Columns left="Top observed misses" right="Share · Shots" />
            {rankedTags.map(([tag, rows]) => (
              <Bar
                key={tag}
                label={resultLabels[tag] ?? tag}
                value={share(rows.length, assessed.length)}
                count={rows.length}
                onClick={() => showReview(resultLabels[tag] ?? tag, rows)}
              />
            ))}
            {!rankedTags.length && (
              <p className="analysis-empty">
                {assessed.length
                  ? "No observed misses recorded"
                  : "No assessed results"}
              </p>
            )}
            <dl className="analysis-coverage-list">
              <div>
                <dt>No observed miss</dt>
                <dd>{coverage.noObservedMiss}</dd>
              </div>
              <div>
                <dt>Not assessed</dt>
                <dd>
                  {
                    focused.filter(
                      (shot) => shot.resultAssessment === "not_assessed",
                    ).length
                  }
                </dd>
              </div>
              {(["not_applicable", "conflicted", "unavailable"] as const).map(
                (status) => {
                  const n = focused.filter(
                    (shot) => shot.resultAssessment === status,
                  ).length;
                  return n ? (
                    <div key={status}>
                      <dt>
                        {status === "not_applicable"
                          ? "Not applicable"
                          : status === "conflicted"
                            ? "Conflicted"
                            : "Unavailable"}
                      </dt>
                      <dd>{n}</dd>
                    </div>
                  ) : null;
                },
              )}
            </dl>
            {reviewContent}
          </Panel>
          <Panel title="Difficulty">
            <div className="analysis-dual">
              <div>
                <strong className="analysis-big">
                  {difficultyPAE(difficulty.pae)}
                </strong>
                <div className="analysis-muted">
                  {difficulty.pae !== null && difficulty.pae < 0
                    ? "Below expected"
                    : "Above expected"}
                </div>
              </div>
              <span className="analysis-coverage">
                {difficulty.classified} / {difficulty.eligible} classified
              </span>
            </div>
            <div className="analysis-tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Difficulty</th>
                    <th>Shots</th>
                    <th>Actual</th>
                    <th>Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {difficulty.mix.map((row) => (
                    <tr key={row.level}>
                      <th scope="row">
                        {row.level} · {difficultyLabels[row.level]}
                      </th>
                      <td>{row.count}</td>
                      <td>{percent(row.actual)}</td>
                      <td>{percent(row.expected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="analysis-foot">
              <span>Provisional benchmark</span>
              <span>
                {difficulty.eligible -
                  difficulty.classified -
                  difficulty.unavailable}{" "}
                not recorded
              </span>
              {difficulty.unavailable > 0 && (
                <span>{difficulty.unavailable} unavailable</span>
              )}
            </div>
            <details className="analysis-index">
              <summary>Weighted score details</summary>
              <dl className="analysis-coverage-list">
                <div>
                  <dt>Difficulty-adjusted index</dt>
                  <dd>
                    {difficulty.adjusted === null
                      ? "—"
                      : difficulty.adjusted.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt>Actual</dt>
                  <dd>{percent(difficulty.actual)}</dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>{percent(difficulty.expected)}</dd>
                </div>
                <div>
                  <dt>Benchmark version</dt>
                  <dd>{difficulty.benchmarks.version}</dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>{percent(difficulty.coverage)}</dd>
                </div>
                <div>
                  <dt>Unavailable</dt>
                  <dd>{difficulty.unavailable}</dd>
                </div>
              </dl>
            </details>
          </Panel>
        </div>
        {coverage.unavailable > 0 && (
          <div className="analysis-status" role="status">
            Advanced data unavailable · {coverage.unavailable} shots
          </div>
        )}
        {focused.some(
          (shot) =>
            shot.analysisStatus === "invalid" ||
            shot.analysisStatus === "conflicted",
        ) && (
          <div className="analysis-status" role="status">
            Invalid or conflicted advanced data ·{" "}
            {
              focused.filter(
                (shot) =>
                  shot.analysisStatus === "invalid" ||
                  shot.analysisStatus === "conflicted",
              ).length
            }{" "}
            shots
          </div>
        )}
      </>
    );
  }
  return (
    <div
      className="analysis-dashboard"
      id="analysis-report"
      role="tabpanel"
      aria-labelledby={`analysis-tab-${tab}`}
    >
      {content}
    </div>
  );
}
