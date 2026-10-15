import { z } from "zod";

const email = z.string().trim().email("Enter a valid email address.");
const internalRedirectSchema = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"));
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
export const studioPasswordSchema = z
  .object({
    password: z.string().min(12, "Password must be at least 12 characters."),
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match.",
  });
export const firstTeamSchema = z.object({
  teamName: z
    .string()
    .trim()
    .min(1, "Enter your team name.")
    .max(100, "Team name must be 100 characters or fewer.")
    .transform((value) => value.replace(/\s+/g, " ")),
});

export function approvedRedirect(value: string | null, fallback = "/account") {
  const parsed = internalRedirectSchema.safeParse(value);
  if (!parsed.success) return fallback;
  try {
    const url = new URL(parsed.data, "https://local.invalid");
    return url.origin === "https://local.invalid"
      ? url.pathname + url.search
      : fallback;
  } catch {
    return fallback;
  }
}

export function confirmationUrl(environment = process.env) {
  return authCallbackUrl("/account", environment);
}

export function authCallbackUrl(next: string, environment = process.env) {
  const origin =
    environment.NODE_ENV === "production"
      ? environment.APP_BASE_URL
      : environment.APP_BASE_URL || "http://localhost:3000";
  if (!origin) throw new Error("Missing environment variable: APP_BASE_URL");
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    throw new Error("Invalid environment variable: APP_BASE_URL");
  const callback = new URL("/auth/confirm", parsed);
  callback.searchParams.set("next", approvedRedirect(next));
  return callback.toString();
}
