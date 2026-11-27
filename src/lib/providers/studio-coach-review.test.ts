import { expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coachMp4Duration } from "./coach-mp4-duration";
import { startStudioCoachReview } from "./studio-coach-review";

function movie(seconds: number) {
  const data = Buffer.alloc(36);
  data.writeUInt32BE(36, 0);
  data.write("moov", 4);
  data.writeUInt32BE(28, 8);
  data.write("mvhd", 12);
  data.writeUInt32BE(1000, 28);
  data.writeUInt32BE(seconds * 1000, 32);
  return data;
}
it("rejects corrupt or excessive native snapshot durations", () => {
  expect(coachMp4Duration(movie(122))).toBe(122);
  expect(() => coachMp4Duration(movie(126))).toThrow();
  expect(() => coachMp4Duration(movie(0))).toThrow();
  expect(() => coachMp4Duration(movie(60).subarray(0, 24))).toThrow();
});
it("uses the existing recorder and durably preserves game, audience, notes and estimated time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-owner-"));
  const gameId = "00000000-0000-4000-8000-000000000001";
  let captures = 0;
  const service = await startStudioCoachReview({
    host: "127.0.0.1",
    directory,
    gameId,
    coach: {
      capture: async () => {
        captures++;
      },
      status: async () => ({ state: 3, availableMs: 120000 }),
      snapshot: async () => movie(122),
    },
  });
  try {
    const headers: Record<string, string> = {
      origin: service.address,
      "content-type": "application/json",
    };
    const post = (path: string, value: unknown) =>
      fetch(service.address + path, {
        method: "POST",
        headers,
        body: JSON.stringify(value),
      });
    const paired = await post("/pair", { code: service.code });
    headers.cookie = paired.headers.get("set-cookie")!.split(";")[0];
    const clip = await (await post("/capture", {})).json();
    expect(clip.minimum).toBe(2);
    expect(captures).toBe(1);
    expect(
      (
        await post("/selection", {
          startSeconds: 0,
          audience: "player",
          notes: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/selection", {
          startSeconds: 70.5,
          audience: "team",
          notes: "Discuss the sweep call",
        })
      ).status,
    ).toBe(200);
    const folder = join(directory, (await readdir(directory))[0]);
    const file = (await readdir(folder)).find((name) =>
      name.endsWith(".json"),
    )!;
    const selection = JSON.parse(await readFile(join(folder, file), "utf8"));
    expect(selection).toMatchObject({
      gameId,
      audience: "team",
      notes: "Discuss the sweep call",
      timingEstimated: true,
      status: "pending-shot-tracker-handoff",
    });
    expect(
      Date.parse(selection.capturedAt) - Date.parse(selection.selectedAt),
    ).toBe(51500);
  } finally {
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
