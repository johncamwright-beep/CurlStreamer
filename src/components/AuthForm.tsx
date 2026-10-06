"use client";
import { useActionState } from "react";
import Link from "next/link";
import { resendConfirmation } from "@/app/signup/actions";
import type { AuthFormState } from "@/app/signup/actions";
import { CurlStreamerLogo } from "@/components/CurlStreamerBrand";

export function AuthForm({
  mode,
  action,
  googleAction,
  googleEnabled = false,
  googleLoginUrl,
  googleUnavailableMessage,
  returnTo,
  notice,
}: {
  mode: "signup" | "login";
  action: (state: AuthFormState, data: FormData) => Promise<AuthFormState>;
  googleAction?: (
    state: AuthFormState,
    data: FormData,
  ) => Promise<AuthFormState>;
  googleEnabled?: boolean;
  googleLoginUrl?: string;
  googleUnavailableMessage?: string;
  returnTo?: string;
  notice?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [googleState, googleFormAction, googlePending] = useActionState(
    googleAction ?? action,
    {},
  );
  const [resendState, resendAction, resending] = useActionState(
    resendConfirmation,
    {},
  );
  const joiningTeam = returnTo?.startsWith("/join-team?token=");
  const field = (name: string) => state.errors?.[name]?.[0];
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
      <section className="panel grid gap-4">
        <CurlStreamerLogo />
        <h1 className="text-3xl font-black">
          {mode === "signup" ? "Create account" : "Sign in"}
        </h1>
        {state.confirmationEmail && (
          <section
            role="status"
            aria-label="Email confirmation required"
            className="rounded-xl border border-cyan-400 bg-slate-800 p-5"
          >
            <h2 className="text-xl font-bold">
              One more step: confirm your email
            </h2>
            <p className="mt-3">
              Check the inbox for <strong>{state.confirmationEmail}</strong> and
              open the account confirmation email. Click its confirmation link
              before signing in.
            </p>
            <p className="mt-3">
              {joiningTeam &&
                "This is a separate email from your team invitation. "}
              Check Spam or Junk if it hasn’t arrived.
            </p>
            {joiningTeam && (
              <p className="mt-3">
                After confirming, continue to your invitation and choose Join
                team. If you aren’t taken there automatically, reopen the latest
                invitation email.
              </p>
            )}
            <form action={resendAction} className="mt-4">
              <input
                type="hidden"
                name="email"
                value={state.confirmationEmail}
              />
              <input type="hidden" name="next" value={returnTo ?? "/account"} />
              <button className="btn-secondary min-h-11" disabled={resending}>
                {resending ? "Requesting email…" : "Resend confirmation email"}
              </button>
              {resendState.message && (
                <p className="mt-3" role="status">
                  {resendState.message}
                </p>
              )}
            </form>
            <Link
              className="btn mt-4 block min-h-11 text-center"
              href={
                returnTo
                  ? `/login?next=${encodeURIComponent(returnTo)}`
                  : "/login"
              }
            >
              I’ve confirmed my email — sign in
            </Link>
          </section>
        )}
        {joiningTeam && !state.confirmationEmail && (
          <p className="text-slate-300">
            {mode === "signup"
              ? "Create your own login using any email you prefer. After confirming your email, you’ll return to the invitation to join the existing team. You don’t need to create a team."
              : "Sign in with the account you want to use. You’ll return to your team invitation next."}
          </p>
        )}
        {googleUnavailableMessage ? (
          <p role="status" className="text-slate-300">
            {googleUnavailableMessage}
          </p>
        ) : (
          googleEnabled &&
          googleAction && (
            <>
              {googleLoginUrl ? (
                <Link
                  className="btn min-h-11 bg-white text-center text-slate-950 hover:bg-slate-200"
                  href={googleLoginUrl}
                >
                  Continue with Google
                </Link>
              ) : (
                <form action={googleFormAction}>
                  <input
                    type="hidden"
                    name="next"
                    value={returnTo ?? "/onboarding"}
                  />
                  <button
                    className="btn min-h-11 w-full bg-white text-slate-950 hover:bg-slate-200"
                    disabled={pending || googlePending}
                  >
                    Continue with Google
                  </button>
                </form>
              )}
            </>
          )
        )}
        {!(mode === "signup" && state.confirmationEmail) && (
          <form action={formAction} className="grid gap-4" noValidate>
            {mode === "signup" && (
              <label>
                Display name
                <input
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                  name="displayName"
                  autoComplete="name"
                  aria-describedby="displayName-error"
                />
                {field("displayName") && (
                  <span id="displayName-error" className="text-red-300">
                    {field("displayName")}
                  </span>
                )}
              </label>
            )}
            <label>
              Email address
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                name="email"
                type="email"
                autoComplete="email"
                aria-describedby="email-error"
              />
              {field("email") && (
                <span id="email-error" className="text-red-300">
                  {field("email")}
                </span>
              )}
            </label>
            <label>
              Password
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                name="password"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                aria-describedby="password-error"
              />
              {field("password") && (
                <span id="password-error" className="text-red-300">
                  {field("password")}
                </span>
              )}
            </label>
            {mode === "signup" && (
              <label>
                Confirm password
                <input
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                  name="passwordConfirmation"
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="passwordConfirmation-error"
                />
                {field("passwordConfirmation") && (
                  <span
                    id="passwordConfirmation-error"
                    className="text-red-300"
                  >
                    {field("passwordConfirmation")}
                  </span>
                )}
              </label>
            )}
            <button className="btn" disabled={pending}>
              {pending
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
            {returnTo && <input type="hidden" name="next" value={returnTo} />}
            {notice && (
              <p role="status" className="text-slate-200">
                {notice}
              </p>
            )}
            {state.message && (
              <p
                role="status"
                className={mode === "login" ? "text-red-300" : "text-slate-200"}
              >
                {state.message}
                {joiningTeam && mode === "signup" && (
                  <span className="mt-2 block">
                    Check your spam folder too. After confirming your email,
                    reopen your invitation link if you aren’t returned there
                    automatically.
                  </span>
                )}
              </p>
            )}
            {googleState.message && (
              <p role="status" className="text-red-300">
                {googleState.message}
              </p>
            )}
          </form>
        )}
        <Link
          className="min-h-11 py-3 text-cyan-300"
          href={
            mode === "signup"
              ? returnTo
                ? `/login?next=${encodeURIComponent(returnTo)}`
                : "/"
              : returnTo
                ? `/signup?next=${encodeURIComponent(returnTo)}`
                : "/signup"
          }
        >
          {mode === "signup" ? "Return to Sign In" : "Create Account"}
        </Link>
      </section>
    </main>
  );
}
