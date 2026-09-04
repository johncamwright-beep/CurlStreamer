import { describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import {
  issueLiveKitToken,
  LiveKitConfigurationError,
  liveKitIdentity,
  liveKitMetadata,
  liveKitVideoGrant,
  removeCameraParticipant,
} from "./livekit";

describe("LiveKit grants", () => {
  it("identifies missing server configuration without exposing values", async () => {
    delete process.env.NEXT_PUBLIC_LIVEKIT_URL;
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    await expect(issueLiveKitToken("game-1", "camera-home")).rejects.toEqual(
      expect.objectContaining<Partial<LiveKitConfigurationError>>({
        category: "configuration",
        missingVariables: [
          "NEXT_PUBLIC_LIVEKIT_URL",
          "LIVEKIT_API_KEY",
          "LIVEKIT_API_SECRET",
        ],
      }),
    );
  });

  it.each(["camera-home", "camera-away"] as const)(
    "limits %s to camera-only publishing",
    (role) => {
      expect(liveKitVideoGrant("game-1", role)).toEqual({
        room: "game-game-1",
        roomJoin: true,
        canPublish: true,
        canSubscribe: false,
        canPublishData: false,
        canPublishSources: ["camera"],
      });
    },
  );

  it("limits an organizer to subscribing", () => {
    expect(liveKitVideoGrant("game-1", "organizer")).toEqual({
      room: "game-game-1",
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    });
  });

  it("limits an anonymous Broadcast viewer to game-room subscription only", () => {
    const grant = liveKitVideoGrant("game-1", "broadcast-viewer");
    expect(grant).toEqual({
      room: "game-game-1",
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    });
    expect(grant).not.toHaveProperty("roomAdmin");
    expect(grant).not.toHaveProperty("roomCreate");
    expect(grant).not.toHaveProperty("roomList");
    expect(grant).not.toHaveProperty("roomRecord");
  });

  it("uses a randomized non-sensitive identity and five-minute viewer expiry", async () => {
    process.env.NEXT_PUBLIC_LIVEKIT_URL = "wss://live.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "super-secret-value";
    const first = decodeJwt(
      (await issueLiveKitToken("private-game-id", "broadcast-viewer")).token,
    );
    const second = decodeJwt(
      (await issueLiveKitToken("private-game-id", "broadcast-viewer")).token,
    );
    expect(first.sub).toMatch(/^viewer-[0-9a-f-]+$/);
    expect(first.sub).not.toContain("private-game-id");
    expect(second.sub).not.toBe(first.sub);
    expect(first.exp! - first.iat!).toBe(5 * 60);
    expect(first.video).toEqual(
      liveKitVideoGrant("private-game-id", "broadcast-viewer"),
    );
    expect(JSON.parse(String(first.metadata))).toEqual({ cameraRole: null });
  });

  it("does not put the API secret in the browser response or claims", async () => {
    process.env.NEXT_PUBLIC_LIVEKIT_URL = "wss://live.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "super-secret-value";
    const result = await issueLiveKitToken("game-1", "camera-home");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    const claims = decodeJwt(result.token);
    expect(claims.iss).toBe("test-key");
    expect(claims.sub).toBe(liveKitIdentity("game-1", "camera-home"));
    expect(claims.metadata).toBe(liveKitMetadata("camera-home"));
  });

  it("uses one stable identity per game role and trusted role metadata", () => {
    expect(liveKitIdentity("game-1", "camera-home")).toBe(
      liveKitIdentity("game-1", "camera-home"),
    );
    expect(JSON.parse(liveKitMetadata("camera-away"))).toEqual({
      cameraRole: "camera-away",
    });
    expect(JSON.parse(liveKitMetadata("organizer"))).toEqual({
      cameraRole: null,
    });
  });

  it("removes only the game-scoped camera participant and treats missing as success", async () => {
    process.env.LIVEKIT_URL = "wss://live.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "super-secret-value";
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 404 }));
    await expect(
      removeCameraParticipant("game-1", "camera-away"),
    ).resolves.toBeUndefined();
    const [, init] = request.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      room: "game-game-1",
      identity: "game-1:camera-away",
    });
    expect(String(init?.headers)).not.toContain("super-secret-value");
    request.mockRestore();
  });
});
