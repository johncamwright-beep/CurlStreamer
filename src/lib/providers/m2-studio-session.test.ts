import { afterEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import {
  issueStudioTicket,
  requireStudioConfiguration,
  studioTopic,
  studioRejectionReason,
} from "./m2-studio-session";
describe("M2 private receive credential", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("never enables an implicit mock or an unconfigured signing key", () => {
    vi.stubEnv("CURLCAST_M1_DIRECT_SPIKE", "");
    expect(() => requireStudioConfiguration()).toThrow();
    vi.stubEnv("CURLCAST_M1_DIRECT_SPIKE", "disposable");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => requireStudioConfiguration()).toThrow();
  });
  it("signs an expiring topic, session, game, assignment, negotiation and side scope", async () => {
    const secret = "m1-disposable-test-signing-secret-only-32";
    vi.stubEnv("SUPABASE_JWT_SECRET", secret);
    const ticket = {
      cameraRole: "camera-away" as const,
      sessionId: crypto.randomUUID(),
      negotiationId: crypto.randomUUID(),
      generation: 4,
      assignmentGeneration: 8,
      expiresAt: Date.now() + 20_000,
    };
    const game = crypto.randomUUID();
    const issued = await issueStudioTicket(game, ticket, "camera");
    const { payload } = await jwtVerify(
      issued.token,
      new TextEncoder().encode(secret),
      { audience: "authenticated" },
    );
    expect(payload).toMatchObject({
      role: "authenticated",
      m2_game: game,
      m2_camera_role: "camera-away",
      m2_session: ticket.sessionId,
      m2_generation: 4,
      m2_assignment: 8,
      m2_negotiation: ticket.negotiationId,
      m2_side: "camera",
      m2_topic: studioTopic(ticket, "camera"),
    });
    expect(
      studioTopic({ ...ticket, cameraRole: "camera-home" }, "camera"),
    ).not.toBe(issued.topic);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(20);
    expect(JSON.stringify(issued)).not.toContain(secret);
    await expect(
      jwtVerify(issued.token, new TextEncoder().encode(secret), {
        currentDate: new Date(Date.now() + 30_000),
      }),
    ).rejects.toThrow();
  });
});

it("preserves only recognized rejection reasons, never raw database details", () => {
  expect(studioRejectionReason("studio_stale")).toBe("studio_stale");
  expect(studioRejectionReason("peer_stale")).toBe("peer_stale");
  expect(studioRejectionReason("camera_released")).toBe("camera_released");
  expect(studioRejectionReason("signal_limit")).toBe("signal_limit");
  expect(studioRejectionReason("private database detail")).toBe("unknown");
});
