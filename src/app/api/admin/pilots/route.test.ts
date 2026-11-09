import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: m.auth,
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/providers/pilot-accounts", () => ({
  sendPilotCredentials: m.send,
}));
import { GET, POST } from "./route";
const req = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/admin/pilots", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(body),
  });
const input = {
  action: "create",
  name: "Pilot Owner",
  email: "pilot@example.test",
  phone: "+1 555 123 4567",
  team: "Pilot Team",
  expiresAt: "2027-03-01T00:00:00Z",
  coachSeats: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue(null);
  m.rpc.mockResolvedValue({ data: { id: "pilot" }, error: null });
  m.send.mockResolvedValue({ emailStatus: "accepted" });
});
it("rejects non-admins and cross-origin calls before any provisioning", async () => {
  expect((await GET()).status).toBe(403);
  expect((await POST(req(input))).status).toBe(403);
  m.auth.mockResolvedValue({ id: "admin" });
  expect((await POST(req(input, "https://other"))).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("binds provisioning to the administrator and never returns credentials", async () => {
  m.auth.mockResolvedValue({ id: "admin" });
  const r = await POST(req({ ...input, p_actor: "forged" }));
  expect(r.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "prepare_pilot_account",
    expect.objectContaining({
      p_actor: "admin",
      p_phone: input.phone,
      p_seats: 1,
    }),
  );
  expect(m.send).toHaveBeenCalledWith("admin", "pilot");
  expect(await r.json()).toEqual({ saved: true, emailStatus: "accepted" });
});
it("does not send or reset an existing account and preserves saved pilots after email failure", async () => {
  m.auth.mockResolvedValue({ id: "admin" });
  m.rpc.mockResolvedValueOnce({ error: { code: "23505" } });
  expect((await POST(req(input))).status).toBe(409);
  expect(m.send).not.toHaveBeenCalled();
  m.send.mockRejectedValueOnce(Error("SMTP"));
  expect((await POST(req(input))).status).toBe(503);
});
