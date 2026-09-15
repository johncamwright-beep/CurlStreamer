import { NextResponse } from "next/server";
import {
  reconcileTestEvent,
  stripeTestClient,
  stripeTestConfig,
} from "@/lib/providers/stripe-billing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status });
  let stripe, config;
  try {
    config = stripeTestConfig();
    if (!config) return reply({ error: "Not configured" }, 503);
    stripe = stripeTestClient();
  } catch {
    return reply({ error: "Not configured" }, 503);
  }
  let event;
  try {
    const raw = await request.text();
    if (raw.length > 1048576) return reply({ error: "Payload too large" }, 413);
    event = stripe.webhooks.constructEvent(
      raw,
      request.headers.get("stripe-signature") ?? "",
      config.webhook,
    );
    if (event.livemode)
      return reply({ error: "Live events are disabled" }, 400);
  } catch {
    return reply({ error: "Invalid Stripe signature" }, 400);
  }
  try {
    await reconcileTestEvent(stripe, event);
    return reply({ received: true });
  } catch {
    return reply({ error: "Retry later" }, 503);
  }
}
