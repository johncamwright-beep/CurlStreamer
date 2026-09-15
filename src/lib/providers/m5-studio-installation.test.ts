import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  readStudioGame,
  readStudioInstallation,
  studioConfiguration,
  studioFiles,
} from "./m5-studio-installation";

const configuration = {
  version: 1,
  website: "https://studio.invalid",
  realtimeUrl: "https://data.invalid",
  realtimeKey: "sb_publishable_example",
  streamingEnabled: false,
};
describe("Studio installation", () => {
  it("accepts only a game page on the configured origin, never an invitation or other site", () => {
    const game = "11111111-1111-4111-8111-111111111111";
    expect(
      readStudioGame(
        `${configuration.website}/games/${game}`,
        configuration.website,
      ),
    ).toBe(game);
    for (const value of [
      `https://other.invalid/games/${game}`,
      `${configuration.website}/games/${game}#code=secret`,
      `${configuration.website}/games/${game}?code=secret`,
      `${configuration.website}/games/not-a-uuid`,
      `https://user:pass@studio.invalid/games/${game}`,
    ])
      expect(() => readStudioGame(value, configuration.website)).toThrow();
    expect(() =>
      studioConfiguration.parse({
        ...configuration,
        realtimeKey: "sb_secret_do_not_package",
      }),
    ).toThrow();
    expect(() =>
      studioConfiguration.parse({ ...configuration, serverKey: "secret" }),
    ).toThrow();
  });
  it("verifies relocated files and rejects corruption, omissions, duplicates and path escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "studio installation "));
    try {
      const files = [];
      for (const path of [
        ...Object.values(studioFiles),
        "obs/bin/64bit/obs.dll",
      ]) {
        const content =
          path === "studio.json" ? JSON.stringify(configuration) : "component";
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
        files.push({
          path,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
      const manifest = {
        version: 1,
        release: "0.2.0-preview.1",
        obsVersion: "32.2.2",
        nodeVersion: "v24.19.0",
        files,
      };
      const save = (value: unknown) =>
        writeFile(join(root, "manifest.json"), JSON.stringify(value));
      await save(manifest);
      expect(
        (await readStudioInstallation(root)).configuration.streamingEnabled,
      ).toBe(false);
      await save({ ...manifest, files: files.slice(1) });
      await expect(readStudioInstallation(root)).rejects.toThrow("incomplete");
      await save({ ...manifest, files: [...files, files[0]] });
      await expect(readStudioInstallation(root)).rejects.toThrow("manifest");
      await save({
        ...manifest,
        files: [{ ...files[0], path: "../outside.exe" }],
      });
      await expect(readStudioInstallation(root)).rejects.toThrow("manifest");
      await save(manifest);
      await writeFile(join(root, studioFiles.node), "damaged");
      await expect(readStudioInstallation(root)).rejects.toThrow("damaged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
