import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  recorderStart: undefined as
    | undefined
    | ((input: { program?: { cacheDirectory: string } }) => Promise<unknown>),
}));

vi.mock("./m4-program-client", () => ({
  M4ProgramClient: class {
    async exchange() {}
    close() {}
  },
}));
vi.mock("./m4-program-realtime", () => ({
  createM4ProgramRealtime: () => ({ close: async () => undefined }),
}));
vi.mock("./m4-program-bridge", () => ({
  createM4ProgramBridge: async () => ({
    rendererUrl: "http://127.0.0.1:4000/",
    address: "http://127.0.0.1:4000",
    close: async () => undefined,
  }),
}));
vi.mock("./m4-studio-recorder", () => ({
  startM4StudioRecorder: (input: { program?: { cacheDirectory: string } }) =>
    mocked.recorderStart!(input),
}));

import { startM4ProgramHost } from "./m4-program-host";

const gameId = "11111111-1111-4111-8111-111111111111";
const input = (cacheRoot: string) => ({
  gameId,
  origin: "https://pilot.invalid",
  invitation: "i".repeat(43),
  realtimeUrl: "https://realtime.invalid",
  realtimeKey: "key",
  executable: "C:\\recorder.exe",
  runtime: "C:\\runtime",
  recording: "C:\\recording.mkv",
  cacheRoot,
  rendererRoot: cacheRoot,
});
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

afterEach(() => {
  mocked.recorderStart = undefined;
});

describe.skipIf(process.platform !== "win32")(
  "M4 program host cache lifecycle",
  () => {
    it("retains cache after failed stop until the recorder confirms a late exit", async () => {
      const root = await mkdtemp(join(tmpdir(), "m4-host-cache-"));
      let finish!: (result: { finalized: boolean }) => void;
      const closed = new Promise<{ finalized: boolean }>(
        (resolve) => (finish = resolve),
      );
      let cache = "";
      mocked.recorderStart = async ({ program }) => {
        cache = program!.cacheDirectory;
        await mkdir(cache, { recursive: true });
        await writeFile(join(cache, "live"), "native may still use this");
        return {
          stop: async () => {
            throw new Error("stop transport failed");
          },
          closed,
        };
      };
      try {
        const host = await startM4ProgramHost(input(root));
        await expect(host.stop()).rejects.toThrow(
          "m4_program_host_unavailable",
        );
        expect(await exists(cache)).toBe(true);
        finish({ finalized: true });
        await expect(host.closed).resolves.toEqual({ finalized: true });
        expect(await exists(cache)).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("retains a cache that may belong to a recorder after startup rejection", async () => {
      const root = await mkdtemp(join(tmpdir(), "m4-host-startup-"));
      let cache = "";
      mocked.recorderStart = async ({ program }) => {
        cache = program!.cacheDirectory;
        await mkdir(cache, { recursive: true });
        await writeFile(
          join(cache, "possibly-live"),
          "do not erase without exit proof",
        );
        throw new Error("startup uncertain");
      };
      try {
        await expect(startM4ProgramHost(input(root))).rejects.toThrow(
          "m4_program_host_unavailable",
        );
        expect(await exists(cache)).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  },
);
