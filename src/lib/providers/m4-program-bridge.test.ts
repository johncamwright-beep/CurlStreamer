import { afterEach, describe, expect, it, vi } from "vitest";
import { M4ProgramClient } from "./m4-program-client";
import { createM4ProgramBridge } from "./m4-program-bridge";
import { StudioTransportUnavailable } from "./studio-transport-error";
const closers: Array<() => Promise<void>> = [];
async function documentInstance(page: Response) {
  return (await page.text()).match(
    /name="m4-renderer-instance" content="([a-f0-9-]+)"/,
  )![1];
}
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
async function setup() {
  const client = new M4ProgramClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.invalid",
  );
  const action = vi.spyOn(client, "action").mockResolvedValue({ ok: true });
  const bridge = await createM4ProgramBridge(client);
  closers.push(bridge.close);
  const headers = {
    authorization: bridge.authorization,
    origin: bridge.address,
    "content-type": "application/json",
  };
  return { client, action, bridge, headers };
}
describe("private loopback program API", () => {
  it("permits only the claimed renderer to reload and fences old-document health reports", async () => {
    const { bridge, headers } = await setup();
    const page = await fetch(bridge.rendererUrl);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    const instance = (await page.text()).match(
      /name="m4-renderer-instance" content="([a-f0-9-]+)"/,
    )![1];
    const post = (
      body: unknown,
      supplied: Record<string, string> = { cookie, origin: bridge.address },
    ) =>
      fetch(bridge.address + "/renderer-health", {
        method: "POST",
        headers: { ...supplied, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const report = {
      action: "renderer-heartbeat",
      instance,
      frames: 1,
      visibility: "visible",
    };
    const observations = [
      {
        action: "observe",
        cameraRole: "camera-home",
        frames: 1,
        verified: true,
      },
      {
        action: "audio-observe",
        cameraRole: "camera-home",
        peak: 0.5,
        rms: 0.2,
        receiving: true,
      },
      {
        action: "usb-audio-observe",
        contextState: "running",
        scheduledFrames: 2400,
        peak: 0.5,
        rms: 0.2,
      },
    ];
    const observe = (body: Record<string, unknown>, rendererInstance: string) =>
      fetch(bridge.address + "/camera", {
        method: "POST",
        headers: {
          cookie,
          origin: bridge.address,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body, rendererInstance }),
      });
    for (const body of observations)
      expect((await observe(body, instance)).status).toBe(200);
    expect((await post(report)).status).toBe(200);
    expect(bridge.rendererHealth()).toMatchObject({ active: true, frames: 1 });
    expect((await post({ ...report, token: "secret" })).status).toBe(409);
    expect((await fetch(bridge.rendererUrl)).status).toBe(403);
    expect((await fetch(bridge.rendererUrl, { headers })).status).toBe(403);
    expect((await post(report, headers)).status).toBe(403);
    const reload = await fetch(bridge.rendererUrl, {
      headers: { cookie, "sec-fetch-site": "none" },
    });
    expect(reload.status).toBe(200);
    expect(reload.headers.get("set-cookie")).toBeNull();
    const next = (await reload.text()).match(
      /name="m4-renderer-instance" content="([a-f0-9-]+)"/,
    )![1];
    expect(next).not.toBe(instance);
    expect(bridge.cameraStatus()["camera-home"]).toBe(false);
    expect(bridge.audioStatus()["camera-home"].receiving).toBe(false);
    expect(bridge.usbAudioStatus().renderer.contextState).toBe("unavailable");
    for (const body of observations)
      expect((await observe(body, instance)).status).toBe(409);
    for (const body of observations)
      expect((await observe(body, next)).status).toBe(200);
    expect((await post({ ...report, frames: 100 })).status).toBe(409);
    expect((await post({ ...report, instance: next })).status).toBe(200);
    expect((await post({ ...report, instance: next, frames: 0 })).status).toBe(
      409,
    );
    expect(
      (
        await post(
          { ...report, instance: next },
          { cookie, origin: "http://evil.invalid" },
        )
      ).status,
    ).toBe(403);
  });
  it("preserves the retryable classification through the local program endpoint", async () => {
    const { client, bridge, headers } = await setup();
    vi.spyOn(client, "readGame").mockRejectedValue(
      new StudioTransportUnavailable(),
    );
    expect((await fetch(bridge.address + "/program", { headers })).status).toBe(
      503,
    );
  });
  it("accepts only fixed diagnostic fields from the authorized renderer", async () => {
    const diagnostic = vi.fn();
    const client = { readGame: vi.fn(), action: vi.fn(), close: vi.fn() };
    const bridge = await createM4ProgramBridge(client, undefined, {
      directory: ".",
      diagnostic,
    });
    closers.push(bridge.close);
    const cookie = (await fetch(bridge.rendererUrl)).headers
      .get("set-cookie")!
      .split(";")[0];
    const event = {
      layer: "peer",
      code: "verification_timeout",
      role: "camera-away",
    };
    const post = (value: unknown, renderer = true) =>
      fetch(bridge.address + "/camera", {
        method: "POST",
        headers: {
          origin: bridge.address,
          "content-type": "application/json",
          ...(renderer ? { cookie } : { authorization: bridge.authorization }),
        },
        body: JSON.stringify({ action: "diagnostic", event: value }),
      });
    expect((await post(event)).status).toBe(200);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(event);
    expect((await post({ ...event, token: "secret" })).status).toBe(409);
    expect((await post(event, false)).status).toBe(409);
    expect(diagnostic).toHaveBeenCalledTimes(1);
  });
  it("drains USB PCM only to the claimed renderer and exposes flush generations", async () => {
    const { bridge, headers } = await setup();
    const page = await fetch(bridge.rendererUrl);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    const pcm = Buffer.alloc(4);
    pcm.writeFloatLE(0.25, 0);
    bridge.pushUsbAudio(pcm);
    expect(
      (await fetch(bridge.address + "/usb-audio", { headers })).status,
    ).toBe(403);
    expect((await fetch(bridge.address + "/usb-audio")).status).toBe(403);
    const accepted = await fetch(bridge.address + "/usb-audio", {
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    expect(accepted.status).toBe(200);
    expect(
      Buffer.from(await accepted.arrayBuffer()).readFloatLE(0),
    ).toBeCloseTo(0.25);
    bridge.pushUsbAudio(Buffer.alloc(0));
    const flushed = await fetch(bridge.address + "/usb-audio", {
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    expect(flushed.status).toBe(204);
    expect(flushed.headers.get("x-m4-usb-audio-generation")).toBe("1");
  });
  it("accepts bounded renderer-only USB playback observations and expires them", async () => {
    const { bridge, headers } = await setup();
    const page = await fetch(bridge.rendererUrl);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const body = {
      action: "usb-audio-observe",
      rendererInstance: await documentInstance(page),
      contextState: "running",
      scheduledFrames: 2400,
      peak: 0.4,
      rms: 0.2,
    };
    try {
      const post = (value: unknown, renderer = true) =>
        fetch(bridge.address + "/camera", {
          method: "POST",
          headers: renderer
            ? {
                origin: bridge.address,
                cookie,
                "content-type": "application/json",
              }
            : headers,
          body: JSON.stringify(value),
        });
      expect((await post(body, false)).status).toBe(409);
      for (const invalid of [
        { ...body, scheduledFrames: 480001 },
        { ...body, peak: Number.NaN },
        { ...body, extra: true },
      ])
        expect((await post(invalid)).status).toBe(409);
      expect((await post(body)).status).toBe(200);
      expect(bridge.usbAudioStatus().renderer).toEqual({
        contextState: "running",
        scheduledFrames: 2400,
        peak: 0.4,
        rms: 0.2,
      });
      now += 6001;
      expect(bridge.usbAudioStatus().renderer).toEqual({
        contextState: "unavailable",
        scheduledFrames: 0,
        peak: 0,
        rms: 0,
      });
    } finally {
      clock.mockRestore();
    }
  });
  it("reports advancing renderer frames, never a heartbeat or a stale counter", async () => {
    const { bridge, headers } = await setup();
    const page = await fetch(bridge.rendererUrl);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const body = {
        action: "observe",
        rendererInstance: await documentInstance(page),
        cameraRole: "camera-home",
        frames: 5,
        verified: true,
      };
      const observe = (frames: number) =>
        fetch(bridge.address + "/camera", {
          method: "POST",
          headers: {
            origin: bridge.address,
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...body, frames }),
        });
      expect(
        (
          await fetch(bridge.address + "/camera", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(409);
      expect(bridge.cameraStatus()["camera-home"]).toBe(false);
      expect((await observe(5)).status).toBe(200);
      expect(bridge.cameraStatus()["camera-home"]).toBe(true);
      expect(bridge.cameraStatus()["camera-away"]).toBe(false);
      now += 6000;
      await observe(5);
      expect(bridge.cameraStatus()["camera-home"]).toBe(false);
      await observe(6);
      expect(bridge.cameraStatus()["camera-home"]).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
  it("accepts finite renderer-only phone audio observations and clears stale meters", async () => {
    const { bridge, headers } = await setup();
    const page = await fetch(bridge.rendererUrl);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const observe = (body: unknown, renderer = true) =>
      fetch(bridge.address + "/camera", {
        method: "POST",
        headers: renderer
          ? {
              origin: bridge.address,
              cookie,
              "content-type": "application/json",
            }
          : headers,
        body: JSON.stringify(body),
      });
    const body = {
      action: "audio-observe",
      rendererInstance: await documentInstance(page),
      cameraRole: "camera-home",
      peak: 0.8,
      rms: 0.25,
      receiving: true,
    };
    try {
      expect((await observe(body, false)).status).toBe(409);
      for (const invalid of [
        { ...body, peak: 1.01 },
        { ...body, rms: -0.01 },
        { ...body, receiving: "true" },
        { ...body, extra: true },
      ])
        expect((await observe(invalid)).status).toBe(409);
      expect((await observe(body)).status).toBe(200);
      expect(bridge.audioStatus()).toEqual({
        "camera-home": { peak: 0.8, rms: 0.25, receiving: true },
        "camera-away": { peak: 0, rms: 0, receiving: false },
      });
      now += 6000;
      expect(bridge.audioStatus()).toEqual({
        "camera-home": { peak: 0, rms: 0, receiving: false },
        "camera-away": { peak: 0, rms: 0, receiving: false },
      });
    } finally {
      clock.mockRestore();
    }
  });
  it("returns only public connection metadata and scoped events", async () => {
    const client = new M4ProgramClient(
      "11111111-1111-4111-8111-111111111111",
      "https://pilot.invalid",
    );
    const ticket = {
      cameraRole: "camera-home",
      sessionId: "22222222-2222-4222-8222-222222222222",
      generation: 1,
      negotiationId: "33333333-3333-4333-8333-333333333333",
      assignmentGeneration: 1,
      expiresAt: Date.now() + 10000,
      token: "private-realtime-token",
      topic: "private-topic",
    };
    const realtime = {
      connect: vi.fn().mockResolvedValue(ticket),
      drain: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = await createM4ProgramBridge(client, realtime);
    closers.push(bridge.close);
    const headers = {
      authorization: bridge.authorization,
      origin: bridge.address,
      "content-type": "application/json",
    };
    const response = await fetch(bridge.address + "/camera", {
      method: "POST",
      headers,
      body: '{"action":"connect","cameraRole":"camera-home"}',
    });
    const value = await response.json();
    expect(value.sessionId).toBe(ticket.sessionId);
    expect(value).not.toHaveProperty("token");
    expect(value).not.toHaveProperty("topic");
    const identity = {
      sessionId: ticket.sessionId,
      negotiationId: ticket.negotiationId,
      generation: ticket.generation,
      assignmentGeneration: ticket.assignmentGeneration,
    };
    const scope = new URLSearchParams(
      Object.entries(identity).map(([key, value]) => [key, String(value)]),
    );
    const events = await fetch(
      bridge.address + `/events/camera-home?${scope}`,
      {
        headers: {
          authorization: bridge.authorization,
          "sec-fetch-site": "same-origin",
        },
      },
    );
    expect(await events.json()).toEqual({ events: [] });
    expect(realtime.drain).toHaveBeenCalledExactlyOnceWith(
      "camera-home",
      identity,
    );
    expect(
      (await fetch(bridge.address + "/events/camera-home?other=1", { headers }))
        .status,
    ).toBe(403);
    for (const suffix of [
      "",
      `?${scope}&other=1`,
      `?${scope}&generation=2`,
      `?${scope.toString().replace("generation=1", "generation=NaN")}`,
      `?${scope.toString().replace("assignmentGeneration=1", "assignmentGeneration=-1")}`,
      `?${scope.toString().replace(ticket.negotiationId, "invalid")}`,
    ]) {
      expect(
        (
          await fetch(bridge.address + `/events/camera-home${suffix}`, {
            headers,
          })
        ).status,
      ).toBe(403);
    }
    expect(realtime.drain).toHaveBeenCalledTimes(1);
    realtime.drain.mockRejectedValueOnce(new Error("retired identity"));
    expect(
      (
        await fetch(bridge.address + `/events/camera-home?${scope}`, {
          headers,
        })
      ).status,
    ).toBe(409);
    await bridge.close();
    expect(realtime.close).toHaveBeenCalledTimes(1);
  });
  it("claims the renderer once without putting its capability in the page", async () => {
    const { bridge, action, headers } = await setup();
    const page = await fetch(bridge.rendererUrl);
    expect(page.status).toBe(200);
    const cookie = page.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^m4_program=[A-Za-z0-9_-]{43}$/);
    expect(await page.text()).not.toContain(cookie!);
    expect((await fetch(bridge.rendererUrl)).status).toBe(403);
    const asset = await fetch(bridge.address + "/m4-program-renderer.js", {
      headers: { cookie: cookie!, "sec-fetch-site": "same-origin" },
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    const logo = await fetch(
      bridge.address + "/branding/curlstreamer-logo.png",
      {
        headers: { cookie: cookie!, "sec-fetch-site": "same-origin" },
      },
    );
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await logo.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    const teamLogo = await fetch(
      bridge.address + "/branding/team-benning.png",
      { headers: { cookie: cookie!, "sec-fetch-site": "same-origin" } },
    );
    expect(teamLogo.status).toBe(200);
    expect(teamLogo.headers.get("content-type")).toBe("image/png");
    expect(
      (await fetch(bridge.address + "/branding/curlstreamer-logo.png")).status,
    ).toBe(403);
    for (const candidate of [
      {},
      { ...headers, origin: "https://attacker.invalid" },
      { ...headers, authorization: "Bearer wrong" },
    ]) {
      const response = await fetch(bridge.address + "/camera", {
        method: "POST",
        headers: candidate,
        body: '{"action":"stop","cameraRole":"camera-home"}',
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(action).not.toHaveBeenCalled();
  });
  it("permits scoped camera actions but denies ticket/prepare and extra URL fields", async () => {
    const { bridge, action, headers } = await setup();
    const accepted = await fetch(bridge.address + "/camera", {
      method: "POST",
      headers,
      body: '{"action":"check","cameraRole":"camera-home"}',
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true });
    for (const body of [
      { action: "ticket", cameraRole: "camera-home" },
      { action: "prepare" },
      {
        action: "check",
        cameraRole: "camera-home",
        url: "https://elsewhere.invalid",
      },
    ]) {
      expect(
        (
          await fetch(bridge.address + "/camera", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(409);
    }
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("does not return raw provider failures and closes the owned authority", async () => {
    const { bridge, action, client, headers } = await setup();
    action.mockRejectedValueOnce(new Error("private-cookie-do-not-return"));
    const response = await fetch(bridge.address + "/camera", {
      method: "POST",
      headers,
      body: '{"action":"check","cameraRole":"camera-home"}',
    });
    expect(await response.text()).toBe('{"error":"Program unavailable"}');
    const close = vi.spyOn(client, "close");
    await bridge.close();
    await bridge.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(
      fetch(bridge.address + "/program", { headers }),
    ).rejects.toThrow();
  });
});
