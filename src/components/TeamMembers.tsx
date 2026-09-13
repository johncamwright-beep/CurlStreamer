"use client";

import { useEffect, useState } from "react";

type Role = "owner" | "team_admin" | "game_operator";
type Member = { id: string; email: string; role: Role; status: string };
type Invitation = {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
};
type MembersResponse = {
  members: Member[];
  invitation: Invitation | null;
  canManage: boolean;
};

const roleNames: Record<Role, string> = {
  owner: "Owner",
  team_admin: "Full access",
  game_operator: "Game operations",
};

function expiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Expires soon";
  return `Expires ${new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(date)} (Toronto time)`;
}

export function TeamMembers({
  apiUrl = "/api/account/members",
}: {
  apiUrl?: string;
}) {
  const [details, setDetails] = useState<MembersResponse | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("game_operator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch(apiUrl, {
        cache: "no-store",
      });
      const body = (await response.json()) as MembersResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Team access could not be loaded.");
      setDetails(body);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Team access could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function request(body: Record<string, string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        error?: string;
        inviteUrl?: string;
        emailSent?: boolean;
      };
      if (!response.ok)
        throw new Error(result.error || "The change could not be saved.");
      return result;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The change could not be saved.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await request({ action: "invite", email, role });
    if (!result) return;
    setInviteUrl(result.inviteUrl || "");
    setEmail("");
    setMessage(
      result.emailSent
        ? "Invitation created and email delivery was requested."
        : "Invitation created. Share the link below with your teammate.",
    );
    await load();
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Invitation link copied.");
    } catch {
      setMessage("Copy the invitation link from the field below.");
    }
  }

  const usedSeats = details
    ? details.members.length + (details.invitation ? 1 : 0)
    : 0;
  const canInvite = Boolean(
    details?.canManage && usedSeats < 2 && !details.invitation,
  );

  return (
    <section className="grid gap-5" aria-label="Team access">
      <div className="grid gap-2">
        <h2 className="text-xl font-bold">Team access</h2>
        <p className="text-slate-300">
          Each team has an owner and one additional login. Full access can
          manage team settings and access. Game operations can run games and
          broadcasts.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-slate-200">
          {message}
        </p>
      )}
      {!details ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void load()}
        >
          Load team access
        </button>
      ) : (
        <>
          <p className="text-sm text-slate-400">
            {usedSeats} of 2 logins in use
          </p>
          <div className="grid gap-3">
            {details.members.map((member) => (
              <article
                key={member.id}
                className="grid gap-3 rounded-xl border border-slate-700 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold">{member.email}</p>
                  <p className="text-sm text-slate-400">
                    {roleNames[member.role]} · {member.status}
                  </p>
                </div>
                {details.canManage && member.role !== "owner" && (
                  <div className="grid gap-2 sm:flex sm:flex-wrap">
                    <label
                      className="sr-only"
                      htmlFor={`member-role-${member.id}`}
                    >
                      Role for {member.email}
                    </label>
                    <select
                      id={`member-role-${member.id}`}
                      className="input"
                      value={member.role}
                      disabled={busy}
                      onChange={async (event) => {
                        const result = await request({
                          action: "role",
                          membershipId: member.id,
                          role: event.target.value,
                        });
                        if (result) {
                          setMessage("Member role updated.");
                          await load();
                        }
                      }}
                    >
                      <option value="team_admin">Full access</option>
                      <option value="game_operator">Game operations</option>
                    </select>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      onClick={async () => {
                        const result = await request({
                          action: "remove",
                          membershipId: member.id,
                        });
                        if (result) {
                          setMessage("Member removed.");
                          await load();
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {details.invitation && (
            <article className="grid gap-3 rounded-xl border border-amber-500/50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="break-words font-semibold">
                  Pending: {details.invitation.email}
                </p>
                <p className="text-sm text-slate-400">
                  {roleNames[details.invitation.role]} ·{" "}
                  {expiry(details.invitation.expiresAt)}
                </p>
              </div>
              {details.canManage && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    const result = await request({
                      action: "revokeInvite",
                      invitationId: details.invitation!.id,
                    });
                    if (result) {
                      setInviteUrl("");
                      setMessage("Invitation revoked.");
                      await load();
                    }
                  }}
                >
                  Revoke invitation
                </button>
              )}
            </article>
          )}
          {details.canManage && (
            <form
              className="grid gap-3 rounded-xl border border-slate-700 p-4"
              onSubmit={(event) => void invite(event)}
            >
              <h3 className="font-bold">Invite teammate</h3>
              <label>
                Email address
                <input
                  className="input mt-1 w-full"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  disabled={!canInvite || busy}
                />
              </label>
              <label>
                Access level
                <select
                  className="input mt-1 w-full"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as Exclude<Role, "owner">)
                  }
                  disabled={!canInvite || busy}
                >
                  <option value="team_admin">
                    Full access — manage team settings and access
                  </option>
                  <option value="game_operator">
                    Game operations — run games and broadcasts
                  </option>
                </select>
              </label>
              <button className="btn" disabled={!canInvite || busy}>
                {busy ? "Saving…" : "Create invitation"}
              </button>
              {!canInvite && (
                <p className="text-sm text-slate-400">
                  {details.invitation
                    ? "Revoke the pending invitation before inviting someone else."
                    : "Your team’s two logins are already in use."}
                </p>
              )}
            </form>
          )}
          {inviteUrl && (
            <div className="grid gap-2 rounded-xl border border-cyan-700 p-4">
              <label htmlFor="team-invite-link">Invitation link</label>
              <input
                id="team-invite-link"
                className="input w-full"
                value={inviteUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void copyInvite()}
              >
                Copy invitation link
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
