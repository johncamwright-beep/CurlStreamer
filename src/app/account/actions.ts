"use server";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { studioPasswordSchema } from "@/lib/auth/validation";

export type StudioPasswordState = {
  message?: string;
  errors?: Record<string, string[]>;
};
export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setStudioPassword(
  _: StudioPasswordState,
  formData: FormData,
): Promise<StudioPasswordState> {
  const parsed = studioPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at)
    return {
      message: "Please sign out and sign in again before setting a password.",
    };
  let error;
  try {
    ({ error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    }));
  } catch {
    return {
      message: "Please sign out and sign in again before setting a password.",
    };
  }
  if (error?.code === "weak_password" || error?.code === "same_password")
    return { message: "Choose a different, stronger password and try again." };
  if (error)
    return {
      message: "Please sign out and sign in again before setting a password.",
    };
  return {
    message:
      "Studio password set. You can now use email and password in Windows Studio.",
  };
}
