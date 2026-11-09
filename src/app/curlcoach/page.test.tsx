import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const requireCoachAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/curlcoach/access", () => ({ labEnabled: () => false }));
vi.mock("@/lib/curlcoach/production-access", () => ({ requireCoachAccount }));
vi.mock("@/components/AppNavigation", () => ({ AppNavigation: () => null }));
vi.mock("./EventWorkspace", () => ({
  default: () => <div>Charting workspace</div>,
}));
import ShotTrackerPage from "../shot-tracker/page";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  requireCoachAccount.mockReset();
});

it("shows add-on and licence assignment links without rendering private charting", async () => {
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubGlobal("React", React);
  requireCoachAccount.mockResolvedValue(null);

  const html = renderToStaticMarkup(await ShotTrackerPage());
  expect(html).toContain(
    "Shot Tracker requires a CurlStreamer add-on subscription",
  );
  expect(html).toContain('href="/account?section=subscription"');
  expect(html).toContain('href="/account?section=members"');
  expect(html).not.toContain("Charting workspace");
});

it("keeps add-on information available when charting is disabled", async () => {
  vi.stubEnv("CURLCOACH_ENABLED", "false");
  vi.stubGlobal("React", React);

  const html = renderToStaticMarkup(await ShotTrackerPage());
  expect(html).toContain("Charting is currently unavailable.");
  expect(html).toContain('href="/account?section=subscription"');
  expect(html).not.toContain("Charting workspace");
  expect(requireCoachAccount).not.toHaveBeenCalled();
});
