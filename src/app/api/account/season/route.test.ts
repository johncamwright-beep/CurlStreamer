import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  config: vi.fn(),
  checkout: vi.fn(),
  cancel: vi.fn(),
  rpc: vi.fn(),
  purchase: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: mocks.auth,
}));
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: mocks.admin,
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/providers/stripe-season", () => ({
  seasonConfig: mocks.config,
  readSeasonPurchase: mocks.purchase,
  seasonCheckout: mocks.checkout,
  cancelSeasonCheckout: mocks.cancel,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { GET, POST } from "./route";
const request = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/account/season", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.purchase.mockResolvedValue({
    baseOwned: false,
    coachSeats: 0,
    pending: false,
  });
  mocks.auth.mockResolvedValue({
    user: { id: "owner" },
    organizationId: "org",
    role: "owner",
  });
  mocks.admin.mockResolvedValue(null);
  mocks.config.mockReturnValue({ live: true });
  mocks.checkout.mockResolvedValue("https://checkout.stripe.com/test");
  mocks.rpc.mockResolvedValue({ data: { pageEnabled: true }, error: null });
});
it("denies unauthenticated, cross-origin and test checkout by ordinary users", async () => {
  expect(
    (await POST(request({ base: true, coaches: 1 }, "https://other"))).status,
  ).toBe(403);
  mocks.config.mockReturnValue({ live: false });
  expect((await POST(request({ base: true, coaches: 1 }))).status).toBe(403);
  mocks.auth.mockResolvedValue(null);
  expect((await GET()).status).toBe(403);
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it("rejects client price, actor, expiry and excess seat inputs", async () => {
  for (const body of [
    { base: true, coaches: 3 },
    { base: false, coaches: 0 },
    { base: true, coaches: 1, amount: 1 },
    { base: true, coaches: 1, organizationId: "other" },
    { base: true, coaches: 1, expiresAt: "2099" },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it("derives checkout identity from the session and keeps billing responses private", async () => {
  expect((await POST(request({ base: true, coaches: 2 }))).status).toBe(200);
  expect(mocks.checkout).toHaveBeenCalledWith("owner", "org", true, 2);
  expect((await GET()).headers.get("cache-control")).toBe("private, no-store");
});

it("returns a purchase summary without treating sandbox purchases as paid access", async () => {
  mocks.config.mockReturnValue({ live: false });
  mocks.admin.mockResolvedValue({ id: "owner" });
  mocks.rpc.mockResolvedValue({
    data: { pageEnabled: false, streamEnabled: false },
    error: null,
  });
  mocks.purchase.mockResolvedValue({
    baseOwned: true,
    coachSeats: 2,
    pending: false,
  });
  const body = await (await GET()).json();
  expect(body).toMatchObject({
    mode: "test",
    available: true,
    purchase: { baseOwned: true, coachSeats: 2 },
    access: { streamEnabled: false },
  });
});
it("rejects malformed JSON and scopes cancellation to the authenticated team", async () => {
  expect(
    (
      await POST(
        new Request("https://test/api/account/season", {
          method: "POST",
          headers: { origin: "https://test" },
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect((await POST(request({ action: "cancel" }))).status).toBe(200);
  expect(mocks.cancel).toHaveBeenCalledWith("org");
});

it("limits checkout creation and fails closed if shared counters are unavailable", async () => {
  mocks.limit.mockResolvedValue(false);
  const response = await POST(request({ base: true, coaches: 0 }));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  mocks.limit.mockRejectedValue(Error("unavailable"));
  expect((await POST(request({ base: true, coaches: 0 }))).status).toBe(503);
  expect(mocks.checkout).not.toHaveBeenCalled();
});
