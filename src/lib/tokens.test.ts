import { describe, expect, it } from "vitest";
import {
  issueOrganizerToken,
  issueParticipantToken,
  issueRoleToken,
  readAccessToken,
} from "./tokens";

describe("game access lifecycle", () => {
  it("exchanges brief invitations for game-length participant sessions", async () => {
    const invitation = await issueRoleToken("game-1", "camera-home");
    const inviteClaims = await readAccessToken(invitation);
    const session = await issueParticipantToken(
      "game-1",
      "camera-home",
      "device-1",
    );
    const sessionClaims = await readAccessToken(session);
    expect(inviteClaims.purpose).toBe("invitation");
    expect((inviteClaims.exp ?? 0) - (inviteClaims.iat ?? 0)).toBe(1_800);
    expect(sessionClaims.purpose).toBe("participant");
    expect(sessionClaims.deviceId).toBe("device-1");
    expect((sessionClaims.exp ?? 0) - (sessionClaims.iat ?? 0)).toBe(21_600);
  });

  it("issues a distinct organizer session", async () => {
    expect(
      (await readAccessToken(await issueOrganizerToken("game-1"))).purpose,
    ).toBe("organizer");
  });
});
