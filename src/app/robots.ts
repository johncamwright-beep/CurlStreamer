import type { MetadataRoute } from "next";
import { headers } from "next/headers";
export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host")?.toLowerCase().split(":")[0] ?? "";
  const publicHost = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.)?curlstreamer\.app$/.test(
    host,
  );
  if (!publicHost) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/account",
        "/dashboard",
        "/score/",
        "/games/",
        "/settings/",
        "/login",
        "/join/",
        "/camera/",
        "/receiver/",
      ],
    },
    sitemap: `https://${host}/sitemap.xml`,
  };
}
