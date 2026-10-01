import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("native renderer retries a camera that stops before its setup promise settles", async ({
  page,
}) => {
  const diagnostics: unknown[] = [];
  const bundle = await build({
    entryPoints: ["src/lib/providers/m4-program-renderer-browser.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "early-camera-failure",
        setup(builder) {
          const mocks: Record<string, string> = {
            "./m4-program-camera": `export async function connectM4ProgramCamera(options){ const attempts=window.__attempts??=( {} ); attempts[options.role]=(attempts[options.role]??0)+1; if(options.role==='camera-home'&&attempts[options.role]===1)options.onStop('Direct path verification timed out. Reconnect the camera.');else { const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;canvas.getContext('2d').fillRect(0,0,90,160);options.onVideo(canvas.captureStream(1)); } return {stop(){}}; }`,
            "@/components/ProgramCanvas": `import React from 'react';export function ProgramCanvas({renderCamera}){return <main>{['camera-home','camera-away'].map(role=><div key={role} data-testid={role}>{renderCamera(role)}</div>)}</main>}`,
            "@/components/ProgramPhoneAudio":
              "export function ProgramPhoneAudio(){return null}",
            "@/components/ProgramUsbAudio":
              "export function ProgramUsbAudio(){return null}",
          };
          builder.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "fixture" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  await page.route("**/renderer-recovery-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/renderer-recovery-fixture.js"></script>',
    }),
  );
  await page.route("**/renderer-recovery-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route("**/program", (route) =>
    route.fulfill({ json: { game: { broadcast: "idle" } } }),
  );
  await page.route("**/camera", (route) => {
    diagnostics.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/renderer-recovery-fixture");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __attempts: Record<string, number> })
            .__attempts?.["camera-home"],
      ),
    )
    .toBe(2);
  await expect(
    page
      .getByTestId("camera-home")
      .getByText("Camera not connected", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __attempts: Record<string, number> })
          .__attempts["camera-away"],
    ),
  ).toBe(1);
  expect(diagnostics).toContainEqual({
    action: "diagnostic",
    event: { layer: "peer", code: "verification_timeout", role: "camera-home" },
  });
});
