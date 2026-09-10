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
  await expect(page.getByLabel("Publish team page")).not.toBeChecked();
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
    description: "Curling together.",
    published: false,
    facebook: "https://www.facebook.com/teambenning",
  });
  await expect(
    page.getByRole("button", { name: /Connect Facebook/ }),
  ).toBeDisabled();
});

test("public page link follows saved publication and slug, and navigates in this tab", async ({
  page,
}) => {
  let settings = {
    ...defaultTeamPageSettings("Team Benning"),
    published: true,
  };
  let rejectSave = false;
  await page.route("**/api/account/team", async (route) => {
    if (route.request().method() === "PATCH") {
      if (rejectSave)
        return route.fulfill({
          status: 409,
          json: { error: "That team address is already taken." },
        });
      settings = route.request().postDataJSON();
      return route.fulfill({ json: { saved: true, settings } });
    }
    return route.fulfill({ json: { settings, logo: null, canEdit: true } });
  });
  await page.route("**/api/account/news", (route) =>
    route.fulfill({ json: { posts: [] } }),
  );
  await page.route("**/teams/new-team", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Public team page</h1>",
    }),
  );
  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  await page
    .getByRole("button", { name: "Public team page", exact: true })
    .click();
  const link = page.getByRole("link", { name: "View saved public page" });
  await expect(link).toHaveAttribute("href", "/teams/team-benning");
  await page.getByLabel("Team subdomain").fill("new-team");
  await expect(link).toHaveAttribute("href", "/teams/team-benning");
  rejectSave = true;
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("That team address is already taken."),
  ).toBeVisible();
  await expect(link).toHaveAttribute("href", "/teams/team-benning");
  rejectSave = false;
  await page.getByLabel("Publish team page").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(link).toHaveCount(0);
  await page.getByLabel("Publish team page").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(link).toHaveAttribute("href", "/teams/new-team");
  await link.click();
  await expect(page).toHaveURL(/\/teams\/new-team$/);
  await expect(
    page.getByRole("heading", { name: "Public team page" }),
  ).toBeVisible();
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
  await page.route("**/api/account/news", async (route) => {
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
  await news.getByRole("button", { name: "New post", exact: true }).click();
  await expect(news.getByLabel("Publish this post")).not.toBeChecked();
  await news.getByLabel("News text").fill("Thank you to our sponsors!");
  await news.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(news.getByText("Draft", { exact: true })).toBeVisible();
  await news.getByRole("button", { name: "Edit post", exact: true }).click();
  await news.getByLabel("News text").fill("See you at the next game!");
  await news.getByLabel("Publish this post").check();
  await news.getByRole("button", { name: "Save and publish" }).click();
  await expect(news.getByText("Published", { exact: true })).toBeVisible();
  await news.getByRole("button", { name: "Remove post", exact: true }).click();
  await expect(
    news.getByText("See you at the next game!", { exact: true }),
  ).toBeVisible();
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
  await page.getByLabel("Upload team photo").setInputFiles({
    name: "team.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture upload intercepted"),
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
