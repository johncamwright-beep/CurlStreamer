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
it("freezes private rolling snapshots and bounds selection to captured footage", async () => {
  dir = await mkdtemp(join(tmpdir(), "coach-proof-"));
  const video = join(dir, "clip.mp4");
  await writeFile(video, "snapshot");
  proof = await startCoachLocalProof({
    host: "127.0.0.1",
    port: 0,
    code: "123456",
    duration: 120,
    capture: async () => ({
      video,
      duration: 12,
      capturedAt: "2026-11-09T20:00:00Z",
    }),
  });
  const post = (path: string, value: unknown, cookie = "") =>
    fetch(proof.address + path, {
      method: "POST",
      headers: {
        Origin: proof.address,
        "Content-Type": "application/json",
        cookie,
      },
      body: JSON.stringify(value),
    });
  expect((await post("/capture", {})).status).toBe(401);
  const first = await post("/pair", { code: "123456" });
  const owner = first.headers.get("set-cookie")!.split(";")[0];
  const second = await post("/pair", { code: "123456" });
  const other = second.headers.get("set-cookie")!.split(";")[0];
  const clip = await (await post("/capture", {}, owner)).json();
  expect(clip.duration).toBe(12);
  expect(
    await (
      await fetch(proof.address + clip.url, { headers: { cookie: owner } })
    ).text(),
  ).toBe("snapshot");
  expect(
    (await fetch(proof.address + clip.url, { headers: { cookie: other } }))
      .status,
  ).toBe(404);
  expect(
    (
      await post(
        "/selection",
        { startSeconds: 13, audience: "player", notes: "" },
        owner,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await post(
        "/selection",
        { startSeconds: 5, audience: "team", notes: "Review together" },
        owner,
      )
    ).status,
  ).toBe(200);
  const replacement = await (await post("/capture", {}, owner)).json();
  expect(replacement.url).not.toBe(clip.url);
  const staleId = new URL(clip.url, proof.address).searchParams.get("id");
  expect(
    (
      await post(
        "/selection",
        { clipId: staleId, startSeconds: 5, audience: "team", notes: "Stale" },
        owner,
      )
    ).status,
  ).toBe(409);
  expect(proof.stats().selection).toEqual({
    startSeconds: 5,
    audience: "team",
    notes: "Review together",
  });
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
it("binds the coaching bridge to its configured origin and game without granting cross-origin HTTP access", async () => {
  proof = await startCoachLocalProof({
    host: "127.0.0.1",
    port: 0,
    code: "123456",
    duration: 120,
    video: "public/celebrations/cat-dance.mp4",
    bridge: {
      appOrigin: "https://coach.example.test",
      gameId: "11111111-1111-4111-8111-111111111111",
    },
  });
  const page = await fetch(proof.address);
  const html = await page.text();
  expect(html).toContain('"appOrigin":"https://coach.example.test"');
  expect(html).not.toContain("/*STUDIO_BRIDGE_CONFIG*/ null");
  expect(page.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect((await fetch(proof.address + "/session")).status).toBe(401);
  const denied = await fetch(proof.address + "/pair", {
    method: "POST",
    headers: {
      Origin: "https://coach.example.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: "123456" }),
  });
  expect(denied.status).toBe(403);
  const paired = await fetch(proof.address + "/pair", {
    method: "POST",
    headers: { Origin: proof.address, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456" }),
  });
  expect(paired.headers.get("set-cookie")).toContain(
    "HttpOnly; SameSite=Strict",
  );
  const session = await fetch(proof.address + "/session", {
    headers: { cookie: paired.headers.get("set-cookie")!.split(";")[0] },
  });
  expect(await session.json()).toMatchObject({
    gameId: "11111111-1111-4111-8111-111111111111",
  });
});
