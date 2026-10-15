// Run with a local @electric-sql/pglite module path; no production database access.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const read = (n) =>
  readFileSync(new URL("../supabase/migrations/" + n, import.meta.url), "utf8");
const org = randomUUID(),
  actor = randomUUID(),
  game = randomUUID();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table public.organizations(id uuid primary key);
create table public.games(id uuid primary key,organization_id uuid,status text);
create table public.user_profiles(user_id uuid,status text);
create table public.team_memberships(user_id uuid,organization_id uuid,status text);
insert into auth.users values('${actor}',now()); insert into organizations values('${org}');
insert into games values('${game}','${org}','completed');
insert into user_profiles values('${actor}','active'); insert into team_memberships values('${actor}','${org}','active');`);
const original = read("0058_curlcoach.sql");
await db.exec(
  original.slice(0, original.indexOf("-- Listing an event")) + "commit;",
);
await db.exec(
  `insert into curlcoach_module_entitlements(organization_id) values('${org}');insert into curlcoach_coach_access(organization_id,user_id) values('${org}','${actor}');`,
);
await db.exec(read("0071_curlcoach_lineups.sql"));
await db.exec(read("0072_curlcoach_closed_game_guard.sql"));
await db.exec(read("0077_shot_tracker_charting_lifecycle.sql"));
const base = {
  organizationId: org,
  gameId: game,
  profile: "tracker-provisional-v1",
  revision: 0,
  status: "open",
  roster: [{ id: "p", name: "Player" }],
  events: [],
};
async function apply(type, state, next, payload = {}, who = actor) {
  const request = payload.requestId ?? randomUUID();
  return (
    await db.query(
      "select public.apply_curlcoach_command($1,$2,$3,$4,$5,$6,$7,$8) result",
      [
        who,
        org,
        game,
        request,
        state.revision,
        type,
        {
          action: type,
          requestId: request,
          expectedRevision: state.revision,
          ...payload,
        },
        next,
      ],
    )
  ).rows[0].result;
}
await assert.rejects(
  apply("finish", base, {
    ...base,
    status: "closed",
    revision: 1,
    reopened: false,
  }),
  /explicit reopen/,
);
await assert.rejects(
  apply("command", base, { ...base, revision: 1, reopened: true }),
  /lifecycle command/,
);
await assert.rejects(
  apply(
    "reopen",
    base,
    { ...base, revision: 1, reopened: true },
    {},
    randomUUID(),
  ),
  /active team account/,
);
const requestId = randomUUID();
let state = await apply(
  "reopen",
  base,
  { ...base, revision: 1, reopened: true },
  { requestId },
);
assert.equal(state.reopened, true);
assert.deepEqual(await apply("reopen", base, state, { requestId }), state);
await assert.rejects(
  apply("command", state, { ...state, revision: 2 }),
  /Confirm lineup/,
);
const lineup = Array(8).fill("p"),
  lineupId = randomUUID();
const payload = {
  action: "set-lineup",
  requestId: lineupId,
  expectedRevision: 1,
  lineup,
};
state = await apply(
  "set-lineup",
  state,
  {
    ...state,
    revision: 2,
    lineup,
    lineupEvents: [
      { ...payload, revision: 2, actor, at: new Date().toISOString() },
    ],
  },
  payload,
);
const shotId = randomUUID(),
  shotRequest = randomUUID();
const command = {
  requestId: shotRequest,
  expectedRevision: 2,
  shotId,
  shot: null,
};
state = await apply(
  "command",
  state,
  {
    ...state,
    revision: 3,
    events: [{ ...command, revision: 3, actor, at: new Date().toISOString() }],
  },
  command,
);
assert.equal(state.events.length, 1);
state = await apply("finish", state, {
  ...state,
  revision: 4,
  status: "closed",
  reopened: false,
});
await assert.rejects(
  apply("command", state, { ...state, revision: 5 }),
  /explicit reopen/,
);
state = await apply("reopen", state, {
  ...state,
  revision: 5,
  status: "open",
  reopened: true,
});
assert.equal(state.events.length, 1);
const loaded = (
  await db.query("select public.read_curlcoach_states($1,$2,$3) result", [
    actor,
    org,
    [game],
  ])
).rows[0].result;
assert.deepEqual(loaded[game], state);
await assert.rejects(
  db.query("select public.read_curlcoach_states($1,$2,$3)", [
    randomUUID(),
    org,
    [game],
  ]),
  /active team account/,
);
await db.exec(`update games set status='deleted' where id='${game}';`);
await assert.rejects(
  apply("finish", state, {
    ...state,
    revision: 6,
    status: "closed",
    reopened: false,
  }),
  /Deleted games/,
);
assert.equal(
  (await db.query("select count(*)::int n from curlcoach_commands")).rows[0].n,
  5,
);
await db.close();
console.log(
  "PASS: authorization, completed-game fence, explicit reopen, lineup gate, append-only history, finish/reopen, deleted-game fence, batched private reads and idempotency.",
);
