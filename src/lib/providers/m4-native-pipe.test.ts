import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { M4NativePipeClient } from "./m4-native-pipe";
const target = {
  serverUrl: "rtmps://synthetic.invalid/live2",
  streamKey: "m4-canary-test",
};
describe.skipIf(process.platform !== "win32")(
  "real Windows named-pipe client framing",
  () => {
    it.each(["arm", "renew", "invalid-renew"])(
      "preserves terminal STOP when %s is in flight without accepting invalid replies",
      async (mode) => {
        const pipe = `\\\\.\\pipe\\curlstreamer-m4-test-${randomBytes(8).toString("hex")}`;
        let peer: Socket | undefined;
        let release!: () => void;
        let receivedPending!: () => void;
        const pending = new Promise<void>((resolve) => {
          receivedPending = resolve;
        });
        const commands: number[] = [];
        const server = createServer((socket) => {
          peer = socket;
          socket.on("error", () => undefined);
          let received = Buffer.alloc(0);
          socket.on("data", (chunk) => {
            received = Buffer.concat([received, chunk]);
            while (received.length >= 52) {
              const length = 52 + received.readUInt32LE(12);
              if (received.length < length) return;
              const opcode = received.readUInt32LE(8);
              const sequence = received.readUInt32LE(16);
              received = received.subarray(length);
              commands.push(opcode);
              const reply = () => {
                const row = Buffer.alloc(16);
                row.writeUInt32LE(0x4d344950, 0);
                row.writeUInt32LE(
                  mode === "invalid-renew" && opcode === 2
                    ? sequence + 1
                    : sequence,
                  4,
                );
                row.writeUInt32LE(opcode === 3 ? 2 : 1, 12);
                socket.write(row);
              };
              if (opcode === (mode === "arm" ? 1 : 2)) {
                release = reply;
                receivedPending();
              } else reply();
            }
          });
        });
        await new Promise<void>((resolve) => server.listen(pipe, resolve));
        let client: M4NativePipeClient | undefined;
        try {
          client = await M4NativePipeClient.connect(pipe, randomBytes(32), {
            synthetic: true,
          });
          if (mode !== "arm") await client.arm(target, 20000);
          const operation = expect(
            mode === "arm" ? client.arm(target, 20000) : client.renew(20000),
          ).rejects.toThrow("m4_native_pipe_unavailable");
          await pending;
          const queued =
            mode !== "arm"
              ? expect(client.renew(20000)).rejects.toThrow()
              : undefined;
          const stopped =
            mode === "invalid-renew"
              ? expect(client.stop()).rejects.toThrow()
              : expect(client.stop()).resolves.toBeUndefined();
          release();
          await Promise.all([operation, queued, stopped]);
          expect(client.snapshot().state).toBe(
            mode === "invalid-renew" ? "failed" : "stopped",
          );
          expect(commands).toEqual(
            mode === "arm" ? [1, 3] : mode === "renew" ? [1, 2, 3] : [1, 2],
          );
        } finally {
          client?.disconnect();
          peer?.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
    it.each(["bad_sequence", "extra_bytes", "missing_reply", "expired_reply"])(
      "fails closed on %s without another ARM",
      async (mode) => {
        const pipe = `\\\\.\\pipe\\curlstreamer-m4-test-${randomBytes(8).toString("hex")}`;
        let peer: Socket | undefined;
        let now = 0;
        let frames = 0;
        const server = createServer((socket) => {
          peer = socket;
          socket.on("error", () => undefined);
          let received = Buffer.alloc(0);
          socket.on("data", (chunk) => {
            received = Buffer.concat([received, chunk]);
            if (received.length < 568) return;
            ++frames;
            if (mode === "missing_reply") return;
            const reply = Buffer.alloc(mode === "extra_bytes" ? 17 : 16);
            reply.writeUInt32LE(0x4d344950, 0);
            reply.writeUInt32LE(mode === "bad_sequence" ? 2 : 1, 4);
            reply.writeUInt32LE(1, 12);
            if (mode === "expired_reply") now = 2000;
            socket.write(reply);
            received.fill(0);
          });
        });
        await new Promise<void>((resolve) => server.listen(pipe, resolve));
        let client: M4NativePipeClient | undefined;
        try {
          client = await M4NativePipeClient.connect(pipe, randomBytes(32), {
            synthetic: true,
            clock: () => now,
          });
          expect(client.supportsObservations).toBe(false);
          await expect(client.arm(target, 1000)).rejects.toThrow(
            "m4_native_pipe_unavailable",
          );
          await expect(client.arm(target, 1000)).rejects.toThrow();
          expect(client.snapshot().state).toBe("failed");
          expect(frames).toBe(1);
          expect(JSON.stringify(client.snapshot())).not.toContain(
            target.streamKey,
          );
        } finally {
          client?.disconnect();
          peer?.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
  },
);
