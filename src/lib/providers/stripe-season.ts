import "server-only";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
export function seasonConfig() {
  const mode = process.env.STRIPE_SEASON_MODE;
  if (mode !== "test" && mode !== "live") return null;
  const live = mode === "live";
  const key =
    process.env[
      live ? "STRIPE_SEASON_LIVE_SECRET_KEY" : "STRIPE_SEASON_TEST_SECRET_KEY"
    ] ||
    (!live ? process.env.STRIPE_SECRET_KEY : "") ||
    "";
  const basePrice =
    process.env[
      live ? "STRIPE_SEASON_LIVE_BASE_PRICE" : "STRIPE_SEASON_TEST_BASE_PRICE"
    ] ?? "";
  const coachPrice =
    process.env[
      live ? "STRIPE_SEASON_LIVE_COACH_PRICE" : "STRIPE_SEASON_TEST_COACH_PRICE"
    ] ?? "";
  const webhook =
    process.env[
      live
        ? "STRIPE_SEASON_LIVE_WEBHOOK_SECRET"
        : "STRIPE_SEASON_TEST_WEBHOOK_SECRET"
    ] ||
    (!live ? process.env.STRIPE_WEBHOOK_SECRET : "") ||
    "";
  const origin = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000");
  if (
    !key.startsWith(live ? "sk_live_" : "sk_test_") ||
    !basePrice.startsWith("price_") ||
    !coachPrice.startsWith("price_") ||
    !webhook.startsWith("whsec_") ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname))
  )
    throw Error("Season checkout is not configured.");
  return { live, key, basePrice, coachPrice, webhook, origin: origin.origin };
}
export function seasonClient() {
  const config = seasonConfig();
  if (!config) throw Error("Season checkout unavailable");
  return new Stripe(config.key, { maxNetworkRetries: 2, timeout: 20000 });
}
export async function validateSeasonPrices(stripe: Stripe) {
  const c = seasonConfig()!;
  for (const [id, amount] of [
    [c.basePrice, 8900],
    [c.coachPrice, 3900],
  ] as const) {
    const p = await stripe.prices.retrieve(id);
    if (
      p.livemode !== c.live ||
      !p.active ||
      p.type !== "one_time" ||
      p.currency !== "cad" ||
      p.unit_amount !== amount
    )
      throw Error("Invalid season price");
  }
}
export type SeasonPurchase = {
  baseOwned: boolean;
  coachSeats: number;
  pending: boolean;
};

/**
 * Reads purchase state for the checkout UI. This is a purchase summary only;
 * database entitlement RPCs deliberately ignore sandbox orders.
 */
export async function readSeasonPurchase(org: string): Promise<SeasonPurchase> {
  const c = seasonConfig();
  if (!c) return { baseOwned: false, coachSeats: 0, pending: false };
  const { data, error } = await createAdminSupabaseClient()
    .from("team_season_orders")
    .select("base,coach_quantity,status,season_end")
    .eq("organization_id", org)
    .eq("livemode", c.live)
    .in("status", ["paid", "pending"]);
  if (error) throw error;
  const now = Date.now();
  const paid = (data ?? []).filter(
    (order) => order.status === "paid" && Date.parse(order.season_end) > now,
  );
  return {
    baseOwned: paid.some((order) => order.base),
    coachSeats: paid.reduce((total, order) => total + order.coach_quantity, 0),
    pending: (data ?? []).some((order) => order.status === "pending"),
  };
}
async function customerFor(stripe: Stripe, org: string) {
  const db = createAdminSupabaseClient(),
    c = seasonConfig()!,
    column = c.live ? "live_customer_id" : "test_customer_id";
  const read = () =>
    db
      .from("team_season_customers")
      .select("live_customer_id,test_customer_id")
      .eq("organization_id", org)
      .maybeSingle();
  const row = await read();
  if (row.error) throw row.error;
  if (row.data?.[column]) return row.data[column] as string;
  const customer = await stripe.customers.create(
    { metadata: { organization_id: org, integration: "curlstreamer-season" } },
    { idempotencyKey: `season-customer-${c.live}-${org}` },
  );
  if (customer.livemode !== c.live) throw Error("Customer mode mismatch");
  const saved = await db
    .from("team_season_customers")
    .upsert(
      { organization_id: org, [column]: customer.id },
      { onConflict: "organization_id" },
    );
  if (saved.error) throw saved.error;
  return customer.id;
}
export async function seasonCheckout(
  user: string,
  org: string,
  base: boolean,
  coaches: number,
) {
  const c = seasonConfig()!,
    stripe = seasonClient(),
    db = createAdminSupabaseClient();
  await validateSeasonPrices(stripe);
  const customer = await customerFor(stripe, org);
  const { data: order, error } = await db.rpc("claim_season_order", {
    p_user: user,
    p_live: c.live,
    p_base: base,
    p_coaches: coaches,
  });
  if (error) throw error;
  if (order.organization_id !== org) throw Error("Order team mismatch");
  if (
    !order.session_id &&
    Date.parse(order.created_at) + 82800 * 1000 <= Date.now()
  ) {
    // Before releasing an old empty order, reconcile any session whose create
    // response was lost. That prevents a later paid webhook from being paired
    // with a replacement checkout.
    const recovered = await stripe.checkout.sessions.list({
      customer,
      created: { gte: Math.floor(Date.parse(order.created_at) / 1000) },
      limit: 100,
    });
    if (recovered.has_more)
      throw Error("Checkout recovery needs support. Please try again shortly.");
    const session = recovered.data.find(
      (candidate) => candidate.metadata?.season_order_id === order.id,
    );
    if (session) {
      const saved = await db
        .from("team_season_orders")
        .update({ session_id: session.id })
        .eq("id", order.id)
        .eq("organization_id", org)
        .eq("status", "pending");
      if (saved.error) throw saved.error;
      if (session.status === "open" && session.url) return session.url;
      await syncSeasonEvent(stripe, {
        id: `local-recovered-${session.id}`,
        livemode: c.live,
        type:
          session.status === "expired"
            ? "checkout.session.expired"
            : "checkout.session.completed",
        data: { object: session },
      });
      if (session.status === "expired")
        return seasonCheckout(user, org, base, coaches);
      throw Error("Checkout is processing or expired. Reload season access.");
    }
    const released = await db.rpc("release_empty_season_order", {
      p_order: order.id,
      p_organization: org,
    });
    if (released.error || !released.data)
      throw Error(
        "Checkout changed while it was being recovered. Please retry.",
      );
    return seasonCheckout(user, org, base, coaches);
  }
  if (order.session_id) {
    const existing = await stripe.checkout.sessions.retrieve(order.session_id);
    if (existing.status === "open" && existing.url) return existing.url;
    if (existing.status === "expired") {
      await syncSeasonEvent(stripe, {
        id: `local-expired-${existing.id}`,
        livemode: c.live,
        type: "checkout.session.expired",
        data: { object: existing },
      });
      return seasonCheckout(user, org, base, coaches);
    }
    throw Error("Checkout is processing or expired. Reload season access.");
  }
  const lines = [];
  if (order.base) lines.push({ price: c.basePrice, quantity: 1 });
  if (order.coach_quantity)
    lines.push({ price: c.coachPrice, quantity: order.coach_quantity });
  const session = await stripe.checkout.sessions.create(
    {
      customer,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lines,
      metadata: { season_order_id: order.id },
      payment_intent_data: { metadata: { season_order_id: order.id } },
      expires_at: Math.min(
        Math.floor(Date.parse(order.created_at) / 1000) + 82800,
        Math.floor(Date.parse(order.season_end) / 1000) - 1,
      ),
      success_url: `${c.origin}/account?section=subscription&season=returned`,
      cancel_url: `${c.origin}/account?section=subscription&season=cancelled`,
      custom_text: {
        submit: {
          message: `Season access ends August 31. No automatic renewal. Shot Tracker requires an assigned licence.`,
        },
      },
    },
    { idempotencyKey: `season-order-${order.id}` },
  );
  if (session.livemode !== c.live || !session.url)
    throw Error("Invalid checkout");
  const saved = await db
    .from("team_season_orders")
    .update({ session_id: session.id })
    .eq("id", order.id)
    .eq("organization_id", org);
  if (saved.error) throw saved.error;
  return session.url;
}
export async function syncSeasonEvent(
  stripe: Stripe,
  event: Pick<Stripe.Event, "id" | "livemode" | "type" | "data">,
) {
  const c = seasonConfig()!;
  if (event.livemode !== c.live) throw Error("Payment mode mismatch");
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ].includes(event.type)
  )
    return;
  const object = event.data.object as unknown as {
    id: string;
    payment_intent?: string;
    metadata?: Record<string, string>;
    charge?: string;
  };
  const db = createAdminSupabaseClient();
  let query = db.from("team_season_orders").select("*").eq("livemode", c.live);
  if (event.type.startsWith("checkout."))
    query = query.eq(
      "id",
      object.metadata?.season_order_id ??
        "00000000-0000-0000-0000-000000000000",
    );
  else {
    const charge = event.type.startsWith("charge.dispute")
      ? await stripe.charges.retrieve(object.charge!)
      : (object as unknown as Stripe.Charge);
    const intent =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!intent) return;
    query = query.eq("payment_intent_id", intent);
  }
  const { data: initialOrder, error } = await query.maybeSingle();
  if (error) throw error;
  let order = initialOrder;
  // Refund and dispute webhooks can arrive before checkout completion has
  // persisted payment_intent_id. The PaymentIntent metadata is set when this
  // checkout is created, so use it only to locate the already-created order;
  // the session/customer/line-item checks below remain authoritative.
  if (!order && !event.type.startsWith("checkout.")) {
    const charge = event.type.startsWith("charge.dispute")
      ? await stripe.charges.retrieve(object.charge!)
      : (object as unknown as Stripe.Charge);
    const intent =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (intent) {
      const paymentIntent = await stripe.paymentIntents.retrieve(intent);
      const orderId = paymentIntent.metadata?.season_order_id;
      if (orderId) {
        const fallback = await db
          .from("team_season_orders")
          .select("*")
          .eq("livemode", c.live)
          .eq("id", orderId)
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        order = fallback.data;
      }
    }
  }
  if (!order) return;
  const token = randomUUID();
  const claim = await db.rpc("begin_season_sync", {
    p_order: order.id,
    p_event: event.id,
    p_token: token,
  });
  if (claim.error || claim.data === "busy") throw Error("Retry payment sync");
  if (claim.data !== "claimed") return;
  const sessionId =
    order.session_id ?? (event.type.startsWith("checkout.") ? object.id : null);
  if (!sessionId) throw Error("Session not recorded");
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent.latest_charge"],
  });
  const customer = await db
    .from("team_season_customers")
    .select("live_customer_id,test_customer_id")
    .eq("organization_id", order.organization_id)
    .single();
  if (customer.error) throw customer.error;
  const expectedCustomer =
    customer.data[c.live ? "live_customer_id" : "test_customer_id"];
  if (
    session.livemode !== c.live ||
    session.customer !== expectedCustomer ||
    session.metadata?.season_order_id !== order.id ||
    session.mode !== "payment"
  )
    throw Error("Order verification failed");
  const lines = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 10,
  });
  if (
    lines.has_more ||
    lines.data.length !==
      Number(order.base) + Number(order.coach_quantity > 0) ||
    lines.data.some(
      (l) =>
        !(
          (order.base && l.price?.id === c.basePrice && l.quantity === 1) ||
          (order.coach_quantity > 0 &&
            l.price?.id === c.coachPrice &&
            l.quantity === order.coach_quantity)
        ),
    )
  )
    throw Error("Order prices do not match");
  const expected = Number(order.base) * 8900 + order.coach_quantity * 3900;
  if (session.amount_total !== expected || session.currency !== "cad")
    throw Error("Order amount mismatch");
  const intent =
    typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge =
    intent && typeof intent.latest_charge === "object"
      ? intent.latest_charge
      : null;
  const revoked = Boolean(
    charge && (charge.amount_refunded > 0 || charge.disputed),
  );
  const status = revoked
    ? "revoked"
    : session.status === "expired"
      ? "expired"
      : session.payment_status === "paid" &&
          intent?.status === "succeeded" &&
          charge?.paid
        ? "paid"
        : "pending";
  const finish = await db.rpc("finish_season_sync", {
    p_order: order.id,
    p_event: event.id,
    p_token: token,
    p_status: status,
    p_intent: intent?.id ?? null,
  });
  if (finish.error) throw finish.error;
}

export async function cancelSeasonCheckout(org: string) {
  const c = seasonConfig()!,
    db = createAdminSupabaseClient(),
    stripe = seasonClient();
  const { data: order, error } = await db
    .from("team_season_orders")
    .select("*")
    .eq("organization_id", org)
    .eq("livemode", c.live)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  if (!order) return;
  if (!order.session_id)
    throw Error("Checkout is being created. Try again shortly.");
  let session = await stripe.checkout.sessions.retrieve(order.session_id);
  if (session.livemode !== c.live) throw Error("Wrong checkout mode");
  if (session.status === "complete")
    throw Error("Payment is processing. Reload access shortly.");
  if (session.status === "open")
    session = await stripe.checkout.sessions.expire(session.id);
  if (session.status !== "expired")
    throw Error("Checkout cannot be cancelled yet.");
  await syncSeasonEvent(stripe, {
    id: `local-expired-${session.id}`,
    livemode: c.live,
    type: "checkout.session.expired",
    data: { object: session },
  });
}
