"use client";

import { useState, type ReactNode } from "react";
import EventReports from "@/app/curlcoach/EventReports";

type Section = "reports" | "edit" | "schedule";

export function EventWorkspace({
  eventId,
  reportsEnabled,
  edit,
  schedule,
}: {
  eventId: string;
  reportsEnabled: boolean;
  edit?: ReactNode;
  schedule: ReactNode;
}) {
  const [section, setSection] = useState<Section>(
    reportsEnabled ? "reports" : "schedule",
  );
  const button = (id: Section, label: string) => (
    <button
      type="button"
      className={
        "min-h-11 w-full rounded-lg px-4 py-3 text-left font-semibold " +
        (section === id
          ? "bg-cyan-400 text-slate-950"
          : "hover:bg-slate-500/20")
      }
      aria-current={section === id ? "page" : undefined}
      aria-controls={"event-" + id}
      aria-expanded={id === "reports" ? section === id : undefined}
      onClick={() => setSection(id)}
    >
      {label}
    </button>
  );
  function layout(reportNavigation?: ReactNode, reportContent?: ReactNode) {
    return (
      <div className="grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside
          className="space-y-2 rounded-xl border border-slate-500/40 p-2 md:sticky md:top-5"
          aria-label="Event navigation"
        >
          {reportsEnabled && (
            <>
              {button("reports", "Event reports")}
              <div
                hidden={section !== "reports"}
                className="ml-3 border-l border-slate-500/40 pl-2"
              >
                {reportNavigation}
              </div>
            </>
          )}
          {edit && button("edit", "Edit event")}
          {button("schedule", "Schedule games")}
        </aside>
        <div className="min-w-0">
          {reportsEnabled && (
            <div id="event-reports" hidden={section !== "reports"}>
              {reportContent}
            </div>
          )}
          {edit && (
            <div id="event-edit" hidden={section !== "edit"}>
              {edit}
            </div>
          )}
          <div id="event-schedule" hidden={section !== "schedule"}>
            {schedule}
          </div>
        </div>
      </div>
    );
  }
  return reportsEnabled ? (
    <EventReports eventId={eventId} renderLayout={layout} />
  ) : (
    layout()
  );
}
