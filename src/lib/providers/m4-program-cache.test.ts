import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recoverM4ProgramCaches } from "./m4-program-cache";

const name = (tail: string) =>
  `curlstreamer-m4-cef-${tail.repeat(32).slice(0, 32)}`;
async function run(
  root: string,
  tail: string,
  marker: unknown = { schema: "m4-cef-owner-v1", pid: 4242, jobBound: true },
) {
  const directory = join(root, name(tail));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, ".m4-owner.json"),
    typeof marker === "string" ? marker : JSON.stringify(marker),
  );
  return directory;
}

describe.skipIf(process.platform !== "win32")(
  "M4 program cache recovery",
  () => {
    it("removes only a controlled dead run and leaves live, unknown, malformed, old, and unrelated entries", async () => {
      const root = await mkdtemp(join(tmpdir(), "m4-cache-"));
      try {
        const dead = await run(root, "a");
        const live = await run(root, "b", {
          schema: "m4-cef-owner-v1",
          pid: 9,
          jobBound: true,
        });
        const malformed = await run(root, "c", "not-json");
        const oversized = await run(root, "d", "x".repeat(1025));
        const unbound = await run(root, "e", {
          schema: "m4-cef-owner-v1",
          pid: 4242,
          jobBound: false,
        });
        await mkdir(join(root, "unrelated-folder"));
        const result = await recoverM4ProgramCaches(root, (pid) =>
          pid === 4242 ? false : pid === 9 ? true : undefined,
        );
        expect(result).toEqual({ removed: 1, retained: 4 });
        await expect(readFile(join(dead, ".m4-owner.json"))).rejects.toThrow();
        await expect(
          readFile(join(live, ".m4-owner.json")),
        ).resolves.toBeTruthy();
        await expect(
          readFile(join(malformed, ".m4-owner.json")),
        ).resolves.toBeTruthy();
        await expect(
          readFile(join(oversized, ".m4-owner.json")),
        ).resolves.toBeTruthy();
        await expect(
          readFile(join(unbound, ".m4-owner.json")),
        ).resolves.toBeTruthy();
        await expect(
          readFile(join(root, "unrelated-folder")),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("retains a run if the second liveness probe becomes alive", async () => {
      const root = await mkdtemp(join(tmpdir(), "m4-cache-race-"));
      try {
        const directory = await run(root, "e");
        let calls = 0;
        expect(
          await recoverM4ProgramCaches(root, () =>
            ++calls === 1 ? false : true,
          ),
        ).toEqual({ removed: 0, retained: 1 });
        await expect(
          readFile(join(directory, ".m4-owner.json")),
        ).resolves.toBeTruthy();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("rejects linked roots and retains linked runs without touching an outside file", async () => {
      const parent = await mkdtemp(join(tmpdir(), "m4-cache-link-"));
      const root = join(parent, "root"),
        outside = join(parent, "outside");
      await mkdir(root);
      await mkdir(outside);
      await writeFile(join(outside, "keep"), "outside");
      try {
        const linked = await run(root, "f");
        await symlink(outside, join(linked, "escape"), "junction");
        expect(await recoverM4ProgramCaches(root, () => false)).toEqual({
          removed: 0,
          retained: 1,
        });
        expect(await readFile(join(outside, "keep"), "utf8")).toBe("outside");
        const rootLink = join(parent, "root-link");
        await symlink(root, rootLink, "junction");
        await expect(
          recoverM4ProgramCaches(rootLink, () => false),
        ).rejects.toThrow("m4_cache_recovery_unavailable");
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  },
);
