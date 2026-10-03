import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  config: vi.fn(),
  checkout: vi.fn(),
  customer: vi.fn(),
  plan: vi.fn(),
  row: vi.fn(),
  portal: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: m.auth,
}));
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: m.admin,
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/providers/stripe-billing", () => ({
  stripeTestConfig: m.config,
  stripeTestClient: () => ({
    billingPortal: { sessions: { create: m.portal } },
  }),
  testPlan: m.plan,
  billingRow: m.row,
  ensureTestCustomer: m.customer,
  createTestCheckout: m.checkout,
}));
import { GET, POST } from "./route";
const req = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/account/billing", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    user: { id: "user" },
    organizationId: "org",
    role: "owner",
  });
  m.admin.mockResolvedValue({ id: "user" });
  m.config.mockReturnValue({ base: "https://test" });
  m.plan.mockResolvedValue({
    name: "Test",
    amount: 1000,
    currency: "cad",
    interval: "month",
  });
  m.customer.mockResolvedValue("cus_own");
  m.checkout.mockResolvedValue("https://checkout.stripe.com/test");
});
it("keeps unconfigured checkout visibly unavailable", async () => {
  m.config.mockReturnValue(null);
  expect(await (await GET()).json()).toMatchObject({
    available: false,
    mode: "test",
  });
});
it("does not allow another team or customer to be supplied", async () => {
  expect(
    (await POST(req({ action: "checkout", customer: "cus_other" }))).status,
  ).toBe(400);
  expect(m.checkout).not.toHaveBeenCalled();
});
it("rejects cross-origin writes", async () => {
  expect(
    (await POST(req({ action: "checkout" }, "https://other"))).status,
  ).toBe(403);
  expect(m.checkout).not.toHaveBeenCalled();
});
it("requires full team authority and platform test permission", async () => {
  m.auth.mockResolvedValue(null);
  expect((await POST(req({ action: "checkout" }))).status).toBe(403);
  m.auth.mockResolvedValue({ user: { id: "u" }, role: "owner" });
  m.admin.mockResolvedValue(null);
  expect((await POST(req({ action: "checkout" }))).status).toBe(403);
});
it("binds checkout to the authenticated organization", async () => {
  expect((await POST(req({ action: "checkout" }))).status).toBe(200);
  expect(m.customer).toHaveBeenCalledWith(expect.anything(), "org");
  expect(m.checkout).toHaveBeenCalledWith(expect.anything(), "user", "cus_own");
});
it("uses only the stored team customer for portal access", async () => {
  m.row.mockResolvedValue({ customer_id: "cus_own" });
  m.portal.mockResolvedValue({ url: "https://billing.stripe.com/test" });
  expect((await POST(req({ action: "portal" }))).status).toBe(200);
  expect(m.portal).toHaveBeenCalledWith({
    customer: "cus_own",
    return_url: "https://test/account?section=subscription&billing=returned",
  });
});
