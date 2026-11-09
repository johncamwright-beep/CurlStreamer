import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    rpc: m.rpc,
    auth: { admin: { createUser: m.create, updateUserById: m.update } },
  }),
}));
vi.mock("./report-email-transport", () => ({
  reportMailConfig: () => ({
    success: true,
    data: {
      host: "smtp.zoho.com",
      port: "465",
      user: "sender@example.test",
      password: "fake",
      from: "sender@example.test",
    },
  }),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: m.send, close: m.close }) },
}));
import { sendPilotCredentials } from "./pilot-accounts";
const row = {
  id: "pilot",
  email: "owner@example.test",
  administrator_name: "Owner",
  team_name: "New Team",
  expires_at: "2090-01-01T00:00:00Z",
  email_attempt: "attempt",
  user_id: "user",
  organization_id: "org",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "claim_pilot_email"
        ? [row]
        : name === "provision_pilot_account"
          ? row
          : null,
    error: null,
  }));
  m.update.mockResolvedValue({ error: null });
  m.send.mockResolvedValue({ accepted: ["owner@example.test"] });
});
it("only emails the saved recipient, rotates temporary credentials, and never returns them", async () => {
  const result = await sendPilotCredentials("admin", "pilot");
  expect(result).toEqual({ emailStatus: "accepted" });
  expect(m.create).not.toHaveBeenCalled();
  expect(m.update.mock.calls[0][1].password.length).toBeGreaterThanOrEqual(24);
  expect(m.send.mock.calls[0][0].to.address).toBe(row.email);
  expect(m.send.mock.calls[0][0].text).toContain(
    m.update.mock.calls[0][1].password,
  );
  expect(m.rpc).toHaveBeenCalledWith("finish_pilot_email", {
    p_id: "pilot",
    p_attempt: "attempt",
    p_status: "accepted",
  });
});
it("cannot reset activated accounts when the database refuses the claim", async () => {
  m.rpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(sendPilotCredentials("admin", "pilot")).rejects.toThrow();
  expect(m.update).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
it("does not send when password setup fails and labels uncertain SMTP delivery", async () => {
  m.update.mockResolvedValueOnce({ error: {} });
  await expect(sendPilotCredentials("admin", "pilot")).rejects.toThrow();
  expect(m.send).not.toHaveBeenCalled();
  m.send.mockRejectedValueOnce(Error("timeout"));
  expect(await sendPilotCredentials("admin", "pilot")).toEqual({
    emailStatus: "unknown",
  });
  expect(m.close).toHaveBeenCalled();
});
