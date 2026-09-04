"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Opponent = {
  id: string;
  display_name: string;
  archived_at: string | null;
  games_played: number;
  last_played_at: string | null;
};
export function OpponentDirectory({
  opponents,
  canEdit,
}: {
  opponents: Opponent[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const shown = useMemo(
    () =>
      opponents.filter((o) =>
        o.display_name
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [opponents, search],
  );
  async function mutate(operation: string, payload: object) {
    setError("");
    const response = await fetch("/api/team-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, ...payload }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Opponent could not be updated.");
      return;
    }
    router.refresh();
  }
  return (
    <div className="grid gap-4">
      <label>
        Search opponents
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      {canEdit && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            void mutate("createOpponent", { input: { displayName: name } });
          }}
        >
          <label className="flex-1">
            Add new opponent
            <input
              name="name"
              required
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
            />
          </label>
          <button className="btn self-end">Add opponent</button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="panel">No matching opponents.</p>
      ) : (
        <ul className="grid gap-3">
          {shown.map((opponent) => (
            <li
              className="panel flex flex-wrap items-center justify-between gap-3"
              key={opponent.id}
            >
              <div>
                <h2 className="font-bold">{opponent.display_name}</h2>
                <p className="text-sm text-slate-300">
                  {opponent.archived_at ? "Archived" : "Active"} ·{" "}
                  {opponent.games_played} game
                  {Number(opponent.games_played) === 1 ? "" : "s"}
                  {opponent.last_played_at
                    ? ` · Last played ${new Date(opponent.last_played_at).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              {canEdit && (
                <button
                  className="btn-secondary"
                  onClick={() =>
                    void mutate(
                      opponent.archived_at
                        ? "restoreOpponent"
                        : "archiveOpponent",
                      { opponentId: opponent.id },
                    )
                  }
                >
                  {opponent.archived_at ? "Restore" : "Archive"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
