import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use Shot Tracker config");
test("private contacts save optional parent and two coach emails without sending reports", async ({
  page,
}, testInfo) => {
  execFileSync(process.execPath, [
    "node_modules/tailwindcss/lib/cli.js",
    "-i",
    "src/app/globals.css",
    "-o",
    "work/contact-fixture.css",
    "--minify",
  ]);
  const css = readFileSync("work/contact-fixture.css", "utf8");
  const bundle = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PlayerEmails}from'./src/components/PlayerEmails';createRoot(document.getElementById('root')).render(<PlayerEmails/>);`,
    },
  });
  const writes: unknown[] = [];
  let sends = 0;
  await page.route("**/api/curlcoach/report-email**", async (route) => {
    sends++;
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/account/player-contacts", async (route) => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ json: { saved: true } });
    } else
      await route.fulfill({
        json: {
          players: [
            {
              id: "a".repeat(64),
              name: "Pat",
              position: "Lead",
              email: "pat@example.com",
              parentEmail: "",
            },
          ],
          coachEmails: ["", ""],
        },
      });
  });
  await page.route("**/contact-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="padding:20px;max-width:1000px;margin:auto"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script></body></html>`,
    }),
  );
  await page.goto("/contact-fixture");
  await page
    .getByLabel("Parent email for Pat (optional)")
    .fill("parent@example.com");
  await page.getByRole("button", { name: "Save email for Pat" }).click();
  await expect(page.getByRole("status")).toHaveText("Email saved for Pat.");
  await page
    .getByLabel("Additional coach 1 email (optional)")
    .fill("coach1@example.com");
  await page
    .getByLabel("Additional coach 2 email (optional)")
    .fill("coach2@example.com");
  await page.getByRole("button", { name: "Save coach emails" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Additional coach emails saved.",
  );
  expect(writes).toEqual([
    {
      playerId: "a".repeat(64),
      email: "pat@example.com",
      parentEmail: "parent@example.com",
    },
    { kind: "coaches", emails: ["coach1@example.com", "coach2@example.com"] },
  ]);
  expect(sends).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("contacts.png"),
    fullPage: false,
  });
});
