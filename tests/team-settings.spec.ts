import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { defaultTeamPageSettings } from "../src/lib/team-page-settings";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated authenticated account fixture",
);

test("team logos preserve uploaded alpha, update account appearance and allow the same file again", async ({
  page,
}) => {
  const pixels = Buffer.alloc(16 * 16 * 4);
  pixels.set([20, 100, 200, 255], (8 * 16 + 8) * 4);
  pixels.set([20, 100, 200, 128], (8 * 16 + 9) * 4);
  const png = await sharp(pixels, {
    raw: { width: 16, height: 16, channels: 4 },
  })
    .png()
    .toBuffer();
  const file = { name: "team-logo.png", mimeType: "image/png", buffer: png };
  const oldLogo = "https://media.test/old-logo.png";
  let logo = oldLogo;
  let uploads = 0;
  let appearanceReads = 0;
  let appearanceCompletions = 0;
  let holdAppearance = false;
  let releaseAppearance!: () => void;
  const appearanceGate = new Promise<void>((resolve) => {
    releaseAppearance = resolve;
  });
  await page.route("https://media.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/api/account/appearance", async (route) => {
    appearanceReads++;
    const snapshot = logo;
    if (holdAppearance) await appearanceGate;
    await route.fulfill({ json: { logo: snapshot } });
    appearanceCompletions++;
  });
  await page.route("**/api/account/team", async (route) => {
    const request = route.request();
    if (request.method() !== "POST")
      return route.fulfill({
        json: {
          settings: defaultTeamPageSettings("Team Benning"),
          logo,
          canEdit: true,
        },
      });
    const form = await new Request(request.url(), {
      method: "POST",
      headers: request.headers(),
      body: new Uint8Array(request.postDataBuffer()!),
    }).formData();
    expect(form.get("kind")).toBe("logo");
    const uploaded = form.get("file") as File;
    expect(uploaded.type).toBe("image/png");
    expect(uploaded.size).toBeLessThanOrEqual(300000);
    const bytes = Buffer.from(await uploaded.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    expect(decoded[3]).toBe(0);
    expect(decoded[(8 * 16 + 8) * 4 + 3]).toBe(255);
    expect(decoded[(8 * 16 + 9) * 4 + 3]).toBe(128);
    uploads++;
    if (uploads === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Test upload temporarily unavailable." },
      });
    logo = `https://media.test/team-logo-${uploads}.png`;
    return route.fulfill({ json: { logo } });
  });
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  const headerLogo = page.locator(".account-shortcut img");
  await expect(headerLogo).toHaveAttribute("src", oldLogo);
  await page.getByRole("button", { name: "Team info", exact: true }).click();
  const input = page.getByLabel("Upload team logo");
  const preview = page.getByAltText("Team logo", { exact: true });
  await expect(preview).toHaveCSS("object-fit", "contain");
  await expect(page.getByText(/transparency is preserved/)).toBeVisible();
  await input.setInputFiles(file);
  await expect(
    page.getByText("Test upload temporarily unavailable."),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(headerLogo).toHaveAttribute("src", oldLogo);
  holdAppearance = true;
  const readsBeforeRefresh = appearanceReads;
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect.poll(() => appearanceReads).toBeGreaterThan(readsBeforeRefresh);
  await page
    .getByRole("navigation", { name: "CurlStreamer navigation" })
    .getByRole("button", { name: "Close navigation menu" })
    .click();
  try {
    await input.setInputFiles(file);
    await expect(page.getByText("Team logo saved.")).toBeVisible();
    await expect(preview).toHaveAttribute("src", logo);
    // The appearance endpoint is still held: this must come from the upload.
    await expect(headerLogo).toHaveAttribute("src", logo);
    await expect
      .poll(() => appearanceReads)
      .toBeGreaterThan(readsBeforeRefresh + 1);
  } finally {
    holdAppearance = false;
    releaseAppearance();
  }
  await expect
    .poll(() => appearanceCompletions)
    .toBeGreaterThan(readsBeforeRefresh + 1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(headerLogo).toHaveAttribute("src", logo);
  await input.setInputFiles(file);
  await expect.poll(() => uploads).toBe(3);
  await expect(preview).toHaveAttribute(
    "src",
    "https://media.test/team-logo-3.png",
  );
  await expect(headerLogo).toHaveAttribute(
    "src",
    "https://media.test/team-logo-3.png",
  );
  await expect(input).toHaveValue("");
  await expect(headerLogo).toHaveCSS("object-fit", "contain");
});

test("support uploads update the selected team's preview without changing the administrator's account logo", async ({
  page,
}) => {
  const teamId = "22222222-2222-4222-8222-222222222222";
  const accountLogo = "https://media.test/account-logo.png";
  const supportLogo = "https://media.test/support-logo.png";
  let appearanceReads = 0;
  await page.route("https://media.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>',
    }),
  );
  await page.route("**/api/account/appearance", (route) => {
    appearanceReads++;
    return route.fulfill({ json: { logo: accountLogo } });
  });
  await page.route("**/api/admin", (route) =>
    route.fulfill({
      json: {
        teams: [
          { id: teamId, name: "Other team", trialExpiresAt: null, members: [] },
        ],
        accounts: [],
        codes: [],
      },
    }),
  );
  await page.route(`**/api/admin/teams/${teamId}`, (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? { logo: supportLogo }
          : {
              settings: defaultTeamPageSettings("Other team"),
              logo: null,
              canEdit: true,
            },
    }),
  );
  await page.goto("/login?next=/admin");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");
  const headerLogo = page.locator(".account-shortcut img");
  await expect(headerLogo).toHaveAttribute("src", accountLogo);
  await page.getByRole("button", { name: "View as / support" }).click();
  await page.getByRole("button", { name: "Team info", exact: true }).click();
  await page.getByRole("button", { name: "Enable support edits" }).click();
  const readsBeforeUpload = appearanceReads;
  const png = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 0, g: 100, b: 200, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Upload team logo")
    .setInputFiles({ name: "support.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Team logo saved.")).toBeVisible();
  await expect(page.getByAltText("Team logo", { exact: true })).toHaveAttribute(
    "src",
    supportLogo,
  );
  await expect(headerLogo).toHaveAttribute("src", accountLogo);
  expect(appearanceReads).toBe(readsBeforeUpload);
});

test("team trial code activates with a visible expiry and no payment authorization", async ({
  page,
}) => {
  let active = false;
  await page.route("**/api/account/trial", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        code: "CURL-01234567-89ABCDEF-01234567-89ABCDEF",
      });
      active = true;
    }
    await route.fulfill({
      json: {
        status: active ? "active" : "none",
        expiresAt: active ? "2027-01-01T05:00:00Z" : null,
      },
    });
  });
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  await page
    .getByRole("button", { name: "Trial & subscription", exact: true })
    .click();
  await page
    .getByLabel("Trial code", { exact: true })
    .fill("CURL-01234567-89ABCDEF-01234567-89ABCDEF");
  await page.getByRole("button", { name: "Activate team trial" }).click();
  await expect(
    page.getByText("Your team’s pilot access is active.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Pilot access ends: December 31, 2026/),
  ).toBeVisible();
  await expect(
    page.getByText(/does not authorize automatic charges/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate team trial" }),
  ).toHaveCount(0);
});
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
  let teamReads = 0;
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
    teamReads++;
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
  expect(teamReads).toBe(0);
  await menu.getByRole("button", { name: "Team info", exact: true }).click();
  await page.getByLabel("About the team").fill("Our team biography.");
  await page
    .getByLabel("Team tagline", { exact: true })
    .fill("Together on the ice");
  await page.getByLabel("third", { exact: true }).fill("Sam");
  await page.getByLabel("Skip throws").selectOption("third");
  await page.getByLabel("Coach 1", { exact: true }).fill("  Alex Smith  ");
  await page.getByLabel("Coach 2", { exact: true }).fill("Sam Lee");
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
  expect(settings.coaches).toEqual(["Alex Smith", "Sam Lee"]);
  await page.reload();
  await expect(page.getByLabel("Team tagline", { exact: true })).toHaveValue(
    "Together on the ice",
  );
  await expect(page.getByLabel("third", { exact: true })).toHaveValue("Sam");
  await expect(page.getByLabel("Skip throws")).toHaveValue("third");
  await expect(page.getByLabel("Coach 1", { exact: true })).toHaveValue(
    "Alex Smith",
  );
  await expect(page.getByLabel("Coach 2", { exact: true })).toHaveValue(
    "Sam Lee",
  );
  await expect(page.getByLabel("Coach 1", { exact: true })).toHaveAttribute(
    "maxlength",
    "100",
  );
  await page.getByLabel("Coach 1", { exact: true }).fill("");
  await expect(page.getByLabel("Coach 2", { exact: true })).toHaveValue(
    "Sam Lee",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Team settings saved.")).toBeVisible();
  expect(settings.coaches).toEqual(["Sam Lee"]);
  await page.reload();
  await expect(page.getByLabel("Coach 1", { exact: true })).toHaveValue(
    "Sam Lee",
  );
  await expect(page.getByLabel("Coach 2", { exact: true })).toHaveValue("");
  await page.getByLabel("Coach 1", { exact: true }).fill(" ");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Team settings saved.")).toBeVisible();
  expect(settings.coaches).toEqual([]);
  await page.reload();
  await expect(page.getByLabel("Coach 1", { exact: true })).toHaveValue("");
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
  await expect(page).toHaveTitle(
    "Test Curling Club | CurlStreamer - Curling Management App",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /^A curling team with a long story\./,
  );
  await expect(page.locator("#team-news")).toHaveAttribute(
    "data-nosnippet",
    "",
  );
  const coaches = page.getByRole("region", { name: "Coaches", exact: true });
  await expect(coaches.getByRole("listitem")).toHaveText([
    "Taylor Coach",
    "Morgan Coach",
  ]);
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
  await expect(games.getByLabel("Show games")).toHaveValue("recent");
  const now = Date.now();
  const recentDates = Array.from({ length: 14 }, (_, i) =>
    Date.UTC(2026, 9, i + 1, 12),
  )
    .filter((stamp) => stamp <= now && stamp >= now - 14 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b - a);
  await expect(games.getByRole("article")).toHaveCount(recentDates.length);
  expect(
    await games
      .locator("article time")
      .evaluateAll((times) =>
        times.map((time) => Date.parse(time.getAttribute("datetime")!)),
      ),
  ).toEqual(recentDates);
  await games.getByLabel("Show games").selectOption("upcoming");
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
  const accomplishmentYear = page.getByRole("combobox", {
    name: "Accomplishments year",
  });
  await expect(accomplishmentYear).toHaveValue(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Toronto",
    }).format(new Date()),
  );
  await accomplishmentYear.selectOption("2020");
  await expect(
    page.getByText("Past championship", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1st place · 2026", { exact: true })).toHaveCount(
    0,
  );
  await accomplishmentYear.selectOption("all");
  await expect(
    page.getByText("Past championship", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1st place · 2026", { exact: true }),
  ).toBeVisible();
  const accomplishmentLayout = await page
    .getByRole("region", { name: "Accomplishments", exact: true })
    .locator("li")
    .evaluateAll((rows) =>
      rows.map((row) => ({
        iconWidth: row.querySelector("span")!.getBoundingClientRect().width,
        textLeft: row.querySelector("div")!.getBoundingClientRect().left,
      })),
    );
  expect(accomplishmentLayout).toHaveLength(2);
  expect(accomplishmentLayout.map((row) => row.iconWidth)).toEqual([32, 32]);
  expect(accomplishmentLayout[0].textLeft).toBe(
    accomplishmentLayout[1].textLeft,
  );
  await expect(page.locator(".public-team-content-area")).toHaveCSS(
    "background-color",
    "rgb(237, 242, 247)",
  );
  await expect(page.locator(".public-team-app-bar")).toHaveCSS(
    "background-color",
    "rgb(7, 17, 31)",
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

test("owners can transfer one coaching seat and assign two with two licences", async ({
  page,
}) => {
  let seats = 1;
  let selected = ["owner-member"];
  await page.route("**/api/account/curlcoach", async (route) => {
    if (route.request().method() === "POST")
      selected = route.request().postDataJSON().membershipIds;
    await route.fulfill({
      json: {
        available: true,
        enabled: true,
        seats,
        canManage: true,
        members: [
          {
            id: "owner-member",
            email: "owner@coach.test",
            role: "owner",
            assigned: selected.includes("owner-member"),
          },
          {
            id: "other-member",
            email: "coach@coach.test",
            role: "game_operator",
            assigned: selected.includes("other-member"),
          },
        ],
      },
    });
  });
  await page.goto("/login?next=/account?section=members");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const licences = page.getByRole("region", { name: "Shot Tracker licences" });
  await expect(licences).toBeVisible();
  await expect(
    licences.getByLabel("coach@coach.test", { exact: true }),
  ).toBeDisabled();
  await licences.getByLabel("owner@coach.test (owner)").uncheck();
  await licences.getByLabel("coach@coach.test", { exact: true }).check();
  await licences
    .getByRole("button", { name: "Save coaching assignments" })
    .click();
  await expect(licences.getByRole("status")).toContainText("saved");
  expect(selected).toEqual(["other-member"]);
  seats = 2;
  await licences.getByRole("button", { name: "Reload licences" }).click();
  await licences.getByLabel("owner@coach.test (owner)").check();
  await licences
    .getByRole("button", { name: "Save coaching assignments" })
    .click();
  await expect(licences.getByRole("status")).toContainText("saved");
  expect(selected).toHaveLength(2);
});

test("seven-day setup access explains no streaming and offers nonrenewing season checkout", async ({
  page,
}) => {
  await page.route("**/api/account/season", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        base: true,
        coaches: 1,
      });
      return route.fulfill({
        status: 409,
        json: { error: "Test checkout deliberately stopped before payment" },
      });
    }
    return route.fulfill({
      json: {
        available: true,
        mode: "test",
        canManage: true,
        access: {
          setupExpiresAt: "2026-09-22T12:00:00Z",
          pageEnabled: true,
          streamEnabled: false,
        },
      },
    });
  });
  await page.goto("/login?next=/account?section=subscription");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const season = page.getByRole("region", { name: "Season access" });
  await expect(season).toContainText(
    "does not include streaming or Shot Tracker",
  );
  await expect(season).toContainText("No automatic renewal");
  await season.getByLabel("Shot Tracker licences to add").selectOption("1");
  await expect(season).toContainText("Total: $128 CAD");
  await season
    .getByRole("button", { name: "Open test season checkout" })
    .click();
  await expect(season.getByRole("alert")).toContainText("deliberately stopped");
});

test("season checkout respects existing purchases and never claims success from the return URL", async ({
  page,
}) => {
  await page.route("**/api/account/season", (route) =>
    route.fulfill({
      json: {
        available: true,
        mode: "test",
        canManage: true,
        purchase: { baseOwned: true, coachSeats: 1, pending: false },
        access: { pageEnabled: true, streamEnabled: false },
      },
    }),
  );
  await page.goto(
    "/login?next=" +
      encodeURIComponent("/account?section=subscription&season=returned"),
  );
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const season = page.getByRole("region", { name: "Season access" });
  await expect(season).toContainText(
    "returning here alone does not confirm payment",
  );
  await expect(season.getByLabel("CurlStreamer season pass")).toBeDisabled();
  await expect(season.getByLabel("CurlStreamer season pass")).not.toBeChecked();
  await expect(
    season.getByRole("button", { name: "Open test season checkout" }),
  ).toBeDisabled();
  await season.getByLabel("Shot Tracker licences to add").selectOption("1");
  await expect(season).toContainText("Total: $39 CAD");
  await expect(
    season.getByRole("button", { name: "Open test season checkout" }),
  ).toBeEnabled();
  await expect(
    season.getByRole("button", { name: "Cancel pending checkout" }),
  ).toBeDisabled();
});
