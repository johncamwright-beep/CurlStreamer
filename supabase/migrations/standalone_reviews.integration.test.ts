import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
const org = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  game = "33333333-3333-4333-8333-333333333333",
  id = "44444444-4444-4444-8444-444444444444";
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table organizations(id uuid primary key);create table games(id uuid primary key,deleted_at timestamptz);insert into auth.users values('${actor}');insert into organizations values('${org}');insert into games values('${game}',null);
 create function assert_curlcoach_actor(uuid,uuid,uuid) returns void language plpgsql as $$begin if $1<>'${actor}'::uuid or $2<>'${org}'::uuid or $3<>'${game}'::uuid then raise exception 'denied';end if;end;$$;
 create function reject_curlcoach_command_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end;$$;`);
  await db.exec(
    readFileSync("supabase/migrations/0095_standalone_reviews.sql", "utf8"),
  );
});
afterAll(() => db.close());
const save = (note = "Review", who = actor) =>
  db.query(
    "select save_standalone_review($1,$2,$3,$4,'team',null,null,$5,'2026-11-10T15:00:00Z')",
    [who, org, game, id, note],
  );
it("saves without a shot/session, retries once, rejects identity/payload conflicts and immutable changes", async () => {
  await save();
  await save();
  expect(
    (await db.query("select * from shot_tracker_standalone_reviews")).rows,
  ).toHaveLength(1);
  await expect(save("Changed")).rejects.toThrow("request conflict");
  await expect(save("Review", id)).rejects.toThrow("denied");
  await expect(
    db.exec("update shot_tracker_standalone_reviews set note='changed'"),
  ).rejects.toThrow("immutable");
  await db.exec(`update games set deleted_at=now() where id='${game}'`);
  await expect(save()).rejects.toThrow("game unavailable");
});
