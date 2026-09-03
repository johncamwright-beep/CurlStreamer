import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const PROGRAM_WIDTH = 1920;
const PROGRAM_HEIGHT = 1080;
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
];

async function createBroadcast(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create game" }).click();
  await page.waitForURL(/\/games\/[^/]+$/);
  const id = page.url().split("/").at(-1)!;
  await page.goto(`/broadcast/${id}`);
  await expect(page.getByTestId("broadcast-canvas")).toBeVisible();
  return id;
}

async function programMeasurements(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(
      '[data-testid="broadcast-canvas"]',
    )!;
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="broadcast-visible-wrapper"]',
    )!;
    const fixed = document.querySelector<HTMLElement>(
      '[data-testid="broadcast-fixed-canvas"]',
    )!;
    const rail = document.querySelector<HTMLElement>(
      '[data-testid="program-side-rail"]',
    )!;
    const rect = canvas.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const viewport = {
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    };
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      wrapperRect: {
        left: wrapperRect.left,
        top: wrapperRect.top,
        width: wrapperRect.width,
        height: wrapperRect.height,
      },
      railRect: { left: railRect.left, right: railRect.right },
      viewport,
      logical: { width: fixed.offsetWidth, height: fixed.offsetHeight },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      },
    };
  });
}

function assertFitted(
  result: Awaited<ReturnType<typeof programMeasurements>>,
  expectedWidth: number,
  expectedHeight: number,
) {
  const { rect, wrapperRect, railRect, viewport, logical, scroll } = result;
  const expectedScale = Math.min(
    viewport.width / PROGRAM_WIDTH,
    viewport.height / PROGRAM_HEIGHT,
  );
  expect(rect.left).toBeGreaterThanOrEqual(-1);
  expect(rect.top).toBeGreaterThanOrEqual(-1);
  expect(rect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(rect.width).toBeCloseTo(expectedWidth, 0);
  expect(rect.height).toBeCloseTo(expectedHeight, 0);
  expect(rect.width / rect.height).toBeCloseTo(16 / 9, 4);
  expect(rect.left).toBeCloseTo((viewport.width - rect.width) / 2, 0);
  expect(rect.top).toBeCloseTo((viewport.height - rect.height) / 2, 0);
  expect(wrapperRect.left).toBeCloseTo(rect.left, 1);
  expect(wrapperRect.top).toBeCloseTo(rect.top, 1);
  expect(wrapperRect.width).toBeCloseTo(rect.width, 1);
  expect(wrapperRect.height).toBeCloseTo(rect.height, 1);
  expect(rect.width / PROGRAM_WIDTH).toBeCloseTo(expectedScale, 4);
  expect(railRect.left).toBeGreaterThanOrEqual(rect.left);
  expect(railRect.right).toBeLessThanOrEqual(rect.right + 1);
  expect(logical).toEqual({ width: PROGRAM_WIDTH, height: PROGRAM_HEIGHT });
  expect(scroll.width).toBe(scroll.clientWidth);
  expect(scroll.height).toBe(scroll.clientHeight);
}

test("fits and centres the complete logical program across desktop viewports", async ({
  page,
}, testInfo) => {
  await createBroadcast(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("back-to-scoring")).toBeVisible();
    const expectedScale = Math.min(
      viewport.width / PROGRAM_WIDTH,
      viewport.height / PROGRAM_HEIGHT,
    );
    await expect
      .poll(async () => (await programMeasurements(page)).rect.width)
      .toBeCloseTo(PROGRAM_WIDTH * expectedScale, 0);
    const result = await programMeasurements(page);
    assertFitted(
      result,
      PROGRAM_WIDTH * expectedScale,
      PROGRAM_HEIGHT * expectedScale,
    );
    if ([1920, 1600, 1024].includes(viewport.width)) {
      const operatorNavigation = page.getByTestId("back-to-scoring");
      await operatorNavigation.evaluate((element) => {
        element.style.visibility = "hidden";
      });
      await page.getByTestId("broadcast-canvas").screenshot({
        path: testInfo.outputPath(
          `broadcast-${viewport.width}x${viewport.height}.png`,
        ),
      });
      await operatorNavigation.evaluate((element) => {
        element.style.visibility = "";
      });
    }
  }
});

test("recalculates after a resize and orientation-sized viewport change", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await createBroadcast(page);
  assertFitted(await programMeasurements(page), 1024, 576);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect
    .poll(async () => (await programMeasurements(page)).rect.width)
    .toBeCloseTo(768, 0);
  assertFitted(await programMeasurements(page), 768, 432);
});

test("authorized operator navigation stays outside the program without changing it", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const id = await createBroadcast(page);
  const before = await programMeasurements(page);
  const navigation = page.getByTestId("back-to-scoring");
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveAttribute("href", `/score/${id}`);
  const canvas = page.getByTestId("broadcast-canvas");
  expect(
    await canvas.evaluate(
      (node, control) => node.contains(control),
      await navigation.elementHandle(),
    ),
  ).toBe(false);
  assertFitted(before, 1024, 576);

  const anonymous = await context.browser()!.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(`/broadcast/${id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(anonymousPage.getByTestId("broadcast-canvas")).toBeVisible({
    timeout: 30_000,
  });
  await expect(anonymousPage.getByTestId("back-to-scoring")).toHaveCount(0);
  const anonymousRect = await programMeasurements(anonymousPage);
  expect(anonymousRect.rect).toEqual(before.rect);
  await anonymous.close();

  await navigation.click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/score/${id}$`), {
    timeout: 15_000,
  });
});
