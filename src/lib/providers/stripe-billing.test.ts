import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => mocks,
}));
import {
  stripeTestConfig,
  testPlan,
  reconcileTestEvent,
  createTestCheckout,
} from "./stripe-billing";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRIPE_TEST_ENABLED", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
  vi.stubEnv("STRIPE_TEST_PRICE_ID", "price_example");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example");
  vi.stubEnv("APP_BASE_URL", "https://www.curlstreamer.app");
});
it("defaults off and refuses live keys even when enabled", () => {
  vi.stubEnv("STRIPE_TEST_ENABLED", "false");
  expect(stripeTestConfig()).toBeNull();
  vi.stubEnv("STRIPE_TEST_ENABLED", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_example");
  expect(stripeTestConfig).toThrow();
});
it("refuses live or non-recurring prices", async () => {
  const stripe = {
    prices: { retrieve: vi.fn().mockResolvedValue({ livemode: true }) },
  } as unknown as Stripe;
  await expect(testPlan(stripe)).rejects.toThrow();
});
it("does not apply duplicated or busy webhook snapshots", async () => {
  const list = vi.fn();
  const stripe = { subscriptions: { list } } as unknown as Stripe;
  const event = {
    id: "evt_1",
    livemode: false,
    type: "customer.subscription.updated",
    data: { object: { customer: "cus_1" } },
  } as Stripe.Event;
  mocks.rpc.mockResolvedValueOnce({ data: "done" });
  await reconcileTestEvent(stripe, event);
  expect(list).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: "busy" });
  await expect(reconcileTestEvent(stripe, event)).rejects.toThrow();
  expect(list).not.toHaveBeenCalled();
});
it("reconciles current Stripe state rather than an older signed event", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: "claimed" })
    .mockResolvedValueOnce({ error: null });
  const stripe = {
    subscriptions: {
      list: vi.fn().mockResolvedValue({
        has_more: false,
        data: [
          {
            livemode: false,
            status: "canceled",
            created: 2,
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: { id: "price_example" },
                  current_period_end: 2000000000,
                },
              ],
            },
          },
        ],
      }),
    },
  } as unknown as Stripe;
  await reconcileTestEvent(stripe, {
    id: "evt_old",
    livemode: false,
    type: "customer.subscription.updated",
    data: { object: { customer: "cus_1", status: "active" } },
  } as Stripe.Event);
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_test_billing_sync",
    expect.objectContaining({
      p_event: "evt_old",
      p_subscription: expect.objectContaining({ status: "canceled" }),
    }),
  );
});
it("blocks another subscription checkout including an older price", async () => {
  const create = vi.fn();
  const stripe = {
    subscriptions: {
      list: vi
        .fn()
        .mockResolvedValue({ has_more: false, data: [{ status: "past_due" }] }),
    },
    checkout: { sessions: { create } },
  } as unknown as Stripe;
  await expect(createTestCheckout(stripe, "user", "cus_1")).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
it("uses the persisted checkout key across retries", async () => {
  mocks.rpc.mockResolvedValue({ data: "stable-key" });
  const session = {
    id: "cs_1",
    livemode: false,
    status: "open",
    url: "https://checkout.stripe.com/test",
  };
  const create = vi.fn().mockResolvedValue(session);
  const stripe = {
    subscriptions: {
      list: vi.fn().mockResolvedValue({ has_more: false, data: [] }),
    },
    checkout: {
      sessions: {
        create,
        list: vi.fn().mockResolvedValue({ has_more: false, data: [] }),
        retrieve: vi.fn().mockResolvedValue(session),
      },
    },
  } as unknown as Stripe;
  await createTestCheckout(stripe, "user", "cus_1");
  await createTestCheckout(stripe, "user", "cus_1");
  expect(create.mock.calls[0][1]).toEqual(create.mock.calls[1][1]);
});

function checkoutClient(sessions: object[] = []) {
  const create = vi.fn().mockResolvedValue({
    id: "cs_new",
    livemode: false,
    status: "open",
    url: "https://checkout.stripe.com/new",
  });
  const retrieve = vi.fn().mockResolvedValue({
    id: "cs_new",
    livemode: false,
    status: "open",
    url: "https://checkout.stripe.com/new",
  });
  const list = vi.fn().mockResolvedValue({ has_more: false, data: sessions });
  const subscriptions = vi
    .fn()
    .mockResolvedValue({ has_more: false, data: [] });
  return {
    create,
    retrieve,
    list,
    subscriptions,
    stripe: {
      subscriptions: { list: subscriptions },
      checkout: { sessions: { list, create, retrieve } },
    } as unknown as Stripe,
  };
}

it("reuses an existing open checkout even after its idempotency record could expire", async () => {
  const client = checkoutClient([
    {
      mode: "subscription",
      status: "open",
      livemode: false,
      url: "https://checkout.stripe.com/existing",
    },
  ]);
  await expect(
    createTestCheckout(client.stripe, "user", "cus_1"),
  ).resolves.toBe("https://checkout.stripe.com/existing");
  expect(client.create).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each([
  {
    mode: "subscription",
    status: "complete",
    payment_status: "unpaid",
    subscription: "sub_pending",
  },
  {
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    subscription: null,
  },
  {
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    subscription: "sub_just_completed",
  },
])(
  "blocks a completed checkout whose payment or subscription is unresolved: %j",
  async (session) => {
    const client = checkoutClient([session]);
    await expect(
      createTestCheckout(client.stripe, "user", "cus_1"),
    ).rejects.toThrow("still processing");
    expect(client.create).not.toHaveBeenCalled();
  },
);

it("retrieves current status instead of returning a cached open URL from a completed checkout", async () => {
  const client = checkoutClient();
  mocks.rpc.mockResolvedValue({ data: "stable-key" });
  client.retrieve.mockResolvedValue({
    id: "cs_new",
    livemode: false,
    status: "complete",
    url: null,
  });
  await expect(
    createTestCheckout(client.stripe, "user", "cus_1"),
  ).rejects.toThrow("Checkout finished");
  expect(client.retrieve).toHaveBeenCalledWith("cs_new");
  expect(client.create).toHaveBeenCalledTimes(1);
});

it("only rotates a checkout key after retrieving an expired session", async () => {
  const client = checkoutClient();
  mocks.rpc
    .mockResolvedValueOnce({ data: "old-key" })
    .mockResolvedValueOnce({ error: null })
    .mockResolvedValueOnce({ data: "new-key" });
  client.retrieve.mockResolvedValueOnce({
    id: "cs_old",
    livemode: false,
    status: "expired",
    url: null,
  });
  await expect(
    createTestCheckout(client.stripe, "user", "cus_1"),
  ).resolves.toBe("https://checkout.stripe.com/new");
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "reset_test_checkout", {
    p_user: "user",
    p_key: "old-key",
  });
  expect(client.create.mock.calls[0][1].idempotencyKey).not.toBe(
    client.create.mock.calls[1][1].idempotencyKey,
  );
});

it("rejects live checkout sessions without creating another", async () => {
  const client = checkoutClient([
    {
      mode: "subscription",
      status: "open",
      livemode: true,
      url: "https://checkout.stripe.com/live",
    },
  ]);
  await expect(
    createTestCheckout(client.stripe, "user", "cus_1"),
  ).rejects.toThrow("Live checkout");
  expect(client.create).not.toHaveBeenCalled();
});

it("does not acknowledge a webhook when its lease was lost before finishing", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: "claimed" })
    .mockResolvedValueOnce({ error: { message: "sync lease expired" } });
  const client = checkoutClient();
  await expect(
    reconcileTestEvent(client.stripe, {
      id: "evt_retry",
      livemode: false,
      type: "customer.subscription.updated",
      data: { object: { customer: "cus_1" } },
    } as Stripe.Event),
  ).rejects.toThrow("Retry");
});
