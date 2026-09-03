"use client";
import Link from "next/link";
import { useActionState } from "react";
import { createFirstTeam } from "./actions";

export function FirstTeamForm() {
  const [state, action, pending] = useActionState(createFirstTeam, {});
  const error = state.errors?.teamName?.[0];
  return (
    <form action={action} className="panel grid gap-4" noValidate>
      <h1 className="text-3xl font-black">Create your team</h1>
      <p className="text-slate-300">Set up your first CurlStreamer team.</p>
      <label>
        Team name
        <input
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          name="teamName"
          autoComplete="organization"
          aria-describedby="teamName-error"
        />
        {error && (
          <span id="teamName-error" className="text-red-300">
            {error}
          </span>
        )}
      </label>
      <button className="btn" disabled={pending}>
        {pending ? "Creating…" : "Create team"}
      </button>
      {state.message && (
        <p role="alert" className="text-red-300">
          {state.message}
        </p>
      )}
      <Link className="min-h-11 py-3 text-cyan-300" href="/">
        Return to CurlStreamer
      </Link>
    </form>
  );
}
