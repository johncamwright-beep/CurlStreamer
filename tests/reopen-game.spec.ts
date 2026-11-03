import { test, expect } from "@playwright/test";
import { build } from "esbuild";
const id = "11111111-1111-4111-8111-111111111111";
test("reopening shows errors, retries the same intent, and returns to scoring", async ({
  page,
}) => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReopenGameControl} from './src/components/ReopenGameControl';createRoot(document.getElementById('root')).render(<ReopenGameControl gameId='${id}'/>);`,
    },
  });
  await page.route("**/reopen-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id='root'></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  await page.route("**/api/games/*/result", (route) =>
    route.fulfill({ json: { revision: 43 } }),
  );
  const bodies: any[] = [];
  await page.route("**/api/games/*/reopen", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill(
      bodies.length === 1
        ? { status: 503, json: { error: "Please retry" } }
        : { json: { status: "active", gameId: id } },
    );
  });
  await page.route(`**/score/${id}`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Continue scoring</h1>",
    }),
  );
  await page.goto("/reopen-fixture");
  await page
    .getByRole("button", { name: "Reopen scoring", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Reopen and continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Please retry");
  await page.getByRole("button", { name: "Reopen and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Continue scoring" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0].expectedRevision).toBe(43);
});
