import Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("@/lib/providers/stripe-billing", () => ({
  stripeTestConfig: () => ({ webhook: "whsec_test" }),
  stripeTestClient: () => new Stripe("sk_test_example"),
  reconcileTestEvent: m.reconcile,
}));
import { POST } from "./route";
beforeEach(() => vi.resetAllMocks());
function request(live = false, valid = true) {
  const payload = JSON.stringify({
    id: "evt_test",
    type: "customer.subscription.updated",
    livemode: live,
    data: { object: { customer: "cus_test" } },
  });
  const signature = new Stripe(
    "sk_test_example",
  ).webhooks.generateTestHeaderString({
    payload,
    secret: valid ? "whsec_test" : "whsec_wrong",
  });
  return new Request("https://test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}
it("verifies the raw Stripe signature before processing", async () => {
  expect((await POST(request(false, false))).status).toBe(400);
  expect(m.reconcile).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(200);
  expect(m.reconcile).toHaveBeenCalledOnce();
});
it("rejects signed live-mode events", async () => {
  expect((await POST(request(true))).status).toBe(400);
  expect(m.reconcile).not.toHaveBeenCalled();
});
it("returns a retryable response if synchronization fails", async () => {
  m.reconcile.mockRejectedValue(Error("database unavailable"));
  expect((await POST(request())).status).toBe(503);
});
