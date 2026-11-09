import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCoachLocalProof } from "./coach-local-proof";
let proof: Awaited<ReturnType<typeof startCoachLocalProof>>, dir: string;
afterEach(async () => {
  proof?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("requires local pairing, supports seek ranges, and stores only a bounded selection", async () => {
  dir = await mkdtemp(join(tmpdir(), "coach-proof-"));
  const video = join(dir, "clip.mp4");
  await writeFile(video, "0123456789");
  proof = await startCoachLocalProof({
    host: "127.0.0.1",
    port: 0,
    video,
    code: "123456",
    duration: 120,
  });
  const base = proof.address;
  expect((await fetch(base + "/video")).status).toBe(401);
  const post = (path: string, value: unknown, cookie = "") =>
    fetch(base + path, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", cookie },
      body: JSON.stringify(value),
    });
  expect((await post("/pair", { code: "000000" })).status).toBe(403);
  const paired = await post("/pair", { code: "123456" });
  expect(paired.status).toBe(200);
  const cookie = paired.headers.get("set-cookie")!.split(";")[0];
  const clip = await fetch(base + "/video", {
    headers: { cookie, Range: "bytes=2-5" },
  });
  expect(clip.status).toBe(206);
  expect(await clip.text()).toBe("2345");
  expect(
    (
      await fetch(base + "/video", {
        headers: { cookie, Range: "bytes=20-30" },
      })
    ).status,
  ).toBe(416);
  expect(
    (
      await post(
        "/selection",
        { startSeconds: 121, audience: "team", notes: "" },
        cookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await post(
        "/selection",
        { startSeconds: 42.5, audience: "team", notes: "Review line" },
        cookie,
      )
    ).status,
  ).toBe(200);
  expect(proof.stats().selection).toEqual({
    startSeconds: 42.5,
    audience: "team",
    notes: "Review line",
  });
  expect(
    (
      await fetch(base + "/selection", {
        method: "POST",
        headers: {
          cookie,
          Origin: "https://other.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(
    (await fetch(base + "/../../package.json", { headers: { cookie } })).status,
  ).toBe(404);
});
