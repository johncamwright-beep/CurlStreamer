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
  await db.exec(source("0097_close_game_final_score"));
  await db.exec(source("0102_review_game_completion_with_scoreboard"));
}, 30000);
afterAll(() => db.close());
async function activeFixture(n: number, scored = true) {
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
    { status: "active", scoreEvents: scored ? [event] : [] },
  ]);
  if (scored)
    await db.query(
      "insert into score_events(id,game_id,event_type,payload,actor) values($1,$2,'end',$3,'test')",
      [event.id, game, event],
    );
  return { game, user, review, completion, event, request: id(n + 7) };
}

async function fixture(n: number, corrected = false) {
  const f = await activeFixture(n);
  const { game, user, review, completion } = f;
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
  return { ...f, revision };
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

const selectFinalScore = (
  f: Awaited<ReturnType<typeof activeFixture>>,
  selection: unknown,
  user = f.user,
) =>
  db.query(
    "select * from review_game_completion_with_final_score($1,$2,$3,false,null,$4)",
    [f.game, f.review, user, selection],
  );

it.each([true, false])(
  "reviews and publishes scoreboard totals (scored: %s)",
  async (scored) => {
    const { game, user, review, completion, event } = await activeFixture(
      scored ? 710 : 720,
      scored,
    );
    const expected = {
      outcome: scored ? "home_win" : "tie",
      totals: { home: scored ? 1 : 0, away: 0 },
      ends: scored ? [event.score] : [],
    };
    const reviewed = await db.query(
      "select * from review_game_completion_with_scoreboard($1,$2,$3,false,null)",
      [game, review, user],
    );
    expect(reviewed.rows[0]).toMatchObject({ result: expected });
    const completed = await db.query(
      "select * from complete_reviewed_game($1,$2,$3,$4,false)",
      [game, review, completion, user],
    );
    expect(completed.rows[0]).toMatchObject({ result: expected });
  },
);

it.each([
  { n: 500, finalScore: null, outcome: "no_result" },
  { n: 510, finalScore: { home: 0, away: 0 }, outcome: "tie" },
  { n: 520, finalScore: { home: 1, away: 4 }, outcome: "away_win" },
])(
  "publishes $outcome with recorded ends and keeps those ends on reopen",
  async ({ n, finalScore, outcome }) => {
    const f = await activeFixture(n);
    const { game, user, review, completion, event } = f;
    const expected = { outcome, totals: finalScore, ends: [event.score] };
    const reviewed = await selectFinalScore(f, { finalScore });
    expect(reviewed.rows[0]).toMatchObject({ result: expected });

    const complete = (completionId: string) =>
      db.query("select * from complete_reviewed_game($1,$2,$3,$4,false)", [
        game,
        review,
        completionId,
        user,
      ]);
    expect((await complete(completion)).rows[0]).toMatchObject({
      completion_id: completion,
      result: expected,
    });
    expect((await complete(id(n + 8))).rows[0]).toMatchObject({
      completion_id: completion,
      result: expected,
    });
    expect(
      (
        await db.query("select current_game_completion_result($1) result", [
          game,
        ])
      ).rows[0],
    ).toMatchObject({ result: expected });
    expect(
      (
        await db.query("select read_game_completion_summary($1) summary", [
          game,
        ])
      ).rows[0],
    ).toMatchObject({ summary: { result: expected } });
    expect(
      (
        await db.query(
          "select result,final_result from game_completion_reviews where id=$1",
          [review],
        )
      ).rows[0],
    ).toMatchObject({
      result: {
        outcome: "home_win",
        totals: { home: 1, away: 0 },
        ends: [event.score],
      },
      final_result: expected,
    });
    expect(
      (
        await db.query(
          "select metadata from audit_events where action='game.completed' and subject_identifier=$1",
          [game],
        )
      ).rows,
    ).toMatchObject([{ metadata: { outcome } }]);

    await db.query(
      "update game_completion_cleanup set status='complete',completed_at=now() where game_id=$1",
      [game],
    );
    await reopen({ ...f, revision: await rev(game) });
    expect(
      (
        await db.query(
          "select state->'scoreEvents' events from game_states where game_id=$1",
          [game],
        )
      ).rows[0],
    ).toEqual({ events: [event] });
    expect(
      (
        await db.query("select payload from score_events where game_id=$1", [
          game,
        ])
      ).rows,
    ).toEqual([{ payload: event }]);
    expect(
      (
        await db.query(
          "select result from game_completion_history where completion_id=$1",
          [completion],
        )
      ).rows[0],
    ).toMatchObject({ result: expected });
  },
);

it("applies the same authorization, score validation and stale review guard to explicit final scores", async () => {
  const f = await activeFixture(530);
  const { game, user, review, completion } = f;
  const signature =
    "public.review_game_completion_with_final_score(uuid,uuid,uuid,boolean,text,jsonb)";
  expect(
    (
      await db.query(
        "select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') authenticated, has_function_privilege('service_role',$1,'EXECUTE') service",
        [signature],
      )
    ).rows[0],
  ).toEqual({ anon: false, authenticated: false, service: true });
  await expect(
    selectFinalScore(f, { finalScore: null }, id(599)),
  ).rejects.toMatchObject({ code: "42501" });
  for (const invalid of [
    "null",
    {},
    { finalScore: { home: 1 } },
    { finalScore: { home: 0, away: 1.5 } },
    { finalScore: { home: 0, away: Number.MAX_SAFE_INTEGER + 1 } },
  ]) {
    await expect(selectFinalScore(f, invalid)).rejects.toMatchObject({
      code: "22023",
    });
  }
  await selectFinalScore(f, { finalScore: { home: 4, away: 2 } });
  const end = {
    id: id(539),
    type: "end",
    at: 2,
    score: { end: 2, team: "away", points: 1, blank: false },
  };
  await db.query(
    "insert into score_events(id,game_id,event_type,payload,actor) values($1,$2,'end',$3,'test')",
    [end.id, game, end],
  );
  await expect(
    db.query("select * from complete_reviewed_game($1,$2,$3,$4,false)", [
      game,
      review,
      completion,
      user,
    ]),
  ).rejects.toMatchObject({ code: "PT409" });
});
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
