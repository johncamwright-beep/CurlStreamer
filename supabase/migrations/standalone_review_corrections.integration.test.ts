import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const org = "11111111-1111-4111-8111-111111111111";
const coach = "22222222-2222-4222-8222-222222222222";
const game = "33333333-3333-4333-8333-333333333333";
const review = "44444444-4444-4444-8444-444444444444";
const otherCoach = "55555555-5555-4555-8555-555555555555";
const otherGame = "66666666-6666-4666-8666-666666666666";
const request = "77777777-7777-4777-8777-777777777777";
const secondRequest = "88888888-8888-4888-8888-888888888888";
const shot = "99999999-9999-4999-8999-999999999999";
const shotRequest = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const recording = "https://www.youtube.com/watch?v=EarlierFilm";

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table organizations(id uuid primary key);
    create table games(id uuid primary key, deleted_at timestamptz);
    create table curlcoach_sessions(
      organization_id uuid, actor_user_id uuid, game_id uuid, state jsonb
    );
    insert into auth.users values ('${coach}'), ('${otherCoach}');
    insert into organizations values ('${org}');
    insert into games values ('${game}', null), ('${otherGame}', null);
    insert into curlcoach_sessions values (
      '${org}', '${coach}', '${game}',
      '{"events":[{"shotId":"${shot}","shot":{"flagged":true}}]}'
    );
    create function assert_curlcoach_actor(uuid, uuid, uuid) returns void
    language plpgsql as $$begin
      if $1 not in ('${coach}', '${otherCoach}') or $2 <> '${org}' or
         $3 not in ('${game}', '${otherGame}') then
        raise exception 'denied';
      end if;
    end;$$;
    create function reject_curlcoach_command_mutation() returns trigger
    language plpgsql as $$begin raise exception 'immutable'; end;$$;
  `);
  for (const migration of [
    "0084_shot_review_corrections",
    "0095_standalone_reviews",
    "0100_standalone_review_corrections",
  ]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
  }
  await db.query(
    "select save_standalone_review($1,$2,$3,$4,'team',null,null,'Original','2026-11-10T15:00:00Z')",
    [coach, org, game, review],
  );
});
afterAll(() => db.close());

const save = ({
  actor = coach,
  gameId = game,
  requestId = request,
  start = 132,
  note = "Watch the release",
} = {}) =>
  db.query(
    "select save_standalone_review_correction($1,$2,$3,$4,$5,$6,$7,$8)",
    [actor, org, gameId, review, requestId, recording, start, note],
  );

const read = (actor = coach, gameId = game) =>
  db.query(
    "select * from read_standalone_review_corrections($1,$2,$3::uuid[])",
    [actor, org, [gameId]],
  );

it("keeps a retry idempotent and returns only the latest correction", async () => {
  await save();
  await save({ requestId: secondRequest, start: 142, note: "New timing" });
  await save();
  expect((await read()).rows).toEqual([
    {
      review_id: review,
      video_url: recording,
      start_seconds: 142,
      note: "New timing",
    },
  ]);
  expect(
    (
      await db.query(
        "select * from shot_tracker_review_corrections where standalone_review_id is not null",
      )
    ).rows,
  ).toHaveLength(2);
  expect(
    (await db.query("select note from shot_tracker_standalone_reviews")).rows,
  ).toEqual([{ note: "Original" }]);
  await expect(save({ start: 133 })).rejects.toThrow("request conflict");
  await expect(
    db.exec("update shot_tracker_review_corrections set note = 'Changed'"),
  ).rejects.toThrow("immutable");
});

it("preserves existing shot correction writes alongside standalone corrections", async () => {
  await db.query(
    "select save_shot_tracker_review_correction($1,$2,$3,$4,$5,$6,40,'Charted shot')",
    [coach, org, game, shot, shotRequest, recording],
  );
  expect(
    (
      await db.query(
        "select shot_id, standalone_review_id from shot_tracker_review_corrections where request_id = $1",
        [shotRequest],
      )
    ).rows,
  ).toEqual([{ shot_id: shot, standalone_review_id: null }]);
  expect((await read()).rows).not.toContainEqual(
    expect.objectContaining({ note: "Charted shot" }),
  );
});

it("denies a different coach or game and reserves the RPC for the server", async () => {
  await expect(save({ actor: otherCoach })).rejects.toThrow(
    "review unavailable",
  );
  await expect(save({ gameId: otherGame })).rejects.toThrow(
    "review unavailable",
  );
  expect((await read(otherCoach)).rows).toEqual([]);
  expect((await read(coach, otherGame)).rows).toEqual([]);
  expect(
    (
      await db.query(`select
        has_function_privilege('authenticated', 'read_standalone_review_corrections(uuid,uuid,uuid[])', 'EXECUTE') as read,
        has_function_privilege('authenticated', 'save_standalone_review_correction(uuid,uuid,uuid,uuid,uuid,text,integer,text)', 'EXECUTE') as write`)
    ).rows,
  ).toEqual([{ read: false, write: false }]);
});
