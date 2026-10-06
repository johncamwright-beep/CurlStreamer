import { NextResponse } from "next/server";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { sameOriginWrite } from "@/lib/providers/platform-admin";
import {
  contactSchema,
  currentPlayerContacts,
  savePlayerContact,
} from "@/lib/providers/player-contacts";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const account = await teamSettingsContext(true);
    if (!account)
      return reply({ error: "Team administrator access required." }, 403);
    return reply({
      players: await currentPlayerContacts(account.organizationId),
    });
  } catch {
    return reply({ error: "Player emails are temporarily unavailable." }, 503);
  }
}
export async function PUT(request: Request) {
  if (!sameOriginWrite(request))
    return reply({ error: "Open Team settings on this website." }, 403);
  try {
    const account = await teamSettingsContext(true);
    if (!account)
      return reply({ error: "Team administrator access required." }, 403);
    const input = contactSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success)
      return reply({ error: "Check the player and email address." }, 400);
    await savePlayerContact(account.organizationId, input.data);
    return reply({ saved: true });
  } catch {
    return reply(
      {
        error:
          "The player email could not be saved. Refresh and check the roster.",
      },
      409,
    );
  }
}
