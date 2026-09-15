import { PublicTeamGames } from "@/components/PublicTeamGames";
import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readPublishedTeamProfile } from "@/lib/providers/public-team-profile";
import {
  teamMetadata,
  teamStructuredData,
  safeStructuredJson,
} from "@/lib/team-seo";
import { gameLibrarySponsors } from "@/lib/providers/sponsor-library";
import { newsPostTitle } from "@/lib/news-content";
import {
  PublicTeamProfile,
  type TeamAccomplishment,
} from "@/components/PublicTeamProfile";
import { EventPhotoCarousel } from "@/components/EventPhotoCarousel";
import { teamThemeStyle } from "@/lib/team-page-theme";
import { NewsContent } from "@/components/NewsContent";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await readPublishedTeamProfile(slug);
  return profile
    ? teamMetadata(slug, profile.settings, profile.logo_url)
    : { robots: { index: false, follow: false } };
}
export default async function PublicTeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound();
  const db = createAdminSupabaseClient();
  const profile = await readPublishedTeamProfile(slug);
  if (!profile) notFound();
  const s = profile.settings;
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
  const { data: accomplishments } = s.accomplishments
    ? await db
        .from("events")
        .select("id,name,end_date,result,level,show_level")
        .eq("organization_id", profile.organization_id)
        .in("result", ["1st", "2nd", "3rd", "qualified"])
        .order("end_date", { ascending: false })
        .limit(50)
    : { data: [] };
  return (
    <div className="public-team-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeStructuredJson(
            teamStructuredData(slug, s, profile.logo_url, games ?? []),
          ),
        }}
      />
      <header className="public-team-app-bar">
        <div className="public-team-app-bar__content">
          <div className="flex min-w-0 items-center gap-4">
            {profile.logo_url && (
              <img
                src={profile.logo_url}
                alt=""
                className="h-16 w-16 shrink-0 object-contain"
              />
            )}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black sm:text-3xl">
                {s.name}
              </h1>
              {s.tagline && (
                <p className="mt-1 text-sm sm:text-lg">{s.tagline}</p>
              )}
            </div>
          </div>
          <a
            href="https://curlstreamer.app/"
            aria-label="Visit CurlStreamer"
            className="public-team-app-bar__brand inline-flex min-h-11 shrink-0 items-center"
          >
            <img
              src="/branding/curlstreamer-logo.png"
              alt="CurlStreamer"
              className="w-44 max-w-full object-contain sm:w-52"
            />
          </a>
        </div>
      </header>
      <main
        className="public-team-content-area"
        style={teamThemeStyle(s.theme)}
      >
        <div className="mx-auto max-w-6xl p-5">
          <div className="public-team-layout">
            <div className="public-team-content min-w-0">
              <PublicTeamGames
                games={games ?? []}
                teamName={s.name}
                upcoming={s.upcoming}
                results={s.results}
              />
              {s.socials && (s.facebook || s.instagram) && (
                <section className="panel mb-5">
                  <h2 className="mb-3 text-xl font-bold">Social media</h2>
                  <p>Follow the team for more updates.</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {s.facebook && (
                      <a
                        className="btn-secondary"
                        href={s.facebook}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Facebook
                      </a>
                    )}
                    {s.instagram && (
                      <a
                        className="btn-secondary"
                        href={s.instagram}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Instagram
                      </a>
                    )}
                  </div>
                </section>
              )}
              {s.news && (
                <section id="team-news" className="panel mb-5 grid gap-2">
                  <h2 className="text-xl font-bold">{s.name} News</h2>
                  {news?.map((item) => (
                    <details
                      className="border-b border-slate-700 py-2"
                      key={item.id}
                    >
                      <summary className="min-h-11 cursor-pointer">
                        <span className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-2 align-middle">
                          <strong>
                            {newsPostTitle(item.content, item.summary)}
                          </strong>
                          <time className="text-sm text-slate-400">
                            {new Date(item.created_at).toLocaleDateString(
                              "en-CA",
                              { timeZone: "UTC" },
                            )}
                          </time>
                        </span>
                      </summary>
                      <div className="mt-4">
                        <NewsContent
                          content={item.content}
                          summary={item.summary}
                        />
                        {item.photo_url && (
                          <img
                            src={item.photo_url}
                            alt="Team update"
                            className="mt-3 aspect-video w-full object-cover object-center"
                          />
                        )}
                      </div>
                    </details>
                  ))}
                  {!news?.length && <p>No updates yet.</p>}
                </section>
              )}
              {!!sponsors.length && (
                <section id="sponsors" className="panel mb-5">
                  <h2 className="mb-4 text-xl font-bold">
                    {s.name} is proudly sponsored by…
                  </h2>
                  <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
                    {sponsors.map((sponsor) => (
                      <div key={sponsor.id} className="text-center">
                        <img
                          src={sponsor.dataUrl}
                          alt={sponsor.name}
                          className="h-32 w-full object-contain"
                        />
                        {sponsor.website ? (
                          <a
                            href={sponsor.website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-11 items-center underline"
                          >
                            {sponsor.name}
                          </a>
                        ) : (
                          <p className="mt-2 font-semibold">{sponsor.name}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {s.photos && <EventPhotoCarousel photos={s.gallery} />}
            </div>
            <PublicTeamProfile
              settings={s}
              logo={profile.logo_url}
              accomplishments={(accomplishments ?? []) as TeamAccomplishment[]}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
