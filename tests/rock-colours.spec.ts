import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

let server: Server;
let origin: string;

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
        import { RockColourSelector } from "./src/components/RockColourSelector";
        function Harness() {
          return React.createElement("form", {
            onSubmit(event) {
              event.preventDefault();
              globalThis.__colours = Object.fromEntries(new FormData(event.currentTarget));
            }
          },
            React.createElement("h1", null, "Rock colours"),
            React.createElement("div", { className: "selectors" },
              React.createElement(RockColourSelector, {
                name: "homeColor",
                label: "Team 1 rock colour",
                defaultValue: "#13579b"
              }),
              React.createElement(RockColourSelector, {
                name: "awayColor",
                label: "Team 2 rock colour",
                defaultValue: "#2563eb"
              })
            ),
            React.createElement("button", { type: "submit", className: "save" }, "Save colours")
          );
        }
        createRoot(document.getElementById("root")).render(React.createElement(Harness));
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  const javascript = bundle.outputFiles[0].text;
  server = createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(javascript);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><meta name="viewport" content="width=device-width">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #020617; color: #f8fafc; font: 16px system-ui; }
        main { margin: auto; max-width: 900px; padding: 24px; }
        h1 { font-size: 32px; }
        .selectors { display: grid; gap: 24px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        fieldset { border: 1px solid #334155; border-radius: 16px; padding: 18px; }
        legend { font-weight: 800; padding: 0 8px; }
        fieldset > div { display: grid; grid-template-columns: repeat(4, minmax(44px, 1fr)); gap: 8px; }
        fieldset > div > label { position: relative; display: grid; min-height: 44px; min-width: 44px; place-items: center; border: 2px solid #64748b; border-radius: 9px; }
        fieldset > div > label:has(input:checked) { border-color: #67e8f9; outline: 2px solid #67e8f9; outline-offset: 2px; }
        input[type=radio] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }
        fieldset > div > label:last-child { grid-column: span 2; background: #1e293b; color: white; }
        fieldset > label { display: flex; min-height: 44px; align-items: center; gap: 12px; margin-top: 16px; padding: 0 12px; background: #1e293b; border-radius: 9px; }
        input[type=color] { min-height: 44px; flex: 1; }
        .save { min-height: 44px; margin-top: 20px; border: 0; border-radius: 9px; padding: 0 20px; background: #0891b2; color: white; font-weight: 800; }
        @media (max-width: 640px) { main { padding: 14px; } .selectors { grid-template-columns: 1fr; } }
      </style><main><div id="root"></div></main><script src="/bundle.js"></script>`);
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

test("preset and custom rock colours retain their submitted values", async ({
  page,
}, testInfo) => {
  await page.goto(origin);
  await expect(
    page.getByRole("radio", { name: "Team 1 rock colour: Custom" }),
  ).toBeChecked();
  await expect(page.getByText("Selected: Custom #13579B")).toBeVisible();

  await page.getByRole("radio", { name: "Team 2 rock colour: Blue" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Team 2 rock colour: Green" }),
  ).toBeChecked();
  await page.getByRole("radio", { name: "Team 2 rock colour: Yellow" }).click();
  await expect(page.getByText("Selected: Yellow")).toBeVisible();
  await page.getByLabel("Team 1 rock colour custom colour").fill("#2468ac");
  await expect(page.getByText("Selected: Custom #2468AC")).toBeVisible();
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as unknown as {
              __colours: { homeColor: string; awayColor: string };
            }
          ).__colours,
      ),
    )
    .toMatchObject({ homeColor: "#2468ac", awayColor: "#facc15" });
  await page.screenshot({
    path: testInfo.outputPath("rock-colour-presets-and-custom.png"),
    fullPage: true,
  });
});
