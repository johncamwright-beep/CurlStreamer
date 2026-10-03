import { expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));
import { requireTeamBroadcastAccess } from "./team-access";
it("fails closed for missing, expired and unavailable access", async () => {
  await expect(requireTeamBroadcastAccess(undefined)).rejects.toMatchObject({
    code: "P0402",
  });
  rpc.mockResolvedValue({ error: { code: "P0402" } });
  await expect(requireTeamBroadcastAccess("team")).rejects.toMatchObject({
    code: "P0402",
  });
  rpc.mockResolvedValue({ error: { code: "503" } });
  await expect(requireTeamBroadcastAccess("team")).rejects.toMatchObject({
    code: "503",
  });
  rpc.mockResolvedValue({ error: null });
  await expect(requireTeamBroadcastAccess("team")).resolves.toBeUndefined();
});
