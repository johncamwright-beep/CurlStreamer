import { afterEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import {
  issueStudioTicket,
  requireStudioConfiguration,
  studioTopic,
} from "./studio-session";
describe("M1 private receive credential", () => {
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
      m1_game: game,
      m1_session: ticket.sessionId,
      m1_generation: 4,
      m1_assignment: 8,
      m1_negotiation: ticket.negotiationId,
      m1_side: "camera",
      m1_topic: studioTopic(ticket, "camera"),
    });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(20);
    expect(JSON.stringify(issued)).not.toContain(secret);
    await expect(
      jwtVerify(issued.token, new TextEncoder().encode(secret), {
        currentDate: new Date(Date.now() + 30_000),
      }),
    ).rejects.toThrow();
  });
});
