import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite({ extensions: { pgcrypto } });
const directory = "supabase/migrations";
const org = randomUUID();
const owner = randomUUID();
const stranger = randomUUID();
const game = randomUUID();
const video = "oldvideo123";
const stream = "oldstream123";
const channel = "channel-1";
const watchUrl = `https://www.youtube.com/watch?v=${video}`;
const encrypted = Buffer.from("opaque").toString("base64");

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb, created_at timestamptz
    );
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create function auth.role() returns text language sql as 'select null::text';
    create function auth.jwt() returns jsonb language sql as 'select null::jsonb';
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean, file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (id uuid, bucket_id text, name text, owner uuid);
    create function storage.foldername(text) returns text[] language sql
      as 'select string_to_array($1, ''/'')';
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema realtime;
    create table realtime.messages (topic text, extension text);
    create function realtime.topic() returns text language sql as 'select null::text';
    create publication supabase_realtime;
  `);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`${directory}/${name}`, "utf8"));
  await db.exec(`
    insert into organizations (id,name) values ('${org}','Studio team');
    insert into auth.users (id,email,email_confirmed_at) values
      ('${owner}','${owner}@example.test',now()), ('${stranger}','${stranger}@example.test',now());
    insert into user_profiles (user_id,display_name,status) values ('${owner}','Operator','active');
    insert into team_memberships (organization_id,user_id,role,status)
      values ('${org}','${owner}','owner','active');
    insert into team_access (organization_id,paid_expires_at)
      values ('${org}',now()+interval '1 day')
      on conflict (organization_id) do update set paid_expires_at=excluded.paid_expires_at;
    insert into games (id,organization_id,config,status,created_by) values
      ('${game}','${org}','{"youtubeVisibility":"public","youtubeTitle":"Game 1"}','active','${owner}');
    insert into game_states (game_id,state) values ('${game}','{"status":"active"}');
    insert into broadcast_settings (
      organization_id,provider,encrypted_credentials,channel_id,channel_title,connection_status,connection_version
    ) values ('${org}','youtube','opaque','${channel}','Team channel','connected',1);
  `);
}, 20_000);
afterAll(() => db.close());

function claimRestart(
  generation: number,
  options: {
    credentials?: string;
    actor?: string;
    broadcastId?: string;
    token?: string;
  } = {},
) {
  return db.query<{ claim: Record<string, unknown> }>(
    "select claim_m4_broadcast_restart($1,$2,false,$3,$4,$5,$6,$7) as claim",
    [
      game,
      options.actor ?? owner,
      generation,
      options.broadcastId ?? video,
      options.token ?? randomUUID(),
      options.credentials ? 1 : null,
      options.credentials ?? null,
    ],
  );
}

it("requires exact retirement and archives the old recording under the same game", async () => {
  const prepareToken = randomUUID();
  await db.exec(`
    set role service_role;
    select claim_m4_broadcast_operation('${game}','${owner}',false,'prepared','${prepareToken}');
    select record_m4_broadcast_operation('${game}',1,'${prepareToken}','prepared',
      p_youtube_broadcast_id=>'${video}',p_youtube_stream_id=>'${stream}',p_watch_url=>'${watchUrl}',
      p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready');
    select record_m4_live_evidence('${game}',1,'${video}','${stream}','2026-11-01T12:00:00Z');
  `);
  await expect(claimRestart(1)).rejects.toMatchObject({ code: "55000" });
  await expect(
    claimRestart(1, { actor: stranger, credentials: encrypted }),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    claimRestart(1, { broadcastId: "different123", credentials: encrypted }),
  ).rejects.toMatchObject({ code: "55000" });
  await expect(
    claimRestart(1, { credentials: "wrong-version-canary" }),
  ).rejects.toMatchObject({ code: "55000" });
  await db.exec("set role authenticated");
  await expect(
    claimRestart(1, { credentials: encrypted }),
  ).rejects.toMatchObject({ code: "42501" });
  await db.exec("set role service_role");

  const token = randomUUID();
  expect(
    (await claimRestart(1, { credentials: encrypted, token })).rows[0].claim,
  ).toMatchObject({ generation: 2, status: "stopping", watchUrl });
  await expect(
    claimRestart(2, { credentials: encrypted }),
  ).rejects.toMatchObject({ code: "55000" });
  await db.query(
    "select confirm_m4_provider_retirement($1,$2,false,2,$3,$4,$5,$6,1,$7)",
    [game, owner, token, video, stream, channel, encrypted],
  );
  const replacement = await claimRestart(2);
  expect(replacement.rows[0].claim).toMatchObject({
    gameId: game,
    generation: 3,
    status: "preparing",
    visibility: "public",
  });
  expect(replacement.rows[0].claim).not.toHaveProperty("watchUrl");
  await expect(claimRestart(2)).rejects.toMatchObject({ code: "55000" });
  await db.exec("reset role");
  expect(
    (
      await db.query(
        `
    select h.metadata->>'watch_url' as watch_url, (h.metadata->>'youtube_actual_started_at')::timestamptz as started_at,
      r.youtube_broadcast_id from m4_broadcast_cycle_history h
    join m4_provider_retirements r on r.retirement_id=h.retirement_id where h.game_id=$1
  `,
        [game],
      )
    ).rows,
  ).toEqual([
    {
      watch_url: watchUrl,
      started_at: new Date("2026-11-01T12:00:00Z"),
      youtube_broadcast_id: video,
    },
  ]);
  expect(
    (
      await db.query(
        "select youtube_actual_started_at from broadcast_sessions where game_id=$1",
        [game],
      )
    ).rows,
  ).toEqual([{ youtube_actual_started_at: null }]);

  await db.exec(`
    insert into team_public_profiles (organization_id,slug,settings)
      values ('${org}','team-${org}','{"published":true,"upcoming":true}');
    update games set scheduled_start=now()+interval '1 hour',youtube_scheduled_status='ready',
      youtube_scheduled_broadcast_id='${video}',youtube_scheduled_watch_url='${watchUrl}'
    where id='${game}';
    set role service_role;
  `);
  const publicLink = async () =>
    (
      await db.query<{ youtube: string | null }>(
        "select read_public_team_games($1)->0->>'youtube' as youtube",
        [org],
      )
    ).rows[0].youtube;
  expect(await publicLink()).toBe(watchUrl);
  const newWatchUrl = "https://www.youtube.com/watch?v=newvideo123";
  await db.query(
    `
    select record_m4_broadcast_operation($1,3,$2,'prepared',
      p_youtube_broadcast_id=>'newvideo123',p_youtube_stream_id=>'newstream123',p_watch_url=>$3,
      p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready')
  `,
    [game, replacement.rows[0].claim.operationToken, newWatchUrl],
  );
  expect(await publicLink()).toBe(newWatchUrl);

  await db.exec(`
    reset role;
    update games set config=config || '{"youtubeVisibility":"private"}' where id='${game}';
    set role service_role;
  `);
  expect(await publicLink()).toBeNull();
  await db.exec(`
    reset role;
    update games set status='closed' where id='${game}';
    set role service_role;
  `);
  await expect(
    claimRestart(3, { broadcastId: "newvideo123", credentials: encrypted }),
  ).rejects.toMatchObject({ code: "55000" });
  await db.exec("reset role");
});

it("accepts idempotent native pauses only for the authorized delivered intent", async () => {
  const pauseGame = randomUUID();
  const session = randomUUID();
  const intent = randomUUID();
  const bearerHash = "a".repeat(64);
  const start = Date.now() - 30 * 60_000;
  const at = (seconds: number) =>
    new Date(start + seconds * 1000).toISOString();
  const pauseId = randomUUID();
  const openPauseId = randomUUID();
  await db.exec(`
    insert into games (id,organization_id,config,status,created_by) values
      ('${pauseGame}','${org}','{"youtubeVisibility":"unlisted","youtubeTitle":"Pause game"}','active','${owner}');
    insert into game_states (game_id,state) values ('${pauseGame}','{"status":"active"}');
    insert into curlcoach_module_entitlements (organization_id,seat_count) values ('${org}',1);
    insert into curlcoach_coach_access (organization_id,user_id) values ('${org}','${owner}');
    insert into broadcast_sessions (game_id,organization_id,provider,status,desired_state,transport,
      operation_generation,youtube_broadcast_id,youtube_stream_id,youtube_channel_id,
      youtube_broadcast_create_state,youtube_stream_create_state,started_at)
      values ('${pauseGame}','${org}','youtube','prepared','live','local-obs',
        1,'${video}','${stream}','${channel}','ready','ready','${at(0)}');
    insert into m4_desktop_sessions (session_id,game_id,organization_id,generation,status,
      code_hash,challenge_hash,bearer_hash,approved_by,expires_at,lease_expires_at)
      values ('${session}','${pauseGame}','${org}',1,'active',repeat('b',64),repeat('c',64),
        '${bearerHash}','${owner}',now()+interval '1 hour',now()+interval '5 minutes');
    insert into m4_output_intents (intent_id,game_id,organization_id,session_id,
      generation,broadcast_generation,youtube_broadcast_id,youtube_stream_id,phase,
      delivery_recorded_at,delivery_channel_id,delivery_connection_version)
      values ('${intent}','${pauseGame}','${org}','${session}',1,1,'${video}',
        '${stream}','quarantined','${at(0)}','${channel}',1);
  `);
  const recordPause = (
    id: string,
    stoppedAt: string,
    resumedAt: string | null,
    options: { intentId?: string; bearer?: string } = {},
  ) =>
    db.query("select record_m4_output_pause($1,$2,1,$3,$4,$5,$6,$7)", [
      pauseGame,
      session,
      options.bearer ?? bearerHash,
      options.intentId ?? intent,
      id,
      stoppedAt,
      resumedAt,
    ]);
  const gaps = async () => {
    const { rows } = await db.query<{
      delivery_gaps: { stopped_at: string; resumed_at: string | null }[];
    }>(
      "select delivery_gaps from read_shot_tracker_recording_history_v2($1,$2,$3)",
      [owner, org, [pauseGame]],
    );
    return rows[0].delivery_gaps.map(({ stopped_at, resumed_at }) => [
      new Date(stopped_at).toISOString(),
      resumed_at ? new Date(resumed_at).toISOString() : null,
    ]);
  };
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(recordPause(pauseId, at(100), null)).rejects.toMatchObject({
      code: "42501",
    });
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  try {
    await expect(
      db.query("select * from m4_output_pauses"),
    ).rejects.toMatchObject({
      code: "42501",
    });
    for (const options of [
      { bearer: "f".repeat(64) },
      { intentId: randomUUID() },
    ]) {
      await expect(
        recordPause(pauseId, at(100), null, options),
      ).rejects.toMatchObject({
        code: "42501",
      });
    }
    for (const [stop, resume] of [
      [at(-6), null],
      [at(100), at(100)],
      ["infinity", null],
      [at(1900), null],
    ]) {
      await expect(recordPause(pauseId, stop!, resume)).rejects.toMatchObject({
        code: "22023",
      });
    }
    await recordPause(pauseId, at(100), null);
    await recordPause(pauseId, at(100), null);
    await expect(recordPause(openPauseId, at(500), null)).rejects.toMatchObject(
      {
        code: "55000",
      },
    );
    expect(await gaps()).toEqual([[at(100), null]]);
    await recordPause(pauseId, at(100), at(200));
    await recordPause(pauseId, at(100), at(200));
    await recordPause(pauseId, at(100), null);
    await expect(recordPause(pauseId, at(100), at(300))).rejects.toMatchObject({
      code: "55000",
    });
    await expect(
      recordPause(randomUUID(), at(150), at(250)),
    ).rejects.toMatchObject({
      code: "55000",
    });
    await recordPause(openPauseId, at(500), null);
    expect(await gaps()).toEqual([
      [at(100), at(200)],
      [at(500), null],
    ]);
  } finally {
    await db.exec("reset role");
  }

  await db.exec(`
    update m4_desktop_sessions set status='stopped',revoked_at='${at(1300)}',
      lease_expires_at='${at(1390)}' where session_id='${session}';
    with desktop as (
      insert into m4_desktop_sessions (game_id,organization_id,generation,status,
        code_hash,challenge_hash,expires_at,lease_expires_at)
        values ('${pauseGame}','${org}',2,'active',repeat('d',64),repeat('e',64),
          now()+interval '1 hour',now()+interval '5 minutes') returning session_id
    )
    insert into m4_output_intents (intent_id,game_id,organization_id,session_id,
      generation,broadcast_generation,youtube_broadcast_id,youtube_stream_id,phase,
      delivery_recorded_at,delivery_channel_id,delivery_connection_version)
      select gen_random_uuid(),'${pauseGame}','${org}',session_id,2,1,'${video}',
        '${stream}','quarantined','${at(1400)}','${channel}',1 from desktop;
    set role service_role;
  `);
  try {
    await expect(
      recordPause(openPauseId, at(500), at(1500)),
    ).rejects.toMatchObject({
      code: "42501",
    });
    expect(await gaps()).toEqual([
      [at(100), at(200)],
      [at(500), at(1400)],
      [at(1300), at(1400)],
    ]);
  } finally {
    await db.exec("reset role");
  }
});
