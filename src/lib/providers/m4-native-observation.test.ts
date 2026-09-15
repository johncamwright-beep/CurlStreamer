import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { M4NativePipeClient } from "./m4-native-pipe";

describe.skipIf(process.platform !== "win32")(
  "native output observations",
  () => {
    it.each(["valid", "bad-state", "unsafe-bytes", "bad-authority"])(
      "validates %s status independently of ARM/STOP replies",
      async (mode) => {
        const pipe = `\\\\.\\pipe\\curlstreamer-m4-observe-${randomBytes(8).toString("hex")}`;
        const operations: number[] = [];
        let peer: Socket | undefined;
        let authority = 0;
        const server = createServer((socket) => {
          peer = socket;
          socket.on("error", () => undefined);
          let pending = Buffer.alloc(0);
          socket.on("data", (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            while (
              pending.length >= 52 &&
              pending.length >= 52 + pending.readUInt32LE(12)
            ) {
              const length = 52 + pending.readUInt32LE(12),
                opcode = pending.readUInt32LE(8),
                sequence = pending.readUInt32LE(16);
              operations.push(opcode);
              if (opcode === 1) authority = 1;
              if (opcode === 3) authority = 2;
              const reply = Buffer.alloc(opcode === 4 ? 32 : 16);
              reply.writeUInt32LE(0x4d344950);
              reply.writeUInt32LE(sequence, 4);
              reply.writeUInt32LE(
                mode === "bad-authority" && opcode === 4 ? 3 : authority,
                12,
              );
              if (opcode === 4) {
                reply.writeUInt32LE(
                  mode === "bad-state" ? 9 : authority === 2 ? 3 : 2,
                  16,
                );
                reply.writeBigUInt64LE(
                  mode === "unsafe-bytes"
                    ? BigInt(Number.MAX_SAFE_INTEGER) + 1n
                    : 1234n,
                  24,
                );
              }
              pending.subarray(0, length).fill(0);
              pending = pending.subarray(length);
              socket.write(reply);
            }
          });
        });
        await new Promise<void>((resolve) => server.listen(pipe, resolve));
        const client = await M4NativePipeClient.connect(pipe, randomBytes(32), {
          synthetic: true,
          observations: true,
        });
        try {
          await client.arm(
            {
              serverUrl: "rtmps://synthetic.invalid/live2",
              streamKey: "m4-canary",
            },
            20000,
          );
          if (mode !== "valid") {
            await expect(client.observe()).rejects.toThrow(
              "m4_native_pipe_unavailable",
            );
            expect(client.snapshot().state).toBe("failed");
            return;
          }
          expect(await client.observe()).toEqual({
            state: "active",
            failure: "none",
            bytes: 1234,
            authority: 1,
          });
          await client.renew(20000);
          await client.stop();
          expect(await client.observe()).toMatchObject({
            state: "stopped",
            authority: 2,
          });
          await expect(
            client.arm(
              {
                serverUrl: "rtmps://synthetic.invalid/live2",
                streamKey: "m4-canary",
              },
              20000,
            ),
          ).rejects.toThrow();
          expect(operations).toEqual([1, 4, 2, 3, 4]);
        } finally {
          client.disconnect();
          peer?.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
  },
);
