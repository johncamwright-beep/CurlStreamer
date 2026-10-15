"use server";
import {
  approvedRedirect,
  authCallbackUrl,
  signupSchema,
} from "@/lib/auth/validation";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AuthFormState = {
  message?: string;
  confirmationEmail?: string;
  errors?: Record<string, string[]>;
};
export async function signup(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const supabase = await createServerSupabaseClient();
  const next = approvedRedirect(formData.get("next")?.toString() ?? null);
  const result = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: authCallbackUrl(next),
    },
  });
  if (result?.error && result.error.code !== "user_already_exists") {
    return {
      message:
        "Account setup could not be completed right now. Please wait a minute and try again.",
    };
  }
  // Intentionally neutral: Supabase may obscure an existing account.
  return {
    message: "Check your email for a confirmation link to continue.",
    confirmationEmail: parsed.data.email,
  };
}

export async function resendConfirmation(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = z
    .string()
    .trim()
    .email()
    .max(254)
    .safeParse(formData.get("email"));
  if (!email.success) return { message: "Enter a valid email address." };
  const supabase = await createServerSupabaseClient();
  const next = approvedRedirect(formData.get("next")?.toString() ?? null);
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.data,
    options: { emailRedirectTo: authCallbackUrl(next) },
  });
  if (error)
    return {
      message:
        "We couldn’t resend the confirmation email just now. Please wait a minute and try again.",
    };
  return {
    message:
      "If this account still needs confirmation, a new link has been requested. Check your inbox and spam folder and use the newest confirmation email.",
  };
}
