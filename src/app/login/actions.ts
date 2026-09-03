"use server";
import { redirect } from "next/navigation";
import { loginSchema } from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/app/signup/actions";

export async function login(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { message: "Invalid email or password." };
  redirect("/account");
}
