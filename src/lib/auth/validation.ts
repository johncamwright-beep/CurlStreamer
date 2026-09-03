import { z } from "zod";

const email = z.string().trim().email("Enter a valid email address.");
export const signupSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter your display name.").max(100),
    email,
    password: z.string().min(8, "Password must be at least 8 characters."),
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match.",
  });
export const loginSchema = z.object({ email, password: z.string().min(1) });

export function approvedRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return "/account";
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid"
      ? url.pathname + url.search
      : "/account";
  } catch {
    return "/account";
  }
}

export function confirmationUrl(environment = process.env) {
  const origin =
    environment.NODE_ENV === "production"
      ? environment.APP_BASE_URL
      : environment.APP_BASE_URL || "http://localhost:3000";
  if (!origin) throw new Error("Missing environment variable: APP_BASE_URL");
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    throw new Error("Invalid environment variable: APP_BASE_URL");
  return new URL("/auth/confirm?next=/account", parsed).toString();
}
