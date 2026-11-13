import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));
import { sendTeamInvitationEmail } from "./invitation-email";
const invitation = {
  to: "parent@example.com",
  url: "https://www.curlstreamer.app/join-team?token=private",
  role: "team_admin",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ZOHO_SMTP_HOST", "smtp.zohocloud.ca");
  vi.stubEnv("ZOHO_SMTP_PORT", "465");
  vi.stubEnv("ZOHO_SMTP_USER", "hello@curlstreamer.app");
  vi.stubEnv("ZOHO_SMTP_PASSWORD", "test-only-password");
  vi.stubEnv("INVITATION_FROM_EMAIL", "hello@curlstreamer.app");
  mocks.createTransport.mockReturnValue({
    sendMail: mocks.sendMail,
    close: mocks.close,
  });
  mocks.sendMail.mockResolvedValue({ accepted: [invitation.to] });
});
afterEach(() => vi.unstubAllEnvs());
it("sends the private link with instructions allowing another login email", async () => {
  expect(await sendTeamInvitationEmail(invitation)).toEqual({
    emailSent: true,
    emailStatus: "sent",
  });
  expect(mocks.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: { address: invitation.to, name: "" },
      text: expect.stringContaining("any email address you prefer"),
    }),
  );
  expect(mocks.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      secure: true,
      requireTLS: true,
      logger: false,
      debug: false,
    }),
  );
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("uses STARTTLS on port 587", async () => {
  vi.stubEnv("ZOHO_SMTP_PORT", "587");
  await sendTeamInvitationEmail(invitation);
  expect(mocks.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
  );
});
it("keeps a usable invitation when SMTP fails without exposing the error", async () => {
  mocks.sendMail.mockRejectedValue(new Error("sensitive-provider-output"));
  expect(await sendTeamInvitationEmail(invitation)).toEqual({
    emailSent: false,
    emailStatus: "failed",
  });
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("does not claim delivery for a missing configuration or rejection", async () => {
  mocks.sendMail.mockResolvedValue({ accepted: [] });
  expect((await sendTeamInvitationEmail(invitation)).emailSent).toBe(false);
  vi.stubEnv("ZOHO_SMTP_PASSWORD", "");
  expect((await sendTeamInvitationEmail(invitation)).emailStatus).toBe(
    "not_configured",
  );
  expect(mocks.sendMail).toHaveBeenCalledOnce();
});
it("rejects non-Zoho hosts and header injection", async () => {
  expect(
    (
      await sendTeamInvitationEmail({
        ...invitation,
        to: "parent@example.com\r\nBcc: other@example.com",
      })
    ).emailSent,
  ).toBe(false);
  vi.stubEnv("ZOHO_SMTP_HOST", "internal.example.com");
  expect((await sendTeamInvitationEmail(invitation)).emailSent).toBe(false);
  expect(mocks.sendMail).not.toHaveBeenCalled();
});
