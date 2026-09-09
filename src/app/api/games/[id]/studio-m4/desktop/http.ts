import { NextResponse } from "next/server";
import { z } from "zod";
export const identifier = z.uuid();
export const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const session = z.object({
  sessionId: identifier,
  generation: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const lease = session.extend({
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  desiredAction: z.enum(["wait", "stop"]),
});
export type Context = { params: Promise<{ id: string }> };
export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
  });
}
export function unavailable(status = 503) {
  return reply(
    {
      error: "Desktop authority is unavailable.",
      code: "m4_desktop_unavailable",
    },
    status,
  );
}
export function failure(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return unavailable(code === "42501" ? 403 : code === "55000" ? 409 : 503);
}
export async function input(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2_048) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
/** Defense in depth only: code/verifier or bearer provides actual authority. */
export function browserRequest(request: Request) {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}
