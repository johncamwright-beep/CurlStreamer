import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  notify: vi.fn(),
  range: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: m.auth,
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: m.from }),
}));
vi.mock("@/lib/providers/waitlist-notification", () => ({
  notifyWaitlistSignup: m.notify,
  waitlistRecipient: "hello@curlstreamer.app",
}));
vi.mock("@/lib/providers/report-email-transport", () => ({
  reportMailConfig: () => ({ success: true }),
}));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const request = (origin = "https://test") =>
  new Request("https://test/api/admin/waitlist", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify({ id }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ id: "admin" });
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    eq: vi.fn(),
    range: m.range,
    single: m.single,
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  m.from.mockReturnValue(query);
  m.range.mockResolvedValue({ data: [], count: 0, error: null });
  m.single.mockResolvedValue({
    data: { email: "coach@example.com", notification_status: "pending" },
    error: null,
  });
});
it("requires platform admin before reading personal signup data or sending email", async () => {
  m.auth.mockResolvedValue(null);
  expect(
    (await GET(new Request("https://test/api/admin/waitlist"))).status,
  ).toBe(403);
  expect((await POST(request())).status).toBe(403);
  expect(m.from).not.toHaveBeenCalled();
  expect(m.notify).not.toHaveBeenCalled();
});
it("rejects cross-origin retries and invalid pagination", async () => {
  expect((await POST(request("https://other"))).status).toBe(403);
  expect(
    (await GET(new Request("https://test/api/admin/waitlist?page=-1"))).status,
  ).toBe(400);
  expect(m.from).not.toHaveBeenCalled();
});
it("paginates newest signup results with private no-store headers", async () => {
  const r = await GET(new Request("https://test/api/admin/waitlist?page=1"));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(m.range).toHaveBeenCalledWith(50, 99);
});
it("retries only eligible saved signups, never an arbitrary submitted address", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.notify).toHaveBeenCalledWith("coach@example.com");
  m.notify.mockClear();
  m.single.mockResolvedValue({
    data: { email: "coach@example.com", notification_status: "accepted" },
    error: null,
  });
  expect((await POST(request())).status).toBe(409);
  expect(m.notify).not.toHaveBeenCalled();
});
