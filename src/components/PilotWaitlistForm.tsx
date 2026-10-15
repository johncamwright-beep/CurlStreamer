"use client";
import { useState } from "react";

export function PilotWaitlistForm() {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  return (
    <div className="tile">
      <h3>Join the pilot waitlist</h3>
      {state === "saved" ? (
        <div className="form-success" role="status">
          You’re on the list. We’ll use your email for CurlStreamer pilot
          updates. No account or subscription has been created.
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (state === "saving") return;
            const data = new FormData(event.currentTarget);
            setState("saving");
            setError("");
            try {
              const response = await fetch("/api/pilot-waitlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: data.get("email"),
                  team: data.get("team"),
                  consent: data.get("consent") === "on",
                  website: data.get("website"),
                }),
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.error ||
                    "We couldn’t save your request. Please try again.",
                );
              setState("saved");
            } catch (cause) {
              setState("idle");
              setError(
                cause instanceof Error
                  ? cause.message
                  : "We couldn’t save your request. Please try again.",
              );
            }
          }}
        >
          <label htmlFor="pilot-email">Email address</label>
          <input
            id="pilot-email"
            type="email"
            name="email"
            autoComplete="email"
            maxLength={254}
            required
          />
          <label htmlFor="pilot-team">
            Team or club name <small>(optional)</small>
          </label>
          <input
            id="pilot-team"
            name="team"
            maxLength={120}
            autoComplete="organization"
          />
          <div className="trap" aria-hidden="true">
            <label htmlFor="pilot-website">Leave this blank</label>
            <input
              id="pilot-website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <label className="consent">
            <input name="consent" type="checkbox" required />
            <span>
              Email me about the CurlStreamer pilot and its availability. I can
              withdraw my interest at any time.
            </span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "Join the waitlist"}
          </button>
        </form>
      )}
      <details id="pilot-privacy">
        <summary>How we use your information</summary>
        <p>
          We store your email, optional team name and signup consent securely
          using Supabase to manage CurlStreamer pilot interest. This list is not
          published or sold. Joining does not create a paid account. Pilot
          emails will include a way to withdraw.
        </p>
      </details>
    </div>
  );
}
