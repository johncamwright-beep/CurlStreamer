import { describe, expect, it } from "vitest";
import {
  issueOrganizerToken,
  issueParticipantToken,
  issueRoleToken,
  readAccessToken,
} from "./tokens";

describe("game access lifecycle", () => {
  it("exchanges brief invitations for game-length participant sessions", async () => {
    const invitation = await issueRoleToken(
      "game-1",
      "camera-home",
      "11111111-1111-4111-8111-111111111111",
      7,
    );
    const inviteClaims = await readAccessToken(invitation);
    const session = await issueParticipantToken(
      "game-1",
      "camera-home",
      "device-1",
      7,
    );
    const sessionClaims = await readAccessToken(session);
    expect(inviteClaims.purpose).toBe("invitation");
    expect(inviteClaims.jti).toBe("11111111-1111-4111-8111-111111111111");
    expect(inviteClaims.assignmentGeneration).toBe(7);
    expect((inviteClaims.exp ?? 0) - (inviteClaims.iat ?? 0)).toBe(1_800);
    expect(sessionClaims.purpose).toBe("participant");
    expect(sessionClaims.deviceId).toBe("device-1");
    expect(sessionClaims.assignmentGeneration).toBe(7);
    expect((sessionClaims.exp ?? 0) - (sessionClaims.iat ?? 0)).toBe(21_600);
  });

  it("issues a distinct organizer session", async () => {
    expect(
      (await readAccessToken(await issueOrganizerToken("game-1"))).purpose,
    ).toBe("organizer");
  });
});
