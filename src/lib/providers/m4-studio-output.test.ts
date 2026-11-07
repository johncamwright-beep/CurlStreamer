import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";
import { runM4StudioOutput } from "./m4-studio-output";

describe.skipIf(process.platform !== "win32")(
  "managed Studio output boundary (simulated server/native peer)",
  () => {
    it.each([false, true])(
      "releases server authority and closes the real pipe; malformed bootstrap=%s",
      async (malformed) => {
        const pipe = `\\\\.\\pipe\\curlstreamer-m4-studio-${randomBytes(8).toString("hex")}`;
        const capability = randomBytes(32);
        const frame = Buffer.alloc(296);
        frame.writeUInt32LE(malformed ? 0 : 0x4d344253, 0);
        frame.writeUInt16LE(1, 4);
        frame.write(pipe, 8, 254, "utf16le");
        capability.copy(frame, 264);
        const abort = new AbortController();
        const operations: number[] = [];
        let peer: Socket | undefined;
        const server = createServer((socket) => {
          peer = socket;
          socket.on("error", () => undefined);
          let buffer = Buffer.alloc(0);
          socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (
              buffer.length >= 52 &&
              buffer.length >= 52 + buffer.readUInt32LE(12)
            ) {
              const length = 52 + buffer.readUInt32LE(12);
              const opcode = buffer.readUInt32LE(8);
              expect(buffer.subarray(20, 52)).toEqual(capability);
              operations.push(opcode);
              const reply = Buffer.alloc(16);
              reply.writeUInt32LE(0x4d344950, 0);
              reply.writeUInt32LE(buffer.readUInt32LE(16), 4);
              reply.writeUInt32LE(opcode === 3 ? 2 : 1, 12);
              socket.write(reply);
              const remaining = Buffer.from(buffer.subarray(length));
              buffer.fill(0);
              buffer = remaining;
              if (opcode === 1) setTimeout(() => abort.abort(), 20);
            }
          });
        });
        await new Promise<void>((resolve) => server.listen(pipe, resolve));
        const epoch = Date.now();
        const row = {
          sessionId: "22222222-2222-4222-8222-222222222222",
          generation: 1,
          expiresAt: new Date(epoch + 14400000).toISOString(),
          leaseExpiresAt: new Date(epoch + 30000).toISOString(),
        };
        const intentId = "33333333-3333-4333-8333-333333333333";
        const urls: string[] = [];
        const fetcher = vi.fn<typeof fetch>(async (url, init) => {
          urls.push(String(url));
          const value = String(url).endsWith("/exchange")
            ? { ...row, bearer: "b".repeat(43) }
            : String(url).endsWith("/output-intent")
              ? {
                  intentId,
                  sessionId: row.sessionId,
                  generation: 1,
                  phase: "reserved",
                  deliveryRecorded: false,
                }
              : String(url).endsWith("/target")
                ? {
                    ...row,
                    intentId,
                    target: {
                      serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
                      streamKey: "synthetic_key_for_test",
                    },
                  }
                : {
                    ...row,
                    desiredAction:
                      JSON.parse(String(init?.body)).action === "stop"
                        ? "stop"
                        : "wait",
                  };
          return new Response(JSON.stringify(value), {
            headers: { date: new Date(epoch).toUTCString() },
          });
        });
        const desktop = new M4DesktopClient(
          "11111111-1111-4111-8111-111111111111",
          "https://pilot.invalid",
          { fetcher },
        );
        try {
          await desktop.exchange("c".repeat(43));
          const run = runM4StudioOutput(
            desktop,
            intentId,
            Readable.from([frame]),
            abort.signal,
          );
          if (malformed)
            await expect(run).rejects.toThrow("m4_studio_output_unavailable");
          else await run;
          expect(desktop.snapshot().state).toBe("stopped");
          expect(operations).toEqual(malformed ? [] : [1, 3]);
          expect(urls.filter((url) => url.endsWith("/target"))).toHaveLength(
            malformed ? 0 : 1,
          );
          expect(frame.every((byte) => byte === 0)).toBe(true);
        } finally {
          abort.abort();
          capability.fill(0);
          peer?.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
  },
);
