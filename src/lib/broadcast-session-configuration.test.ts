import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastStartConfiguration } from "./broadcast-session";

describe("broadcast start deployment boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  function configured() {
    vi.stubEnv("APP_BASE_URL", "https://curlstreamer.example");
    vi.stubEnv("GOOGLE_YOUTUBE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_YOUTUBE_CLIENT_SECRET", "secret");
    vi.stubEnv(
      "GOOGLE_YOUTUBE_REDIRECT_URI",
      "https://curlstreamer.example/api/settings/youtube/callback",
    );
    vi.stubEnv(
      "YOUTUBE_CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 1).toString("base64"),
    );
    vi.stubEnv("NEXT_PUBLIC_LIVEKIT_URL", "wss://livekit.example");
    vi.stubEnv("LIVEKIT_API_KEY", "key");
    vi.stubEnv("LIVEKIT_API_SECRET", "secret");
  }

  it("accepts only the configured production/render origin", () => {
    configured();
    expect(
      broadcastStartConfiguration(
        "https://curlstreamer.example/api/games/game/broadcast",
      ),
    ).toBe(true);
    expect(
      broadcastStartConfiguration(
        "https://preview.example/api/games/game/broadcast",
      ),
    ).toBe(false);
  });

  it("fails closed when provider runtime configuration is missing", () => {
    configured();
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    expect(
      broadcastStartConfiguration(
        "https://curlstreamer.example/api/games/game/broadcast",
      ),
    ).toBe(false);
  });
});
