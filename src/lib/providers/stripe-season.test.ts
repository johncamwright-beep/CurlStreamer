import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  order: vi.fn(),
  customer: vi.fn(),
  orders: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    rpc: mocks.rpc,
    from: (_table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: mocks.orders,
        maybeSingle: mocks.order,
        single: mocks.customer,
      };
      return query;
    },
  }),
}));
import {
  seasonConfig,
  validateSeasonPrices,
  readSeasonPurchase,
  syncSeasonEvent,
} from "./stripe-season";
const id = "00000000-0000-4000-8000-000000000001";
const event = {
  id: "evt_test",
  livemode: false,
  type: "checkout.session.completed",
  data: { object: { id: "cs_test", metadata: { season_order_id: id } } },
} as unknown as Stripe.Event;
const session = () => ({
  id: "cs_test",
  livemode: false,
  customer: "cus_test",
  metadata: { season_order_id: id },
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  amount_total: 12800,
  currency: "cad",
  payment_intent: {
    id: "pi_test",
    status: "succeeded",
    latest_charge: { paid: true, amount_refunded: 0, disputed: false },
  },
});
const stripe = (value = session()) => ({
  checkout: {
    sessions: {
      retrieve: vi.fn().mockResolvedValue(value),
      listLineItems: vi.fn().mockResolvedValue({
        has_more: false,
        data: [
          { price: { id: "price_base" }, quantity: 1 },
          { price: { id: "price_coach" }, quantity: 1 },
        ],
      }),
    },
  },
  prices: {
    retrieve: vi.fn(async (id: string) => ({
      livemode: false,
      active: true,
      type: "one_time",
      currency: "cad",
      unit_amount: id === "price_base" ? 8900 : 3900,
    })),
  },
  paymentIntents: {
    retrieve: vi.fn().mockResolvedValue({
      metadata: { season_order_id: id },
    }),
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SEASON_MODE", "test");
  vi.stubEnv("STRIPE_SEASON_TEST_SECRET_KEY", "sk_test_placeholder");
  vi.stubEnv("STRIPE_SEASON_TEST_BASE_PRICE", "price_base");
  vi.stubEnv("STRIPE_SEASON_TEST_COACH_PRICE", "price_coach");
  vi.stubEnv("STRIPE_SEASON_TEST_WEBHOOK_SECRET", "whsec_placeholder");
  vi.stubEnv("APP_BASE_URL", "https://www.curlstreamer.app");
  mocks.order.mockResolvedValue({
    data: {
      id,
      organization_id: "org",
      session_id: "cs_test",
      base: true,
      coach_quantity: 1,
    },
    error: null,
  });
  mocks.customer.mockResolvedValue({
    data: { test_customer_id: "cus_test" },
    error: null,
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "begin_season_sync" ? "claimed" : null,
    error: null,
  }));
  mocks.orders.mockResolvedValue({ data: [], error: null });
});
it("pins one-time CAD prices and refuses recurring, incorrect or live prices in test mode", async () => {
  const s = stripe();
  await validateSeasonPrices(s as unknown as Stripe);
  s.prices.retrieve.mockResolvedValue({
    livemode: false,
    active: true,
    type: "one_time",
    currency: "cad",
    unit_amount: 1,
  });
  await expect(validateSeasonPrices(s as unknown as Stripe)).rejects.toThrow();
  vi.stubEnv("STRIPE_SEASON_TEST_SECRET_KEY", "sk_live_wrong");
  expect(() => seasonConfig()).toThrow();
});
it("uses the existing Stripe key and webhook only for sandbox season checkout", () => {
  vi.stubEnv("STRIPE_SEASON_TEST_SECRET_KEY", "");
  vi.stubEnv("STRIPE_SEASON_TEST_WEBHOOK_SECRET", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_existing");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_existing");
  expect(seasonConfig()).toMatchObject({ live: false });
  vi.stubEnv("STRIPE_SEASON_MODE", "live");
  vi.stubEnv("STRIPE_SEASON_LIVE_SECRET_KEY", "");
  vi.stubEnv("STRIPE_SEASON_LIVE_BASE_PRICE", "price_base");
  vi.stubEnv("STRIPE_SEASON_LIVE_COACH_PRICE", "price_coach");
  vi.stubEnv("STRIPE_SEASON_LIVE_WEBHOOK_SECRET", "");
  expect(() => seasonConfig()).toThrow();
});
it("fulfils only a verified paid checkout and leaves assignment to the owner", async () => {
  await syncSeasonEvent(stripe() as unknown as Stripe, event);
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_season_sync",
    expect.objectContaining({
      p_order: id,
      p_status: "paid",
      p_intent: "pi_test",
    }),
  );
  expect(
    mocks.rpc.mock.calls.some(([name]) => name === "assign_team_curlcoach"),
  ).toBe(false);
});
it("reports unexpired configured-mode purchases as a checkout summary", async () => {
  mocks.orders.mockResolvedValue({
    data: [
      {
        base: true,
        coach_quantity: 1,
        status: "paid",
        season_end: "2099-09-01T04:00:00.000Z",
      },
      {
        base: false,
        coach_quantity: 2,
        status: "paid",
        season_end: "2000-09-01T04:00:00.000Z",
      },
      {
        base: false,
        coach_quantity: 1,
        status: "pending",
        season_end: "2000-09-01T04:00:00.000Z",
      },
    ],
    error: null,
  });
  await expect(readSeasonPurchase("org")).resolves.toEqual({
    baseOwned: true,
    coachSeats: 1,
    pending: true,
  });
  vi.stubEnv("STRIPE_SEASON_MODE", "live");
  vi.stubEnv("STRIPE_SEASON_LIVE_SECRET_KEY", "sk_live_placeholder");
  vi.stubEnv("STRIPE_SEASON_LIVE_BASE_PRICE", "price_base");
  vi.stubEnv("STRIPE_SEASON_LIVE_COACH_PRICE", "price_coach");
  vi.stubEnv("STRIPE_SEASON_LIVE_WEBHOOK_SECRET", "whsec_placeholder");
  await expect(readSeasonPurchase("org")).resolves.toEqual({
    baseOwned: true,
    coachSeats: 1,
    pending: true,
  });
});
it("rejects wrong customer, amount, metadata and payment mode", async () => {
  for (const change of [
    { customer: "cus_other" },
    { amount_total: 1 },
    { metadata: { season_order_id: "other" } },
    { livemode: true },
  ]) {
    mocks.rpc.mockClear();
    await expect(
      syncSeasonEvent(
        stripe({ ...session(), ...change }) as unknown as Stripe,
        event,
      ),
    ).rejects.toThrow();
    expect(
      mocks.rpc.mock.calls.some(([name]) => name === "finish_season_sync"),
    ).toBe(false);
  }
});
it("does not fulfil an unpaid session, and revokes refunded or disputed purchases", async () => {
  const pending = session();
  pending.payment_status = "unpaid";
  await syncSeasonEvent(stripe(pending) as unknown as Stripe, event);
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_season_sync",
    expect.objectContaining({ p_status: "pending" }),
  );
  for (const change of [{ amount_refunded: 1 }, { disputed: true }]) {
    const refunded = session();
    Object.assign(refunded.payment_intent.latest_charge, change);
    await syncSeasonEvent(stripe(refunded) as unknown as Stripe, event);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "finish_season_sync",
      expect.objectContaining({ p_status: "revoked" }),
    );
  }
});
it("finds a refunded order from PaymentIntent metadata before its intent is stored", async () => {
  const refunded = session();
  refunded.payment_intent.latest_charge.amount_refunded = 1;
  mocks.order
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({
      data: {
        id,
        organization_id: "org",
        session_id: "cs_test",
        base: true,
        coach_quantity: 1,
      },
      error: null,
    });
  const s = stripe(refunded);
  await syncSeasonEvent(
    s as unknown as Stripe,
    {
      id: "evt_refund_before_completion",
      livemode: false,
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_test" } },
    } as unknown as Stripe.Event,
  );
  expect(s.paymentIntents.retrieve).toHaveBeenCalledWith("pi_test");
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_season_sync",
    expect.objectContaining({ p_status: "revoked", p_order: id }),
  );
});
it("deduplicates completed events and retries busy leases without applying snapshots", async () => {
  const s = stripe();
  mocks.rpc.mockResolvedValue({ data: "done", error: null });
  await syncSeasonEvent(s as unknown as Stripe, event);
  expect(s.checkout.sessions.retrieve).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: "busy", error: null });
  await expect(
    syncSeasonEvent(s as unknown as Stripe, event),
  ).rejects.toThrow();
});
