import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import {
  issueLiveKitToken,
  liveKitIdentity,
  liveKitMetadata,
  liveKitVideoGrant,
} from "./livekit";

describe("LiveKit grants", () => {
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

  it("does not put the API secret in the browser response or claims", async () => {
    process.env.LIVEKIT_URL = "wss://live.example.test";
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
});
