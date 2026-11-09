import Link from "next/link";
import type { TeamPageSettings } from "@/lib/team-page-settings";
export function TeamSetupChecklist({
  settings,
  logo,
  seasons,
  games,
}: {
  settings: TeamPageSettings;
  logo: string | null;
  seasons: number;
  games: number;
}) {
  const items = [
    { label: "Team logo", done: !!logo, href: "/account" },
    {
      label: "Player names",
      done: ["lead", "second", "third", "fourth"].every((p) =>
        Boolean(settings.roster[p as keyof typeof settings.roster]),
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
  ];
  return (
    <details className="panel mx-auto my-4 max-w-6xl p-4" open={games === 0}>
      <summary className="min-h-11 cursor-pointer font-bold">
        Team setup · {items.filter((i) => i.done).length}/{items.length} ready
      </summary>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label}>
            <Link
              className="flex min-h-11 items-center gap-2 text-cyan-300"
              href={i.href}
            >
              <span aria-hidden>{i.done ? "✓" : "○"}</span>
              {i.label} — {i.done ? "Ready" : "To do"}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3">
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
    </details>
  );
}
