import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { teamPageSettingsSchema } from "@/lib/team-page-settings";
import { gameLibrarySponsors } from "@/lib/providers/sponsor-library";
import { NewsContent } from "@/components/NewsContent";
export const dynamic = "force-dynamic";
export default async function PublicTeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound();
  const db = createAdminSupabaseClient();
  const { data: profile, error } = await db
    .from("team_public_profiles")
    .select("organization_id,settings,logo_url")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !profile) notFound();
  const parsed = teamPageSettingsSchema.safeParse(profile.settings);
  if (!parsed.success || !parsed.data.published) notFound();
  const s = parsed.data;
  const { data: games } = await db.rpc("read_public_team_games", {
    p_org: profile.organization_id,
  });
  const { data: news } = s.news
    ? await db
        .from("team_news")
        .select("id,summary,content,photo_url,created_at")
        .eq("organization_id", profile.organization_id)
        .eq("published", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30)
    : { data: [] };
  const sponsors = s.sponsors
    ? await gameLibrarySponsors("", profile.organization_id).catch(() => [])
    : [];
  return (
    <main className="mx-auto max-w-5xl p-5">
      <header className="panel mb-5 flex items-center gap-5">
        {profile.logo_url && (
          <img
            src={profile.logo_url}
            alt=""
            className="h-24 w-24 object-contain"
          />
        )}
        <div>
          <h1 className="text-3xl font-black">{s.name}</h1>
          <p className="mt-3">{s.description}</p>
          {s.socials && (
            <div className="mt-3 flex gap-5">
              {s.facebook && (
                <a
                  className="text-cyan-300 underline"
                  href={s.facebook}
                  target="_blank"
                  rel="noreferrer"
                >
                  Facebook
                </a>
              )}
              {s.instagram && (
                <a
                  className="text-cyan-300 underline"
                  href={s.instagram}
                  target="_blank"
                  rel="noreferrer"
                >
                  Instagram
                </a>
              )}
            </div>
          )}
        </div>
      </header>
      {s.photo && (
        <img
          src={s.photo}
          alt={s.name + " team photo"}
          className="mb-5 max-h-96 w-full rounded-xl object-contain"
        />
      )}
      {!!sponsors.length && (
        <section className="panel mb-5">
          <h2 className="mb-4 text-xl font-bold">Thank you to our sponsors</h2>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
            {sponsors.map((sponsor) => (
              <img
                key={sponsor.id}
                src={sponsor.dataUrl}
                alt={sponsor.name}
                className="h-32 w-full object-contain"
              />
            ))}
          </div>
        </section>
      )}
      {s.news && (
        <section className="mb-5 grid gap-3">
          <h2 className="text-xl font-bold">Team news</h2>
          {news?.map((item) => (
            <article className="panel" key={item.id}>
              <time className="text-sm text-slate-400">
                {new Date(item.created_at).toLocaleDateString("en-CA")}
              </time>
              <NewsContent content={item.content} summary={item.summary} />
              {item.photo_url && (
                <img
                  src={item.photo_url}
                  alt="Team update"
                  className="mt-3 max-h-96 w-full object-contain"
                />
              )}
            </article>
          ))}
          {!news?.length && <p>No updates yet.</p>}
        </section>
      )}
      {(["upcoming", "results"] as const)
        .filter((key) => s[key])
        .map((key) => (
          <section key={key} className="mb-5 grid gap-3">
            <h2 className="text-xl font-bold">
              {key === "results" ? "Results & replays" : "Upcoming games"}
            </h2>
            {(games ?? [])
              .filter(
                (g: PublicGame) => Boolean(g.completed) === (key === "results"),
              )
              .map((g: PublicGame) => (
                <article
                  key={g.id}
                  className="panel flex flex-wrap items-center justify-between gap-4"
                >
                  <div>
                    <strong>
                      {g.home} vs {g.away}
                    </strong>
                    <p>
                      {g.event}
                      {g.number ? ` · Game ${g.number}` : ""}
                    </p>
                    <p className="text-sm text-slate-400">
                      {g.completed || g.scheduled
                        ? new Date(
                            g.completed || g.scheduled!,
                          ).toLocaleDateString("en-CA")
                        : ""}
                    </p>
                  </div>
                  {g.result && (
                    <strong>
                      {g.result.home} – {g.result.away}
                    </strong>
                  )}
                  {g.youtube &&
                    /^https:\/\/www.youtube.com\/watch\?v=/.test(g.youtube) && (
                      <a
                        href={g.youtube}
                        className="btn-secondary"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Watch on YouTube
                      </a>
                    )}
                </article>
              ))}
          </section>
        ))}
      <footer className="mt-8 flex justify-center">
        <img
          src="/branding/curlstreamer-logo.png"
          alt="Curl Streamer"
          className="w-52 object-contain"
        />
      </footer>
    </main>
  );
}
type PublicGame = {
  id: string;
  home: string;
  away: string;
  event: string;
  number: number | null;
  scheduled: string | null;
  completed: string | null;
  result: { home: number; away: number } | null;
  youtube: string | null;
};
