"use client";
import { useActionState } from "react";
import Link from "next/link";
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
  const field = (name: string) => state.errors?.[name]?.[0];
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
      <section className="panel grid gap-4">
        <CurlStreamerLogo />
        <h1 className="text-3xl font-black">
          {mode === "signup" ? "Create account" : "Sign in"}
        </h1>
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
                <span id="passwordConfirmation-error" className="text-red-300">
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
            </p>
          )}
          {googleState.message && (
            <p role="status" className="text-red-300">
              {googleState.message}
            </p>
          )}
        </form>
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
