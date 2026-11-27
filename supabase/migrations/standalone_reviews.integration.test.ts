import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
const org = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  game = "33333333-3333-4333-8333-333333333333",
  id = "44444444-4444-4444-8444-444444444444";
const save = (note = "Review", who = actor) =>
  db.query(
    "select save_standalone_review($1,$2,$3,$4,'team',null,null,$5,'2026-11-10T15:00:00Z')",
    [who, org, game, id, note],
  );
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table organizations(id uuid primary key);create table games(id uuid primary key,deleted_at timestamptz);insert into auth.users values('${actor}');insert into organizations values('${org}');insert into games values('${game}',null);
 create function assert_curlcoach_actor(uuid,uuid,uuid) returns void language plpgsql as $$begin if $1<>'${actor}'::uuid or $2<>'${org}'::uuid or $3<>'${game}'::uuid then raise exception 'denied';end if;end;$$;
 create function reject_curlcoach_command_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end;$$;`);
  await db.exec(
    readFileSync("supabase/migrations/0095_standalone_reviews.sql", "utf8"),
  );
  await save();
  await db.exec(
    readFileSync(
      "supabase/migrations/0106_standalone_review_shot_context.sql",
      "utf8",
    ),
  );
});
afterAll(() => db.close());
it("saves without a shot/session, retries once, rejects identity/payload conflicts and immutable changes", async () => {
  await save();
  await save();
  expect(
    (
      await db.query(
        "select end_number, shot_number from shot_tracker_standalone_reviews where request_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ end_number: null, shot_number: null }]);
  await expect(save("Changed")).rejects.toThrow("request conflict");
  await expect(save("Review", id)).rejects.toThrow("denied");
  await expect(
    db.exec("update shot_tracker_standalone_reviews set note='changed'"),
  ).rejects.toThrow("immutable");
  await db.exec(`update games set deleted_at=now() where id='${game}'`);
  await expect(save()).rejects.toThrow("game unavailable");
  await db.exec(`update games set deleted_at=null where id='${game}'`);
});

it("stores the end and team shot number and compares them on retry", async () => {
  const request = "55555555-5555-4555-8555-555555555555";
  const saveContext = (end: number, shot: number | null, who = actor) =>
    db.query(
      "select save_standalone_review($1,$2,$3,$4,'team',null,null,'Review','2026-11-10T15:00:00Z',$5,$6)",
      [who, org, game, request, end, shot],
    );
  await expect(saveContext(4, null)).rejects.toThrow(
    "standalone_review_shot_context_check",
  );
  await expect(saveContext(4, 9)).rejects.toThrow(
    "standalone_review_shot_context_check",
  );
  await expect(saveContext(4, 7, id)).rejects.toThrow("denied");
  await saveContext(4, 7);
  await saveContext(4, 7);
  await expect(saveContext(4, 8)).rejects.toThrow("request conflict");
  expect(
    (
      await db.query(
        "select end_number, shot_number, selected_at from shot_tracker_standalone_reviews where request_id=$1",
        [request],
      )
    ).rows,
  ).toEqual([
    {
      end_number: 4,
      shot_number: 7,
      selected_at: new Date("2026-11-10T15:00:00Z"),
    },
  ]);
});
