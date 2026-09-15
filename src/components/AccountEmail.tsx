"use client";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
export function AccountEmail({ email }: { email: string }) {
  const [value, setValue] = useState(email),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          const { error } = await createBrowserSupabaseClient().auth.updateUser(
            { email: value },
          );
          if (error) throw error;
          setMessage(
            "Check your email to confirm the change. Your sign-in email stays unchanged until confirmation.",
          );
        } catch {
          setMessage(
            "Email change could not be started. Please sign in again and retry.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="min-w-0 flex-1">
        Sign-in email
        <input
          className="input mt-1 w-full"
          type="email"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button className="btn-secondary" disabled={busy || value === email}>
        {busy ? "Sending…" : "Change email"}
      </button>
      {message && (
        <p role="status" className="w-full">
          {message}
        </p>
      )}
    </form>
  );
}
