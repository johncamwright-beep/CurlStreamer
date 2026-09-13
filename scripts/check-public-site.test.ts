import { describe, expect, it, vi } from "vitest";
import { checkPublicSite } from "./check-public-site.mjs";
describe("public availability checks", () => {
  it("checks the database-backed sitemap and one public team, ignoring outside URLs", async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("robots.txt")
            ? "Sitemap: https://www.curlstreamer.app/sitemap.xml"
            : url.endsWith("sitemap.xml")
              ? "<urlset><url><loc>https://www.curlstreamer.app/</loc></url><url><loc>https://attacker.example/secret</loc></url><url><loc>https://sample-team.curlstreamer.app/</loc></url></urlset>"
              : "<h1>CurlStreamer</h1>",
        ),
    );
    const result = await checkPublicSite(fetcher);
    expect(result.ok).toBe(true);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://www.curlstreamer.app/",
      "https://www.curlstreamer.app/robots.txt",
      "https://www.curlstreamer.app/sitemap.xml",
      "https://sample-team.curlstreamer.app/",
    ]);
  });
  it("fails when a database outage breaks the sitemap and never reports response bodies", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("sitemap.xml")
        ? new Response("private diagnostic", { status: 503 })
        : new Response("CurlStreamer Sitemap: <h1>team</h1>"),
    );
    const result = await checkPublicSite(fetcher);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
  });
  it("does not treat redirects or login pages as a healthy sitemap", async () => {
    const result = await checkPublicSite(
      vi.fn(async () => new Response("login", { status: 302 })),
    );
    expect(result.ok).toBe(false);
  });
});
