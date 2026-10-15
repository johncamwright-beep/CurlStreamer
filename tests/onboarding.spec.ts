import { expect, test } from "@playwright/test";
import { defaultTeamPageSettings } from "../src/lib/team-page-settings";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated account fixture",
);

test("owner setup saves actual profile details, resumes, and finishes without publishing", async ({
  page,
}) => {
  let settings = defaultTeamPageSettings("Test Curling Club");
  await page.route("**/api/account/team", async (route) => {
    if (route.request().method() === "PATCH")
      settings = route.request().postDataJSON();
    await route.fulfill({ json: { settings, logo: null, canEdit: true } });
  });
  await page.goto("/login?next=/dashboard");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Resume team setup" }),
  ).toHaveCount(0);
  await page.goto(new URL("/onboarding?start=1", page.url()).href);
  await expect(
    page.getByRole("heading", { name: "Your team", exact: true }),
  ).toBeVisible();
  await page.getByLabel("About the team").fill("Our first season together.");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Your public page", exact: true }),
  ).toBeVisible();
  expect(settings.description).toBe("Our first season together.");
  expect(settings.published).toBe(false);
  await page.getByRole("button", { name: "Save progress and exit" }).click();
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: "Resume team setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Your public page", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    page.getByRole("heading", { name: "Your season", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Choose season")
    .selectOption("33333333-3333-4333-8333-333333333333");
  await page
    .getByRole("button", { name: "Continue with selected season" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first event", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Timezone", exact: true }),
  ).toHaveValue("America/Toronto");
  await page
    .getByLabel("Choose event")
    .selectOption("55555555-5555-4555-8555-555555555555");
  await page
    .getByRole("button", { name: "Continue with selected event" })
    .click();
  await expect(page.getByText(/A travel router to connect/)).toBeVisible();
  await page
    .getByRole("button", { name: "Continue to your first game" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first game", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to get started" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to your games" }).click();
  await expect(
    page.getByRole("link", { name: "Resume team setup" }),
  ).toHaveCount(0);
});

test("a current-season activation retry does not create another season", async ({
  page,
}) => {
  let creates = 0;
  let activations = 0;
  await page.route("**/api/account/team", (route) =>
    route.fulfill({
      json: {
        settings: defaultTeamPageSettings("Test Curling Club"),
        logo: null,
        canEdit: true,
      },
    }),
  );
  await page.route("**/api/team-schedule", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "createSeason") {
      creates++;
      return route.fulfill({
        status: 201,
        json: "88888888-8888-4888-8888-888888888888",
      });
    }
    if (body.operation === "activateSeason") {
      activations++;
      return route.fulfill(
        activations === 1
          ? {
              status: 503,
              json: { error: "Please retry making this current." },
            }
          : { json: {} },
      );
    }
    await route.abort();
  });
  await page.goto("/login?next=%2Fonboarding%3Fstart%3D1");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your team", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    page.getByRole("heading", { name: "Your public page", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    page.getByRole("heading", { name: "Your season", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Season name").fill("First season");
  await page.getByLabel("Start date", { exact: true }).fill("2026-09-01");
  await page.getByLabel("End date", { exact: true }).fill("2027-04-01");
  await page
    .getByRole("button", { name: "Create season", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry making this season current" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first event", exact: true }),
  ).toBeVisible();
  expect(creates).toBe(1);
  expect(activations).toBe(2);
});
