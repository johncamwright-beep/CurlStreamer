import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  validate: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: mocks.context,
  readTeamSettings: mocks.read,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    rpc: mocks.rpc,
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: "https://storage.test/team-public-media/" + path },
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/providers/sponsor-library", () => ({
  validateSponsorImage: mocks.validate,
}));
import { PATCH, POST } from "./route";
import { defaultTeamPageSettings } from "@/lib/team-page-settings";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(null);
});
describe("team settings writes", () => {
  it("rejects non administrators before database access", async () => {
    expect(
      (
        await PATCH(
          new Request("https://test/api/account/team", {
            method: "PATCH",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses only the authenticated organization", async () => {
    mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
    mocks.rpc.mockResolvedValue({ error: null });
    const settings = defaultTeamPageSettings("Team Benning");
    expect(
      (
        await PATCH(
          new Request("https://test/api/account/team", {
            method: "PATCH",
            body: JSON.stringify(settings),
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_team_public_profile", {
      p_org: "trusted-org",
      p_settings: settings,
    });
  });
  it("rejects caller supplied organization fields", async () => {
    mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
    expect(
      (
        await PATCH(
          new Request("https://test/api/account/team", {
            method: "PATCH",
            body: JSON.stringify({
              ...defaultTeamPageSettings("Team Benning"),
              organizationId: "other",
            }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns the normalized saved address for public-page navigation", async () => {
    mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
    mocks.rpc.mockResolvedValue({ error: null });
    const response = await PATCH(
      new Request("https://test/api/account/team", {
        method: "PATCH",
        body: JSON.stringify({
          ...defaultTeamPageSettings("Team Benning"),
          slug: "  Team-Benning  ",
          published: true,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      saved: true,
      settings: { slug: "team-benning", published: true },
    });
  });
});

it("rejects a photo belonging to a different organization", async () => {
  mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
  const response = await PATCH(
    new Request("https://test/api/account/team", {
      method: "PATCH",
      body: JSON.stringify({
        ...defaultTeamPageSettings("Team Benning"),
        photo: "https://storage.test/team-public-media/other-org/123.png",
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["photo", "gallery"])(
  "stores validated %s in the authorized profile",
  async (kind) => {
    mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
    mocks.read.mockResolvedValue({
      settings: defaultTeamPageSettings("Team Benning"),
      logo: "existing-logo",
    });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.validate.mockResolvedValue({
      extension: "png",
      bytes: Buffer.from("validated image"),
      mime: "image/png",
    });
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new File(["test"], "team.png", { type: "image/png" }));
    const response = await POST(
      new Request("https://test/api/account/team", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const uploadedUrl = kind === "gallery" ? body.gallery[0].url : body.photo;
    expect(uploadedUrl).toMatch(
      /^https:\/\/storage.test\/team-public-media\/trusted-org\/[a-f0-9-]+\.png$/,
    );
    expect(mocks.validate).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenLastCalledWith("update_team_public_profile", {
      p_org: "trusted-org",
      p_settings: {
        ...defaultTeamPageSettings("Team Benning"),
        ...(kind === "gallery"
          ? { gallery: body.gallery }
          : { photo: body.photo }),
      },
    });
  },
);
