import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createM4ProgramBridge } from "../src/lib/providers/m4-program-bridge";

describe("bundled celebration assets", () => {
  it.skipIf(process.platform !== "win32")(
    "stages only the six generic assets and resolves them from the packaged renderer root",
    async () => {
      const root = await mkdtemp(
        join(tmpdir(), "curlcast-packaged-lightsaber-"),
      );
      const publicRoot = join(root, "public"),
        studioRoot = join(root, "studio");
      const assets = [
        "lightsaber.mp4",
        "cat-dance.mp4",
        "trump-dance.mp4",
        "lightsaber-foreground-0.png",
        "lightsaber-foreground-1.png",
        "lightsaber-foreground-2.png",
      ];
      await mkdir(join(publicRoot, "celebrations"), { recursive: true });
      for (const asset of [...assets, "private-head.png"])
        await writeFile(
          join(publicRoot, "celebrations", asset),
          Buffer.from("fixture-" + asset),
        );
      try {
        execFileSync("powershell.exe", [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("scripts/stage-studio-celebrations.ps1"),
          "-SourceRoot",
          publicRoot,
          "-StudioSource",
          studioRoot,
        ]);
        expect(
          (await readdir(join(studioRoot, "renderer", "celebrations"))).sort(),
        ).toEqual([...assets].sort());
        for (const asset of assets)
          expect(
            await readFile(join(studioRoot, "renderer", "celebrations", asset)),
          ).toEqual(await readFile(join(publicRoot, "celebrations", asset)));
        const bridge = await createM4ProgramBridge(
          { readGame: vi.fn(), action: vi.fn(), close: vi.fn() },
          undefined,
          { directory: join(studioRoot, "renderer") },
        );
        try {
          const page = await fetch(bridge.rendererUrl);
          const headers = {
            origin: bridge.address,
            cookie: page.headers.get("set-cookie")!.split(";")[0],
          };
          for (const asset of assets) {
            const response = await fetch(
              bridge.address + "/celebrations/" + asset,
              { headers },
            );
            expect(response.status).toBe(200);
            expect(Buffer.from(await response.arrayBuffer())).toEqual(
              await readFile(join(publicRoot, "celebrations", asset)),
            );
          }
        } finally {
          await bridge.close();
        }
        const script = await readFile("scripts/build-m5-studio.ps1", "utf8");
        expect(script.indexOf("'stage-studio-celebrations.ps1'")).toBeLessThan(
          script.indexOf("$files = @(Get-ChildItem"),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
