import "server-only";
import { approvedRedirect, authCallbackUrl } from "@/lib/auth/validation";

const GOOGLE_SCOPE = "openid email profile";
type GoogleAuthEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "APP_BASE_URL" | "GOOGLE_AUTH_ENABLED" | "NODE_ENV">
>;

export function googleAuthEnabled(
  environment: GoogleAuthEnvironment = process.env,
) {
  return environment.GOOGLE_AUTH_ENABLED === "true";
}

export function googleOAuthOptions(
  next: string,
  environment: GoogleAuthEnvironment = process.env,
) {
  if (!environment.APP_BASE_URL)
    throw new Error("Google OAuth requires APP_BASE_URL");
  return {
    redirectTo: authCallbackUrl(next, environment as NodeJS.ProcessEnv),
    scopes: GOOGLE_SCOPE,
  };
}

export function isGoogleOAuthOrigin(
  origin: string | null,
  environment: GoogleAuthEnvironment = process.env,
) {
  if (!origin || !environment.APP_BASE_URL) return false;
  try {
    return new URL(origin).origin === new URL(environment.APP_BASE_URL).origin;
  } catch {
    return false;
  }
}

export function googleLoginUrl(
  next: string | null,
  environment: GoogleAuthEnvironment = process.env,
) {
  if (!environment.APP_BASE_URL)
    throw new Error("Google OAuth requires APP_BASE_URL");
  const url = new URL("/login", environment.APP_BASE_URL);
  url.searchParams.set("next", approvedRedirect(next, "/onboarding"));
  return url.toString();
}

export function isWindowsStudioBrowser(userAgent: string | null) {
  return userAgent?.includes("CurlStreamerStudio/") ?? false;
}
