import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  send: vi.fn(),
  close: vi.fn(),
  create: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: m.create } }));
import { deliverReportEmail } from "./report-email-transport";
beforeEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of Object.entries({
    ZOHO_SMTP_HOST: "smtp.zohocloud.ca",
    ZOHO_SMTP_PORT: "465",
    ZOHO_SMTP_USER: "hello@curlstreamer.app",
    ZOHO_SMTP_PASSWORD: "fixture",
    INVITATION_FROM_EMAIL: "hello@curlstreamer.app",
  }))
    vi.stubEnv(k, v);
  m.create.mockReturnValue({ sendMail: m.send, close: m.close });
  m.send.mockResolvedValue({ accepted: ["player@example.com"] });
});
afterEach(() => vi.unstubAllEnvs());
const input = {
  to: "player@example.com",
  title: "Player report",
  eventName: "Event",
  pdf: Buffer.from("%PDF-fixture"),
};
it("attaches only the supplied PDF to one recipient and never a roster list", async () => {
  expect(await deliverReportEmail(input)).toBe("accepted");
  const mail = m.send.mock.calls[0][0];
  expect(mail.to).toEqual({ name: "", address: input.to });
  expect(mail.cc).toBeUndefined();
  expect(mail.bcc).toBeUndefined();
  expect(mail.attachments).toHaveLength(1);
  expect(mail.attachments[0].content).toBe(input.pdf);
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      requireTLS: true,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
  );
});
it("rejects injected recipients and treats SMTP exceptions as uncertain without retries", async () => {
  expect(
    await deliverReportEmail({
      ...input,
      to: "player@example.com\r\nBcc: other@example.com",
    }),
  ).toBe("failed");
  expect(m.send).not.toHaveBeenCalled();
  m.send.mockRejectedValue(Error("private provider error"));
  expect(await deliverReportEmail(input)).toBe("unknown");
  expect(m.send).toHaveBeenCalledOnce();
  expect(m.close).toHaveBeenCalledOnce();
});
