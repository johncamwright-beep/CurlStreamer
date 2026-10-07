import { build } from "esbuild";
import { expect, test, type Route } from "@playwright/test";

let javascript: string;
const picture =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#163343"/></svg>';
const fulfill = (route: Route) =>
  route.fulfill({ contentType: "image/svg+xml", body: picture });

test.beforeAll(async () => {
  const bundle = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React, {useState} from "react";
        import {createRoot} from "react-dom/client";
        import {StudioProgramPreview} from "./src/components/StudioProgramPreview";
        function Harness() {
          const [game, setGame] = useState("game-a");
          const [shown, setShown] = useState(true);
          return <><button onClick={() => setGame("game-b")}>Change game</button>
            <button onClick={() => setShown(false)}>Unmount preview</button>
            {shown && <StudioProgramPreview gameId={game} embedded />}</>;
        }
        createRoot(document.getElementById("root")).render(<Harness />);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  javascript = bundle.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value: "StudioProgramPreview/1",
    }),
  );
  await page.route("http://preview-fixture.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${javascript}</script>`,
    }),
  );
});

test("a never-completing image times out, retains the last picture and ignores late callbacks while recovering", async ({
  page,
}) => {
  const requests: Route[] = [];
  const canceled: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/__studio-preview/"))
      canceled.push(request.url());
  });
  let recover = false;
  await page.route("**/__studio-preview/**", async (route) => {
    requests.push(route);
    if (requests.length === 1 || recover) await fulfill(route);
  });
  await page.goto("http://preview-fixture.test/", {
    waitUntil: "domcontentloaded",
  });
  const visible = page.getByRole("img", {
    name: "Actual Studio program output",
  });
  await expect(visible).toHaveAttribute("src", /frame=0$/);
  await page.clock.runFor(200);
  await expect.poll(() => requests.length).toBe(2);
  // The already-visible image can deliver duplicate/late DOM events while its
  // successor is pending. Those callbacks must not create another request.
  await visible.evaluate((node) => {
    node.dispatchEvent(new Event("load", { bubbles: true }));
    node.dispatchEvent(new Event("error", { bubbles: true }));
  });
  await page.clock.runFor(250);
  expect(requests).toHaveLength(2);
  await page.clock.runFor(2750);
  await expect.poll(() => canceled).toContain(requests[1].request().url());
  await expect(page.getByText("Preview reconnecting…")).toBeVisible();
  await expect(visible).toHaveAttribute("src", /frame=0$/);
  expect(
    await visible.evaluate((node) => getComputedStyle(node).objectFit),
  ).toBe("contain");
  recover = true;
  await page.clock.runFor(1000);
  await expect.poll(() => requests.length).toBe(3);
  await expect(visible).toHaveAttribute("src", /frame=2$/);
  await expect(page.getByText("Preview reconnecting…")).toHaveCount(0);
  await fulfill(requests[1]).catch(() => {});
  await expect(visible).toHaveAttribute("src", /frame=2$/);
});

test("an initial stalled picture retries and source changes/unmount retire all old work", async ({
  page,
}) => {
  const requests: Route[] = [];
  await page.route("**/__studio-preview/**", (route) => {
    requests.push(route);
  });
  await page.goto("http://preview-fixture.test/", {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.runFor(4000);
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole("button", { name: "Change game" }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].request().url()).toContain("/game-b?frame=0");
  await fulfill(requests[0]).catch(() => {});
  await fulfill(requests[1]).catch(() => {});
  await expect(
    page.getByRole("img", { name: "Actual Studio program output" }),
  ).toHaveCount(0);
  await fulfill(requests[2]);
  await expect(
    page.getByRole("img", { name: "Actual Studio program output" }),
  ).toHaveAttribute("src", /game-b\?frame=0$/);
  await page.getByRole("button", { name: "Unmount preview" }).click();
  await page.clock.runFor(10000);
  expect(requests).toHaveLength(3);
  await expect(
    page.getByRole("region", { name: "Studio program preview" }),
  ).toHaveCount(0);
});

test("successful preview polling advances fifteen pictures per second without overlapping image loads", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/__studio-preview/**", async (route) => {
    requests++;
    await fulfill(route);
  });
  await page.goto("http://preview-fixture.test/", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("img", { name: "Actual Studio program output" }),
  ).toBeVisible();
  await page.clock.runFor(65);
  expect(requests).toBe(1);
  await page.clock.runFor(2);
  await expect.poll(() => requests).toBe(2);
  for (let index = 0; index < 14; index++) {
    await page.clock.runFor(67);
    await expect.poll(() => requests).toBe(index + 3);
  }
  expect(requests).toBe(16); // Initial picture plus fifteen refreshes in ~1 second.
});

test("preview cadence includes image load time and never queues pictures behind a slow load", async ({
  page,
}) => {
  const requests: Route[] = [];
  await page.route("**/__studio-preview/**", (route) => {
    requests.push(route);
  });
  await page.goto("http://preview-fixture.test/", {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.runFor(40);
  await fulfill(requests[0]);
  const visible = page.getByRole("img", {
    name: "Actual Studio program output",
  });
  await expect(visible).toHaveAttribute("src", /frame=0$/);
  await page.clock.runFor(25);
  expect(requests).toHaveLength(1);
  await page.clock.runFor(2);
  await expect.poll(() => requests.length).toBe(2);
  // A load that takes longer than the interval is still the only pending work.
  await page.clock.runFor(500);
  expect(requests).toHaveLength(2);
  await expect(visible).toHaveAttribute("src", /frame=0$/);
  await fulfill(requests[1]);
  await expect(visible).toHaveAttribute("src", /frame=1$/);
  await page.clock.runFor(1);
  await expect.poll(() => requests.length).toBe(3);
  await page.getByRole("button", { name: "Unmount preview" }).click();
});
