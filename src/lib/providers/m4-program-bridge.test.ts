import { afterEach, describe, expect, it, vi } from "vitest";
import { M4ProgramClient } from "./m4-program-client";
import { createM4ProgramBridge } from "./m4-program-bridge";
const closers: Array<() => Promise<void>> = [];
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
    const events = await fetch(bridge.address + "/events/camera-home", {
      headers: {
        authorization: bridge.authorization,
        "sec-fetch-site": "same-origin",
      },
    });
    expect(await events.json()).toEqual({ events: [] });
    expect(realtime.drain).toHaveBeenCalledWith("camera-home");
    expect(
      (await fetch(bridge.address + "/events/camera-home?other=1", { headers }))
        .status,
    ).toBe(403);
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
