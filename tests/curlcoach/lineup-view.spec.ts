import { expect, test } from "@playwright/test";

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");

test("styled lineup fits the viewport and saves a three-player eight-rock order through the local API", async ({
  page,
}, info) => {
  await page.goto("/curlcoach?event=practice#scoring");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  const open = page.getByRole("button", {
    name: /^(Edit lineup|Start Charting)$/,
    exact: true,
  });
  await expect(open).toBeEnabled();
  expect(
    await open.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: `work/lineup-styled-scoring-${info.project.name}.png`,
    fullPage: true,
  });
  await open.click();
  const dialog = page.getByRole("dialog", {
    name: "Set game lineup",
    exact: true,
  });
  await expect(dialog.getByRole("combobox")).toHaveCount(8);
  const originalLineup = await dialog
    .getByRole("combobox")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLSelectElement).value),
    );
  try {
    const viewport = page.viewportSize()!;
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await dialog
        .getByRole("combobox")
        .evaluateAll((nodes) =>
          nodes.every((node) => node.getBoundingClientRect().height >= 44),
        ),
    ).toBe(true);
    const players = await dialog
      .getByRole("combobox", { name: "Rock 1", exact: true })
      .locator("option")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean),
      );
    expect(players.length).toBeGreaterThanOrEqual(3);
    const lineup = [
      players[0],
      players[0],
      players[0],
      players[1],
      players[1],
      players[1],
      players[2],
      players[2],
    ];
    for (let index = 0; index < 8; index++)
      await dialog
        .getByRole("combobox", { name: `Rock ${index + 1}`, exact: true })
        .selectOption(lineup[index]);
    const counts = dialog.getByLabel("Rocks per player");
    await expect(counts).toContainText("3 rocks");
    await expect(counts.locator("span")).toHaveCount(3);
    await expect(counts.locator("span").nth(2)).toContainText("2 rocks");
    await dialog.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({
      path: `work/lineup-styled-modal-${info.project.name}.png`,
    });
    const save = dialog.getByRole("button", {
      name: /^(Save lineup|Confirm lineup & start)$/,
      exact: true,
    });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    expect(
      await save.evaluate((node) => node.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: `work/lineup-styled-save-${info.project.name}.png`,
    });
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/curlcoach/workspace") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().action === "set-lineup",
    );
    await save.click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().lineup).toEqual(lineup);
    expect((await response.json()).lineup).toEqual(lineup);
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(open).toBeEnabled();
    await open.click();
    for (let index = 0; index < 8; index++)
      await expect(
        dialog.getByRole("combobox", {
          name: `Rock ${index + 1}`,
          exact: true,
        }),
      ).toHaveValue(lineup[index]);
  } finally {
    // The local lab is shared by the phone/tablet projects; restore its lineup
    // so this persisted example does not change other charting scenarios.
    if (!(await dialog.isVisible())) {
      await expect(open).toBeEnabled();
      await open.click();
    }
    for (let index = 0; index < 8; index++)
      await dialog
        .getByRole("combobox", { name: `Rock ${index + 1}`, exact: true })
        .selectOption(originalLineup[index]);
    const restored = page.waitForResponse(
      (response) =>
        response.url().includes("/api/curlcoach/workspace") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().action === "set-lineup",
    );
    await dialog
      .getByRole("button", {
        name: /^(Save lineup|Confirm lineup & start)$/,
        exact: true,
      })
      .click();
    expect((await restored).ok()).toBe(true);
    await expect(dialog).not.toBeVisible();
  }
});
