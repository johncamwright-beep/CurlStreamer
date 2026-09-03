"use server";
import { signupSchema } from "@/lib/auth/validation";
import { confirmationUrl } from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AuthFormState = {
  message?: string;
  errors?: Record<string, string[]>;
};
export async function signup(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: confirmationUrl(),
    },
  });
  // Intentionally neutral: Supabase may obscure an existing account.
  return { message: "Check your email for a confirmation link to continue." };
}
