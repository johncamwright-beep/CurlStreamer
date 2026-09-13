"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TeamSettings } from "./TeamSettings";
import { TeamMembers } from "./TeamMembers";
import { localDateTimeToUtc } from "@/lib/team-hierarchy";
type Account = { id: string; email: string; status: string; createdAt: string };
type Team = {
  id: string;
  name: string;
  trialExpiresAt: string | null;
  members: {
    id: string;
    userId: string;
    email: string;
    role: string;
    status: string;
  }[];
};
type Code = {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  redeemedAt: string | null;
  teamName: string | null;
};
type Overview = { teams: Team[]; accounts: Account[]; codes: Code[] };
const field = "min-h-11 rounded-lg border border-slate-600 bg-slate-900 p-3";
function expires(date: string) {
  const value = localDateTimeToUtc(date, "23:59", "America/Toronto");
  if (!value) throw Error("Choose a valid expiry date.");
  return new Date(Date.parse(value) + 60000).toISOString();
}
export function PlatformAdmin() {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [tab, setTab] = useState<"teams" | "accounts" | "codes">("teams"),
    [selected, setSelected] = useState<Team | null>(null),
    [edit, setEdit] = useState(false),
    [section, setSection] = useState<
      "team" | "public" | "social" | "photos" | "members"
    >("team");
  const [count, setCount] = useState(10),
    [until, setUntil] = useState(
      new Intl.DateTimeFormat("en", {
        year: "numeric",
        timeZone: "America/Toronto",
      }).format(new Date()) + "-12-31",
    ),
    [codes, setCodes] = useState<string[]>([]),
    [message, setMessage] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/admin", { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setData(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Administration unavailable.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (b.codes) setCodes(b.codes);
      setMessage("Saved.");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Change failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black">Platform administration</h1>
        <Link className="btn-secondary" href="/account">
          Back to my account
        </Link>
      </div>
      <p className="mb-4 text-slate-300">
        You are working as the platform administrator. Support changes are
        recorded with your identity.
      </p>
      {error && (
        <p role="alert" className="mb-4 text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 text-cyan-300">
          {message}
        </p>
      )}
      {selected ? (
        <>
          <div className="mb-5 rounded-xl border border-amber-400 bg-amber-950 p-4">
            <strong>Support view: {selected.name}</strong>
            <p>
              You remain signed in as the administrator. This does not sign you
              in as a team member.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                className="btn-secondary"
                onClick={() => {
                  setSelected(null);
                  setEdit(false);
                }}
              >
                Exit support view
              </button>
              <button className="btn-secondary" onClick={() => setEdit(!edit)}>
                {edit ? "Return to read-only view" : "Enable support edits"}
              </button>
            </div>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {(["team", "public", "social", "photos", "members"] as const).map(
              (value) => (
                <button
                  key={value}
                  className={section === value ? "btn" : "btn-secondary"}
                  onClick={() => setSection(value)}
                >
                  {
                    {
                      team: "Team info",
                      public: "Public team page",
                      social: "Social media",
                      photos: "Event photos",
                      members: "Team access",
                    }[value]
                  }
                </button>
              ),
            )}
          </div>
          <section className="panel">
            {section === "members" ? (
              <fieldset disabled={!edit}>
                <TeamMembers
                  key={selected.id}
                  apiUrl={"/api/admin/teams/" + selected.id + "/members"}
                />
              </fieldset>
            ) : (
              <TeamSettings
                key={selected.id + String(edit)}
                name={selected.name}
                section={section}
                readOnly={!edit}
                apiUrl={"/api/admin/teams/" + selected.id}
              />
            )}
          </section>
          {edit && (
            <form
              className="panel mt-5 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void action({
                  action: "trial",
                  target: selected.id,
                  expiresAt: expires(until),
                });
              }}
            >
              <label>
                Trial access through (Toronto)
                <input
                  type="date"
                  className={field + " mt-1 block"}
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  required
                />
              </label>
              <button className="btn" disabled={busy}>
                Update trial expiry
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <nav
            className="mb-5 flex flex-wrap gap-3"
            aria-label="Platform administration sections"
          >
            {(["teams", "accounts", "codes"] as const).map((value) => (
              <button
                key={value}
                className={tab === value ? "btn" : "btn-secondary"}
                onClick={() => setTab(value)}
              >
                {
                  {
                    teams: "Teams",
                    accounts: "Accounts",
                    codes: "Trial codes",
                  }[value]
                }
              </button>
            ))}
          </nav>
          {!data ? (
            <button className="btn-secondary" onClick={load}>
              Load administration
            </button>
          ) : (
            <>
              {tab !== "codes" && (
                <label className="mb-5 block">
                  Search
                  <input
                    className={field + " mt-1 block w-full"}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              )}
              {tab === "teams" && (
                <div className="grid gap-3">
                  {data.teams
                    .filter((t) =>
                      (t.name + " " + t.members.map((m) => m.email).join(" "))
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((t) => (
                      <article className="panel" key={t.id}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className="text-xl font-bold">{t.name}</h2>
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              setSelected(t);
                              setEdit(false);
                              setSection("team");
                            }}
                          >
                            View as / support
                          </button>
                        </div>
                        <p className="mt-2">{t.members.length} of 2 logins</p>
                        {t.members.map((m) => (
                          <p key={m.id} className="break-words text-slate-300">
                            {m.email} · {m.role.replaceAll("_", " ")} ·{" "}
                            {m.status}
                          </p>
                        ))}
                        <p className="mt-2">
                          Trial:{" "}
                          {t.trialExpiresAt
                            ? new Date(t.trialExpiresAt).toLocaleString(
                                "en-CA",
                                { timeZone: "America/Toronto" },
                              )
                            : "Not activated"}
                        </p>
                      </article>
                    ))}
                </div>
              )}
              {tab === "accounts" && (
                <div className="grid gap-3">
                  {data.accounts
                    .filter((a) =>
                      a.email.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((a) => (
                      <article
                        className="panel flex flex-wrap items-center justify-between gap-3"
                        key={a.id}
                      >
                        <div>
                          <strong className="break-all">{a.email}</strong>
                          <p>{a.status ?? "Profile not completed"}</p>
                        </div>
                        <button
                          className="btn-secondary"
                          disabled={busy || !a.status}
                          onClick={() => {
                            if (
                              window.confirm(
                                `${a.status === "active" ? "Suspend" : "Reactivate"} ${a.email}?`,
                              )
                            )
                              void action({
                                action:
                                  a.status === "active"
                                    ? "suspend"
                                    : "activate",
                                target: a.id,
                              });
                          }}
                        >
                          {a.status === "active"
                            ? "Suspend account"
                            : "Reactivate account"}
                        </button>
                      </article>
                    ))}
                </div>
              )}
              {tab === "codes" && (
                <div className="grid gap-4">
                  <form
                    className="panel flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action({
                        action: "codes",
                        count,
                        expiresAt: expires(until),
                      });
                    }}
                  >
                    <label>
                      Number of codes
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className={field + " mt-1 block"}
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value))}
                        required
                      />
                    </label>
                    <label>
                      Valid through (Toronto)
                      <input
                        type="date"
                        className={field + " mt-1 block"}
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                        required
                      />
                    </label>
                    <button className="btn" disabled={busy}>
                      Generate trial codes
                    </button>
                  </form>
                  {codes.length > 0 && (
                    <div className="panel">
                      <h2 className="font-bold">Copy these codes now</h2>
                      <p className="mb-3">
                        Raw codes are shown only for this batch. Give each code
                        to one team.
                      </p>
                      <textarea
                        className={field + " w-full"}
                        rows={Math.min(12, codes.length + 1)}
                        readOnly
                        value={codes.join("\n")}
                        aria-label="Generated trial codes"
                      />
                      <button
                        className="btn-secondary mt-3"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              codes.join("\n"),
                            );
                            setMessage("Codes copied.");
                          } catch {
                            setMessage("Select and copy the codes above.");
                          }
                        }}
                      >
                        Copy codes
                      </button>
                    </div>
                  )}
                  {data.codes.map((c) => (
                    <article
                      key={c.id}
                      className="panel flex flex-wrap justify-between gap-3"
                    >
                      <div>
                        <p>
                          {c.revokedAt
                            ? "Revoked"
                            : c.redeemedAt
                              ? "Redeemed by " + c.teamName
                              : "Available"}
                        </p>
                        <p className="text-sm text-slate-300">
                          Expires{" "}
                          {new Date(c.expiresAt).toLocaleString("en-CA", {
                            timeZone: "America/Toronto",
                          })}
                        </p>
                        <p className="text-xs text-slate-400">{c.id}</p>
                      </div>
                      {!c.revokedAt && !c.redeemedAt && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm("Revoke this unused trial code?")
                            )
                              void action({
                                action: "revokeCode",
                                target: c.id,
                              });
                          }}
                        >
                          Revoke code
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
