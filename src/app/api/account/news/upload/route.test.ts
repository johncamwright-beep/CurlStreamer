import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  context: vi.fn(),
  validate: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: m.context,
}));
vi.mock("@/lib/providers/sponsor-library", () => ({
  validateSponsorImage: m.validate,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    storage: {
      from: () => ({ upload: m.upload, getPublicUrl: m.getPublicUrl }),
    },
  }),
}));
import { POST } from "./route";
function request(file?: File) {
  const form = new FormData();
  if (file) form.append("image", file);
  return new Request("https://test/api/account/news/upload", {
    method: "POST",
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.context.mockResolvedValue({
    organizationId: "trusted",
    user: { id: "admin" },
  });
  m.validate.mockResolvedValue({
    bytes: new Uint8Array([1]),
    mime: "image/png",
    extension: "png",
  });
  m.upload.mockResolvedValue({ error: null });
  m.getPublicUrl.mockReturnValue({
    data: {
      publicUrl: "https://media.test/team-public-media/trusted/news/photo.png",
    },
  });
});
it("requires a team administrator before accepting uploads", async () => {
  m.context.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect(m.upload).not.toHaveBeenCalled();
});
it("rejects a missing or invalid image without storing it", async () => {
  expect((await POST(request())).status).toBe(400);
  m.validate.mockRejectedValue(Error("bad image"));
  expect(
    (await POST(request(new File(["bad"], "bad.gif", { type: "image/gif" }))))
      .status,
  ).toBe(400);
  expect(m.upload).not.toHaveBeenCalled();
});
it("stores each image below the authenticated organization prefix", async () => {
  const response = await POST(
    request(new File(["image"], "rink.png", { type: "image/png" })),
  );
  expect(response.status).toBe(200);
  expect(m.upload).toHaveBeenCalledWith(
    expect.stringMatching(/^trusted\/news\/[0-9a-f-]+\.png$/),
    expect.any(Uint8Array),
    { contentType: "image/png" },
  );
});
