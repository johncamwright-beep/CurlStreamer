import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { approvedRedirect, confirmationUrl } from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
const otpTypes = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);
export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = new URL(confirmationUrl()).origin;
  const next = approvedRedirect(url.searchParams.get("next"));
  const loginDestination = (query: string) => {
    const target = new URL(`/login?${query}`, publicOrigin);
    if (url.searchParams.has("next")) target.searchParams.set("next", next);
    return target;
  };
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (oauthError) {
    const outcome = oauthError === "access_denied" ? "cancelled" : "failed";
    return NextResponse.redirect(loginDestination(`oauth=${outcome}`));
  }
  const supabase = await createServerSupabaseClient();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : token_hash && type && otpTypes.has(type)
      ? await supabase.auth.verifyOtp({ token_hash, type })
      : { error: new Error("invalid confirmation") };
  if (result.error)
    return NextResponse.redirect(loginDestination("confirmation=invalid"));
  return NextResponse.redirect(new URL(next, publicOrigin));
}
