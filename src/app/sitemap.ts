import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readPublishedTeamProfile } from "@/lib/providers/public-team-profile";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host")?.toLowerCase().split(":")[0] ?? "";
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.curlstreamer\.app$/.exec(host);
  if (match && match[1] !== "www")
    return (await readPublishedTeamProfile(match[1]))
      ? [{ url: `https://${host}/` }]
      : [];
  const result: MetadataRoute.Sitemap = [
    { url: "https://www.curlstreamer.app/" },
  ];
  const db = createAdminSupabaseClient();
  for (let offset = 0; offset < 49000; offset += 1000) {
    const { data, error } = await db
      .from("team_public_profiles")
      .select("slug")
      .eq("settings->>published", "true")
      .order("slug")
      .range(offset, offset + 999);
    if (error) throw new Error("Published team sitemap unavailable");
    for (const item of data ?? [])
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug))
        result.push({ url: `https://${item.slug}.curlstreamer.app/` });
    if (!data || data.length < 1000) break;
  }
  return result;
}
