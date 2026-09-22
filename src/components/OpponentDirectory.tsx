"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OpponentSeasonForm } from "./OpponentSeasonForm";
import {
  opponentSeasonDirectorySchema,
  type OpponentSeasonDirectory,
} from "@/lib/opponent-seasons";
import { OpponentProfilePicker } from "./OpponentProfilePicker";

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
  const [seasonData, setSeasonData] = useState<OpponentSeasonDirectory | null>(
    null,
  );
  const [seasonId, setSeasonId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [seasonError, setSeasonError] = useState("");
  const [reload, setReload] = useState(0);
  const [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/opponent-seasons", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Season details could not be loaded.");
        const data = opponentSeasonDirectorySchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setSeasonData(data);
          setSeasonError("");
          setSeasonId((current) =>
            data.seasons.some((s) => s.id === current)
              ? current
              : (data.seasons.find((s) => s.status === "active")?.id ??
                data.seasons[0]?.id ??
                ""),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSeasonError("Season details could not be loaded.");
      });
    return () => controller.abort();
  }, [reload]);
  const seasonName =
    seasonData?.seasons.find((s) => s.id === seasonId)?.name ??
    "Selected season";
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
      {seasonData && (
        <label>
          Opponent season
          <select
            className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
            value={seasonId}
            disabled={editing !== null}
            onChange={(e) => {
              setSeasonId(e.target.value);
              setSavedMessage("");
            }}
          >
            {seasonData.seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
                {season.status === "active" ? " (Current)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {seasonData?.seasons.length === 0 && (
        <p>
          Create a season in Seasons &amp; events to add seasonal opponent
          details.
        </p>
      )}
      {seasonError && (
        <p role="alert">
          {seasonError}{" "}
          <button
            className="btn-secondary"
            onClick={() => setReload((n) => n + 1)}
          >
            Retry season details
          </button>
        </p>
      )}
      {savedMessage && <p role="status">{savedMessage}</p>}
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
        <OpponentProfilePicker
          initialQuery={search}
          onLinked={() => router.refresh()}
        />
      )}
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
          {shown.map((opponent) => {
            const profile = seasonData?.profiles.find(
              (p) => p.opponent_id === opponent.id && p.season_id === seasonId,
            );
            return (
              <li
                className="panel flex flex-wrap items-center justify-between gap-3"
                key={opponent.id}
              >
                <div>
                  <h2 className="font-bold">
                    {opponent.display_name}
                    {seasonId && (
                      <span className="ml-2 text-sm font-normal text-slate-300">
                        {seasonName}
                      </span>
                    )}
                  </h2>
                  {profile && (
                    <p className="text-sm text-slate-300">
                      {profile.level ?? "Level not recorded"}
                      {Object.values(profile.roster).filter(Boolean).length > 0
                        ? " · " +
                          Object.values(profile.roster)
                            .filter(Boolean)
                            .join(", ")
                        : " · Players not recorded"}
                    </p>
                  )}
                  <p className="text-sm text-slate-300">
                    {opponent.archived_at ? "Archived" : "Active"} ·{" "}
                    {opponent.games_played} game
                    {Number(opponent.games_played) === 1 ? "" : "s"}
                    {opponent.last_played_at
                      ? ` · Last played ${new Date(opponent.last_played_at).toLocaleDateString()}`
                      : ""}
                  </p>
                  <OpponentProfilePicker
                    opponentId={opponent.id}
                    initialQuery={opponent.display_name}
                    canEdit={canEdit && !opponent.archived_at}
                    onLinked={() => router.refresh()}
                  />
                </div>
                {canEdit &&
                  seasonId &&
                  !opponent.archived_at &&
                  editing !== opponent.id && (
                    <button
                      className="btn-secondary"
                      disabled={editing !== null}
                      onClick={() => {
                        setEditing(opponent.id);
                        setSavedMessage("");
                      }}
                    >
                      Season details
                    </button>
                  )}
                {editing === opponent.id && (
                  <OpponentSeasonForm
                    key={opponent.id + ":" + seasonId}
                    opponentId={opponent.id}
                    seasonId={seasonId}
                    seasonName={seasonName}
                    profile={profile}
                    onCancel={() => setEditing(null)}
                    onSaved={(value) => {
                      setSeasonData((current) =>
                        current
                          ? {
                              ...current,
                              profiles: [
                                ...current.profiles.filter(
                                  (p) =>
                                    !(
                                      p.opponent_id === value.opponent_id &&
                                      p.season_id === value.season_id
                                    ),
                                ),
                                value,
                              ],
                            }
                          : current,
                      );
                      setEditing(null);
                      setSavedMessage(
                        opponent.display_name + " · " + seasonName + " saved.",
                      );
                    }}
                  />
                )}
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
