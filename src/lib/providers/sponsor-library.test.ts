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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns public metadata with a five-minute signed URL and no storage path", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: "internal-id",
          display_name: "Club sponsor",
          alt_text: "Club sponsor logo",
          storage_path: "organization/private/logo.png",
          position: 0,
        },
      ],
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
});
