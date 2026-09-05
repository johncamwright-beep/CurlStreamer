import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameConfig } from "../types";

const config: GameConfig = {
  eventName: "Club final",
  homeName: "Rocks",
  awayName: "Stones",
  homeColor: "#000000",
  awayColor: "#ffffff",
  scheduledEnds: 8,
  initialHammer: "home",
  youtubeTitle: "Club final",
  youtubeVisibility: "unlisted",
};

const temporaryDirectories: string[] = [];

async function loadFreshStore() {
  const directory = mkdtempSync(join(tmpdir(), "curlcast-local-store-"));
  temporaryDirectories.push(directory);
  vi.stubEnv("CURLCAST_MOCK_STORE_PATH", join(directory, "games.json"));
  vi.resetModules();
  return import("./local-store");
}

async function reloadStore() {
  vi.resetModules();
  return import("./local-store");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("local-store shared assignment authority", () => {
  it("persists positive-generation invitations across module instances", async () => {
    const firstWorker = await loadFreshStore();
    const game = firstWorker.createGame(config);
    const invitationId = "camera-invitation";
    const claimant = "11111111-1111-4111-8111-111111111111";
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const prepared = firstWorker.prepareRoleInvitation(
      game.id,
      "camera-home",
      invitationId,
      expiresAt,
    );

    expect(prepared).toEqual({ generation: 1 });

    const secondWorker = await reloadStore();
    const claimed = secondWorker.claimRole(game.id, "camera-home", claimant, {
      id: invitationId,
      expectedGeneration: 1,
      expiresAt,
    });

    expect(claimed).toMatchObject({ generation: 1 });
    expect(
      secondWorker.claimRole(
        game.id,
        "camera-home",
        "22222222-2222-4222-8222-222222222222",
        { id: invitationId, expectedGeneration: 1, expiresAt },
      ),
    ).toEqual({ error: "This invitation has already been used." });
    expect(secondWorker.listCameraIdentityGenerations(game.id)).toEqual({
      "camera-home": [1],
    });
  });

  it("rejects stale same-device authority for framing and scoring", async () => {
    const store = await loadFreshStore();
    const game = store.createGame(config);
    const claimant = "33333333-3333-4333-8333-333333333333";
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    expect(
      store.prepareRoleInvitation(
        game.id,
        "camera-home",
        "camera-generation-1",
        expiresAt,
      ),
    ).toEqual({ generation: 1 });
    expect(
      store.claimRole(game.id, "camera-home", claimant, {
        id: "camera-generation-1",
        expectedGeneration: 1,
        expiresAt,
      }),
    ).toMatchObject({ generation: 1 });
    expect(
      store.releaseRole(game.id, "camera-home", claimant, 1),
    ).toMatchObject({ released: true, releasedGeneration: 1 });
    expect(
      store.prepareRoleInvitation(
        game.id,
        "camera-home",
        "camera-generation-3",
        expiresAt,
      ),
    ).toEqual({ generation: 3 });
    expect(
      store.claimRole(game.id, "camera-home", claimant, {
        id: "camera-generation-3",
        expectedGeneration: 3,
        expiresAt,
      }),
    ).toMatchObject({ generation: 3 });

    expect(() =>
      store.updateGame(
        game.id,
        { type: "camera-framing", role: "camera-home", mode: "contain" },
        { role: "camera-home", claim: claimant, generation: 1 },
      ),
    ).toThrow("Camera assignment changed");
    expect(
      store.updateGame(
        game.id,
        { type: "camera-framing", role: "camera-home", mode: "contain" },
        { role: "camera-home", claim: claimant, generation: 3 },
      )?.cameraFraming,
    ).toEqual({ "camera-home": "contain" });

    expect(
      store.prepareRoleInvitation(
        game.id,
        "scorer",
        "scorer-generation-1",
        expiresAt,
      ),
    ).toEqual({ generation: 1 });
    expect(
      store.claimRole(game.id, "scorer", claimant, {
        id: "scorer-generation-1",
        expectedGeneration: 1,
        expiresAt,
      }),
    ).toMatchObject({ generation: 1 });
    expect(() =>
      store.updateGame(
        game.id,
        {
          type: "score",
          intentId: "10000000-0000-4000-8000-000000000010",
          expectedEnd: 1,
          expectedLastEventId: null,
          team: "home",
          points: 1,
          blank: false,
        },
        { role: "scorer", claim: claimant, generation: 0 },
      ),
    ).toThrow("Participant assignment changed");
    expect(
      store.updateGame(
        game.id,
        {
          type: "score",
          intentId: "10000000-0000-4000-8000-000000000011",
          expectedEnd: 1,
          expectedLastEventId: null,
          team: "home",
          points: 1,
          blank: false,
        },
        { role: "scorer", claim: claimant, generation: 1 },
      )?.scoreEvents,
    ).toHaveLength(1);
  });
});
