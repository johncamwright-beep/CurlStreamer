import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createSignedUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) },
  }),
}));
import { gameBroadcastSponsors, validateSponsorImage } from "./sponsor-library";

describe("sponsor image validation", () => {
  it("accepts a matching PNG signature", async () => {
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "logo.png",
      { type: "image/png" },
    );
    await expect(validateSponsorImage(file)).resolves.toMatchObject({
      mime: "image/png",
      extension: "png",
    });
  });
  it.each(["image/png", "image/x-png", ""])(
    "normalizes PNG bytes reported as %s",
    async (type) => {
      const file = new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        "team.png",
        { type },
      );
      await expect(validateSponsorImage(file)).resolves.toMatchObject({
        mime: "image/png",
      });
    },
  );
  it("rejects spoofed MIME content", async () => {
    const file = new File(["not an image"], "logo.png", { type: "image/png" });
    await expect(validateSponsorImage(file)).rejects.toThrow("logo.png");
  });
  it("rejects files over the deployed request limit before writes", async () => {
    const file = new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await expect(validateSponsorImage(file)).rejects.toThrow("4 MB");
  });
});

describe("anonymous Broadcast sponsors", () => {
  const sponsorRow = (overrides = {}) => ({
    id: "internal-id",
    display_name: "Club sponsor",
    alt_text: "Club sponsor logo",
    storage_path: "organization/private/logo.png",
    position: 0,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns public metadata with a five-minute signed URL and no storage path", async () => {
    mocks.rpc.mockResolvedValue({
      data: [sponsorRow()],
      error: null,
    });
    mocks.createSignedUrl.mockResolvedValue({
      data: {
        signedUrl:
          "https://storage.example/object/sign/logo.png?token=short-lived",
      },
      error: null,
    });

    await expect(gameBroadcastSponsors("game-1")).resolves.toEqual([
      {
        id: "internal-id",
        name: "Club sponsor",
        altText: "Club sponsor logo",
        dataUrl:
          "https://storage.example/object/sign/logo.png?token=short-lived",
        enabled: true,
        rotation: 0,
      },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("list_game_organization_sponsors", {
      p_game_id: "game-1",
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "organization/private/logo.png",
      300,
    );
  });

  it("reuses stable signed URLs across repeated one-second polls", async () => {
    mocks.rpc.mockResolvedValue({ data: [sponsorRow()], error: null });
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/stable" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/unexpected" },
        error: null,
      });

    const first = await gameBroadcastSponsors("stable-game");
    const second = await gameBroadcastSponsors("stable-game");
    expect(second).toEqual(first);
    expect(second[0].dataUrl).toBe("https://storage.example/signed/stable");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("refreshes a stable sponsor after the cache expires before its URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mocks.rpc.mockResolvedValue({ data: [sponsorRow()], error: null });
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/first" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/refreshed" },
        error: null,
      });

    await gameBroadcastSponsors("expiring-game");
    vi.advanceTimersByTime(4 * 60 * 1000 + 1);
    const refreshed = await gameBroadcastSponsors("expiring-game");
    expect(refreshed[0].dataUrl).toBe(
      "https://storage.example/signed/refreshed",
    );
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("refreshes immediately when a sponsor asset is replaced", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [sponsorRow()], error: null })
      .mockResolvedValueOnce({
        data: [sponsorRow({ storage_path: "organization/private/new.png" })],
        error: null,
      });
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/old" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/new" },
        error: null,
      });

    await gameBroadcastSponsors("replacement-game");
    const replaced = await gameBroadcastSponsors("replacement-game");
    expect(replaced[0].dataUrl).toBe("https://storage.example/signed/new");
    expect(mocks.createSignedUrl).toHaveBeenLastCalledWith(
      "organization/private/new.png",
      300,
    );
  });

  it("refreshes ordered output and removes archived sponsors", async () => {
    const first = sponsorRow({ id: "first", position: 0 });
    const second = sponsorRow({
      id: "second",
      storage_path: "organization/private/second.png",
      position: 1,
    });
    mocks.rpc
      .mockResolvedValueOnce({ data: [first, second], error: null })
      .mockResolvedValueOnce({
        data: [
          { ...second, position: 0 },
          { ...first, position: 1 },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ ...second, position: 0 }],
        error: null,
      });
    mocks.createSignedUrl.mockImplementation(async (path: string) => ({
      data: { signedUrl: `https://storage.example/signed/${path}` },
      error: null,
    }));

    await gameBroadcastSponsors("order-archive-game");
    const reordered = await gameBroadcastSponsors("order-archive-game");
    expect(reordered.map((sponsor) => sponsor.id)).toEqual(["second", "first"]);
    const archived = await gameBroadcastSponsors("order-archive-game");
    expect(archived.map((sponsor) => sponsor.id)).toEqual(["second"]);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(5);
  });

  it("does not cache signing failures", async () => {
    mocks.rpc.mockResolvedValue({ data: [sponsorRow()], error: null });
    mocks.createSignedUrl
      .mockResolvedValueOnce({ data: null, error: { message: "private" } })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://storage.example/signed/recovered" },
        error: null,
      });

    await expect(gameBroadcastSponsors("failed-game")).rejects.toThrow(
      "Sponsor preview unavailable",
    );
    await expect(gameBroadcastSponsors("failed-game")).resolves.toEqual([
      expect.objectContaining({
        dataUrl: "https://storage.example/signed/recovered",
      }),
    ]);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });
});
