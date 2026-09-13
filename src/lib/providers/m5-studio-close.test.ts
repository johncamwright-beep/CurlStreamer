import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createM4OperatorServer } from "./m4-operator-server";

describe("Studio exit", () => {
  it.each([true, false])(
    "waits for recording finalization and reports its result (%s)",
    async (finalized) => {
      const root = await mkdtemp(join(tmpdir(), "studio close "));
      let finish!: (result: { finalized: boolean }) => void;
      const closed = new Promise<{ finalized: boolean }>((resolve) => {
        finish = resolve;
      });
      const stop = vi.fn(async () => {
        finish({ finalized });
      });
      const app = await createM4OperatorServer({
        origin: "https://studio.invalid",
        gameId: "11111111-1111-4111-8111-111111111111",
        paths: { executable: "unused", plugin: "unused", runtime: "unused" },
        check: async () => {},
        program: {
          realtimeUrl: "https://data.invalid",
          realtimeKey: "public",
          recorder: "unused",
          runtime: "unused",
          recordingRoot: root,
          cacheRoot: root,
          rendererRoot: root,
          start: async () => ({
            stop,
            closed,
            rendererAddress: "http://127.0.0.1:1",
          }),
        },
      });
      try {
        const page = await fetch(app.address);
        const headers = {
          cookie: page.headers.get("set-cookie")!.split(";")[0],
          origin: app.address,
          "content-type": "application/json",
        };
        for (const value of [
          { action: "check" },
          { action: "start-program", invitation: "a".repeat(43) },
        ]) {
          const response = await fetch(`${app.address}/command`, {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          });
          expect(response.ok).toBe(true);
        }
        const first = app.close();
        expect(app.close()).toBe(first);
        expect(await first).toEqual({ cleanupConfirmed: finalized });
        expect(stop).toHaveBeenCalledOnce();
      } finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
