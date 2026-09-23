import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("not-found");
  },
}));
vi.mock("@/components/M4DesktopPairing", () => ({
  M4DesktopPairing: ({ id }: { id: string }) => (
    <div data-game-id={id}>Checking administrator access</div>
  ),
}));
import Page from "./page";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllEnvs());
describe("desktop pairing page gate", () => {
  it("does not expose pairing controls when the deployment feature is disabled", async () => {
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "");
    const markup = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id }) }),
    );
    expect(markup).toContain("Desktop pairing is unavailable");
    expect(markup).not.toContain("data-game-id");
  });
  it("loads only a game-scoped access-checking shell when enabled", async () => {
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
    const markup = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id }) }),
    );
    expect(markup).toContain(`data-game-id="${id}"`);
    expect(markup).toContain("Checking administrator access");
  });
  it("rejects malformed game identifiers", async () => {
    await expect(
      Page({ params: Promise.resolve({ id: "bad" }) }),
    ).rejects.toThrow("not-found");
  });
});
