import { AuthForm } from "@/components/AuthForm";
import { signup } from "./actions";
import { signInWithGoogle } from "@/app/auth/actions";
import {
  googleAuthEnabled,
  googleLoginUrl,
  isGoogleOAuthOrigin,
  isWindowsStudioBrowser,
} from "@/lib/providers/google-auth";
import { headers } from "next/headers";
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const studioBrowser = isWindowsStudioBrowser(
    requestHeaders.get("user-agent"),
  );
  const googleEnabled = googleAuthEnabled();
  const canonicalGoogleLogin =
    googleEnabled && !isGoogleOAuthOrigin(host ? `${protocol}://${host}` : null)
      ? googleLoginUrl(next ?? null)
      : undefined;
  return (
    <AuthForm
      mode="signup"
      action={signup}
      googleAction={signInWithGoogle}
      googleEnabled={googleEnabled}
      googleLoginUrl={canonicalGoogleLogin}
      googleUnavailableMessage={
        studioBrowser
          ? "Google sign-in is available on the website. Use email and password in Windows Studio."
          : undefined
      }
      returnTo={next}
    />
  );
}
