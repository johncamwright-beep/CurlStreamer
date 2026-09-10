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
  await expect(page.getByLabel("Publish team page")).not.toBeChecked();
  await page.getByLabel("About the team").fill("Curling together.");
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
