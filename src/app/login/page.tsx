import { AuthForm } from "@/components/AuthForm";
import { login } from "./actions";
import { signInWithGoogle } from "@/app/auth/actions";
import {
  googleAuthEnabled,
  googleLoginUrl,
  isGoogleOAuthOrigin,
  isWindowsStudioBrowser,
} from "@/lib/providers/google-auth";
import { headers } from "next/headers";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    oauth?: string;
    confirmation?: string;
  }>;
}) {
  const { next, oauth, confirmation } = await searchParams;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const currentOrigin = host ? `${protocol}://${host}` : null;
  const studioBrowser = isWindowsStudioBrowser(
    requestHeaders.get("user-agent"),
  );
  const googleEnabled = googleAuthEnabled();
  const canonicalGoogleLogin =
    googleEnabled && !isGoogleOAuthOrigin(currentOrigin)
      ? googleLoginUrl(next ?? null)
      : undefined;
  const notice =
    oauth === "cancelled"
      ? "Google sign-in was cancelled. You can try again when ready."
      : oauth === "failed"
        ? "Google sign-in could not be completed. Please try again."
        : confirmation === "invalid"
          ? "That confirmation link is invalid or has expired."
          : undefined;
  return (
    <AuthForm
      mode="login"
      action={login}
      googleAction={signInWithGoogle}
      googleEnabled={googleEnabled}
      googleLoginUrl={canonicalGoogleLogin}
      googleUnavailableMessage={
        studioBrowser
          ? "Google sign-in is available on the website. Use email and password in Windows Studio."
          : undefined
      }
      returnTo={next}
      notice={notice}
    />
  );
}
