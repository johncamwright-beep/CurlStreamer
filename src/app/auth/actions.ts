"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { approvedRedirect } from "@/lib/auth/validation";
import {
  googleAuthEnabled,
  googleLoginUrl,
  isGoogleOAuthOrigin,
  isWindowsStudioBrowser,
  googleOAuthOptions,
} from "@/lib/providers/google-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/app/signup/actions";

export async function signInWithGoogle(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!googleAuthEnabled())
    return { message: "Google sign-in is not available in this environment." };
  const next = approvedRedirect(
    formData.get("next")?.toString() ?? null,
    "/onboarding",
  );
  let options: ReturnType<typeof googleOAuthOptions>;
  try {
    options = googleOAuthOptions(next);
  } catch {
    return { message: "Google sign-in couldn't be started. Please try again." };
  }
  const requestHeaders = await headers();
  if (isWindowsStudioBrowser(requestHeaders.get("user-agent")))
    return {
      message:
        "Google sign-in is available on the website. Use email and password in Windows Studio.",
    };
  const requestOrigin = requestHeaders.get("origin");
  if (!isGoogleOAuthOrigin(requestOrigin))
    redirect(googleLoginUrl(formData.get("next")?.toString() ?? null));
  const supabase = await createServerSupabaseClient();
  let result: Awaited<ReturnType<typeof supabase.auth.signInWithOAuth>>;
  try {
    result = await supabase.auth.signInWithOAuth({
      provider: "google",
      options,
    });
  } catch {
    return { message: "Google sign-in couldn't be started. Please try again." };
  }
  if (result.error || !result.data.url)
    return { message: "Google sign-in couldn't be started. Please try again." };
  redirect(result.data.url);
}
