// Disposable PostgreSQL WASM test; install @electric-sql/pglite under
// work/coach-sql-validation (never points at a network database).
import { PGlite } from "../work/coach-sql-validation/node_modules/@electric-sql/pglite/dist/index.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const db = new PGlite();
const sql = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const source = "d4909708-4e33-4ed6-8909-2b3d4d3b12e3",
  target = "c8b19da4-cb4f-402e-ae0c-428d4eff459b";
const session = "5a673cef-fec2-43ab-b79d-d32fc64c2e3b",
  org = randomUUID(),
  actor = randomUUID();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table public.organizations(id uuid primary key);
create table public.games(id uuid primary key,organization_id uuid,status text,event_id uuid,deleted_at timestamptz,completed_at timestamptz);
create table public.user_profiles(user_id uuid,status text);
create table public.team_memberships(user_id uuid,organization_id uuid,status text);
insert into auth.users values('${actor}',now()); insert into public.organizations values('${org}');
insert into public.user_profiles values('${actor}','active');
insert into public.team_memberships values('${actor}','${org}','active');
insert into public.games values('${source}','${org}','active','1a798edc-d561-4cce-b253-ebebda9eb3c5',null,null),('${target}','${org}','active','1a798edc-d561-4cce-b253-ebebda9eb3c5',null,null);`);
await db.exec(sql("supabase/migrations/0058_curlcoach.sql"));
await db.exec(sql("supabase/migrations/0071_curlcoach_lineups.sql"));
await db.exec(
  `insert into public.curlcoach_module_entitlements(organization_id) values('${org}'); insert into public.curlcoach_coach_access(organization_id,user_id) values('${org}','${actor}');`,
);
const state = {
  organizationId: org,
  gameId: source,
  profile: "tracker-provisional-v1",
  roster: [{ id: "lead", name: "Test", position: "Lead" }],
  status: "open",
  revision: 0,
  events: [],
};
const ids = Array.from({ length: 119 }, () => randomUUID());
for (let revision = 1; revision <= 121; revision++) {
  const finish = revision === 121;
  const index =
    revision <= 56 ? revision - 1 : revision === 57 ? 55 : revision - 2;
  const at =
    revision <= 57 ? "2026-10-03T17:00:00.000Z" : "2026-10-03T23:00:00.000Z";
  const shot = {
    playerId: "lead",
    position: "Lead",
    end: Math.floor(index / 8) + 1,
    stone: (index % 2) + 1,
    type: "Draw",
    turn: null,
    execution: null,
    grade: 4,
    deficiency: null,
    review: null,
    excluded: null,
    note: "Preserve " + index,
  };
  const payload = finish
    ? { action: "finish", requestId: randomUUID(), expectedRevision: 120 }
    : {
        requestId: randomUUID(),
        expectedRevision: revision - 1,
        shotId: ids[index],
        shot,
      };
  state.revision = revision;
  if (finish) state.status = "closed";
  else state.events.push({ ...payload, revision, actor, at });
  if (revision === 1)
    await db.query(
      `insert into public.curlcoach_sessions(id,organization_id,game_id,actor_user_id,status,revision,state) values($1,$2,$3,$4,'open',1,$5)`,
      [session, org, source, actor, state],
    );
  else
    await db.query(
      `update public.curlcoach_sessions set status=$1,revision=$2,state=$3,closed_at=$4 where id=$5`,
      [state.status, revision, state, finish ? at : null, session],
    );
  await db.query(
    `insert into public.curlcoach_commands(session_id,request_id,expected_revision,revision,command_type,payload,result_state,actor_user_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      session,
      payload.requestId,
      revision - 1,
      revision,
      finish ? "finish" : "command",
      payload,
      state,
      actor,
      at,
    ],
  );
}
// Failed preflight is atomic.
await db.exec(
  `update public.curlcoach_sessions set revision=122 where id='${session}'`,
);
await assert.rejects(
  db.exec(sql("scripts/repair-rideau-coach-games.sql")),
  /preflight/,
);
await db.exec("rollback");
assert.equal(
  (await db.query("select count(*)::int n from public.curlcoach_commands"))
    .rows[0].n,
  121,
);
await db.exec(
  `update public.curlcoach_sessions set revision=121 where id='${session}'`,
);
await db.exec(sql("scripts/repair-rideau-coach-games.sql"));
assert.deepEqual(
  (
    await db.query(
      "select revision::int,status from public.curlcoach_sessions order by revision",
    )
  ).rows,
  [
    { revision: 64, status: "closed" },
    { revision: 186, status: "closed" },
  ],
);
await assert.rejects(
  db.exec(sql("scripts/repair-rideau-coach-games.sql")),
  /preflight/,
);
await db.exec("rollback");
await db.exec(sql("supabase/migrations/0072_curlcoach_closed_game_guard.sql"));
await db.exec(sql("supabase/migrations/0072_curlcoach_closed_game_guard.sql"));
await assert.rejects(
  db.exec(
    `update public.curlcoach_sessions set status='open',closed_at=null where id='${session}'`,
  ),
  /read only/,
);
await assert.rejects(
  db.exec(
    `update public.curlcoach_commands set payload='{}' where session_id='${session}'`,
  ),
  /append_only/,
);
await db.exec(
  `update public.games set status='completed' where id='${target}'`,
);
await assert.rejects(
  db.exec(
    `insert into public.curlcoach_sessions(organization_id,game_id,actor_user_id,status,revision,state) values('${org}','${target}','${actor}','open',0,'{}')`,
  ),
  /read only/,
);
// Open shared games still allow ordinary private saves and finishing.
const openGame = randomUUID();
await db.exec(
  `insert into public.games(id,organization_id,status) values('${openGame}','${org}','active'); insert into public.curlcoach_sessions(organization_id,game_id,actor_user_id,status,revision,state) values('${org}','${openGame}','${actor}','open',0,'{}'); update public.curlcoach_sessions set revision=1 where game_id='${openGame}'; update public.curlcoach_sessions set status='closed',closed_at=now() where game_id='${openGame}';`,
);
console.log(
  "PASS: atomic split, exact shot preservation, duplicate repair rejection, append-only history, closed-session guard, completed-game guard, ordinary open-game writes.",
);
await db.close();
