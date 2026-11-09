import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
vi.mock("./report-email-transport", () => ({ reportMailConfig: m.config }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: m.send, close: m.close }) },
}));
import { notifyWaitlistSignup } from "./waitlist-notification";
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  notification_attempt_id: "00000000-0000-4000-8000-000000000002",
  email: "coach@example.com",
  team: "Team",
  created_at: "2026-11-09T12:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockResolvedValue({ data: [], error: null });
  m.config.mockReturnValue({
    success: true,
    data: {
      host: "smtp.zoho.com",
      port: "465",
      user: "hello@curlstreamer.app",
      password: "fixture",
      from: "hello@curlstreamer.app",
    },
  });
  m.send.mockResolvedValue({ accepted: ["hello@curlstreamer.app"] });
});
it("sends a claimed signup to Hello and records provider acceptance", async () => {
  m.rpc.mockResolvedValueOnce({ data: [row], error: null });
  await notifyWaitlistSignup(row.email);
  expect(m.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "hello@curlstreamer.app",
      subject: "New CurlStreamer waitlist signup",
      text: expect.stringContaining(row.email),
    }),
  );
  expect(m.rpc).toHaveBeenLastCalledWith("finish_waitlist_notification", {
    p_id: row.id,
    p_attempt: row.notification_attempt_id,
    p_status: "accepted",
  });
});
it("does not email when another worker claimed it or it was already sent", async () => {
  await notifyWaitlistSignup(row.email);
  expect(m.send).not.toHaveBeenCalled();
});
it("marks ambiguous SMTP failure unknown without resending", async () => {
  m.rpc.mockResolvedValueOnce({ data: [row], error: null });
  m.send.mockRejectedValue(new Error("timeout"));
  await notifyWaitlistSignup(row.email);
  expect(m.rpc).toHaveBeenLastCalledWith(
    "finish_waitlist_notification",
    expect.objectContaining({ p_status: "unknown" }),
  );
  expect(m.close).toHaveBeenCalledOnce();
});
it("retains retryable failure when mail is not configured", async () => {
  m.rpc.mockResolvedValueOnce({ data: [row], error: null });
  m.config.mockReturnValue({ success: false });
  await notifyWaitlistSignup(row.email);
  expect(m.send).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenLastCalledWith(
    "finish_waitlist_notification",
    expect.objectContaining({ p_status: "failed" }),
  );
});
