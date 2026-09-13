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
