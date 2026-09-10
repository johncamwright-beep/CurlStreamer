import { expect, test } from "@playwright/test";

const gameId = "11111111-1111-4111-8111-111111111111";

test("uses the full mark for sign-in and keeps the app badge out of program output", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("img", { name: "Curl Streamer", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("curlstreamer-app-brand")).toHaveCount(0);

  await page.goto(`/score/${gameId}`);
  await expect(page.getByTestId("curlstreamer-app-brand")).toBeVisible();

  const menu = await page
    .getByRole("button", { name: "Open navigation menu" })
    .boundingBox();
  const badge = await page.getByTestId("curlstreamer-app-brand").boundingBox();
  expect(badge!.x).toBeGreaterThanOrEqual(menu!.x + menu!.width);
  expect(Math.abs(badge!.y - menu!.y)).toBeLessThan(2);
  await page.goto(`/studio-m3/${gameId}/program`);
  await expect(page.getByTestId("curlstreamer-app-brand")).toHaveCount(0);
});
