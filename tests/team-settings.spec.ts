import { expect, test } from "@playwright/test";
import { defaultTeamPageSettings } from "../src/lib/team-page-settings";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated authenticated account fixture",
);
test("team settings save visibility and social profiles without publishing by default", async ({
  page,
}) => {
  const settings = defaultTeamPageSettings("Team Benning");
  let saved: unknown;
  await page.route("**/api/account/team", async (route) => {
    if (route.request().method() === "PATCH") {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { saved: true } });
    } else
      await route.fulfill({ json: { settings, logo: null, canEdit: true } });
  });
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  await expect(page.getByText("Display name", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Public team page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish team page", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Page background", { exact: true }).fill("#112233");
  await page.getByLabel("Panel background", { exact: true }).fill("#eeeeee");
  await page.getByLabel("Accent color", { exact: true }).fill("#bb0000");
  await page.getByRole("button", { name: "Team info", exact: true }).click();
  await page.getByLabel("About the team").fill("Curling together.");
  await page.getByRole("button", { name: "Social media", exact: true }).click();
  await page
    .getByLabel("Facebook Page link")
    .fill("https://www.facebook.com/teambenning");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Team settings saved." }),
  ).toBeVisible();
  expect(saved).toMatchObject({
    theme: { background: "#112233", panel: "#eeeeee", accent: "#bb0000" },
    description: "Curling together.",
    published: false,
    facebook: "https://www.facebook.com/teambenning",
  });
  await expect(
    page.getByRole("button", { name: /Connect Facebook/ }),
  ).toBeDisabled();
});

test("publication requires confirmation then locks the subdomain and exposes its link", async ({
  page,
}) => {
  let settings = defaultTeamPageSettings("Team Benning");
  let writes = 0;
  await page.route("**/api/account/team", async (route) => {
    if (route.request().method() === "PATCH") {
      writes++;
      expect(route.request().headers()["x-team-publish"]).toBe("confirm");
      settings = route.request().postDataJSON();
      return route.fulfill({ json: { settings, saved: true } });
    }
    return route.fulfill({ json: { settings, logo: null, canEdit: true } });
  });
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  await page
    .getByRole("button", { name: "Public team page", exact: true })
    .click();
  await page.getByLabel("Team subdomain").fill("new-team");
  await page
    .getByRole("button", { name: "Publish team page", exact: true })
    .click();
  expect(writes).toBe(0);
  await expect(
    page.getByText("Each team can publish one subdomain.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm permanent address" }).click();
  await expect(page.getByLabel("Team subdomain")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish team page", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Visit new-team.curlstreamer.app" }),
  ).toHaveAttribute("href", "https://new-team.curlstreamer.app");
  await page.reload();
  await expect(page.getByLabel("Team subdomain")).toBeDisabled();
  expect(writes).toBe(1);
});

test("team news drafts, edits and removal stay compact and explicit", async ({
  page,
}) => {
  let posts: any[] = [];
  await page.route("**/api/account/team", (route) =>
    route.fulfill({
      json: {
        settings: defaultTeamPageSettings("Team Benning"),
        logo: null,
        canEdit: true,
      },
    }),
  );
  await page.route(/\/api\/account\/news(?:\?.*)?$/, async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { posts } });
    if (method === "DELETE") {
      posts = [];
      return route.fulfill({ json: { removed: true } });
    }
    posts = [
      {
        id: "10000000-0000-4000-8000-000000000001",
        revision: method === "POST" ? 1 : 2,
        summary:
          method === "POST"
            ? "Thank you to our sponsors!"
            : "See you at the next game!",
        photo_url: null,
        published: method === "PATCH",
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
  await news.getByLabel("Post title").fill("Sponsor thanks");
  await expect(news.getByText(/Draft post/)).toBeVisible();
  await news.getByLabel("News text").fill("Thank you to our sponsors!");
  await news.getByRole("button", { name: "Save draft", exact: true }).click();
  await news.getByRole("link", { name: /Thank you to our sponsors!/ }).click();
  await news.getByLabel("News text").fill("See you at the next game!");

  await news.getByRole("button", { name: "Save and publish" }).click();
  await news.getByRole("link", { name: /See you at the next game!/ }).click();
  await expect(news.getByText(/Published post/)).toBeVisible();
  await news.getByRole("button", { name: "Remove post", exact: true }).click();
  await expect(news.getByLabel("News text")).toBeVisible();
  await news.getByRole("button", { name: "Confirm removal" }).click();
  await expect(news.getByText("No news posts yet.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("account sections preserve edits, support back navigation and save a team photo", async ({
  page,
}, testInfo) => {
  let settings = defaultTeamPageSettings("Team Benning");
  const photo = "https://media.test/team-photo.png";
  await page.route("https://media.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#164e63"/></svg>',
    }),
  );
  await page.route("**/api/account/team", async (route) => {
    if (route.request().method() === "POST") {
      const request = route.request();
      const form = await new Request(request.url(), {
        method: "POST",
        headers: request.headers(),
        body: new Uint8Array(request.postDataBuffer()!),
      }).formData();
      const uploaded = form.get("file") as File;
      expect(uploaded.type).toBe("image/jpeg");
      expect(uploaded.size).toBeLessThanOrEqual(300000);
      if (form.get("kind") === "gallery") {
        settings = {
          ...settings,
          gallery: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              url: photo,
              caption: "",
            },
          ],
        };
        return route.fulfill({ json: { gallery: settings.gallery } });
      }
      settings = { ...settings, photo };
      return route.fulfill({ json: { photo } });
    }
    if (route.request().method() === "PATCH") {
      settings = route.request().postDataJSON();
      return route.fulfill({ json: { saved: true, settings } });
    }
    return route.fulfill({ json: { settings, logo: null, canEdit: true } });
  });
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  const menu = page.getByRole("navigation", {
    name: "Account settings sections",
  });
  await expect(page.getByLabel("Sign-in email")).toBeVisible();
  await menu.getByRole("button", { name: "Team info", exact: true }).click();
  await page.getByLabel("About the team").fill("Our team biography.");
  await page
    .getByLabel("Team tagline", { exact: true })
    .fill("Together on the ice");
  await page.getByLabel("third", { exact: true }).fill("Sam");
  await page.getByLabel("Skip throws").selectOption("third");
  await page.getByLabel("Upload team photo").setInputFiles({
    name: "team.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAYUlEQVRYhe2SQQkAQRDDqqKyzkT8e1gR9wgDhQhIQ9OP00Q36AagV+wuxF2iG3QD0Ct2F+Iu0Q26AegVuwtxl+gG3QD0it2FuEt0g24AesXuQtwlukE3AL1idyHuEt3gJw+VazhbjLy1zAAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.getByText("Team photo saved.")).toBeVisible();
  await menu
    .getByRole("button", { name: "Public team page", exact: true })
    .click();
  await expect(page.getByLabel("About the team")).toBeHidden();
  await page.goBack();
  await expect(page.getByLabel("About the team")).toHaveValue(
    "Our team biography.",
  );
  await expect(
    page.getByAltText("Team photo", { exact: true }),
  ).toHaveAttribute("src", photo);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Team settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Team tagline", { exact: true })).toHaveValue(
    "Together on the ice",
  );
  await expect(page.getByLabel("third", { exact: true })).toHaveValue("Sam");
  await expect(page.getByLabel("Skip throws")).toHaveValue("third");
  await expect(page.getByLabel("About the team")).toHaveValue(
    "Our team biography.",
  );
  await expect(
    page.getByAltText("Team photo", { exact: true }),
  ).toHaveAttribute("src", photo);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("account-settings.png"),
    fullPage: true,
  });
});

test("public page filters games and keeps five rows in its scrolling tile", async ({
  page,
}, testInfo) => {
  await page.route("https://media.test/portrait.png", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="teal"/><circle cx="200" cy="400" r="100" fill="white"/></svg>',
    }),
  );
  await page.goto("/teams/public-preview");
  await expect(
    page.getByRole("heading", { name: "Test Curling Club Games", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Team page sections" }),
  ).toHaveCount(0);
  await expect(page.getByText("7 games", { exact: true })).toHaveCount(0);
  await expect(page.locator(".public-team-profile")).toHaveCSS(
    "position",
    "static",
  );
  const photo = page
    .getByRole("complementary", { name: "Team profile" })
    .getByAltText("Test Curling Club team photo");
  await expect(photo).toHaveCSS("object-fit", "cover");
  const box = await photo.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  await expect(
    page.getByText("Full news story for the opening weekend.", { exact: true }),
  ).toBeHidden();
  await page.locator("summary").filter({ hasText: "Opening weekend" }).click();
  await expect(
    page.getByText("Full news story for the opening weekend.", { exact: true }),
  ).toBeVisible();

  const games = page.getByRole("region", { name: "Team games", exact: true });
  await expect(games.getByRole("article")).toHaveCount(7);
  await expect(
    games.getByRole("link", { name: "Watch on YouTube", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=test1234567");
  const scroll = games.getByRole("region", { name: "Filtered games" });
  expect(await scroll.evaluate((el) => el.clientHeight)).toBe(540);
  expect(await scroll.evaluate((el) => el.scrollHeight)).toBeGreaterThan(540);
  await games
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Orion" });
  await expect(games.getByRole("article")).toHaveCount(3);
  await games.getByLabel("Show games").selectOption("results");
  await expect(games.getByRole("article")).toHaveCount(4);
  await expect(games.getByRole("link", { name: "Watch replay" })).toHaveCount(
    4,
  );
  await expect(page.getByText("Skip (Third)", { exact: true })).toBeVisible();
  await expect(
    page.getByText("1st place · 2026", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".public-team-page")).toHaveCSS(
    "background-color",
    "rgb(237, 242, 247)",
  );
  await page.getByRole("button", { name: "More…", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Less", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({
    path: testInfo.outputPath("public-page.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
