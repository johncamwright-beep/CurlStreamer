import { useId } from "react";
import {
  reportContent,
  reportSummaryCards,
  reportTrendPoints,
} from "@/lib/curlcoach/report-content";
import { reportLogo } from "@/lib/curlcoach/report-logo";
import type { SavedReport } from "@/lib/curlcoach/reports";

export default function ReportDocument({
  report,
  eventName,
}: {
  report: SavedReport;
  eventName: string;
}) {
  const titleId = useId();
  const cards = reportSummaryCards(report);
  return (
    <article className="report-document" aria-labelledby={titleId}>
      <header className="report-masthead">
        {/* eslint-disable-next-line @next/next/no-img-element -- Same embedded logo used by the PDF. */}
        <img src={reportLogo} width={268} height={67} alt="CurlStreamer" />
        <div>
          <strong>Shot Tracker</strong>
          <span>Event performance report</span>
        </div>
      </header>
      <div className="report-sheet">
        <h3 id={titleId}>{report.title}</h3>
        <p className="report-event-name">{eventName}</p>
        {cards.length > 0 && (
          <dl className="report-summary" aria-label="Report summary">
            {cards.map((card) => (
              <div key={card.label}>
                <dt>{card.label}</dt>
                <dd>
                  <strong>{card.value}</strong>
                  <span>{card.basis}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {reportContent(report).map((block, index) => {
          switch (block.kind) {
            case "heading":
              return <h4 key={index}>{block.title}</h4>;
            case "text":
              return (
                <p
                  key={index}
                  className={block.muted ? "report-note" : undefined}
                >
                  {block.value}
                </p>
              );
            case "table":
              return (
                <table key={index}>
                  <thead>
                    <tr>
                      {block.headers.map((header) => (
                        <th key={header} scope="col">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map(([label, ...values], row) => (
                      <tr key={row}>
                        <th scope="row">{label}</th>
                        {values.map((value, column) => (
                          <td key={column}>
                            {value}
                            {block.layout === "shooting" &&
                              column === 0 &&
                              value.endsWith("%") && (
                                <span
                                  className="report-meter"
                                  aria-hidden="true"
                                >
                                  <span style={{ width: value }} />
                                </span>
                              )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            case "trend": {
              const points = reportTrendPoints(block.games);
              const x = (relative: number) => 58 + 490 * relative;
              const min = block.minimum ?? 0,
                max = block.maximum ?? 100;
              const y = (value: number) =>
                144 - (118 * (value - min)) / (max - min);
              return (
                <svg
                  key={index}
                  className="report-trend"
                  viewBox="0 0 600 180"
                  role="img"
                  aria-label={
                    block.eventLabels
                      ? "Performance across events in chronological order"
                      : `Shooting percentage by game, games ${block.firstGame} to ${block.firstGame + points.length - 1}`
                  }
                >
                  {[max, (min + max) / 2, min].map((value) => (
                    <g key={value}>
                      <line x1={x(0)} x2={x(1)} y1={y(value)} y2={y(value)} />
                      <text x={x(0) - 7} y={y(value) + 5} textAnchor="end">
                        {value.toFixed(0)}
                        {block.unit ?? "%"}
                      </text>
                    </g>
                  ))}
                  {points.map((point, index) => {
                    const previous = points[index - 1];
                    return (
                      <g key={index}>
                        <text x={x(point.x)} y="169" textAnchor="middle">
                          {block.eventLabels?.[index] ??
                            `Game ${block.firstGame + index}`}
                        </text>
                        {point.value !== null && (
                          <>
                            {previous && previous.value !== null && (
                              <line
                                className="report-trend-line"
                                x1={x(previous.x)}
                                y1={y(previous.value)}
                                x2={x(point.x)}
                                y2={y(point.value)}
                              />
                            )}
                            <circle cx={x(point.x)} cy={y(point.value)} r="5" />
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
              );
            }
            case "practice":
              return (
                <div className="report-practice" key={index}>
                  <h5>Practice {block.number}</h5>
                  <p>{block.text}</p>
                </div>
              );
            case "flag": {
              const { flag } = block;
              return (
                <div
                  className="report-flag"
                  key={`${flag.gameId}:${flag.shotId}`}
                >
                  <h5>
                    {flag.shooter && `${flag.shooter} · `}
                    {flag.game}
                    {flag.end !== null && (
                      <>
                        {" "}
                        · End {flag.end} · Stone {flag.stone}
                      </>
                    )}
                  </h5>
                  <p className="report-note">{flag.type}</p>
                  <p>{flag.note || "No coach’s note added."}</p>
                  {flag.url ? (
                    <a
                      href={flag.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Review video
                      {flag.estimated ? " (approximate timing)" : ""}
                    </a>
                  ) : (
                    <p className="report-note">Recording unavailable.</p>
                  )}
                </div>
              );
            }
          }
        })}
        <footer>CurlStreamer | Shot Tracker</footer>
      </div>
    </article>
  );
}
