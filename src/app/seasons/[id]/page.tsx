import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { EventForm } from "@/components/EventForm";
import { ScheduleMutationForm } from "@/components/ScheduleMutationForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at)
    redirect(`/login?next=${encodeURIComponent(`/seasons/${id}`)}`);
  const data = await loadTeamHierarchyData(user);
  if (!data.ok)
    return (
      <main className="p-5" role="alert">
        Season could not be loaded.
      </main>
    );
  const season = data.seasons.find((item) => item.id === id);
  if (!season) notFound();
  const events = data.events.filter((event) => event.seasonId === id);
  const canEdit = data.role !== "viewer" && season.status !== "archived";
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="panel mb-5">
        <Link href="/seasons" className="text-cyan-300">
          ← Seasons
        </Link>
        <h1 className="mt-2 text-3xl font-black">{season.name}</h1>
        <p>
          {season.startDate} – {season.endDate} · {season.status}
        </p>
      </header>
      {canEdit && (
        <div className="mb-5">
          <EventForm seasonId={id} />
        </div>
      )}
      <section className="grid gap-4">
        <h2 className="text-2xl font-bold">Events</h2>
        {events.length === 0 ? (
          <div className="panel">
            <p>No events in this season.</p>
            {canEdit && (
              <p className="text-slate-300">
                Create the first event above, then schedule a game.
              </p>
            )}
          </div>
        ) : (
          events.map((event) => (
            <article
              id={`event-${event.id}`}
              className="panel grid gap-3"
              key={event.id}
            >
              <div>
                <span className="text-sm uppercase text-cyan-300">
                  {event.eventType.replace("_", " ")}
                  {event.archivedAt ? " · Archived" : ""}
                </span>
                <h3 className="text-xl font-bold">{event.name}</h3>
                <p>
                  {event.startDate} – {event.endDate}
                </p>
                <p className="text-slate-300">
                  {[event.location, event.timezone].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Link
                className="btn-secondary text-center"
                href={`/events/${event.id}`}
              >
                Open event
              </Link>
              {canEdit && !event.archivedAt && (
                <ScheduleMutationForm
                  operation="archiveEvent"
                  confirmMessage={`Archive ${event.name}? Its games will remain accessible.`}
                >
                  <input type="hidden" name="eventId" value={event.id} />
                  <button className="btn-secondary border-red-700 text-red-200">
                    Archive event
                  </button>
                </ScheduleMutationForm>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
