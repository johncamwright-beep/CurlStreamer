"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ScheduleMutationForm({
  operation,
  children,
  confirmMessage,
  className = "",
  submitLabel,
}: {
  operation: string;
  children: React.ReactNode;
  confirmMessage?: string;
  className?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmMessage && !confirm(confirmMessage)) return;
    setBusy(true);
    setError("");
    const flat = Object.fromEntries(new FormData(event.currentTarget));
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(flat)) {
      const nested = key.match(/^(\w+)\[(\w+)]$/);
      if (nested) {
        const target = (data[nested[1]] ??= {}) as Record<string, unknown>;
        target[nested[2]] = value;
      } else data[key] = value;
    }
    const response = await fetch("/api/team-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, ...data }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error ?? "The change could not be saved.");
      setBusy(false);
      return;
    }
    router.refresh();
  }
  return (
    <form onSubmit={submit} className={className}>
      {children}
      {submitLabel && (
        <button disabled={busy} className="btn min-h-11">
          {busy ? "Saving…" : submitLabel}
        </button>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
