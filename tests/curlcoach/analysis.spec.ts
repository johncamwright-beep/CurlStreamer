import { expect, test } from "@playwright/test";
import {
  emptySupplement,
  type Supplement,
} from "../../src/lib/curlcoach/enhanced-catalog";

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");

test("legacy analysis links select the matching submenu", async ({ page }) => {
  await page.goto("/curlcoach?event=practice#miss-analysis");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  for (const [hash, name] of [
    ["miss-analysis", "Miss Analysis"],
    ["technical-review", "Technical Review"],
    ["shot-performance", "Shot Performance"],
    ["analysis/advanced", "Advanced Analysis"],
  ]) {
    await page.goto(`/curlcoach?event=practice#${hash}`);
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await page
    .getByRole("tab", { name: "Advanced Analysis", exact: true })
    .focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Shot Performance", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Miss Analysis", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Miss Analysis", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const shortcuts = page.getByRole("navigation", {
    name: "Shot Tracker shortcuts",
  });
  await expect(
    shortcuts.getByRole("link", { name: "Analysis", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Shot Performance",
    "Miss Analysis",
    "Technical Review",
  ]) {
    await expect(
      shortcuts.getByRole("link", { name, exact: true }),
    ).toHaveCount(0);
  }
});

test("Analysis keeps shared filters and charts saved advanced observations", async ({
  page,
}, info) => {
  await page.goto("/curlcoach?event=practice#analysis");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByRole("tab", { name: "Shot Performance", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Local lab key")).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Performance overview", exact: true }),
  ).toBeVisible();
  const workspaceResponse = await page.request.get(
    "/api/curlcoach/workspace?source=sample&eventId=practice",
  );
  expect(workspaceResponse.ok(), await workspaceResponse.text()).toBe(true);
  const workspace = await workspaceResponse.json();
  const game = workspace.event.games[0];
  const end = info.project.name === "phone" ? 15 : 16;
  let revision: number = game.state.revision;
  const shotIds: string[] = [];
  const noMiss = emptySupplement();
  noMiss.values = {
    shotSubtype: "straight_draw",
    intendedWeight: "button",
    observedDestination: "button",
    resultObservations: [],
    difficulty: "very_demanding",
  };
  noMiss.assessments = { destination: "assessed", results: "assessed" };
  const light = structuredClone(noMiss);
  light.values.observedDestination = "top_12";
  light.values.resultObservations = ["light"];
  const otherPlayer = structuredClone(noMiss);
  otherPlayer.values.shotSubtype = "draw_to_score";
  otherPlayer.values.resultObservations = ["heavy"];
  try {
    for (const [index, playerId, supplement] of [
      [0, "lead", noMiss],
      [1, "lead", light],
      [2, "lead", null],
      [3, "second", otherPlayer],
    ] as [number, string, Supplement | null][]) {
      const shotId = crypto.randomUUID();
      const response = await page.request.post("/api/curlcoach/workspace", {
        headers: { origin: "http://127.0.0.1:3012" },
        data: {
          source: "sample",
          eventId: "practice",
          gameId: game.id,
          command: {
            requestId: crypto.randomUUID(),
            shotId,
            expectedRevision: revision,
            shot: {
              playerId,
              position: index < 2 ? "Lead" : "Second",
              end,
              stone: (index % 2) + 1,
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
          ...(supplement
            ? { enhanced: { expectedRevision: 0, supplement } }
            : {}),
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      shotIds.push(shotId);
      revision += 1;
    }
    await page.reload();
    await page
      .getByRole("combobox", { name: "Event", exact: true })
      .selectOption("practice");
    await page
      .getByRole("combobox", { name: "Game", exact: true })
      .selectOption(game.id);
    await page
      .getByRole("combobox", { name: "Team / player", exact: true })
      .selectOption("lead");
    await page.getByText("More filters", { exact: true }).click();
    await page
      .getByRole("combobox", { name: "End", exact: true })
      .selectOption(String(end));
    const season = await page
      .getByRole("combobox", { name: "Season", exact: true })
      .inputValue();
    await page
      .getByRole("region", { name: "Performance by shot", exact: true })
      .getByRole("button", { name: /^Draw/ })
      .click();
    await expect(
      page.getByRole("tab", { name: "Advanced Analysis", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("combobox", { name: "Shot focus", exact: true }),
    ).toHaveValue("Draw");
    for (const name of [
      "Miss Analysis",
      "Technical Review",
      "Advanced Analysis",
    ]) {
      const tab = page.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("combobox", { name: "Season", exact: true }),
      ).toHaveValue(season);
      await expect(
        page.getByRole("combobox", { name: "Event", exact: true }),
      ).toHaveValue("practice");
      await expect(
        page.getByRole("combobox", { name: "Game", exact: true }),
      ).toHaveValue(game.id);
      await expect(
        page.getByRole("combobox", { name: "Team / player", exact: true }),
      ).toHaveValue("lead");
      await expect(
        page.getByRole("combobox", { name: "End", exact: true }),
      ).toHaveValue(String(end));
      const bounds = await tab.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const subtypes = page.getByRole("region", {
      name: "Shot subtypes",
      exact: true,
    });
    await expect(subtypes).toContainText("Straight Draw");
    await expect(subtypes).not.toContainText("Draw to Score");
    const results = page.getByRole("region", {
      name: "Result observations",
      exact: true,
    });
    await expect(results).toContainText("No observed miss");
    await expect(results).toContainText("Light");
    await expect(results).not.toContainText("Heavy");
    await expect(results).toContainText("Not assessed");
    for (const label of ["No observed miss", "Not assessed"]) {
      await expect(
        results.locator("dl > div").filter({ hasText: label }).locator("dd"),
      ).toHaveText("1");
    }
    const weights = page.getByRole("region", {
      name: "Called vs observed weight",
      exact: true,
    });
    await expect(
      weights.getByRole("combobox", { name: "Called weight" }),
    ).toHaveValue("button");
    await expect(weights).toContainText("Top 12");
    await expect(weights).toContainText("2 / 2 observations recorded");
    await results.getByRole("button", { name: "Light", exact: false }).click();
    await expect(
      results.getByRole("region", { name: "Review shots" }),
    ).toContainText("Light · 1 shots");
    await expect(
      results.getByRole("region", { name: "Review shots" }),
    ).toContainText(`End ${end}`);
    await expect(
      results.getByRole("region", { name: "Review shots" }),
    ).toContainText("4/5");
    await results.getByRole("button", { name: "Close shot review" }).click();
    await page
      .getByRole("combobox", { name: "Team / player", exact: true })
      .selectOption("second");
    await expect(subtypes).toContainText("Draw to Score");
    await expect(subtypes).not.toContainText("Straight Draw");
    await expect(results).toContainText("Heavy");
    await expect(results).not.toContainText("Light");
    for (const label of ["No observed miss", "Not assessed"]) {
      await expect(
        results.locator("dl > div").filter({ hasText: label }).locator("dd"),
      ).toHaveText("0");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `work/advanced-analysis-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    // Remove synthetic attempts so later entry tests start with their original lineup context.
    for (const shotId of shotIds) {
      const response = await page.request.post("/api/curlcoach/workspace", {
        headers: { origin: "http://127.0.0.1:3012" },
        data: {
          source: "sample",
          eventId: "practice",
          gameId: game.id,
          command: {
            requestId: crypto.randomUUID(),
            shotId,
            expectedRevision: revision,
            shot: null,
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      revision += 1;
    }
  }
});
