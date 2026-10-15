import { expect, test } from "@playwright/test";
import { emptySupplement } from "../../src/lib/curlcoach/enhanced-catalog";

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("persisted difficulty follows analytics filters without changing primary shooting", async ({
  page,
}, info) => {
  await page.goto("/curlcoach?event=practice#shot-performance");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByRole("region", { name: "Performance overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Local lab key")).toBeHidden();
  await expect(
    page.getByRole("tab", { name: "Shot Performance", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const workspace = await (
    await page.request.get(
      "/api/curlcoach/workspace?source=sample&eventId=practice",
    )
  ).json();
  const game = workspace.event.games[0],
    end = info.project.name === "phone" ? 19 : 20;
  const supplement = emptySupplement();
  const shotId = crypto.randomUUID();
  supplement.values.difficulty = "very_demanding";
  const response = await page.request.post("/api/curlcoach/workspace", {
    headers: { origin: "http://127.0.0.1:3012" },
    data: {
      source: "sample",
      eventId: "practice",
      gameId: game.id,
      command: {
        requestId: crypto.randomUUID(),
        shotId,
        expectedRevision: game.state.revision,
        shot: {
          playerId: "lead",
          position: "Lead",
          end,
          stone: 1,
          type: "Draw",
          turn: "CW C",
          execution: "Partial",
          grade: 4,
          deficiency: null,
          review: null,
          excluded: null,
          note: "",
        },
      },
      enhanced: { expectedRevision: 0, supplement },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await page.reload();
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("practice");
  await page.getByText("More filters", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "End", exact: true })
    .selectOption(String(end));
  await expect(
    page.getByRole("region", { name: "Performance overview", exact: true }),
  ).toContainText("80.0%");
  await page
    .getByRole("tab", { name: "Advanced Analysis", exact: true })
    .click();
  const difficulty = page.getByRole("region", {
    name: "Difficulty",
    exact: true,
  });
  await difficulty.getByText("Weighted score details", { exact: true }).click();
  await expect(
    difficulty.locator("dl > div").filter({
      has: page.getByText("Difficulty-adjusted index", { exact: true }),
    }),
  ).toContainText("95.0");
  await expect(
    page.getByText("Difficulty-adjusted detail", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Provisional illustrative benchmarks/),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const top = page.getByRole("navigation", { name: "Shot Tracker shortcuts" });
  const menu = page.getByRole("navigation", {
    name: "Shot Tracker pages",
    includeHidden: true,
  });
  expect(await top.getByRole("link").allTextContents()).toEqual(
    await menu.getByRole("link", { includeHidden: true }).allTextContents(),
  );
  await expect(
    top.getByRole("link", { name: "Options", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `work/difficulty-${info.project.name}.png`,
    fullPage: true,
  });
  const removal = await page.request.post("/api/curlcoach/workspace", {
    headers: { origin: "http://127.0.0.1:3012" },
    data: {
      source: "sample",
      eventId: "practice",
      gameId: game.id,
      command: {
        requestId: crypto.randomUUID(),
        shotId,
        expectedRevision: game.state.revision + 1,
        shot: null,
      },
    },
  });
  expect(removal.ok(), await removal.text()).toBe(true);
});
