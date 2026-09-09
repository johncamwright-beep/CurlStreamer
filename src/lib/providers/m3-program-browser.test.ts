import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import { broadcastGame } from "@/lib/game-projection";
import type { CameraRole } from "@/lib/m2-studio-protocol";
import type { connectStudio } from "./m2-studio-browser";
import type { DirectMetrics } from "./direct-peer";
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("./m2-studio-browser", () => ({ connectStudio: mocks.connect }));
import { startProgramReceiver } from "./m3-program-browser";
type Connection = Parameters<typeof connectStudio>[0];
const ids = {
  "camera-home": "00000000-0000-4000-8000-000000000001",
  "camera-away": "00000000-0000-4000-8000-000000000002",
};
let game = broadcastGame(gameFixture());
let negotiations: Record<CameraRole, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let receiver: ReturnType<typeof startProgramReceiver> | undefined;
const connections: Array<{
  options: Connection;
  stop: ReturnType<typeof vi.fn>;
}> = [];
beforeEach(() => {
  vi.useFakeTimers();
  connections.length = 0;
  negotiations = { ...ids };
  game = broadcastGame(gameFixture());
  mocks.connect.mockReset().mockImplementation(async (options: Connection) => {
    const connection = { options, stop: vi.fn() };
    connections.push(connection);
    return { stop: connection.stop };
  });
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const role = body?.cameraRole as CameraRole;
    return {
      ok: true,
      json: async () =>
        body
          ? {
              cameraRole: role,
              sessionId: ids[role],
              generation: 1,
              negotiationId: negotiations[role],
              assignmentGeneration: 1,
              expiresAt: Date.now() + 20_000,
              token: "synthetic",
              topic: `synthetic-${role}`,
            }
          : { game },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  receiver?.stop();
  receiver = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function begin() {
  const onCamera = vi.fn(),
    onGame = vi.fn(),
    onError = vi.fn();
  receiver = startProgramReceiver({
    gameId: game.id,
    onCamera,
    onGame,
    onError,
  });
  await vi.advanceTimersByTimeAsync(0);
  return { onCamera, onGame, onError };
}
describe("M3 independent program receivers", () => {
  it("ends only the failed role and reconnects only on a new negotiation", async () => {
    await begin();
    expect(connections).toHaveLength(2);
    const home = connections[0],
      away = connections[1];
    home.options.onStop("lost transport");
    expect(home.stop).toHaveBeenCalledOnce();
    expect(away.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connections).toHaveLength(2);
    negotiations["camera-home"] = "00000000-0000-4000-8000-000000000003";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connections).toHaveLength(3);
    expect(connections[2].options.ticket.cameraRole).toBe("camera-home");
    expect(away.stop).not.toHaveBeenCalled();
  });
  it("retains both live tracks when a layout hides one camera", async () => {
    const { onGame } = await begin();
    const track = { stop: vi.fn() };
    connections[1].options.onVideo({
      getTracks: () => [track],
    } as unknown as MediaStream);
    game = { ...game, layout: "home" };
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onGame).toHaveBeenLastCalledWith(
      expect.objectContaining({ layout: "home" }),
    );
    expect(connections).toHaveLength(2);
    expect(track.stop).not.toHaveBeenCalled();
    expect(connections[1].stop).not.toHaveBeenCalled();
  });
  it("forces the slot role and removes side from strict program API requests", async () => {
    await begin();
    await connections[0].options.request({
      action: "signal",
      cameraRole: "camera-away",
      side: "camera",
      sessionId: ids["camera-home"],
      negotiationId: ids["camera-home"],
      signal: { type: "ready" },
    });
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));
    expect(body).toEqual({
      action: "signal",
      cameraRole: "camera-home",
      sessionId: ids["camera-home"],
      negotiationId: ids["camera-home"],
      signal: { type: "ready" },
    });
  });
  it("rejects late media callbacks after stop and clears verified state", async () => {
    const { onCamera } = await begin();
    const connection = connections[0];
    connection.options.onMetrics({ direct: true } as DirectMetrics);
    receiver!.stop();
    const track = { stop: vi.fn() };
    connection.options.onVideo({
      getTracks: () => [track],
    } as unknown as MediaStream);
    connection.options.onMetrics({ direct: true } as DirectMetrics);
    expect(track.stop).toHaveBeenCalledOnce();
    const homeEvents = onCamera.mock.calls.filter(
      ([role]) => role === "camera-home",
    );
    expect(homeEvents.at(-1)![1]).toEqual({ status: "Program stopped" });
  });
  it("stops both roles and reports authority failure when private state access ends", async () => {
    const { onError } = await begin();
    fetchMock.mockResolvedValue({ ok: false });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(
      connections.every(
        (connection) => connection.stop.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });
});
