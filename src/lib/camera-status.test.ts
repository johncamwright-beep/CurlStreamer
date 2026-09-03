import { describe, expect, it } from "vitest";
import { cameraDisplayStatus, CAMERA_STALE_AFTER_MS } from "./camera-status";

const role = "camera-home" as const;
const now = 1_000_000;

describe("organizer camera status", () => {
  it("displays every camera state", () => {
    expect(
      cameraDisplayStatus({ claims: {}, cameraHealth: {} }, role, now),
    ).toBe("Unclaimed");
    expect(
      cameraDisplayStatus(
        { claims: { [role]: "claimed" }, cameraHealth: {} },
        role,
        now,
      ),
    ).toBe("Claimed but offline");
    for (const [phase, label] of [
      ["connecting", "Connecting"],
      ["live", "Live"],
      ["reconnecting", "Reconnecting"],
      ["disconnected", "Disconnected"],
      ["attention", "Needs attention"],
    ] as const) {
      expect(
        cameraDisplayStatus(
          {
            claims: { [role]: "claimed" },
            cameraHealth: { [role]: { phase, updatedAt: now } },
          },
          role,
          now,
        ),
      ).toBe(label);
    }
  });

  it("does not leave a stale published camera marked Live", () => {
    expect(
      cameraDisplayStatus(
        {
          claims: { [role]: "claimed" },
          cameraHealth: {
            [role]: {
              phase: "live",
              updatedAt: now - CAMERA_STALE_AFTER_MS - 1,
            },
          },
        },
        role,
        now,
      ),
    ).toBe("Needs attention");
  });
});
