import { expect, test } from "@playwright/test";
import { defaultTeamPageSettings } from "../src/lib/team-page-settings";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated authenticated account fixture",
);

test("formatted news and inline photos survive save and reopen", async ({
  page,
}, testInfo) => {
  let posts: Record<string, unknown>[] = [];
  const photo = "https://media.test/team-public-media/team/photo.png";
  await page.route("**/api/account/team", (route) =>
    route.fulfill({
      json: {
        settings: defaultTeamPageSettings("Team Benning"),
        logo: null,
        canEdit: true,
      },
    }),
  );
  await page.route("https://media.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#164e63"/><circle cx="320" cy="145" r="90" fill="#e2e8f0"/><circle cx="320" cy="145" r="60" fill="#ef4444"/><circle cx="320" cy="145" r="30" fill="#e2e8f0"/><text x="320" y="300" text-anchor="middle" font-family="sans-serif" font-size="24" fill="white">Team photo · test fixture</text></svg>',
    }),
  );
  await page.route("**/api/account/news/upload", (route) =>
    route.fulfill({ json: { url: photo } }),
  );
  await page.route(/\/api\/account\/news(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { posts } });
    const request = route.request();
    const form = await new Request(request.url(), {
      method: request.method(),
      headers: request.headers(),
      body: new Uint8Array(request.postDataBuffer()!),
    }).formData();
    posts = [
      {
        id: form.get("id"),
        revision: 1,
        summary: form.get("summary"),
        content: JSON.parse(String(form.get("content"))),
        photo_url: null,
        published: false,
        created_at: "2026-09-10T12:00:00Z",
        game_id: null,
      },
    ];
    return route.fulfill({ json: { saved: true, post: posts[0] } });
  });
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  await page.getByRole("button", { name: "News posts", exact: true }).click();
  const news = page.getByRole("region", { name: "Manage team news" });
  await news.getByRole("link", { name: "New post", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/news\/new$/);
  await news.getByLabel("Post title").fill("Season opening update");
  const editor = news.getByLabel("News text", { exact: true });
  await editor.fill("A great start to the season.");
  // Native select-all modifiers vary with the emulated mobile platform.
  await editor.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await news.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText(
    "A great start to the season.",
  );
  await news.getByLabel("Font family", { exact: true }).selectOption("Georgia");
  await news.getByLabel("Font size", { exact: true }).selectOption("20px");
  await news.getByLabel("Text color", { exact: true }).selectOption("#38bdf8");
  await news.getByRole("button", { name: "Link", exact: true }).click();
  await news.getByLabel("Link address").fill("https://example.com/team");
  await news.getByRole("button", { name: "Apply link", exact: true }).click();
  await editor.press("ArrowRight");
  await editor.press("Enter");
  await news.getByRole("button", { name: "Add photo", exact: true }).click();
  await news.getByLabel("Photo description").fill("Our team on the ice");
  await news
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "rink.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAYUlEQVRYhe2SQQkAQRDDqqKyzkT8e1gR9wgDhQhIQ9OP00Q36AagV+wuxF2iG3QD0Ct2F+Iu0Q26AegVuwtxl+gG3QD0it2FuEt0g24AesXuQtwlukE3AL1idyHuEt3gJw+VazhbjLy1zAAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  await expect(editor.locator("img")).toHaveAttribute("src", photo);
  await expect(editor.locator("img")).toHaveAttribute(
    "alt",
    "Our team on the ice",
  );
  await news.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    news
      .getByLabel("News preview")
      .locator("strong")
      .filter({ hasText: "A great start to the season." }),
  ).toBeVisible();
  await news.screenshot({ path: testInfo.outputPath("news-editor.png") });
  await news.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    news.getByRole("link", { name: /Season opening update/ }),
  ).toBeVisible();
  await expect(news.locator("img")).toHaveCount(0);
  expect(JSON.stringify(posts[0].content)).toContain('"bold"');
  expect(JSON.stringify(posts[0].content)).toContain(photo);
  expect(JSON.stringify(posts[0].content)).toContain("Georgia");
  expect(JSON.stringify(posts[0].content)).toContain("20px");
  expect(JSON.stringify(posts[0].content)).toContain(
    "https://example.com/team",
  );
  await news.getByRole("link", { name: /Season opening update/ }).click();
  await expect(news.getByLabel("Post title")).toHaveValue(
    "Season opening update",
  );
  await expect(editor.locator("strong")).toHaveText(
    "A great start to the season.",
  );
  await expect(editor.locator("img")).toHaveAttribute("src", photo);
  await expect(
    editor.locator('a[href="https://example.com/team"]'),
  ).toBeVisible();
  await expect(editor.locator('span[style*="Georgia"]').first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
