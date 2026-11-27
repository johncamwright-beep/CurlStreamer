import { pathToFileURL } from "node:url";
import path from "node:path";

export async function checkPublicSite(fetcher = fetch) {
  const results = [];
  async function check(name, url, validate) {
    try {
      const response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 200) throw Error("Unexpected HTTP status");
      const body = await response.text();
      if (!validate(body)) throw Error("Unexpected response content");
      results.push({ name, ok: true });
      return body;
    } catch {
      results.push({ name, ok: false });
      return "";
    }
  }
  await check("Product homepage", "https://www.curlstreamer.app/", (body) =>
    /curl\s*streamer/i.test(body),
  );
  await check(
    "Robots discovery",
    "https://www.curlstreamer.app/robots.txt",
    (body) => /sitemap:/i.test(body),
  );
  const sitemap = await check(
    "Published-team sitemap",
    "https://www.curlstreamer.app/sitemap.xml",
    (body) =>
      /<urlset[\s>]/.test(body) &&
      body.includes("https://www.curlstreamer.app/"),
  );
  // Accept only a root URL on a public team subdomain; never follow arbitrary
  // URLs supplied by fetched content or contact account/admin endpoints.
  const urls = [
    ...sitemap.matchAll(
      /<loc>(https:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\.curlstreamer\.app\/?)<\/loc>/g,
    ),
  ];
  const firstTeam = urls.find((match) => match[2] !== "www");
  if (firstTeam)
    await check(
      "Published team page",
      firstTeam[1],
      (body) => /<h1[\s>]/.test(body) && /curl\s*streamer/i.test(body),
    );
  return {
    checkedAt: new Date().toISOString(),
    ok: results.every((result) => result.ok),
    results,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await checkPublicSite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
