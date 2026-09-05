import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import { localDateTimeToUtc } from "../src/lib/team-hierarchy";

test.use({ timezoneId: "America/Vancouver" });

const originalInstant = "2026-11-01T06:30:00.000Z";
const props = {
  teamName: "Rocks",
  seasons: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "active",
    },
  ],
  events: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      seasonId: "11111111-1111-4111-8111-111111111111",
      name: "Fall final",
      eventType: "tournament",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      location: null,
      timezone: "America/Toronto",
      archivedAt: null,
    },
  ],
  opponents: [],
  games: [],
  editing: {
    id: "33333333-3333-4333-8333-333333333333",
    seasonId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    opponentId: null,
    scheduledStart: originalInstant,
    timezone: "America/Toronto",
    gameNumber: 1,
    gameLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "active",
    config: {
      eventName: "Fall final",
      homeName: "Rocks",
      awayName: "Opponent TBD",
      homeColor: "#000000",
      awayColor: "#ffffff",
      scheduledEnds: 8,
      youtubeTitle: "Fall final",
      youtubeVisibility: "unlisted",
    },
  },
  editingTitle: "Rocks vs Opponent TBD",
};

let server: Server;
let origin: string;
let savedInstant: string | null;

test.beforeAll(async () => {
  const bundle = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { GameCreationForm } from "./src/app/games/new/GameCreationForm";
        createRoot(document.getElementById("root")).render(
          React.createElement(GameCreationForm, ${JSON.stringify(props)})
        );
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    plugins: [
      {
        name: "next-navigation-test-boundary",
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "next-navigation",
            namespace: "test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export function useRouter() { return { push() {}, refresh() {} }; }",
            loader: "js",
          }));
        },
      },
    ],
  });
  const javascript = bundle.outputFiles[0].text;
  server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/team-schedule") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const payload = JSON.parse(body) as {
          scheduledDate: string;
          scheduledTime: string;
          timezone: string;
        };
        savedInstant = localDateTimeToUtc(
          payload.scheduledDate,
          payload.scheduledTime,
          payload.timezone,
          originalInstant,
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
      return;
    }
    if (request.url === "/bundle.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(javascript);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<main><div id="root"></div><script src="/bundle.js"></script></main>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

test.beforeEach(() => {
  savedInstant = null;
});

test("an unchanged Toronto edit round-trips in a Vancouver browser", async ({
  page,
}) => {
  await page.goto(origin);
  const date = page.getByLabel("Scheduled date (America/Toronto)");
  const time = page.getByLabel("Scheduled time (America/Toronto)");
  const save = page.getByRole("button", { name: "Save schedule" });

  await expect(date).toHaveValue("2026-11-01");
  await expect(time).toHaveValue("01:30");
  await expect(page.getByText("Event timezone:")).toContainText(
    "America/Toronto",
  );

  await date.fill("2026-03-08");
  await time.fill("02:30");
  await expect(
    page.getByText(/Times skipped when clocks move forward/),
  ).toBeVisible();
  await expect(save).toBeDisabled();

  await date.fill("2026-11-01");
  await time.fill("01:30");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => savedInstant).toBe(originalInstant);
});
