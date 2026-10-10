import { NextResponse } from "next/server";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import {
  billingRow,
  createTestCheckout,
  ensureTestCustomer,
  stripeTestClient,
  stripeTestConfig,
  testPlan,
} from "@/lib/providers/stripe-billing";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const auth = await teamSettingsContext();
    if (!auth) return reply({ error: "Sign in to your team account." }, 403);
    const canManage = ["owner", "team_admin"].includes(auth.role);
    const available = Boolean(
      stripeTestConfig() && (await platformAdminContext()),
    );
    if (!available)
      return reply({
        mode: "test",
        available: false,
        canManage,
        plan: null,
        subscription: null,
        hasCustomer: false,
      });
    const [plan, row] = await Promise.all([
      testPlan(stripeTestClient()),
      billingRow(auth.organizationId),
    ]);
    return reply({
      mode: "test",
      available,
      canManage,
      plan,
      subscription: row?.subscription ?? null,
      hasCustomer: Boolean(row),
    });
  } catch {
    return reply(
      { error: "Subscription details are temporarily unavailable." },
      503,
    );
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open billing from Account & Settings." }, 403);
    const auth = await teamSettingsContext(true);
    if (!auth || !(await platformAdminContext()))
      return reply(
        {
          error:
            "Only a platform administrator with full team access can test billing.",
        },
        403,
      );
    const parsed = z
      .object({ action: z.enum(["checkout", "portal"]) })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return reply(
        { error: "Choose checkout or subscription management." },
        400,
      );
    const config = stripeTestConfig();
    if (!config)
      return reply({ error: "Test checkout is not configured yet." }, 503);
    const stripe = stripeTestClient();
    if (parsed.data.action === "portal") {
      const row = await billingRow(auth.organizationId);
      if (!row)
        return reply({ error: "Create a test subscription first." }, 409);
      const session = await stripe.billingPortal.sessions.create({
        customer: row.customer_id,
        return_url: `${config.base}/account?section=subscription&billing=returned`,
      });
      return reply({ url: session.url });
    }
    await testPlan(stripe);
    const customer = await ensureTestCustomer(stripe, auth.organizationId);
    return reply({
      url: await createTestCheckout(stripe, auth.user.id, customer),
    });
  } catch {
    return reply(
      {
        error:
          "Test checkout could not open. Reload your details or manage your existing test subscription.",
      },
      503,
    );
  }
}
