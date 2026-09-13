import { describe, expect, it } from "vitest";
import { cameraAudioEnabled } from "./camera-audio";

describe("cameraAudioEnabled", () => {
  const role = "camera-home" as const;
  const base = {
    claims: { [role]: "assigned-phone" },
    claimGenerations: { [role]: 3 },
  };

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
