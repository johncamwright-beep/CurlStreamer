import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalGameStore, invitationHash } from "./store";
import type { GameConfig } from "./types";

const path = join(tmpdir(), `curlcast-store-test-${process.pid}.json`);
const config: GameConfig = {
  eventName: "Test game",
  homeName: "Home",
  awayName: "Away",
  homeColor: "#ff0000",
  awayColor: "#0000ff",
  scheduledEnds: 8,
  initialHammer: "home",
  youtubeTitle: "Test live",
  youtubeVisibility: "unlisted",
};

afterEach(() => {
  rmSync(path, { force: true });
  rmSync(`${path}.lock`, { recursive: true, force: true });
});

describe("local game-store fallback", () => {
  it("hashes invitations before persistence", () => {
    expect(invitationHash("secret-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(invitationHash("secret-token")).not.toContain("secret-token");
  });

  it("atomically prevents a claimed role and invitation from being stolen", async () => {
    const store = createLocalGameStore(path);
    const game = await store.createGame(config);
    await store.registerInvitation(game.id, "invite", "camera-home");

    const first = await store.claimRole(
      game.id,
      "camera-home",
      "11111111-1111-4111-8111-111111111111",
      "invite",
    );
    const stolen = await store.claimRole(
      game.id,
      "camera-home",
      "22222222-2222-4222-8222-222222222222",
      "invite",
    );

    expect(first.game?.claims["camera-home"]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(stolen.error).toMatch(/already/);
  });

  it("keeps scores append-only and revokes connections on closure", async () => {
    const store = createLocalGameStore(path);
    const game = await store.createGame(config);
    await store.updateGame(game.id, {
      type: "score",
      team: "home",
      points: 2,
      blank: false,
    });
    await store.updateGame(game.id, { type: "undo" });
    await store.updateGame(game.id, {
      type: "connection",
      role: "scorer",
      connected: true,
    });
    const closed = await store.updateGame(game.id, { type: "close-game" });

    expect(closed?.scoreEvents.map((event) => event.type)).toEqual([
      "end",
      "undo",
    ]);
    expect(closed?.status).toBe("closed");
    expect(closed?.connections.scorer).toBe(false);
  });
});
