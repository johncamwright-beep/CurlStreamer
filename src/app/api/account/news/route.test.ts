import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  validate: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: m.context,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    rpc: m.rpc,
    from: m.from,
    storage: {
      from: () => ({
        upload: m.upload,
        remove: m.remove,
        getPublicUrl: () => ({
          data: { publicUrl: "https://media.test/photo.png" },
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/providers/sponsor-library", () => ({
  validateSponsorImage: m.validate,
}));
import { POST, PATCH, DELETE, GET } from "./route";
const id = "10000000-0000-4000-8000-000000000001";
function request(method = "POST", values: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id,
    summary: "A team update",
    published: "false",
    ...values,
  }))
    form.append(key, value);
  return new Request("https://test/api/account/news", { method, body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.context.mockResolvedValue({
    organizationId: "trusted",
    user: { id: "admin" },
  });
  m.rpc.mockResolvedValue({
    data: { id, revision: 1, photo_url: null },
    error: null,
  });
});
it("denies reads and writes without an administrator", async () => {
  m.context.mockResolvedValue(null);
  for (const response of [
    await GET(),
    await POST(request()),
    await PATCH(request("PATCH")),
    await DELETE(new Request("https://test", { method: "DELETE", body: "{}" })),
  ])
    expect(response.status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.from).not.toHaveBeenCalled();
});
it("creates a private standalone post and ignores forged team identity", async () => {
  expect(
    (await POST(request("POST", { organizationId: "foreign" }))).status,
  ).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "manage_team_news",
    expect.objectContaining({
      p_org: "trusted",
      p_user: "admin",
      p_id: id,
      p_revision: 0,
      p_game: null,
      p_published: false,
    }),
  );
});
it("passes the same stable ID on retries", async () => {
  await POST(request());
  await POST(request());
  expect(m.rpc.mock.calls.map((call) => call[1].p_id)).toEqual([id, id]);
});
it("passes the completed game to the database authorization check", async () => {
  await POST(request("POST", { gameId: id, published: "true" }));
  expect(m.rpc).toHaveBeenCalledWith(
    "manage_team_news",
    expect.objectContaining({ p_game: id, p_published: true }),
  );
});
it("requires an edit revision and preserves an existing photo", async () => {
  expect((await PATCH(request("PATCH"))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
  expect((await PATCH(request("PATCH", { revision: "2" }))).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "manage_team_news",
    expect.objectContaining({ p_revision: 2, p_replace_photo: false }),
  );
});
it("reports stale updates as a conflict instead of silently overwriting", async () => {
  m.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect((await PATCH(request("PATCH", { revision: "2" }))).status).toBe(409);
});
it("rejects empty text and malformed publication flags", async () => {
  expect((await POST(request("POST", { summary: " " }))).status).toBe(400);
  expect((await POST(request("POST", { published: "yes" }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("removes only the authenticated team's post with a matching revision", async () => {
  expect(
    (
      await DELETE(
        new Request("https://test", {
          method: "DELETE",
          body: JSON.stringify({ id, revision: 3 }),
        }),
      )
    ).status,
  ).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "manage_team_news",
    expect.objectContaining({
      p_org: "trusted",
      p_id: id,
      p_revision: 3,
      p_delete: true,
      p_published: false,
    }),
  );
});
async function photoRequest() {
  const form = await request().formData();
  form.append("photo", new File(["image"], "test.png", { type: "image/png" }));
  m.validate.mockResolvedValue({
    bytes: new Uint8Array([1]),
    mime: "image/png",
    extension: "png",
  });
  m.upload.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
  return new Request("https://test", { method: "POST", body: form });
}
it("keeps a photo when the database commit outcome is uncertain", async () => {
  m.rpc.mockRejectedValue(new Error("connection lost after commit"));
  expect((await POST(await photoRequest())).status).toBe(400);
  expect(m.remove).not.toHaveBeenCalled();
});
it("cleans up an unused retry image without touching the saved photo", async () => {
  m.rpc.mockResolvedValue({
    data: { id, revision: 1, photo_url: "https://media.test/original.png" },
    error: null,
  });
  expect((await POST(await photoRequest())).status).toBe(200);
  expect(m.remove).toHaveBeenCalledOnce();
});
it("cleans up the new image on a definite stale edit rejection", async () => {
  m.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect((await POST(await photoRequest())).status).toBe(409);
  expect(m.remove).toHaveBeenCalledOnce();
});
