import { describe, expect, it } from "vitest";
import {
  cameraAudioEnabled,
  cameraAudioControlEnabled,
  nativeCameraAudioIntent,
} from "./camera-audio";

describe("cameraAudioEnabled", () => {
  const role = "camera-home" as const;
  const base = {
    claims: { [role]: "assigned-phone" },
    claimGenerations: { [role]: 3 },
  };

  it.each(["tapo", "rtsp"] as const)(
    "uses local %s intent without relaxing phone assignments",
    (sourceKind) => {
      const game = {
        claims: {},
        claimGenerations: {},
        cameraAudio: {
          [role]: {
            enabled: true,
            generation: 0,
            status: "pending" as const,
            updatedAt: 1,
            volume: 0.4,
          },
        },
      };
      expect(cameraAudioControlEnabled(game, role, sourceKind)).toBe(true);
      expect(cameraAudioControlEnabled(game, role, "phone")).toBe(false);
      expect(cameraAudioControlEnabled(game, role)).toBe(false);
      expect(nativeCameraAudioIntent(game)[role]).toEqual({
        enabled: true,
        volume: 0.4,
      });
      game.cameraAudio[role].enabled = false;
      expect(cameraAudioControlEnabled(game, role, sourceKind)).toBe(false);
      expect(nativeCameraAudioIntent(game)[role]?.enabled).toBe(false);
    },
  );

  it.each(["tapo", "rtsp"] as const)(
    "rejects stale or legacy intent for %s",
    (sourceKind) => {
      for (const generation of [undefined, 2]) {
        const game = {
          claims: {},
          claimGenerations: { [role]: 3 },
          cameraAudio: {
            [role]: {
              enabled: true,
              generation,
              status: "pending" as const,
              updatedAt: 1,
            },
          },
        };
        expect(cameraAudioControlEnabled(game, role, sourceKind)).toBe(false);
        expect(nativeCameraAudioIntent(game)[role]?.enabled).toBe(false);
      }
    },
  );

  it("requires a claimed matching assignment generation", () => {
    expect(
      cameraAudioEnabled(
        {
          ...base,
          cameraAudio: {
            [role]: {
              enabled: true,
              status: "active",
              updatedAt: 1,
              generation: 3,
            },
          },
        },
        role,
      ),
    ).toBe(true);
    expect(
      cameraAudioEnabled(
        {
          ...base,
          claimGenerations: { [role]: 4 },
          cameraAudio: {
            [role]: {
              enabled: true,
              status: "active",
              updatedAt: 1,
              generation: 3,
            },
          },
        },
        role,
      ),
    ).toBe(false);
  });

  it("keeps legacy generation-less intent disabled", () => {
    expect(
      cameraAudioEnabled(
        {
          ...base,
          cameraAudio: {
            [role]: { enabled: true, status: "active", updatedAt: 1 },
          },
        },
        role,
      ),
    ).toBe(false);
  });
});
