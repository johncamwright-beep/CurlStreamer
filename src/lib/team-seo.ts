import type { TeamPageSettings } from "./team-page-settings";
import { throwingPositions } from "./team-page-settings";
import type { Metadata } from "next";
import type { PublicGame } from "@/components/PublicTeamGames";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";

export function teamMetadata(
  slug: string,
  s: TeamPageSettings,
  logo: string | null,
): Metadata {
  const url = `https://${slug}.curlstreamer.app/`;
  const title = `${s.name} | Games, Results & Team News`;
  const description = (
    s.tagline ||
    s.description ||
    `Meet ${s.name}. Follow upcoming curling games, results, team news and broadcasts.`
  ).slice(0, 160);
  const photo = s.photo || logo;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: s.name,
      ...(photo ? { images: [{ url: photo, alt: `${s.name} team` }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(photo ? { images: [photo] } : {}),
    },
  };
}

export function teamStructuredData(
  slug: string,
  s: TeamPageSettings,
  logo: string | null,
  games: PublicGame[] = [],
) {
  const url = `https://${slug}.curlstreamer.app/`;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": url,
    url,
    name: s.name,
    description: s.description || s.tagline,
    mainEntity: {
      "@type": "SportsTeam",
      "@id": `${url}#team`,
      name: s.name,
      url,
      sport: "Curling",
      description: s.description || s.tagline,
      ...(logo ? { logo } : {}),
      ...(s.photo ? { image: s.photo } : {}),
      ...(s.socials
        ? { sameAs: [s.facebook, s.instagram].filter(Boolean) }
        : {}),
      athlete: throwingPositions
        .filter((position) => s.roster[position])
        .map((position) => ({
          "@type": "Person",
          name: s.roster[position],
          description: `${position[0].toUpperCase()}${position.slice(1)}${s.roster.skip === position ? " / Skip" : ""}`,
        })),
      ...(s.upcoming
        ? {
            event: games
              .filter((g) => !g.completed && g.scheduled)
              .map((g) => ({
                "@type": "SportsEvent",
                name: `${g.home} vs ${g.away}${g.event ? ` — ${g.event}` : ""}${g.number ? ` · Game ${g.number}` : ""}`,
                startDate: g.scheduled,
                url: `${url}#game-${g.id}`,
                ...(youtubeWatchUrlSchema.safeParse(g.youtube).success
                  ? { sameAs: g.youtube }
                  : {}),
                competitor: [
                  { "@type": "SportsTeam", name: g.home },
                  { "@type": "SportsTeam", name: g.away },
                ],
              })),
          }
        : {}),
    },
  };
}

export function safeStructuredJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
