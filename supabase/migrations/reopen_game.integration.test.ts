import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (name: string) =>
  readFileSync(`supabase/migrations/${name}.sql`, "utf8");
const fn = (sql: string, name: string) => {
  const match = sql.match(
    new RegExp(
      `create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
    ),
  );
  if (!match) throw Error(name);
  return match[0];
};
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create table public.organizations(id uuid primary key);
 create table public.user_profiles(user_id uuid,status text);
 create table public.team_memberships(user_id uuid,organization_id uuid,status text,role text);
 create table public.games(id uuid primary key,organization_id uuid,status text,config jsonb,deleted_at timestamptz,deleted_by_user_id uuid,
 season_id uuid,event_id uuid,opponent_id uuid,scheduled_start timestamptz,schedule_timezone text,game_number int,game_label text);
 create table public.game_states(game_id uuid primary key references games(id),state jsonb,version bigint default 0,updated_at timestamptz);
 create table public.score_events(id uuid primary key,game_id uuid references games(id),sequence bigint generated always as identity,event_type text,payload jsonb,actor text);
 create table public.audit_events(actor_user_id uuid,organization_id uuid,action text,subject_type text,subject_identifier text,metadata jsonb);
 create table public.game_completion_closing(game_id uuid primary key references games(id),deadline_at timestamptz);
 `);
  const foundation = source("0015_add_game_completion_foundation");
  await db.exec(
    foundation.slice(
      0,
      foundation.indexOf(
        "create function public.authorize_game_completion_actor",
      ),
    ),
  );
  for (const name of [
    "authorize_game_completion_actor",
    "derive_game_completion_result",
    "review_game_completion",
  ])
    await db.exec(fn(foundation, name));
  const flow = source("0016_add_end_game_flow");
  await db.exec(
    flow.slice(
      0,
      flow.indexOf("drop function public.list_team_hierarchy_games"),
    ),
  );
  await db.exec(
    fn(
      source("0032_stop_application_conflict_retry_loops"),
      "complete_reviewed_game",
    ),
  );
  const corrections = source("0076_completed_result_corrections");
  await db.exec(
    corrections.slice(0, corrections.indexOf("-- Fail closed")) + "commit;",
  );
  await db.exec(source("0089_reopen_game_scoring"));
}, 30000);
afterAll(() => db.close());
async function fixture(n: number, corrected = false) {
  const game = id(n),
    org = id(n + 1),
    user = id(n + 2),
    review = id(n + 3),
    completion = id(n + 4);
  const event = {
    id: id(n + 5),
    type: "end",
    at: 1,
    score: { end: 1, team: "home", points: 1, blank: false },
  };
  await db.query("insert into organizations values($1)", [org]);
  await db.query("insert into auth.users values($1,now());", [user]);
  await db.query("insert into user_profiles values($1,'active')", [user]);
  await db.query(
    "insert into team_memberships values($1,$2,'active','owner')",
    [user, org],
  );
  await db.query(
    "insert into games(id,organization_id,status,config) values($1,$2,'active',$3)",
    [
      game,
      org,
      {
        eventName: "Test",
        homeName: "Home",
        awayName: "Away",
        scheduledEnds: 8,
      },
    ],
  );
  await db.query("insert into game_states(game_id,state) values($1,$2)", [
    game,
    { status: "active", scoreEvents: [event] },
  ]);
  await db.query(
    "insert into score_events(id,game_id,event_type,payload,actor) values($1,$2,'end',$3,'test')",
    [event.id, game, event],
  );
  await db.query(
    "select * from review_game_completion_with_link($1,$2,$3,false,null)",
    [game, review, user],
  );
  await db.query("select * from complete_reviewed_game($1,$2,$3,$4,false)", [
    game,
    review,
    completion,
    user,
  ]);
  await db.query(
    "update game_completion_cleanup set status='complete',completed_at=now() where game_id=$1",
    [game],
  );
  let revision = await rev(game);
  if (corrected) {
    await db.query("select correct_completed_game_result($1,$2,$3,$4,$5,$6)", [
      game,
      user,
      id(n + 6),
      revision,
      [{ end: 1, team: "away", points: 3, blank: false }],
      "Score correction",
    ]);
    revision = await rev(game);
  }
  return { game, user, review, completion, revision, request: id(n + 7) };
}
async function rev(game: string) {
  return (
    await db.query<{ revision: number }>(
      "select revision from game_result_revisions where game_id=$1",
      [game],
    )
  ).rows[0].revision;
}
const reopen = (
  f: Awaited<ReturnType<typeof fixture>>,
  user = f.user,
  revision = f.revision,
) =>
  db.query("select reopen_completed_game($1,$2,$3,$4) result", [
    f.game,
    user,
    f.request,
    revision,
  ]);
it("reopens, keeps corrections and immutable history, retries safely, and can complete again", async () => {
  const f = await fixture(100, true);
  const before = (
    await db.query("select * from game_completion_history where game_id=$1", [
      f.game,
    ])
  ).rows;
  await reopen(f);
  await reopen(f);
  expect(
    (
      await db.query("select * from game_completions where game_id=$1", [
        f.game,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query("select * from game_completion_history where game_id=$1", [
        f.game,
      ])
    ).rows,
  ).toEqual(before);
  const result = (
    await db.query<{ result: any }>(
      "select derive_game_completion_result($1) result",
      [f.game],
    )
  ).rows[0].result;
  expect(result.totals).toEqual({ home: 0, away: 3 });
  expect(
    (await db.query("select * from score_events where game_id=$1", [f.game]))
      .rows,
  ).toHaveLength(3);
  await expect(
    db.query("select * from complete_reviewed_game($1,$2,$3,$4,false)", [
      f.game,
      f.review,
      id(110),
      f.user,
    ]),
  ).rejects.toThrow(/completion_review_conflict/);
  const nextEvent = {
    id: id(113),
    type: "end",
    at: 2,
    score: { end: 2, team: "home", points: 2, blank: false },
  };
  await db.query(
    "insert into score_events(id,game_id,event_type,payload,actor) values($1,$2,'end',$3,'test')",
    [nextEvent.id, f.game, nextEvent],
  );
  await db.query(
    "update game_states set state=jsonb_set(state,'{scoreEvents}',(state->'scoreEvents')||$2::jsonb) where game_id=$1",
    [f.game, [nextEvent]],
  );
  await db.query(
    "select * from review_game_completion_with_link($1,$2,$3,false,null)",
    [f.game, id(111), f.user],
  );
  await db.query("select * from complete_reviewed_game($1,$2,$3,$4,false)", [
    f.game,
    id(111),
    id(112),
    f.user,
  ]);
  expect(
    (
      await db.query("select * from game_completion_history where game_id=$1", [
        f.game,
      ])
    ).rows,
  ).toHaveLength(2);
  expect(
    (
      await db.query<{ result: { totals: unknown } }>(
        "select current_game_completion_result($1) result",
        [f.game],
      )
    ).rows[0].result.totals,
  ).toEqual({ home: 2, away: 3 });
  await expect(reopen(f)).rejects.toThrow(/reopen_request_conflict/);
  await expect(
    db.query(
      "update game_completion_history set result='{}' where game_id=$1",
      [f.game],
    ),
  ).rejects.toThrow(/immutable/);
  await expect(
    db.query(
      "update games set status='active',completed_at=null,completion_id=null where id=$1",
      [f.game],
    ),
  ).rejects.toThrow(/terminal/);
}, 30000);
it("rejects unauthorized, stale and closing requests without changing the game", async () => {
  const f = await fixture(200);
  await expect(reopen(f, id(999))).rejects.toThrow(/administrator/);
  await expect(reopen(f, f.user, 0)).rejects.toThrow(/revision_conflict/);
  await db.query(
    "update game_completion_cleanup set status='pending',completed_at=null where game_id=$1",
    [f.game],
  );
  await expect(reopen(f)).rejects.toThrow(/still_closing/);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from games where id=$1",
        [f.game],
      )
    ).rows[0].status,
  ).toBe("completed");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(reopen(f)).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
}, 30000);
