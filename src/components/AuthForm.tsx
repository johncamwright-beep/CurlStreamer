"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { AuthFormState } from "@/app/signup/actions";

export function AuthForm({
  mode,
  action,
  returnTo,
}: {
  mode: "signup" | "login";
  action: (state: AuthFormState, data: FormData) => Promise<AuthFormState>;
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const field = (name: string) => state.errors?.[name]?.[0];
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
      <form action={formAction} className="panel grid gap-4" noValidate>
        <p className="font-bold tracking-widest text-cyan-300">CURLSTREAMER</p>
        <h1 className="text-3xl font-black">
          {mode === "signup" ? "Create account" : "Sign in"}
        </h1>
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
        {mode === "login" && returnTo && (
          <input type="hidden" name="next" value={returnTo} />
        )}
        {state.message && (
          <p
            role="status"
            className={mode === "login" ? "text-red-300" : "text-slate-200"}
          >
            {state.message}
          </p>
        )}
        <Link
          className="min-h-11 py-3 text-cyan-300"
          href={mode === "signup" ? "/" : "/signup"}
        >
          {mode === "signup" ? "Return to Sign In" : "Create Account"}
        </Link>
      </form>
    </main>
  );
}
