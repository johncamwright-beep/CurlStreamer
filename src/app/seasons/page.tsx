import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { ScheduleMutationForm } from "@/components/ScheduleMutationForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";

export default async function SeasonsPage() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login?next=%2Fseasons");
  const data = await loadTeamHierarchyData(user);
  if (!data.ok)
    return (
      <main className="p-5" role="alert">
        Seasons could not be loaded.
      </main>
    );
  const canEdit = data.role !== "viewer";
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="panel mb-5">
        <p className="text-cyan-300">{data.teamName}</p>
        <h1 className="text-3xl font-black">Seasons &amp; Events</h1>
      </header>
      {canEdit && (
        <ScheduleMutationForm
          operation="createSeason"
          submitLabel="Create season"
          className="panel mb-5 grid gap-3 sm:grid-cols-3"
        >
          <h2 className="text-xl font-bold sm:col-span-3">Create a season</h2>
          <label>
            Name
            <input
              name="input[name]"
              required
              placeholder="2026–27"
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
            />
          </label>
          <label>
            Start date
            <input
              name="input[startDate]"
              type="date"
              required
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
            />
          </label>
          <label>
            End date
            <input
              name="input[endDate]"
              type="date"
              required
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
            />
          </label>
        </ScheduleMutationForm>
      )}
      <section className="grid gap-3" aria-labelledby="season-list">
        <h2 id="season-list" className="text-2xl font-bold">
          All seasons
        </h2>
        {data.seasons.length === 0 ? (
          <div className="panel">
            <p>No seasons yet.</p>
            {canEdit && (
              <p className="text-slate-300">
                Create a season above to start scheduling events.
              </p>
            )}
          </div>
        ) : (
          data.seasons.map((season) => (
            <article className="panel grid gap-3" key={season.id}>
              <div>
                <span className="rounded bg-slate-700 px-2 py-1 text-sm">
                  {season.status}
                </span>
                <h3 className="mt-2 text-xl font-bold">{season.name}</h3>
                <p>
                  {season.startDate} – {season.endDate}
                </p>
              </div>
              <Link
                className="btn-secondary text-center"
                href={`/seasons/${season.id}`}
              >
                Open season
              </Link>
              {canEdit && season.status !== "archived" && (
                <div className="flex flex-wrap gap-2">
                  {season.status !== "active" && (
                    <ScheduleMutationForm operation="activateSeason">
                      <input type="hidden" name="seasonId" value={season.id} />
                      <button className="btn-secondary">
                        Make current season
                      </button>
                      <p className="text-sm text-slate-400">
                        Events and games in the previous season are preserved.
                      </p>
                    </ScheduleMutationForm>
                  )}
                  <ScheduleMutationForm
                    operation="archiveSeason"
                    confirmMessage={`Archive ${season.name}? Active events must be archived first.`}
                  >
                    <input type="hidden" name="seasonId" value={season.id} />
                    <button className="btn-secondary border-red-700 text-red-200">
                      Archive season
                    </button>
                  </ScheduleMutationForm>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
