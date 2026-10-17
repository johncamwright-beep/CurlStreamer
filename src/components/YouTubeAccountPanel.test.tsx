import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock("@/lib/youtube-connection", () => ({
  getYouTubeConnection: mocks.connection,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user", email_confirmed_at: "2026-10-06" } },
      }),
    },
  }),
}));
vi.mock("@/lib/auth/account", () => ({
  getAccountContext: async () => ({
    ok: true,
    account: {
      profile: { status: "active" },
      membership: { role: "owner", teamName: "Test Team" },
    },
  }),
}));
vi.mock("@/lib/providers/youtube", () => ({
  youtubeConfigurationStatus: () => true,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
import { YouTubeAccountPanel } from "./YouTubeAccountPanel";

async function render() {
  return renderToStaticMarkup(
    await YouTubeAccountPanel({ searchParams: Promise.resolve({}) }),
  );
}

describe("withdrawal recovery after channel metadata is removed", () => {
  beforeEach(() => {
    mocks.connection.mockResolvedValue({
      channel_id: null,
      channel_title: null,
      connection_status: "disconnected",
      connected_at: null,
      tested_at: null,
      last_error_code: null,
    });
  });
  it("shows Google-side revocation follow-up without requiring retained channel details", async () => {
    mocks.connection.mockResolvedValue({
      channel_id: null,
      channel_title: null,
      connection_status: "disconnected",
      last_error_code: "revocation_unconfirmed_data_removed",
    });
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("could not be confirmed");
    expect(html).toContain('href="https://myaccount.google.com/permissions"');
    expect(html).not.toContain("Connected channel");
  });
  it("directs a revoked live authorization to YouTube Studio without claiming the stream stopped", async () => {
    mocks.connection.mockResolvedValue({
      channel_id: null,
      channel_title: null,
      connection_status: "disconnected",
      last_error_code: "authorization_revoked_use_youtube_studio",
    });
    const html = await render();
    expect(html).toContain("If a broadcast is still running");
    expect(html).toContain('href="https://studio.youtube.com"');
    expect(html).toContain("unfinished broadcast");
    expect(html).not.toContain("Connected channel");
  });
  it("does not invent a withdrawal failure for a normally disconnected account", async () => {
    const html = await render();
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Connect YouTube channel");
  });
  it("explains a retention outage without claiming that Google confirmed revocation", async () => {
    mocks.connection.mockResolvedValue({
      channel_id: null,
      channel_title: null,
      connection_status: "disconnected",
      last_error_code: "authorization_unverified_data_removed",
    });
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("could not reconfirm");
    expect(html).toContain("retention period");
    expect(html).not.toContain("authorization is no longer valid");
  });
});
