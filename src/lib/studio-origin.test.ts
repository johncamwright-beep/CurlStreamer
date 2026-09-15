import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studioOrigin } from "./studio-origin";

describe("configured Studio domain migration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://www.curlstreamer.app");
    vi.stubEnv("STUDIO_ADDITIONAL_ORIGINS", "https://pilot.example");
  });
  afterEach(() => vi.unstubAllEnvs());
  const request = (origin?: string) =>
    new Request("http://localhost/api/program", {
      headers: {
        ...(origin ? { origin } : {}),
        "x-forwarded-host": "attacker.example",
      },
    });
  it("keeps canonical and explicitly registered installed origins usable", () => {
    expect(studioOrigin(request("https://pilot.example"))).toBe(
      "https://pilot.example",
    );
    expect(studioOrigin(request("https://www.curlstreamer.app"))).toBe(
      "https://www.curlstreamer.app",
    );
    expect(studioOrigin(request())).toBe("https://www.curlstreamer.app");
  });
  it("does not trust an arbitrary origin or forwarded host", () => {
    for (const origin of [
      "https://attacker.example",
      "https://pilot.example.attacker.example",
    ])
      expect(studioOrigin(request(origin))).not.toBe(origin);
  });
  it.each([
    "http://pilot.example",
    "https://user:pass@pilot.example",
    "https://pilot.example/path",
    "https://pilot.example/",
  ])("rejects malformed configured alias %s", (alias) => {
    vi.stubEnv("STUDIO_ADDITIONAL_ORIGINS", alias);
    expect(() => studioOrigin(request())).toThrow();
  });
});
