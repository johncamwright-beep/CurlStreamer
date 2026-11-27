import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { maxCoachClipBytes } from "./coach-mp4-duration";
import { createM4OperatorServer } from "./m4-operator-server";

it("captures one authorized loopback clip and fences concurrent and stale requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "m4-operator-coach-"));
  const movie = Buffer.alloc(36);
  movie.writeUInt32BE(36, 0);
  movie.write("moov", 4);
  movie.writeUInt32BE(28, 8);
  movie.write("mvhd", 12);
  movie.writeUInt32BE(1000, 28);
  movie.writeUInt32BE(122_000, 32);
  let finish!: (value: { finalized: boolean }) => void;
  const closed = new Promise<{ finalized: boolean }>((resolve) => {
    finish = resolve;
  });
  let completeCapture!: () => void;
  let authorityEnded = false;
  const coach = {
    capture: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeCapture = resolve;
        }),
    ),
    status: vi.fn(async () => ({ state: 3, availableMs: 120_000 })),
    snapshot: vi.fn(async () => movie),
  };
  const app = await createM4OperatorServer({
    gameId: "11111111-1111-4111-8111-111111111111",
    origin: "https://pilot.invalid",
    paths: {
      executable: "C:\\missing.exe",
      plugin: "C:\\missing.dll",
      runtime: "C:\\missing",
    },
    check: async () => undefined,
    program: {
      realtimeUrl: "https://realtime.invalid",
      realtimeKey: "public-anon-key",
      recorder: "C:\\recorder.exe",
      runtime: "C:\\runtime",
      recordingRoot: directory,
      cacheRoot: directory,
      rendererRoot: directory,
      coachControl: true,
      start: async () => ({
        stop: async () => finish({ finalized: true }),
        closed,
        rendererAddress: "http://127.0.0.1:4000",
        coach,
        programAuthorityEnded: () => authorityEnded,
      }),
    },
  });
  try {
    const page = await fetch(app.address);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    const headers = { cookie, origin: app.address };
    const command = (value: unknown) =>
      fetch(`${app.address}/command`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(value),
      });
    const capture = () => command({ action: "capture-coach-clip" });
    expect((await capture()).status).toBe(409);
    await command({ action: "check" });
    const recording = await command({
      action: "start-program",
      invitation: "i".repeat(43),
    });
    expect(await recording.json()).toMatchObject({
      canCaptureCoachClip: true,
      coachReview: { address: null, code: null },
    });
    const capturing = capture();
    await vi.waitFor(() => expect(coach.capture).toHaveBeenCalledTimes(1));
    expect((await capture()).status).toBe(409);
    completeCapture();
    const result = await capturing;
    expect(result.status).toBe(200);
    const metadata = await result.json();
    expect(metadata).toEqual({
      clipId: expect.any(String),
      capturedAt: expect.any(String),
      duration: 122,
      minimum: 2,
    });
    expect(Number.isNaN(Date.parse(metadata.capturedAt))).toBe(false);
    const clipUrl = `${app.address}/coach-clip/${metadata.clipId}`;
    expect((await fetch(clipUrl)).status).toBe(403);
    expect((await fetch(clipUrl, { headers: { cookie } })).status).toBe(403);
    expect(
      (await fetch(clipUrl, { headers: { ...headers, range: "bytes=0-1" } }))
        .status,
    ).toBe(409);
    const clip = await fetch(clipUrl, { headers });
    expect(clip.headers.get("content-type")).toBe("video/mp4");
    expect(clip.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await clip.arrayBuffer())).toEqual(movie);

    coach.snapshot.mockResolvedValueOnce(Buffer.alloc(maxCoachClipBytes + 1));
    const oversized = capture();
    await vi.waitFor(() => expect(coach.capture).toHaveBeenCalledTimes(2));
    completeCapture();
    expect((await oversized).status).toBe(409);

    const stale = capture();
    await vi.waitFor(() => expect(coach.capture).toHaveBeenCalledTimes(3));
    authorityEnded = true;
    completeCapture();
    expect((await stale).status).toBe(409);
    expect((await fetch(clipUrl, { headers })).status).toBe(404);
    await command({ action: "stop-program" });
    expect((await fetch(clipUrl, { headers })).status).toBe(404);
  } finally {
    completeCapture?.();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
