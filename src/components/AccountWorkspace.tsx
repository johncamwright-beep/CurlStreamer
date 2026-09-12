"use client";
import { useEffect, useState, type ReactNode } from "react";
import { TeamSettings } from "./TeamSettings";
import { TeamNews } from "./TeamNews";
import { TeamTrial } from "./TeamTrial";
import { SponsorLibrary } from "@/app/sponsors/SponsorLibrary";
const sections = [
  ["account", "Account info"],
  ["subscription", "Trial & subscription"],
  ["team", "Team info"],
  ["youtube", "YouTube Settings"],
  ["public", "Public team page"],
  ["social", "Social media"],
  ["news", "News posts"],
  ["photos", "Event photos"],
  ["sponsors", "Sponsors"],
] as const;
type Section = (typeof sections)[number][0];
function valid(value: string): Section {
  return sections.find(([id]) => id === value)?.[0] ?? "account";
}
export function AccountWorkspace({
  initialSection,
  account,
  youtube,
  teamName,
  canManage,
}: {
  initialSection: string;
  account: ReactNode;
  youtube: ReactNode;
  teamName?: string;
  canManage: boolean;
}) {
  const [section, setSection] = useState<Section>(valid(initialSection));
  const [visited, setVisited] = useState<Set<Section>>(
    () => new Set([valid(initialSection)]),
  );
  function select(next: Section) {
    setSection(next);
    setVisited((previous) => new Set([...previous, next]));
  }
  useEffect(() => {
    const back = () =>
      select(
        valid(
          new URL(window.location.href).searchParams.get("section") ??
            "account",
        ),
      );
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const available = sections.filter(
    ([id]) => id === "account" || (teamName && (id !== "news" || canManage)),
  );
  const current = available.some(([id]) => id === section)
    ? section
    : "account";
  return (
    <div className="account-workspace">
      <nav
        className="account-sidebar panel"
        aria-label="Account settings sections"
      >
        {available.map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={current === id ? "page" : undefined}
            aria-controls="account-settings-panel"
            onClick={() => {
              select(id);
              const url = new URL(window.location.href);
              url.searchParams.set("section", id);
              url.searchParams.delete("result");
              window.history.pushState(null, "", url);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <section
        id="account-settings-panel"
        className="panel min-w-0"
        aria-label={sections.find(([id]) => id === current)?.[1]}
      >
        <div hidden={current !== "account"}>{account}</div>
        {teamName && (
          <>
            <div hidden={current !== "subscription"}>
              {visited.has("subscription") && (
                <TeamTrial canManage={canManage} />
              )}
            </div>
            <div
              hidden={!["team", "public", "social", "photos"].includes(current)}
            >
              <TeamSettings
                name={teamName}
                section={
                  current === "public"
                    ? "public"
                    : current === "social"
                      ? "social"
                      : current === "photos"
                        ? "photos"
                        : "team"
                }
              />
            </div>
            <div hidden={current !== "youtube"}>
              {visited.has("youtube") && youtube}
            </div>
            {canManage && (
              <div hidden={current !== "news"}>
                {visited.has("news") && <TeamNews />}
              </div>
            )}
            <div hidden={current !== "sponsors"}>
              {visited.has("sponsors") && (
                <>
                  <h2 className="mb-3 text-xl font-bold">Sponsors</h2>
                  <p className="mb-4 text-slate-300">
                    Manage the sponsor images used by your games and public team
                    page.
                  </p>
                  <SponsorLibrary />
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
