import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("seven-game workspace navigation, player/game filters and source availability", async ({
  page,
}, info) => {
  await page.goto("/curlcoach");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", {
        name: "Shot Tracker pages",
        includeHidden: true,
      })
      .getByRole("link", { includeHidden: true }),
  ).toHaveCount(6);
  await page.screenshot({
    path: `test-results/event-setup-${info.project.name}.png`,
  });
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: /Shot breakdown/ }).click();
  await expect(
    page.getByRole("heading", { name: "Turn / deficiency", exact: true }),
  ).toBeVisible();
  async function checkShotDropdown() {
    const selector = page.getByRole("combobox", {
      name: "Shooting by shot type shot type",
      exact: true,
    });
    const table = page.getByRole("region", {
      name: "Shooting by shot type",
      exact: true,
    });
    await expect(selector).toHaveValue("Overall");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    for (const shot of ["Draws", "Hits", "Draw"]) {
      await selector.selectOption(shot);
      await expect(table.getByRole("rowheader")).toHaveText(shot);
      await expect(table.locator("tbody tr")).toHaveCount(1);
    }
    await selector.selectOption("Overall");
    expect(
      await selector.evaluate((node) => node.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  }
  await checkShotDropdown();
  await expect(page.locator(".event-metrics")).toContainText("448");
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await expect(page.locator(".event-metrics")).toContainText("112");
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("shorty-example-1");
  await expect(page.locator(".event-metrics > div").nth(1)).toContainText("64");
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await expect(page.locator(".event-metrics > div").nth(1)).toContainText("16");
  expect(
    await page
      .locator(".event-metrics > div")
      .evaluateAll(
        (nodes) =>
          new Set(nodes.map((n) => Math.round(n.getBoundingClientRect().top)))
            .size,
      ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByText("Shooting uses numerically graded", { exact: false }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "work-shot-filters-" + info.project.name + ".png",
  });
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: /Team statistics$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Team statistics", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-bars > div")).toHaveCount(7);
  await expect(
    page.getByRole("combobox", { name: "Season", exact: true }),
  ).toHaveValue("sample-season");
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("all");
  await expect(page.locator(".event-bars > div")).toHaveCount(8);
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("shorty-example");
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await checkShotDropdown();
  await page.screenshot({
    path: `test-results/event-team-${info.project.name}.png`,
  });
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: /Game analysis/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue("all");
  await expect(page.locator(".event-metrics > div").nth(1)).toContainText(
    "112",
  );
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("shorty-example-7");
  await expect(
    page.getByRole("heading", { name: "Game analysis", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await checkShotDropdown();
  async function checkAnalysisSelectors() {
    const hitSelector = page.getByRole("combobox", {
      name: "Result / hit type shot type",
      exact: true,
    });
    const hitTable = page.getByRole("region", {
      name: "Result / hit type",
      exact: true,
    });
    await expect(hitSelector).toHaveValue("All Hits");
    await expect(hitTable.getByRole("rowheader")).toHaveText("All Hits");
    await expect(hitTable.getByRole("cell").first()).toHaveText(
      /^\d+ · \d+\.\d%$/,
    );
    await expect(hitTable.getByRole("cell").last()).toHaveText(/^\d+\.\d%$/);
    await hitSelector.selectOption("Peel");
    await expect(hitTable.getByRole("rowheader")).toHaveText("Peel");

    const turnSelector = page.getByRole("combobox", {
      name: "Turn / deficiency turn / target",
      exact: true,
    });
    await expect(turnSelector).toHaveValue("All Turns");
    await expect(turnSelector.locator("option[value='CW C']")).toHaveText(
      /^CW C — Clockwise/,
    );
    await turnSelector.selectOption("CW C");
    await expect(
      page
        .getByRole("region", { name: "Turn / deficiency", exact: true })
        .getByRole("rowheader"),
    ).toHaveText("CW C");

    const endSelector = page.getByRole("combobox", {
      name: "End performance end",
      exact: true,
    });
    await expect(endSelector).toHaveValue("All Ends");
    await endSelector.selectOption("End 1");
    await expect(
      page
        .getByRole("region", { name: "End performance", exact: true })
        .getByRole("rowheader"),
    ).toHaveText("End 1");
    await expect(
      page
        .getByRole("region", { name: "End performance", exact: true })
        .getByRole("cell")
        .last(),
    ).toHaveText(/^\d+\.\d%$/);
    await hitSelector.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/game-analysis-selectors-${info.project.name}.png`,
    });
  }
  await checkAnalysisSelectors();
  await expect(page.locator(".event-metrics")).toHaveCount(1);
  await expect(page.locator(".event-metrics > div").nth(1)).toContainText("16");
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: /End-by-end scores/ }).click();
  await expect(
    page.getByRole("heading", { name: "With hammer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Team / player", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("all");
  await expect(page.locator(".event-metrics > div").first()).toContainText("7");
  await expect(
    page.getByRole("heading", { name: "Game scoreboard", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "With hammer", exact: true }),
  ).toContainText("ends");
  await expect(page.getByLabel("Entering end", { exact: true })).toHaveValue(
    "final",
  );
  await page.getByLabel("Entering end", { exact: true }).selectOption("7");
  await expect(
    page.getByRole("region", {
      name: "Win rate by starting situation",
      exact: true,
    }),
  ).toContainText("%");
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("shorty-example-7");
  await expect(page.locator(".event-metrics > div").first()).toContainText("1");
  await expect(
    page.getByRole("heading", { name: "Game scoreboard", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-metrics")).toHaveCount(1);
  expect(
    await page
      .locator(".event-metrics > div")
      .evaluateAll(
        (nodes) =>
          new Set(nodes.map((n) => Math.round(n.getBoundingClientRect().top)))
            .size,
      ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/event-scoreboard-${info.project.name}.png`,
  });
  await page
    .getByRole("combobox", { name: "Data source", exact: true })
    .selectOption("streamer");
  await expect(
    page.getByRole("heading", { name: "Event data is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Streamer is not connected",
  );
});

test("scoring draft survives stats navigation with one cached season read", async ({
  page,
}, info) => {
  await page.goto("/curlcoach?event=practice#scoring");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(page.getByLabel("End", { exact: true })).toBeVisible();
  await page.getByLabel("End", { exact: true }).fill("3");
  await page
    .getByLabel("Private coaching note")
    .fill("Keep this unsaved draft");
  let reads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/curlcoach/workspace")
    )
      reads++;
  });
  for (const view of [
    "Shot breakdown",
    "Team statistics",
    "End-by-end scores",
    "Scoring",
  ]) {
    await page
      .getByRole("button", { name: "Shot Tracker menu", exact: true })
      .click();
    await page.getByRole("link", { name: view, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: view, exact: true }),
    ).toBeVisible();
    if (view === "Shot breakdown") {
      await page
        .locator(".event-table-scroll")
        .first()
        .screenshot({ path: "work-coach-stats-" + info.project.name + ".png" });
      expect(
        await page
          .locator(".event-table-scroll")
          .evaluateAll((nodes) =>
            nodes.every((node) => node.scrollWidth <= node.clientWidth),
          ),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Keep this unsaved draft",
  );
  expect(reads).toBe(1);
  await page.getByRole("button", { name: "Next turn", exact: false }).click();
  await expect(page.locator(".coach-scoring [role=status]")).toContainText(
    "Saved. Next turn",
  );
  expect(reads).toBe(1);
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: "Shot breakdown", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Turn / deficiency", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(1);
});

test("selected event statistics and local filters do not wait for the season download", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route("**/api/curlcoach/workspace?**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    reads++;
    if (new URL(route.request().url()).searchParams.has("seasonId")) await held;
    await route.continue();
  });
  try {
    await page.goto("/curlcoach");
    await page
      .getByLabel("Local lab key")
      .fill("curlcoach-e2e-only-key-thirty-two-characters");
    await page.getByRole("button", { name: "Unlock lab" }).click();
    await expect(
      page.getByRole("combobox", { name: "Game", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Shot Tracker menu", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Shot breakdown", exact: true })
      .click();
    // The season request remains held: existing event data must already be usable.
    await expect(page.locator(".event-metrics")).toContainText("448");
    await page
      .getByRole("combobox", { name: "Game", exact: true })
      .selectOption("shorty-example-1");
    await expect(page.locator(".event-metrics > div").nth(1)).toContainText(
      "64",
    );
    await page
      .getByRole("combobox", { name: "Team / player", exact: true })
      .selectOption("lead");
    await expect(page.locator(".event-metrics > div").nth(1)).toContainText(
      "16",
    );
    expect(reads).toBe(2);
    await page
      .getByRole("combobox", { name: "Event", exact: true })
      .selectOption("all");
    await expect(page.getByRole("status").first()).toContainText(
      "Loading season statistics",
    );
    release();
    await expect(
      page
        .getByRole("combobox", { name: "Game", exact: true })
        .locator("option"),
    ).toHaveCount(9);
    expect(reads).toBe(2);
  } finally {
    release();
  }
});
