import { NextResponse } from "next/server";
import {
  seasonConfig,
  seasonClient,
  syncSeasonEvent,
} from "@/lib/providers/stripe-season";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let c, stripe, event;
  try {
    c = seasonConfig();
    if (!c)
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    stripe = seasonClient();
    const raw = await request.text();
    if (raw.length > 1048576)
      return NextResponse.json({ error: "Too large" }, { status: 413 });
    event = stripe.webhooks.constructEvent(
      raw,
      request.headers.get("stripe-signature") ?? "",
      c.webhook,
    );
    if (event.livemode !== c.live) throw Error("Wrong mode");
  } catch {
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
  try {
    await syncSeasonEvent(stripe, event);
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Retry later" }, { status: 503 });
  }
}
