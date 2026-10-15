import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  preview: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/providers/shot-tracker-report-email", async (original) => ({
  ...(await original<
    typeof import("@/lib/providers/shot-tracker-report-email")
  >()),
  prepareReportEmail: m.preview,
  sendReportEmail: m.send,
}));
import { GET, POST } from "./route";
const eventId = "11111111-1111-4111-8111-111111111111";
const input = {
  eventId,
  audience: "team",
  reportKey: "team",
  planToken: "a".repeat(64),
  resend: false,
  coachName: "John Wright",
  subject: "Event report",
  coachMessage: "Please review before practice.",
  cc: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LAB_ENABLED", "false");
  m.account.mockResolvedValue({ userId: "actor", organizationId: "org" });
  m.preview.mockResolvedValue({ preview: { recipients: [] } });
  m.send.mockResolvedValue({ results: [] });
});
afterEach(() => vi.unstubAllEnvs());
const post = (body: unknown, origin = "https://www.curlstreamer.app") =>
  POST(
    new Request("https://www.curlstreamer.app/api/curlcoach/report-email", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
it("GET previews but never sends", async () => {
  expect(
    (
      await GET(
        new Request(
          `https://www.curlstreamer.app/api/curlcoach/report-email?eventId=${eventId}&audience=team&reportKey=team`,
        ),
      )
    ).status,
  ).toBe(200);
  expect(m.send).not.toHaveBeenCalled();
});
it("rejects unauthenticated users and cross-origin sending", async () => {
  expect((await post(input, "https://other.example")).status).toBe(403);
  m.account.mockResolvedValue(null);
  expect((await post(input)).status).toBe(403);
  expect(m.send).not.toHaveBeenCalled();
});
it("rejects arbitrary recipients, organizations and coach reports", async () => {
  for (const extra of [
    { to: "other@example.com" },
    { organizationId: "other" },
    { audience: "coach" },
  ])
    expect((await post({ ...input, ...extra })).status).toBe(400);
  expect(m.send).not.toHaveBeenCalled();
});
it("uses only the authenticated account scope", async () => {
  expect((await post(input)).status).toBe(200);
  expect(m.send).toHaveBeenCalledWith(
    { userId: "actor", organizationId: "org" },
    input,
  );
});
