"use client";

import { useActionState } from "react";
import {
  setStudioPassword,
  type StudioPasswordState,
} from "@/app/account/actions";

export function AccountPasswordForm() {
  const [state, formAction, pending] = useActionState<
    StudioPasswordState,
    FormData
  >(setStudioPassword, {});
  return (
    <form action={formAction} className="grid gap-3">
      <h3 className="text-lg font-bold">Set a Studio password</h3>
      <p className="text-sm text-slate-300">
        This is the same CurlStreamer password used for email sign-in. If you
        already have one, this replaces it.
      </p>
      <label>
        New password
        <input
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="studio-password-error"
        />
        {state.errors?.password?.[0] && (
          <span id="studio-password-error" className="text-red-300">
            {state.errors.password[0]}
          </span>
        )}
      </label>
      <label>
        Confirm new password
        <input
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          aria-describedby="studio-password-confirmation-error"
        />
        {state.errors?.passwordConfirmation?.[0] && (
          <span
            id="studio-password-confirmation-error"
            className="text-red-300"
          >
            {state.errors.passwordConfirmation[0]}
          </span>
        )}
      </label>
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Set Studio password"}
      </button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
