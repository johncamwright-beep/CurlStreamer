import Link from "next/link";
import type { TeamPageSettings } from "@/lib/team-page-settings";
import { throwingPositions } from "@/lib/team-page-settings";
import { TeamSetupWalkthrough } from "./TeamSetupWalkthrough";
export function TeamSetupChecklist({
  organizationId,
  settings,
  logo,
  seasons,
  games,
  resumeStep,
}: {
  organizationId: string;
  settings?: TeamPageSettings;
  logo: string | null;
  seasons: number;
  games: number;
  resumeStep?: number;
}) {
  const items = settings
    ? [
        { label: "Team logo", done: !!logo, href: "/account" },
        {
          label: "Player names",
          done: throwingPositions.every((position) =>
            Boolean(settings.roster[position]),
          ),
          href: "/account",
        },
        {
          label: "Public homepage (optional)",
          done: settings.published,
          href: "/account",
        },
        { label: "Season", done: seasons > 0, href: "/seasons" },
        { label: "First game", done: games > 0, href: "/games/new" },
      ]
    : [];
  const ready = items.filter((item) => item.done).length;
  if (items.length ? ready === items.length : !resumeStep) return null;

  return (
    <TeamSetupWalkthrough key={organizationId} organizationId={organizationId}>
      {items.length > 0 && (
        <>
          <p className="font-semibold">
            Team setup · {ready}/{items.length} ready
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.label}>
                <Link
                  className="flex min-h-11 items-center gap-2 text-cyan-300"
                  href={item.href}
                >
                  <span aria-hidden>{item.done ? "✓" : "○"}</span>
                  {item.label} — {item.done ? "Ready" : "To do"}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {resumeStep && (
        <p className="mt-2">
          Finish setting up your team · Step {resumeStep} of 6
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {resumeStep && (
          <Link className="btn-secondary" href="/onboarding">
            Resume team setup
          </Link>
        )}
        <Link className="btn-secondary" href="/onboarding?start=1">
          Open setup guide
        </Link>
        <Link className="btn-secondary" href="/sponsors">
          Add sponsors (optional)
        </Link>
        <Link className="btn-secondary" href="/account">
          YouTube and team access
        </Link>
      </div>
    </TeamSetupWalkthrough>
  );
}
