import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { authorized, issueSession, labEnabled, sameOrigin } from "./access";
import { gameId, organizationId } from "./model";
const key = "local-test-secret-more-than-thirty-two-characters";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LOCAL_LAB", "true");
  vi.stubEnv("CURLCOACH_LAB_SECRET", key);
});
afterEach(() => vi.unstubAllEnvs());
it("fails closed for absent/invalid flags and production", async () => {
  expect(labEnabled()).toBe(true);
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    vi.stubEnv("CURLCOACH_ENABLED", flag);
    expect(labEnabled()).toBe(false);
  }
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("NODE_ENV", "production");
  expect(labEnabled()).toBe(false);
  expect(await authorized("anything")).toBe(false);
});
it("requires a signed coach session scoped to the synthetic organization and game", async () => {
  expect(await authorized()).toBe(false);
  expect(await authorized("forged")).toBe(false);
  expect(await authorized(await issueSession())).toBe(true);
  for (const claims of [
    { organizationId: "another-org", gameId, role: "coach" },
    { organizationId, gameId: "another-game", role: "coach" },
    { organizationId, gameId, role: "scorer" },
  ]) {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("synthetic-coach")
      .setIssuer("curlcoach-local")
      .setAudience("curlcoach-lab")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(key));
    expect(await authorized(token)).toBe(false);
  }
});
it("requires same-origin mutations", () => {
  expect(
    sameOrigin(
      new Request("http://localhost:3010/api/curlcoach/game", {
        headers: { origin: "https://external.example" },
      }),
    ),
  ).toBe(false);
  expect(
    sameOrigin(
      new Request("http://localhost:3010/api/curlcoach/game", {
        headers: { origin: "http://localhost:3010" },
      }),
    ),
  ).toBe(true);
});
