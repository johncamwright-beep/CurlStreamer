import { describe, expect, it } from "vitest";
import { participantUrl } from "./participant-links";

const request = new Request(
  "https://curlstreamer-git-feature-team.vercel.app/api/games/game-1/invitations",
);

describe("participantUrl", () => {
  it.each([
    "/join/game-1?token=invitation-token",
    "/camera/game-1/camera-home",
    "/score/game-1",
  ])("uses APP_BASE_URL for production participant link %s", (path) => {
    const link = participantUrl(request, path, {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      APP_BASE_URL: "https://curlstreamer.vercel.app",
      VERCEL_URL: "curlstreamer-git-feature-team.vercel.app",
    });

    expect(link).toBe(`https://curlstreamer.vercel.app${path}`);
    expect(link).not.toContain("curlstreamer-git-feature-team.vercel.app");
  });

  it("allows a preview to use its request origin", () => {
    expect(
      participantUrl(request, "/join/game-1", {
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).toBe("https://curlstreamer-git-feature-team.vercel.app/join/game-1");
  });

  it.each([
    "http://curlstreamer.vercel.app",
    "https://user:password@curlstreamer.vercel.app",
    "https://curlstreamer.vercel.app/a-path",
    "https://curlstreamer.vercel.app?query=yes",
    "https://curlstreamer.vercel.app#fragment",
    "https://curlstreamer.vercel.app/",
  ])("rejects invalid production APP_BASE_URL %s", (baseUrl) => {
    expect(() =>
      participantUrl(request, "/join/game-1", {
        NODE_ENV: "production",
        APP_BASE_URL: baseUrl,
      }),
    ).toThrow("Invalid environment variable: APP_BASE_URL");
  });
});
