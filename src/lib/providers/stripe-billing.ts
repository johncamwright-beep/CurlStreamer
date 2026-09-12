import "server-only";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export function stripeTestConfig() {
  if (process.env.STRIPE_TEST_ENABLED !== "true") return null;
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const price = process.env.STRIPE_TEST_PRICE_ID ?? "";
  const webhook = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const base = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000");
  if (
    !key.startsWith("sk_test_") ||
    !price.startsWith("price_") ||
    !webhook.startsWith("whsec_")
  )
    throw Error("Stripe test configuration is incomplete.");
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw Error("Billing requires a secure application address.");
  return { key, price, webhook, base: base.origin };
}
export function stripeTestClient() {
  const config = stripeTestConfig();
  if (!config) throw Error("Test billing is not enabled.");
  return new Stripe(config.key, { maxNetworkRetries: 2, timeout: 20000 });
}
export async function testPlan(stripe: Stripe) {
  const price = await stripe.prices.retrieve(stripeTestConfig()!.price, {
    expand: ["product"],
  });
  if (
    price.livemode ||
    !price.active ||
    price.type !== "recurring" ||
    !price.recurring ||
    price.recurring.usage_type !== "licensed" ||
    price.currency !== "cad" ||
    price.unit_amount === null ||
    price.unit_amount <= 0 ||
    price.recurring.interval_count !== 1 ||
    !["month", "year"].includes(price.recurring.interval)
  )
    throw Error("Choose an active CAD test subscription price.");
  const product = price.product;
  return {
    name:
      typeof product !== "string" && !product.deleted
        ? product.name
        : "CurlStreamer subscription",
    amount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring.interval,
  };
}
export async function billingRow(org: string) {
  const { data, error } = await createAdminSupabaseClient()
    .from("team_test_billing")
    .select("customer_id,subscription")
    .eq("organization_id", org)
    .maybeSingle();
  if (error) throw Error("Billing storage unavailable.");
  return data;
}
export async function ensureTestCustomer(stripe: Stripe, org: string) {
  const existing = await billingRow(org);
  if (existing) return existing.customer_id as string;
  const customer = await stripe.customers.create(
    { metadata: { organization_id: org, integration: "curlstreamer-test" } },
    { idempotencyKey: `curlstreamer-test-customer-${org}` },
  );
  if (customer.livemode) throw Error("Live customers are disabled.");
  const { error } = await createAdminSupabaseClient()
    .from("team_test_billing")
    .upsert(
      { organization_id: org, customer_id: customer.id },
      { onConflict: "organization_id", ignoreDuplicates: true },
    );
  if (error) throw Error("Customer could not be saved.");
  return (await billingRow(org))!.customer_id as string;
}
export const openSubscription = (s: { status: string }) =>
  !["canceled", "incomplete_expired"].includes(s.status);
export async function currentTestSubscription(
  stripe: Stripe,
  customer: string,
) {
  const list = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  if (list.has_more) throw Error("Subscription history requires review.");
  if (list.data.some((s) => s.livemode))
    throw Error("Live subscriptions are disabled.");
  const relevant = list.data.filter((s) =>
    s.items.data.some((item) => item.price.id === stripeTestConfig()!.price),
  );
  const selected =
    relevant.find(openSubscription) ??
    relevant.sort((a, b) => b.created - a.created)[0];
  if (!selected) return null;
  const item = selected.items.data.find(
    (i) => i.price.id === stripeTestConfig()!.price,
  )!;
  return {
    status: selected.status,
    currentPeriodEnd: item.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: selected.cancel_at_period_end,
  };
}
export async function createTestCheckout(
  stripe: Stripe,
  user: string,
  customer: string,
  retry = false,
): Promise<string> {
  // Inspect all customer subscriptions, even a retired price, before another checkout.
  const subscriptions = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  if (subscriptions.data.some((subscription) => subscription.livemode))
    throw Error("Live subscriptions are disabled.");
  if (subscriptions.has_more || subscriptions.data.some(openSubscription))
    throw Error("Manage your existing test subscription instead.");
  // Idempotency records can disappear after 24 hours. Inspect Stripe sessions
  // before reusing a key so an open or payment-pending checkout is never replaced.
  const sessions = await stripe.checkout.sessions.list({
    customer,
    limit: 100,
  });
  if (sessions.has_more) throw Error("Checkout history requires review.");
  if (sessions.data.some((session) => session.livemode))
    throw Error("Live checkout is disabled.");
  const relevant = sessions.data.filter(
    (session) => session.mode === "subscription",
  );
  if (
    relevant.some((session) => {
      if (session.status !== "complete") return false;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      const subscription = subscriptions.data.find(
        (item) => item.id === subscriptionId,
      );
      return (
        session.payment_status === "unpaid" ||
        !subscription ||
        openSubscription(subscription)
      );
    })
  )
    throw Error(
      "Checkout is still processing. Reload your subscription details.",
    );
  const open = relevant.filter((session) => session.status === "open");
  if (open.length > 1) throw Error("Checkout history requires review.");
  if (open.length === 1) {
    if (!open[0].url) throw Error("Checkout is temporarily unavailable.");
    return open[0].url;
  }
  const db = createAdminSupabaseClient();
  const { data: key, error } = await db.rpc("claim_test_checkout", {
    p_user: user,
  });
  if (error || !key) throw Error("Checkout is temporarily unavailable.");
  const config = stripeTestConfig()!;
  const created = await stripe.checkout.sessions.create(
    {
      customer,
      mode: "subscription",
      line_items: [{ price: config.price, quantity: 1 }],
      success_url: `${config.base}/account?section=subscription&billing=returned`,
      cancel_url: `${config.base}/account?section=subscription&billing=cancelled`,
    },
    { idempotencyKey: `curlstreamer-test-checkout-${key}` },
  );
  if (created.livemode) throw Error("Live checkout is disabled.");
  // A replayed POST returns its original body, including a stale "open" status.
  const session = await stripe.checkout.sessions.retrieve(created.id);
  if (session.livemode) throw Error("Live checkout is disabled.");
  if (session.status === "expired" && !retry) {
    const { error: resetError } = await db.rpc("reset_test_checkout", {
      p_user: user,
      p_key: key,
    });
    if (resetError) throw Error("Checkout could not be reset.");
    return createTestCheckout(stripe, user, customer, true);
  }
  if (session.status !== "open" || !session.url)
    throw Error("Checkout finished. Reload your subscription details.");
  return session.url;
}
export async function reconcileTestEvent(stripe: Stripe, event: Stripe.Event) {
  if (event.livemode) throw Error("Live events are disabled.");
  if (
    !event.type.startsWith("customer.subscription.") &&
    ![
      "checkout.session.completed",
      "invoice.paid",
      "invoice.payment_failed",
    ].includes(event.type)
  )
    return;
  const object = event.data.object as {
    customer?: string | { id: string } | null;
  };
  const customer =
    typeof object.customer === "string" ? object.customer : object.customer?.id;
  if (!customer) return;
  const db = createAdminSupabaseClient(),
    token = randomUUID();
  const { data: claim, error } = await db.rpc("begin_test_billing_sync", {
    p_customer: customer,
    p_event: event.id,
    p_token: token,
  });
  if (error || claim === "busy")
    throw Error("Retry subscription synchronization.");
  if (["unknown", "done"].includes(claim)) return;
  if (claim !== "claimed") throw Error("Could not synchronize subscription.");
  // Fetch the current Stripe state under the lease, never apply an old event snapshot.
  const subscription = await currentTestSubscription(stripe, customer);
  const { error: finish } = await db.rpc("finish_test_billing_sync", {
    p_customer: customer,
    p_event: event.id,
    p_token: token,
    p_subscription: subscription,
  });
  if (finish) throw Error("Retry subscription synchronization.");
}
