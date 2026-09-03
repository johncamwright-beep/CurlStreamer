import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { approvedRedirect } from "@/lib/auth/validation";
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
  const next = approvedRedirect(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createServerSupabaseClient();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : token_hash && type && otpTypes.has(type)
      ? await supabase.auth.verifyOtp({ token_hash, type })
      : { error: new Error("invalid confirmation") };
  if (result.error)
    return NextResponse.redirect(
      new URL("/login?confirmation=invalid", url.origin),
    );
  return NextResponse.redirect(new URL(next, url.origin));
}
