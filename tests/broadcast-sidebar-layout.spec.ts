import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { gameFixture } from "../src/test/game-fixture";

let stylesheet: string;
test.beforeAll(async () => {
  const source = await fs.readFile("src/app/globals.css", "utf8");
  stylesheet = (
    await postcss([
      tailwindcss({ content: ["./src/**/*.{ts,tsx}"], theme: {}, plugins: [] }),
    ]).process(source, { from: "src/app/globals.css" })
  ).css;
});

for (const width of [1920, 960, 390]) {
  for (const containMedia of [false, true]) {
    test(`scoreboard, schedule and logo remain aligned at ${width}px (${containMedia ? "direct" : "broadcast"})`, async ({
      page,
    }, testInfo) => {
      const game = gameFixture();
      game.config.homeName = "Team Benning International Curling Club";
      game.config.awayName = "Northumberland Championship Curling Team";
      game.config.homeLogoUrl =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="cyan"/></svg>',
        );
      game.broadcastSchedule = {
        scheduledStart: "2026-10-20T22:30:00Z",
        timezone: "America/Toronto",
      };
      game.sponsors = [];
      const source = path.resolve("src/components/ProgramCanvas.tsx");
      const bundle = await build({
        stdin: {
          contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProgramComposition} from ${JSON.stringify(source)}; createRoot(document.getElementById('preview')).render(React.createElement(ProgramComposition,{game:${JSON.stringify(game)},containMedia:${containMedia},showStatus:false,renderCamera:()=>React.createElement('video',{className:'portrait-camera-video'})}));`,
          resolveDir: process.cwd(),
          loader: "tsx",
        },
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        jsx: "automatic",
      });
      await page.setViewportSize({ width, height: Math.max(1080, width) });
      await page.setContent(
        `<style>${stylesheet}</style><div id="preview" style="width:${width}px"></div>`,
      );
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const scoreboard = page.getByTestId("broadcast-scoreboard");
      const date = page.getByTestId("broadcast-schedule");
      const logo = page.getByRole("img", {
        name: `${game.config.homeName} logo`,
      });
      await expect(scoreboard).toBeVisible();
      await expect(date).toContainText("Oct 20, 2026");
      await expect(logo).toHaveCSS("object-fit", "contain");
      const [scoreBounds, dateBounds, logoBounds, railBounds] =
        await Promise.all([
          scoreboard.boundingBox(),
          date.boundingBox(),
          logo.boundingBox(),
          page.getByTestId("program-side-rail").boundingBox(),
        ]);
      expect(scoreBounds).not.toBeNull();
      expect(dateBounds).not.toBeNull();
      expect(logoBounds).not.toBeNull();
      expect(railBounds).not.toBeNull();
      const score = scoreBounds!;
      const schedule = dateBounds!;
      const image = logoBounds!;
      const rail = railBounds!;
      // These relationships protect the visible layout, independently of CSS choices.
      expect(score.x + score.width).toBeLessThan(image.x);
      expect(score.width).toBeLessThan(rail.width * 0.85);
      expect(Math.abs(score.y - image.y)).toBeLessThan(1);
      expect(image.y - rail.y).toBeLessThan(width * 0.01);
      expect(schedule.y).toBeGreaterThanOrEqual(score.y + score.height);
      expect(schedule.y - score.y - score.height).toBeLessThan(width * 0.006);
      expect(Math.abs(schedule.x - score.x)).toBeLessThan(1);
      expect(schedule.x + schedule.width).toBeLessThanOrEqual(image.x);
      expect(schedule.y + schedule.height).toBeLessThan(rail.y + rail.height);
      for (const team of [game.config.homeName, game.config.awayName]) {
        const label = scoreboard.getByText(team, { exact: true });
        const bounds = (await label.boundingBox())!;
        expect(bounds.width).toBeGreaterThan(width * 0.07);
        expect(bounds.x).toBeGreaterThan(score.x);
        expect(bounds.x + bounds.width).toBeLessThan(score.x + score.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(
          score.y + score.height,
        );
      }
      expect(
        await scoreboard.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return Array.from(element.querySelectorAll("strong, svg")).every(
            (child) => {
              const childRect = child.getBoundingClientRect();
              return (
                childRect.left >= rect.left &&
                childRect.right <= rect.right &&
                childRect.bottom <= rect.bottom
              );
            },
          );
        }),
      ).toBe(true);
      await expect(page.locator("video").first()).toHaveCSS(
        "object-fit",
        "contain",
      );
      if (containMedia && width !== 960) {
        await page.getByTestId("broadcast-canvas").screenshot({
          path: testInfo.outputPath(`sidebar-${width}.png`),
        });
      }
    });
  }
}
