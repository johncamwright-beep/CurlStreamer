"use client";
import { useState } from "react";
import {
  report,
  shotTypes,
  executions,
  turns,
  type RosterEntry,
} from "@/lib/curlcoach/model";
import { family, type CoachGame } from "@/lib/curlcoach/event";
import { missBreakdown, type AnalysisShot } from "@/lib/curlcoach/analysis";
import { reviewLink } from "@/lib/curlcoach/review";
import Table from "./AnalysisTable";

const pct = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
const shooting = (shots: AnalysisShot[]) => {
  const r = report(shots);
  return (
    pct(r.percent) + (r.scored > 0 && r.scored < 10 ? " · Small sample" : "")
  );
};
export default function AnalysisPanels({
  mode,
  shots,
  games,
  players,
  catalog,
  seasonShots,
  seasonReady,
  byEvent,
}: {
  mode: "performance" | "misses" | "game";
  shots: AnalysisShot[];
  games: CoachGame[];
  players: RosterEntry[];
  catalog: { id: string; name: string }[];
  seasonShots: AnalysisShot[];
  seasonReady: boolean;
  byEvent: boolean;
}) {
  const [category, setCategory] = useState("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [compare, setCompare] = useState(false);
  const misses = missBreakdown(shots);
  const topMiss = [...misses].sort((a, b) => b.count - a.count)[0];
  const performance = shotTypes.map((label) => ({
    label,
    rows: shots.filter((s) => s.type === label),
  }));
  const ranked = performance
    .filter((r) => report(r.rows).scored >= 10)
    .sort((a, b) => report(b.rows).percent! - report(a.rows).percent!);
  const trendGroups =
    games.length === 1
      ? [...new Set(shots.map((s) => s.end))]
          .sort((a, b) => a - b)
          .map((end) => ({
            label: `End ${end}`,
            rows: shots.filter((s) => s.end === end),
          }))
      : byEvent
        ? [...new Set(games.map((g) => g.eventId))].map((id) => ({
            label: catalog.find((e) => e.id === id)?.name ?? "Single games",
            rows: shots.filter((s) =>
              games.some((g) => g.id === s.gameId && g.eventId === id),
            ),
          }))
        : [...games]
            .sort((a, b) =>
              (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""),
            )
            .map((g) => ({
              label: `${g.label} · ${g.opponent}`,
              rows: shots.filter((s) => s.gameId === g.id),
            }));
  const diagnosed = shots.filter((s) => !s.excluded && s.deficiency !== null);
  const missCount = misses.reduce((n, r) => n + r.count, 0);
  const visible = shots.filter(
    (s) =>
      (category === "all" ||
        (mode === "misses"
          ? s.deficiency === category
          : s.type === category)) &&
      (!reviewOnly || s.flagged || s.review),
  );
  const selectedStats = report(shots);
  return (
    <>
      {mode === "game" && (
        <Table
          title="Shooting by end"
          columns={["Overall shooting", "Draws", "Hits"]}
          rows={[...new Set(shots.map((s) => s.end))]
            .sort((a, b) => a - b)
            .map((end) => {
              const pool = shots.filter((s) => s.end === end);
              return {
                label: `End ${end}`,
                values: [
                  shooting(pool),
                  shooting(pool.filter((s) => family(s) === "Draws")),
                  shooting(pool.filter((s) => family(s) === "Hits")),
                ],
              };
            })}
        />
      )}
      {mode !== "misses" && (
        <div className="event-metrics event-shot-metrics">
          {[
            { label: "Overall shooting", rows: shots },
            ...["Draws", "Hits"].map((label) => ({
              label,
              rows: shots.filter((s) => family(s) === label),
            })),
          ].map(({ label, rows }) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{shooting(rows)}</strong>
            </div>
          ))}
        </div>
      )}
      <section className="event-card" aria-label="Analysis summary">
        <h2>
          {mode === "misses"
            ? "Where misses occur"
            : mode === "game"
              ? "Shooting through the game"
              : "Shot performance overview"}
        </h2>
        <p>
          {!shots.length
            ? "No recorded shots match these filters."
            : mode === "misses"
              ? missCount
                ? `${topMiss.label} is the most frequently recorded diagnosis, accounting for ${pct(topMiss.share)} of diagnosed misses and ${pct(topMiss.frequency)} of all diagnosed shots. Review the relevant attempts before deciding what to change.`
                : "No miss diagnoses are recorded for this selection. Ungraded shots and missing diagnoses are not treated as successful shots."
              : ranked.length > 1
                ? `${ranked[0].label} has the highest shooting percentage (${shooting(ranked[0].rows)}), while ${ranked[ranked.length - 1].label} is lowest (${shooting(ranked[ranked.length - 1].rows)}), among categories with at least ten graded shots. Shot difficulty and shot selection can affect these comparisons.`
                : "Use the shot categories and trend below to compare execution. Categories with fewer than ten graded attempts are marked as small samples."}
        </p>
        {mode === "misses" && (
          <p className="score-stat-caption">
            Management means the throw was good enough to make the shot; it does
            not assign fault to the thrower. Diagnoses are recorded
            observations, not inferred causes.
          </p>
        )}
      </section>
      {mode === "misses" ? (
        <>
          <Table
            title="Miss breakdown"
            columns={[
              "Share of diagnosed misses",
              "Frequency across diagnosed shots",
            ]}
            rows={misses.map((r) => ({
              label: r.label,
              values: [pct(r.share), pct(r.frequency)],
            }))}
          />
          <details className="event-card">
            <summary>Miss patterns by shot, turn, player and end</summary>
            {[
              { title: "By shot type", groups: performance },
              {
                title: "By turn / target",
                groups: turns.map((label) => ({
                  label,
                  rows: shots.filter((s) => s.turn === label),
                })),
              },
              {
                title: "By player",
                groups: players.map((p) => ({
                  label: p.name,
                  rows: shots.filter((s) => s.playerId === p.id),
                })),
              },
              {
                title: "By end",
                groups: [...new Set(shots.map((s) => s.end))]
                  .sort((a, b) => a - b)
                  .map((end) => ({
                    label: `End ${end}`,
                    rows: shots.filter((s) => s.end === end),
                  })),
              },
            ].map((group) => (
              <Table
                key={group.title}
                title={group.title}
                columns={misses.map((r) => r.label)}
                rows={group.groups.map((r) => ({
                  label: r.label,
                  values: missBreakdown(r.rows).map((m) => pct(m.frequency)),
                }))}
              />
            ))}
            <p>Each cell is a percentage of diagnosed shots within its row.</p>
            <Table
              title="Miss severity"
              columns={executions}
              rows={misses.map((m) => {
                const pool = shots.filter(
                  (s) =>
                    !s.excluded &&
                    s.deficiency === m.label &&
                    s.execution !== null,
                );
                return {
                  label: m.label,
                  values: executions.map((e) =>
                    pct(
                      pool.length
                        ? (pool.filter((s) => s.execution === e).length /
                            pool.length) *
                            100
                        : null,
                    ),
                  ),
                };
              })}
            />
          </details>
        </>
      ) : mode === "performance" ? (
        <section className="event-card">
          <h3>Performance by shot type</h3>
          <div className="analysis-bars">
            {performance.map((r) => (
              <button
                key={r.label}
                aria-pressed={category === r.label}
                onClick={() =>
                  setCategory(category === r.label ? "all" : r.label)
                }
              >
                <span>{r.label}</span>
                <meter
                  min="0"
                  max="100"
                  value={report(r.rows).percent ?? 0}
                  aria-label={`${r.label} shooting percentage`}
                />
                <strong>{shooting(r.rows)}</strong>
              </button>
            ))}
          </div>
          <p className="score-stat-caption">
            Select a category to inspect its shots in Shot review below.
          </p>
        </section>
      ) : null}
      <details className="event-card">
        <summary>
          {games.length === 1
            ? "Trend by end"
            : byEvent
              ? "Trend by event"
              : "Trend by game"}
        </summary>
        <Table
          title={
            games.length === 1
              ? "Trend by end"
              : byEvent
                ? "Trend by event"
                : "Trend by game"
          }
          columns={
            mode === "misses"
              ? misses.map((r) => r.label)
              : ["Overall shooting", "Draws", "Hits"]
          }
          rows={trendGroups.map((r) => ({
            label: r.label,
            values:
              mode === "misses"
                ? missBreakdown(r.rows).map((m) => pct(m.frequency))
                : [
                    shooting(r.rows),
                    shooting(r.rows.filter((s) => family(s) === "Draws")),
                    shooting(r.rows.filter((s) => family(s) === "Hits")),
                  ],
          }))}
        />
        {mode === "misses" && (
          <p className="score-stat-caption">
            Miss trends show frequency across diagnosed shots in each row.
          </p>
        )}
      </details>
      <section className="event-card">
        <label className="analysis-check">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />{" "}
          Compare with this season
        </label>
        {compare &&
          (seasonReady ? (
            <Table
              title="Selection versus season"
              columns={["Selection", "Season including selection"]}
              rows={
                mode === "misses"
                  ? misses.map((r, i) => ({
                      label: r.label,
                      values: [
                        pct(r.frequency),
                        pct(missBreakdown(seasonShots)[i].frequency),
                      ],
                    }))
                  : ["Overall", "Draws", "Hits"].map((label) => ({
                      label,
                      values: [shots, seasonShots].map((pool) =>
                        shooting(
                          label === "Overall"
                            ? pool
                            : pool.filter((s) => family(s) === label),
                        ),
                      ),
                    }))
              }
            />
          ) : (
            <p>Loading season comparison…</p>
          ))}
      </section>
      {mode === "performance" && (
        <details className="event-card">
          <summary>Execution, turn and player breakdowns</summary>
          <Table
            title="Execution outcomes"
            columns={["Share of recorded execution"]}
            rows={executions.map((label) => {
              const pool = shots.filter(
                (s) => !s.excluded && s.execution !== null,
              );
              return {
                label,
                values: [
                  pct(
                    pool.length
                      ? (pool.filter((s) => s.execution === label).length /
                          pool.length) *
                          100
                      : null,
                  ),
                ],
              };
            })}
          />
          <p className="score-stat-caption">
            Make percentage describes the execution category. Shooting
            percentage uses the numeric 0–5 grade; these are separate measures.
          </p>
          <Table
            title="Turn / target performance"
            columns={["Shooting"]}
            rows={turns.map((label) => ({
              label,
              values: [shooting(shots.filter((s) => s.turn === label))],
            }))}
          />
          <Table
            title="Player performance"
            columns={["Overall shooting", "Draws", "Hits"]}
            rows={players.map((p) => {
              const pool = shots.filter((s) => s.playerId === p.id);
              return {
                label: p.name,
                values: [
                  shooting(pool),
                  shooting(pool.filter((s) => family(s) === "Draws")),
                  shooting(pool.filter((s) => family(s) === "Hits")),
                ],
              };
            })}
          />
        </details>
      )}
      <details className="event-card" open={category !== "all" || undefined}>
        <summary>
          Shot review{category !== "all" ? ` · ${category}` : ""}
        </summary>
        <div className="event-filter-bar">
          <label>
            Review category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {(mode === "misses"
                ? misses.map((r) => r.label)
                : [...shotTypes]
              ).map((label) => (
                <option key={label}>{label}</option>
              ))}
            </select>
          </label>
          <label className="analysis-check">
            <input
              type="checkbox"
              checked={reviewOnly}
              onChange={(e) => setReviewOnly(e.target.checked)}
            />{" "}
            Flagged shots only
          </label>
        </div>
        {!visible.length && <p>No shots match this review selection.</p>}
        {visible.map((s) => {
          const link = reviewLink(s.videoReview);
          return (
            <details className="coach-review-item" key={s.gameId + ":" + s.id}>
              <summary>
                {games.find((g) => g.id === s.gameId)?.label} · End {s.end} ·{" "}
                {players.find((p) => p.id === s.playerId)?.name ?? s.position} ·{" "}
                {s.type ?? "Unrecorded type"} ·{" "}
                {s.grade === null ? "Ungraded" : `${s.grade}/5`}
              </summary>
              <p>
                {s.execution ?? "Execution not recorded"} ·{" "}
                {s.deficiency ?? "Diagnosis not recorded"}
                {s.excluded ? ` · Excluded: ${s.excluded}` : ""}
              </p>
              <p>{s.note || "No note added."}</p>
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  Review video ↗
                </a>
              ) : (
                (s.flagged || s.review) && (
                  <p>Flagged for review · Video link not available.</p>
                )
              )}
            </details>
          );
        })}
      </details>
      <details className="event-card">
        <summary>Data details and calculation definitions</summary>
        <p>
          {selectedStats.scored} graded shots; {selectedStats.missing} ungraded;{" "}
          {selectedStats.excluded} excluded. {diagnosed.length} diagnosed shots,
          including {missCount} diagnosed misses.
        </p>
        <p>
          Shooting percentage = total numeric grades ÷ (5 × graded attempts).
          Zero counts; ungraded and excluded attempts do not. Combined
          percentages use the underlying shots, not averages of game
          percentages. Miss percentages exclude attempts without a diagnosis.
          Small sample means fewer than ten graded attempts, not a statistical
          confidence test.
        </p>
      </details>
    </>
  );
}
