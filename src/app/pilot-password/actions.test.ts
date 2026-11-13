import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (s: string) => {
    throw Error(s);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: m.getUser, refreshSession: m.refresh },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    auth: { admin: { updateUserById: m.update } },
    rpc: m.rpc,
    from: () => ({ select: () => ({ eq: () => ({ single: m.read }) }) }),
  }),
}));
import { changePilotPassword } from "./actions";
const form = () => {
  const f = new FormData();
  f.set("password", "a-new-password-123");
  f.set("passwordConfirmation", "a-new-password-123");
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  m.getUser.mockResolvedValue({
    data: {
      user: {
        id: "user",
        app_metadata: {
          pilot_password_required: true,
          pilot_credentials_expire: "2090-01-01",
        },
      },
    },
  });
  m.read.mockResolvedValue({
    data: {
      organization_id: "org",
      expires_at: "2090-01-01",
      email_status: "accepted",
    },
    error: null,
  });
  m.update.mockResolvedValue({ error: null });
  m.rpc.mockResolvedValue({ error: null });
});
it("activates only after changing the password and keeps the gate until activation finishes", async () => {
  await expect(changePilotPassword({}, form())).rejects.toThrow(
    "/onboarding?start=1",
  );
  expect(m.update.mock.calls[0][1]).toMatchObject({
    password: "a-new-password-123",
    app_metadata: { pilot_password_required: false, pilot_setup_pending: true },
  });
  expect(m.rpc).toHaveBeenCalledWith("activate_pilot_account", {
    p_user: "user",
  });
  expect(m.update.mock.calls[1][1]).toEqual({
    app_metadata: { pilot_setup_pending: false },
  });
});
it("does not activate expired invitations or failed password updates", async () => {
  m.read.mockResolvedValueOnce({
    data: { revoked_at: "now", expires_at: "2090-01-01" },
  });
  expect((await changePilotPassword({}, form())).error).toBeTruthy();
  expect(m.update).not.toHaveBeenCalled();
  m.update.mockResolvedValueOnce({ error: {} });
  expect((await changePilotPassword({}, form())).error).toBeTruthy();
  expect(m.rpc).not.toHaveBeenCalled();
});
