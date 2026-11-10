import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const coach = "20000000-0000-4000-8000-000000000001";
const teammate = "20000000-0000-4000-8000-000000000002";
const game = "30000000-0000-4000-8000-000000000001";
const otherGame = "30000000-0000-4000-8000-000000000002";
const deletedGame = "30000000-0000-4000-8000-000000000003";
const migration = (file: string) =>
  readFileSync(`supabase/migrations/${file}.sql`, "utf8");

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
    create table organizations (id uuid primary key);
    create table games (id uuid primary key, organization_id uuid, deleted_at timestamptz);
    create table user_profiles (user_id uuid, status text);
    create table team_memberships (user_id uuid, organization_id uuid, status text);
    create table curlcoach_coach_access (organization_id uuid, user_id uuid, expires_at timestamptz);
    create table broadcast_sessions (
      game_id uuid, organization_id uuid, provider text, youtube_broadcast_id text,
      started_at timestamptz, stopped_at timestamptz, session_key uuid default gen_random_uuid(),
      transport text default 'local-obs', operation_generation bigint default 1,
      youtube_stream_id text default 'stream-1', status text default 'prepared', desired_state text default 'live'
    );
    create function effective_curlcoach_seats(uuid) returns integer language sql as 'select 1';
    insert into auth.users values ('${coach}', now()), ('${teammate}', now());
    insert into organizations values ('${org}'), ('${otherOrg}');
    insert into games values
      ('${game}', '${org}', null), ('${otherGame}', '${otherOrg}', null),
      ('${deletedGame}', '${org}', now());
    insert into user_profiles values ('${coach}', 'active'), ('${teammate}', 'active');
    insert into team_memberships values
      ('${coach}', '${org}', 'active'), ('${teammate}', '${org}', 'active');
    insert into curlcoach_coach_access values ('${org}', '${coach}', null);
    insert into broadcast_sessions (game_id, organization_id, provider, youtube_broadcast_id, started_at, stopped_at) values
      ('${game}', '${org}', 'youtube', 'currentvid1', '2026-11-10 15:00Z', null),
      ('${otherGame}', '${otherOrg}', 'youtube', 'othervideo1', null, null),
      ('${deletedGame}', '${org}', 'youtube', 'deletedvid1', null, null);
  `);
  const access = migration("0060_setup_trial_and_paid_access");
  const assertion = access.indexOf(
    "create or replace function public.assert_curlcoach_actor(",
  );
  await db.exec(access.slice(assertion, access.indexOf("$$;", assertion) + 3));
  await db.exec(
    migration("0029_add_m4_provider_retirement").split(
      "alter table public.m4_output_intents",
    )[0],
  );
  await db.exec(
    migration("0030_add_m4_replacement_cycle").split(
      "create function public.m4_intent_is_retired",
    )[0],
  );
  await db.exec(migration("0033_record_m4_live_evidence"));
  await db.exec(migration("0085_shot_review_recordings"));
  await db.exec(migration("0098_shot_review_recording_history"));
  await db.exec(migration("0099_youtube_recording_start_anchor"));
  await db.exec(`
    insert into m4_provider_retirements (
      game_id, organization_id, broadcast_generation, operation_token,
      youtube_broadcast_id, youtube_channel_id, confirmed_at
    ) values ('${game}', '${org}', 1, gen_random_uuid(), 'previousvi1', 'private-channel', '2026-11-10 14:05Z');
    insert into m4_broadcast_cycle_history (game_id, organization_id, session_key, retirement_id, metadata)
      select '${game}', '${org}', gen_random_uuid(), retirement_id,
        '{"provider":"youtube", "youtube_broadcast_id":"previousvi1", "started_at":"2026-11-10 13:00Z", "stopped_at":"2026-11-10 14:00Z", "operation_token":"private"}'
      from m4_provider_retirements;
    insert into m4_broadcast_cycle_history (game_id, organization_id, session_key, metadata)
      values ('${game}', '${org}', gen_random_uuid(), '{"provider":"youtube", "youtube_broadcast_id":"unretiredv1"}');
    insert into m4_broadcast_cycle_history (game_id, organization_id, session_key, retirement_id, metadata)
      select '${game}', '${org}', gen_random_uuid(), retirement_id,
        '{"provider":"youtube", "youtube_broadcast_id":"mismatchvi1"}'
      from m4_provider_retirements;
  `);
});

afterAll(() => db.close());

const read = (actor = coach, games = [game], organizationId = org) =>
  db.query("select * from read_shot_tracker_recording_history($1, $2, $3)", [
    actor,
    organizationId,
    games,
  ]);

it("exposes scoped current and provider-retired video metadata and preserves the current-only RPC", async () => {
  await db.exec("set role service_role");
  try {
    expect((await read()).rows).toEqual(
      expect.arrayContaining([
        {
          game_id: game,
          youtube_broadcast_id: "currentvid1",
          started_at: new Date("2026-11-10T15:00:00Z"),
          stopped_at: null,
          is_current: true,
        },
        {
          game_id: game,
          youtube_broadcast_id: "previousvi1",
          started_at: new Date("2026-11-10T13:00:00Z"),
          stopped_at: new Date("2026-11-10T14:00:00Z"),
          is_current: false,
        },
      ]),
    );
    expect((await read()).rows).toHaveLength(2);
    expect(
      (
        await db.query(
          "select youtube_broadcast_id from read_shot_tracker_recordings($1, $2, $3)",
          [coach, org, [game]],
        )
      ).rows,
    ).toEqual([{ youtube_broadcast_id: "currentvid1" }]);
    await expect(
      db.query("select * from m4_broadcast_cycle_history"),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.exec("reset role");
  }
});

it("rejects browser callers, unlicensed teammates and mixed-organization game requests", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(read()).rejects.toThrow("permission denied");
      await expect(
        db.query(
          "select record_m4_live_evidence($1, 1, 'currentvid1', 'stream-1', now())",
          [game],
        ),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  }
  await db.exec("set role service_role");
  try {
    await expect(read(teammate)).rejects.toThrow(
      "explicit curlcoach access required",
    );
    await expect(read(coach, [game, otherGame])).rejects.toThrow(
      "game unavailable",
    );
    await expect(read(coach, [otherGame], otherOrg)).rejects.toThrow(
      "active team account required",
    );
    expect((await read(coach, [deletedGame])).rows).toEqual([]);
    expect((await read(coach, [])).rows).toEqual([]);
  } finally {
    await db.exec("reset role");
  }
});

it("accepts a first valid provider start after a legacy live observation and preserves both timestamps", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "update broadcast_sessions set started_at = null where game_id = $1",
      [game],
    );
    await db.exec("set local role service_role");
    await db.query(
      "select record_m4_live_evidence($1, 1, 'currentvid1', 'stream-1')",
      [game],
    );
    expect((await read()).rows).toContainEqual(
      expect.objectContaining({
        is_current: true,
        started_at: expect.any(Date),
      }),
    );

    await db.exec("reset role");
    await db.query(
      "update broadcast_sessions set started_at = '2024-11-10 15:00Z' where game_id = $1",
      [game],
    );
    await db.exec("set local role service_role");
    for (const [generation, video, stream, start] of [
      [2, "currentvid1", "stream-1", "2024-11-10 14:59:50Z"],
      [1, "previousvi1", "stream-1", "2024-11-10 14:59:50Z"],
      [1, "currentvid1", "stale", "2024-11-10 14:59:50Z"],
      [1, "currentvid1", "stream-1", "infinity"],
      [1, "currentvid1", "stream-1", "2024-11-10 15:00:01Z"],
    ]) {
      await db.query("select record_m4_live_evidence($1, $2, $3, $4, $5)", [
        game,
        generation,
        video,
        stream,
        start,
      ]);
    }
    expect((await read()).rows).toContainEqual(
      expect.objectContaining({
        is_current: true,
        started_at: new Date("2024-11-10T15:00:00Z"),
      }),
    );

    for (const start of ["2024-11-10 14:59:50Z", "2024-11-10 14:59:49Z"]) {
      await db.query(
        "select record_m4_live_evidence($1, 1, 'currentvid1', 'stream-1', $2)",
        [game, start],
      );
    }
    expect((await read()).rows).toContainEqual(
      expect.objectContaining({
        is_current: true,
        started_at: new Date("2024-11-10T14:59:50Z"),
      }),
    );
    await db.exec("reset role");
    expect(
      (
        await db.query(
          "select started_at, youtube_actual_started_at from broadcast_sessions where game_id = $1",
          [game],
        )
      ).rows,
    ).toEqual([
      {
        started_at: new Date("2024-11-10T15:00:00Z"),
        youtube_actual_started_at: new Date("2024-11-10T14:59:50Z"),
      },
    ]);
  } finally {
    await db.exec("rollback");
  }
});

it("archives the effective start with its retired video and clears it for the replacement", async () => {
  await db.exec("begin");
  try {
    await db.query(
      `
      update broadcast_sessions set started_at = '2024-11-10 15:00Z', stopped_at = '2024-11-10 16:00Z'
      where game_id = $1`,
      [game],
    );
    await db.exec("set local role service_role");
    await db.query(
      `select record_m4_live_evidence($1, 1, 'currentvid1', 'stream-1', '2024-11-10 14:59:50Z')`,
      [game],
    );
    await db.exec("reset role");
    await db.query(
      "update broadcast_sessions set operation_generation = 2 where game_id = $1",
      [game],
    );
    expect((await read()).rows).toContainEqual(
      expect.objectContaining({
        is_current: true,
        started_at: new Date("2024-11-10T14:59:50Z"),
      }),
    );

    // The replacement operation archives to_jsonb of the old row before it reuses the row.
    await db.exec(`
      insert into m4_provider_retirements (game_id, organization_id, broadcast_generation,
        operation_token, youtube_broadcast_id, youtube_channel_id, confirmed_at)
      values ('${game}', '${org}', 2, gen_random_uuid(), 'currentvid1', 'private-channel', '2024-11-10 16:00Z');
      insert into m4_broadcast_cycle_history (game_id, organization_id, session_key, retirement_id, metadata)
      select b.game_id, b.organization_id, b.session_key, r.retirement_id, to_jsonb(b)
      from broadcast_sessions b join m4_provider_retirements r on r.game_id = b.game_id
        and r.youtube_broadcast_id = b.youtube_broadcast_id
      where b.game_id = '${game}';
      update broadcast_sessions set session_key = gen_random_uuid(), operation_generation = 3,
        youtube_broadcast_id = 'nextcycle01', started_at = null, stopped_at = null where game_id = '${game}';
    `);
    await db.exec("set local role service_role");
    expect((await read()).rows).toEqual(
      expect.arrayContaining([
        {
          game_id: game,
          youtube_broadcast_id: "nextcycle01",
          started_at: null,
          stopped_at: null,
          is_current: true,
        },
        {
          game_id: game,
          youtube_broadcast_id: "currentvid1",
          started_at: new Date("2024-11-10T14:59:50Z"),
          stopped_at: new Date("2024-11-10T16:00:00Z"),
          is_current: false,
        },
      ]),
    );
  } finally {
    await db.exec("rollback");
  }
});
