"use client";
import { useActionState } from "react";
import { changePilotPassword } from "./actions";
export function PasswordForm() {
  const [state, action, pending] = useActionState(changePilotPassword, {});
  return (
    <form action={action} className="panel grid gap-4">
      <h1 className="text-3xl font-black">Choose your password</h1>
      <p>Replace your temporary password to open your team workspace.</p>
      <label>
        New password
        <input
          className="block min-h-11 w-full rounded border bg-slate-900 p-3"
          name="password"
          type="password"
          minLength={12}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        Confirm password
        <input
          className="block min-h-11 w-full rounded border bg-slate-900 p-3"
          name="passwordConfirmation"
          type="password"
          minLength={12}
          autoComplete="new-password"
          required
        />
      </label>
      {state.error && <p role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save password and set up team"}
      </button>
    </form>
  );
}
