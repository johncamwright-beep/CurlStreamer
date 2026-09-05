import { randomUUID } from "node:crypto";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const safeDatabase = Boolean(
  parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(parsed.pathname),
);
const psqlAvailable =
  spawnSync("psql", ["--version"], { encoding: "utf8" }).status === 0;
const enabled = safeDatabase && psqlAvailable;
type SqlResult = { ok: boolean; stdout: string; stderr: string };

function postgresEnvironment(applicationName?: string) {
  if (!parsed) throw new Error("Disposable PostgreSQL is not configured");
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(applicationName ? { PGAPPNAME: applicationName } : {}),
  };
}

function psql(sql: string): SqlResult {
  const result = spawnSync(
    "psql",
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", env: postgresEnvironment() },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function psqlAsServiceRole(sql: string): SqlResult {
  return psql(`set role service_role; ${sql}`);
}

function psqlAsync(sql: string, applicationName: string) {
  return new Promise<SqlResult>((resolve) => {
    const child = spawn(
      "psql",
      [
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `set role service_role; ${sql}`,
      ],
      { env: postgresEnvironment(applicationName) },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (value) => (stdout += String(value)));
    child.stderr.on("data", (value) => (stderr += String(value)));
    child.on("close", (status) =>
      resolve({
        ok: status === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }),
    );
  });
}

/** Holds an interactive transaction after `sql` has run and its locks exist. */
function heldTransaction(
  sql: string,
  applicationName: string,
  asServiceRole = false,
) {
  const marker = `CURLCAST_READY_${randomUUID().replaceAll("-", "")}`;
  const child: ChildProcessWithoutNullStreams = spawn(
    "psql",
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { env: postgresEnvironment(applicationName) },
  );
  let stdout = "";
  let stderr = "";
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stdout.on("data", (value) => {
    stdout += String(value);
    if (!readySettled && stdout.includes(marker)) {
      readySettled = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (value) => (stderr += String(value)));
  const result = new Promise<SqlResult>((resolve) => {
    child.on("close", (status) => {
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error(stderr || "held PostgreSQL session exited"));
      }
      resolve({
        ok: status === 0,
        stdout: stdout.replace(marker, "").trim(),
        stderr: stderr.trim(),
      });
    });
  });
  child.stdin.write(
    `begin;\n${asServiceRole ? "set role service_role;\n" : ""}${sql}\n\\echo ${marker}\n`,
  );
  return {
    ready,
    result,
    release() {
      child.stdin.end("commit;\n\\q\n");
    },
  };
}

/** Uses observable PostgreSQL lock wait state rather than elapsed time. */
function waitUntilBlocked(applicationName: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const waiting = psql(`select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name='${applicationName}' and wait_event_type='Lock')`);
    if (waiting.ok && waiting.stdout === "t") return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`PostgreSQL session ${applicationName} did not block`);
}

function fixture(gameId: string, organizationId: string, creatorId: string) {
  const config = {
    eventName: "Completion integration",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#000000",
    awayColor: "#ffffff",
    scheduledEnds: 8,
    youtubeTitle: "Completion integration",
    youtubeVisibility: "unlisted",
  };
  const state = {
    id: gameId,
    config,
    createdAt: 1,
    scoreEvents: [],
    layout: "split",
    broadcast: "live",
    status: "active",
    audioMuted: false,
    connections: { "camera-home": true, "camera-away": true, scorer: true },
    cameraHealth: { "camera-home": { phase: "live", updatedAt: 1 } },
    claims: { "camera-home": "private-device", scorer: "private-scorer" },
    sponsors: [],
    sponsorMode: {
      active: true,
      style: "overlay",
      intervalSeconds: 4,
      startedAt: 1,
      rotationOffset: 0,
      paused: true,
      mutedPrevious: true,
      muteDuring: true,
    },
  };
  return `
    insert into public.organizations(id,name) values ('${organizationId}','Completion test');
    insert into public.organizer_users(organization_id,user_id) values ('${organizationId}','${creatorId}');
    insert into public.games(id,organization_id,config,status,created_by)
      values ('${gameId}','${organizationId}','${JSON.stringify(config)}'::jsonb,'active','${creatorId}');
    insert into public.game_states(game_id,state) values ('${gameId}','${JSON.stringify(state)}'::jsonb);
  `;
}

function account(
  userId: string,
  organizationId: string,
  options: {
    verified?: boolean;
    profile?: "active" | "suspended";
    role?: "owner" | "team_admin" | "scorer";
  } = {},
) {
  return `
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('${userId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      '${userId}@completion.test','',${options.verified === false ? "null" : "now()"},'{}','{}',now(),now());
    insert into public.user_profiles(user_id,display_name,status)
      values ('${userId}','Completion account','${options.profile ?? "active"}');
    insert into public.team_memberships(organization_id,user_id,role,status)
      values ('${organizationId}','${userId}','${options.role ?? "owner"}','active');
  `;
}

function scoreEvent(
  gameId: string,
  team: "home" | "away",
  points: number,
  end: number,
) {
  const id = randomUUID();
  const payload = {
    id,
    at: end,
    type: "end",
    score: { end, team, points, blank: false },
  };
  return {
    id,
    payload,
    sql: `insert into public.score_events(id,game_id,event_type,payload,actor)
      values ('${id}','${gameId}','end','${JSON.stringify(payload)}','integration');`,
  };
}

function sqlJson(value: string | object) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  return `'${json.replaceAll("'", "''")}'::jsonb`;
}

function stateWithEvent(state: string, event: ReturnType<typeof scoreEvent>) {
  const next = JSON.parse(state) as { scoreEvents: unknown[] };
  next.scoreEvents.push(event.payload);
  return next;
}

describe.skipIf(!enabled)("game completion PostgreSQL transactions", () => {
  it("atomically deletes, records cleanup truthfully, and restores metadata without reopening state", () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const gameId = randomUUID();
    const owner = randomUUID();
    const administrator = randomUUID();
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        ${account(owner, organizationId)}
        ${account(administrator, organizationId, { role: "team_admin" })}
        update public.game_states set state=jsonb_set(state,'{broadcast}','"idle"'::jsonb,true)
          where game_id='${gameId}';`).ok,
    ).toBe(true);
    const initialVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;

    expect(
      psqlAsServiceRole(
        `select public.soft_delete_team_game('${owner}','${gameId}')`,
      ),
    ).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select g.deleted_by_user_id='${owner}',gs.state->>'status',
        gs.state->>'broadcast',gs.state->>'audioMuted',
        gs.state->'claims'='{}'::jsonb,
        gs.state#>>'{connections,camera-home}',
        gs.state->'cameraHealth'='{}'::jsonb,
        gs.state#>>'{sponsorMode,active}',gs.version>${initialVersion},
        c.status,c.attempts,
        (select count(*) from public.audit_events where action='game.deleted'
          and subject_identifier='${gameId}')
        from public.games g join public.game_states gs on gs.game_id=g.id
        join public.game_deletion_cleanup c on c.game_id=g.id
        where g.id='${gameId}'`).stdout,
    ).toBe("t|closed|idle|true|t|false|t|false|t|pending|0|1");

    expect(
      psqlAsServiceRole(
        `select public.soft_delete_team_game('${administrator}','${gameId}')`,
      ),
    ).toMatchObject({ ok: true, stdout: "f" });
    expect(
      psql(`select deleted_by_user_id='${owner}',
        (select count(*) from public.audit_events where action='game.deleted'
          and subject_identifier='${gameId}'),
        (select count(*) from public.game_deletion_cleanup where game_id='${gameId}')
        from public.games where id='${gameId}'`).stdout,
    ).toBe("t|1|1");

    expect(
      psqlAsServiceRole(`select status,attempts,last_error from
        public.record_game_deletion_cleanup('${owner}','${gameId}',false,'provider unavailable')`)
        .stdout,
    ).toBe("failed|1|provider unavailable");
    expect(
      psqlAsServiceRole(`select cleanup_status,cleanup_attempts,cleanup_last_error from
        public.list_deleted_team_games_with_cleanup('${owner}')
        where game_id='${gameId}'`).stdout,
    ).toBe("failed|1|provider unavailable");
    expect(
      psqlAsServiceRole(`select status,attempts,last_error is null from
        public.record_game_deletion_cleanup('${owner}','${gameId}',true,null)`)
        .stdout,
    ).toBe("complete|2|t");
    expect(
      psqlAsServiceRole(`select status,attempts,last_error is null from
        public.record_game_deletion_cleanup('${owner}','${gameId}',false,'late outage')`)
        .stdout,
    ).toBe("complete|2|t");

    const deletedVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    expect(
      psqlAsServiceRole(
        `select public.restore_team_game('${administrator}','${gameId}')`,
      ),
    ).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select g.deleted_at is null,g.deleted_by_user_id is null,
        gs.state->>'status',gs.state->'claims'='{}'::jsonb,
        gs.version=${deletedVersion},c.status,
        (select count(*) from public.audit_events where action='game.restored'
          and subject_identifier='${gameId}')
        from public.games g join public.game_states gs on gs.game_id=g.id
        join public.game_deletion_cleanup c on c.game_id=g.id
        where g.id='${gameId}'`).stdout,
    ).toBe("t|t|closed|t|t|complete|1");
    expect(
      psqlAsServiceRole(
        `select public.restore_team_game('${owner}','${gameId}')`,
      ),
    ).toMatchObject({ ok: true, stdout: "f" });
    expect(
      psql(`select count(*) from public.audit_events where action='game.restored'
        and subject_identifier='${gameId}'`).stdout,
    ).toBe("1");
    expect(
      psqlAsServiceRole(`select count(*) from
        public.get_game_deletion_cleanup('${administrator}','${gameId}')`)
        .stdout,
    ).toBe("0");
    expect(
      psql(`select count(*) from public.audit_events where action='game.deleted'
        and subject_identifier='${gameId}'`).stdout,
    ).toBe("1");
  });

  it("repairs a legacy partial deletion before restore makes it visible", () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const gameId = randomUUID();
    const administratorId = randomUUID();
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        ${account(administratorId, organizationId)}
        update public.games set deleted_at=now(),deleted_by_user_id='${administratorId}'
          where id='${gameId}';
        insert into public.game_deletion_cleanup(game_id,provider,status,requested_at)
          values ('${gameId}','livekit','pending',now());`).ok,
    ).toBe(true);
    const legacyVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;

    expect(
      psqlAsServiceRole(
        `select public.restore_team_game('${administratorId}','${gameId}')`,
      ),
    ).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select g.deleted_at is null,g.deleted_by_user_id is null,
        gs.state->>'status',gs.state->>'broadcast',gs.state->>'audioMuted',
        gs.state->'claims'='{}'::jsonb,
        gs.state->'cameraHealth'='{}'::jsonb,
        gs.state#>>'{connections,camera-home}',
        gs.state#>>'{sponsorMode,active}',gs.version>${legacyVersion},
        (select count(*) from public.audit_events where action='game.deleted'
          and subject_identifier='${gameId}'),
        (select count(*) from public.audit_events where action='game.restored'
          and subject_identifier='${gameId}')
        from public.games g join public.game_states gs on gs.game_id=g.id
        where g.id='${gameId}'`).stdout,
    ).toBe("t|t|closed|idle|true|t|t|false|false|t|0|1");
  });

  it("keeps state writers service-role only while preserving both schedule signatures", () => {
    expect(
      psql(`select
        has_function_privilege('service_role','public.write_game_state(uuid,bigint,jsonb)','execute'),
        has_function_privilege('authenticated','public.write_game_state(uuid,bigint,jsonb)','execute'),
        has_function_privilege('service_role','public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text)','execute'),
        has_function_privilege('service_role','public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)','execute'),
        has_function_privilege('authenticated','public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)','execute'),
        has_function_privilege('service_role','public.get_game_deletion_cleanup(uuid,uuid)','execute'),
        has_function_privilege('authenticated','public.get_game_deletion_cleanup(uuid,uuid)','execute'),
        has_function_privilege('service_role','public.list_deleted_team_games_with_cleanup(uuid)','execute'),
        has_function_privilege('authenticated','public.list_deleted_team_games_with_cleanup(uuid)','execute'),
        has_table_privilege('service_role','public.game_deletion_cleanup','select')`)
        .stdout,
    ).toBe("t|f|t|t|f|t|f|t|f|f");
  });

  it("preserves supplied historical names for schedule-only edits and accepts changed-opponent snapshots", () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const administratorId = randomUUID();
    const gameId = randomUUID();
    const seasonId = randomUUID();
    const eventId = randomUUID();
    const oldOpponentId = randomUUID();
    const newOpponentId = randomUUID();
    const historicalConfig = {
      eventName: "Saved Event Name",
      homeName: "Saved Home Name",
      awayName: "Saved Opponent Name",
      homeColor: "#111111",
      awayColor: "#eeeeee",
      scheduledEnds: 8,
      youtubeTitle: "Saved title",
      youtubeVisibility: "unlisted",
    };
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        ${account(administratorId, organizationId)}
        insert into public.seasons(id,organization_id,name,start_date,end_date,status,created_by)
        values ('${seasonId}','${organizationId}','Name preservation','2026-01-01','2026-12-31','active','${administratorId}');
        insert into public.events(id,organization_id,season_id,name,event_type,start_date,end_date,timezone,created_by)
        values ('${eventId}','${organizationId}','${seasonId}','Current Library Event','league','2026-09-01','2026-09-30','America/Toronto','${administratorId}');
        insert into public.opponents(id,organization_id,display_name,created_by) values
          ('${oldOpponentId}','${organizationId}','Current Library Opponent','${administratorId}'),
          ('${newOpponentId}','${organizationId}','Replacement Opponent','${administratorId}');
        update public.games set season_id='${seasonId}',event_id='${eventId}',
          opponent_id='${oldOpponentId}',scheduled_start='2026-09-05T18:00:00Z',
          schedule_timezone='America/Toronto',game_number=1,config=${sqlJson(historicalConfig)}
          where id='${gameId}';
        update public.game_states set state=jsonb_set(state,'{config}',${sqlJson(historicalConfig)},true)
          where game_id='${gameId}';`).ok,
    ).toBe(true);

    const beforeVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    expect(
      psqlAsServiceRole(`select public.update_scheduled_team_game(
        '${administratorId}','${gameId}','${seasonId}','${eventId}','${oldOpponentId}',
        '2026-09-05T20:00:00Z','America/Toronto',1,'',${sqlJson(historicalConfig)});`),
    ).toMatchObject({ ok: true });
    expect(
      psql(`select g.config=${sqlJson(historicalConfig)},
        gs.state->'config'=${sqlJson(historicalConfig)},
        g.config->>'eventName',g.config->>'awayName',gs.version>${beforeVersion}
        from public.games g join public.game_states gs on gs.game_id=g.id
        where g.id='${gameId}'`).stdout,
    ).toBe("t|t|Saved Event Name|Saved Opponent Name|t");

    const changedOpponentConfig = {
      ...historicalConfig,
      awayName: "Replacement Opponent",
    };
    expect(
      psqlAsServiceRole(`select public.update_scheduled_team_game(
        '${administratorId}','${gameId}','${seasonId}','${eventId}','${newOpponentId}',
        '2026-09-05T20:00:00Z','America/Toronto',1,'',${sqlJson(changedOpponentConfig)});`),
    ).toMatchObject({ ok: true });
    expect(
      psql(`select g.opponent_id='${newOpponentId}',
        g.config=gs.state->'config',g.config->>'eventName',g.config->>'awayName'
        from public.games g join public.game_states gs on gs.game_id=g.id
        where g.id='${gameId}'`).stdout,
    ).toBe("t|t|Saved Event Name|Replacement Opponent");
  });

  it("executes account authorization and authoritative result derivation", () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const creatorId = randomUUID();
    const gameId = randomUUID();
    const owner = randomUUID();
    const teamAdmin = randomUUID();
    const unverified = randomUUID();
    const inactive = randomUUID();
    const scorer = randomUUID();
    const crossOrganization = randomUUID();
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        insert into public.organizations(id,name) values ('${otherOrganizationId}','Other team');
        ${account(owner, organizationId)}
        ${account(teamAdmin, organizationId, { role: "team_admin" })}
        ${account(unverified, organizationId, { verified: false })}
        ${account(inactive, organizationId, { profile: "suspended" })}
        ${account(scorer, organizationId, { role: "scorer" })}
        ${account(crossOrganization, otherOrganizationId)}`).ok,
    ).toBe(true);
    for (const denied of [unverified, inactive, scorer, crossOrganization]) {
      const result = psqlAsServiceRole(
        `select * from public.review_game_completion('${gameId}','${randomUUID()}','${denied}',false)`,
      );
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("completion_administrator_required");
    }
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion('${gameId}','${randomUUID()}','${owner}',false)`,
      ).ok,
    ).toBe(true);

    const home = scoreEvent(gameId, "home", 2, 1);
    const undoneAway = scoreEvent(gameId, "away", 1, 2);
    const tiedAway = scoreEvent(gameId, "away", 2, 3);
    const undoId = randomUUID();
    expect(
      psql(`${home.sql}${undoneAway.sql}${tiedAway.sql}
        insert into public.score_events(id,game_id,event_type,payload,actor)
        values ('${undoId}','${gameId}','undo',
          '{"id":"${undoId}","at":4,"type":"undo","targetId":"${undoneAway.id}"}','integration');`)
        .ok,
    ).toBe(true);
    const result =
      psqlAsServiceRole(`select result->>'outcome',result#>>'{totals,home}',
      result#>>'{totals,away}',jsonb_array_length(result->'ends')
      from public.review_game_completion('${gameId}','${randomUUID()}','${teamAdmin}',false)`);
    expect(result).toMatchObject({ ok: true, stdout: "tie|2|2|2" });
  });

  it("anonymizes a deleted account without changing completion evidence", () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const gameId = randomUUID();
    const administratorId = randomUUID();
    const reviewId = randomUUID();
    const completionId = randomUUID();
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        ${account(administratorId, organizationId, { role: "team_admin" })}`)
        .ok,
    ).toBe(true);
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion(
          '${gameId}','${reviewId}','${administratorId}',false)`,
      ),
    ).toMatchObject({ ok: true, stdout: reviewId });
    expect(
      psqlAsServiceRole(
        `select completion_id,review_id from public.complete_reviewed_game(
          '${gameId}','${reviewId}','${completionId}','${administratorId}',false)`,
      ),
    ).toMatchObject({ ok: true, stdout: `${completionId}|${reviewId}` });

    expect(
      psql(`delete from auth.users where id='${administratorId}'`),
    ).toMatchObject({ ok: true });
    expect(
      psql(`select r.reviewer_user_id is null,c.completed_by_user_id is null,
        r.result=c.result,c.completed_by_kind,a.actor_user_id is null,
        a.metadata->>'completion_id',a.metadata->>'review_id'
        from public.game_completion_reviews r
        join public.game_completions c on c.review_id=r.id
        join public.audit_events a on a.action='game.completed'
          and a.subject_identifier=c.game_id::text
        where r.id='${reviewId}'`).stdout,
    ).toBe(`t|t|t|account|t|${completionId}|${reviewId}`);

    for (const mutation of [
      `update public.game_completion_reviews set result='{}' where id='${reviewId}'`,
      `update public.game_completion_reviews set reviewer_user_id=null where id='${reviewId}'`,
      `update public.game_completions set completed_by_user_id=null where game_id='${gameId}'`,
      `delete from public.game_completions where game_id='${gameId}'`,
    ]) {
      const rejected = psql(mutation);
      expect(rejected.ok).toBe(false);
      expect(rejected.stderr).toContain("completion_records_are_immutable");
    }
    for (const mutation of [
      `update public.audit_events set metadata='{}' where action='game.completed' and subject_identifier='${gameId}'`,
      `update public.audit_events set actor_user_id=null where action='game.completed' and subject_identifier='${gameId}'`,
    ]) {
      const rejected = psql(mutation);
      expect(rejected.ok).toBe(false);
      expect(rejected.stderr).toContain("audit events are append-only");
    }
  });

  it("rolls back completion when the reviewed revision changes", () => {
    const gameId = randomUUID();
    const reviewId = randomUUID();
    expect(psql(fixture(gameId, randomUUID(), randomUUID())).ok).toBe(true);
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion('${gameId}','${reviewId}',null,true)`,
      ).ok,
    ).toBe(true);
    expect(psql(scoreEvent(gameId, "home", 1, 1).sql).ok).toBe(true);
    const conflict = psqlAsServiceRole(
      `select * from public.complete_reviewed_game('${gameId}','${reviewId}','${randomUUID()}',null,true)`,
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.stderr).toContain("completion_review_conflict");
    expect(
      psql(`select count(c.game_id),g.completed_at is null,gs.state->>'status'
        from public.games g join public.game_states gs on gs.game_id=g.id
        left join public.game_completions c on c.game_id=g.id
        where g.id='${gameId}' group by g.completed_at,gs.state`).stdout,
    ).toBe("0|t|active");
  });

  it("completes after a writer that already holds the state lock", async () => {
    const gameId = randomUUID();
    const reviewId = randomUUID();
    expect(psql(fixture(gameId, randomUUID(), randomUUID())).ok).toBe(true);
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion('${gameId}','${reviewId}',null,true)`,
      ).ok,
    ).toBe(true);
    const version = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const state = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const writerState = JSON.parse(state) as {
      claims: Record<string, string>;
    };
    writerState.claims["camera-home"] = "writer-first";
    const writer = heldTransaction(
      `select public.write_game_state(
        '${gameId}',${version},${sqlJson(writerState)});`,
      `writer_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await writer.ready;
    const app = `completion_${randomUUID().replaceAll("-", "")}`;
    const completion = psqlAsync(
      `select completion_id from public.complete_reviewed_game('${gameId}','${reviewId}','${randomUUID()}',null,true)`,
      app,
    );
    waitUntilBlocked(app);
    writer.release();
    expect(await writer.result).toMatchObject({ ok: true });
    expect(await completion).toMatchObject({ ok: true });
    expect(
      psql(`select state->>'status',state->'claims'='{}'::jsonb
        from public.game_states where game_id='${gameId}'`).stdout,
    ).toBe("completed|t");
  }, 15_000);

  it("rejects a stale writer and preserves stored identities when completion holds the lock", async () => {
    const gameId = randomUUID();
    const reviewId = randomUUID();
    const completionId = randomUUID();
    expect(psql(fixture(gameId, randomUUID(), randomUUID())).ok).toBe(true);
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion('${gameId}','${reviewId}',null,true)`,
      ).ok,
    ).toBe(true);
    const first = heldTransaction(
      `select completion_id,review_id from public.complete_reviewed_game(
        '${gameId}','${reviewId}','${completionId}',null,true);`,
      `first_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await first.ready;
    const staleApp = `stale_${randomUUID().replaceAll("-", "")}`;
    const retryApp = `retry_${randomUUID().replaceAll("-", "")}`;
    const staleVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const staleState = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const stale = psqlAsync(
      `select public.write_game_state(
        '${gameId}',${staleVersion},${sqlJson(staleState)});`,
      staleApp,
    );
    const retry = psqlAsync(
      `select completion_id,review_id from public.complete_reviewed_game(
        '${gameId}','${randomUUID()}','${randomUUID()}',null,true)`,
      retryApp,
    );
    waitUntilBlocked(staleApp);
    waitUntilBlocked(retryApp);
    first.release();
    expect(await first.result).toMatchObject({
      ok: true,
      stdout: `${completionId}|${reviewId}`,
    });
    const staleResult = await stale;
    expect(staleResult.ok).toBe(false);
    expect(staleResult.stderr).toContain("stale game state");
    expect(await retry).toMatchObject({
      ok: true,
      stdout: `${completionId}|${reviewId}`,
    });
    expect(
      psql(`select count(*) from public.audit_events
        where action='game.completed' and subject_identifier='${gameId}'`)
        .stdout,
    ).toBe("1");
    const completedVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const completedState = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const terminalWrite = psqlAsServiceRole(
      `select public.write_game_state(
        '${gameId}',${completedVersion},${sqlJson(completedState)});`,
    );
    expect(terminalWrite.ok).toBe(false);
    expect(terminalWrite.stderr).toContain("completed_game_terminal");
  }, 15_000);

  it("serializes ordinary state writes racing append_score_event in both orderings", async () => {
    const writerFirstGame = randomUUID();
    expect(psql(fixture(writerFirstGame, randomUUID(), randomUUID())).ok).toBe(
      true,
    );
    const version = psql(
      `select version from public.game_states where game_id='${writerFirstGame}'`,
    ).stdout;
    const state = psql(
      `select state from public.game_states where game_id='${writerFirstGame}'`,
    ).stdout;
    const heartbeatState = JSON.parse(state) as {
      connections: Record<string, boolean>;
    };
    heartbeatState.connections["camera-home"] = false;
    const writer = heldTransaction(
      `select public.write_game_state(
        '${writerFirstGame}',${version},${sqlJson(heartbeatState)});`,
      `state_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await writer.ready;
    const appendApp = `append_${randomUUID().replaceAll("-", "")}`;
    const event = scoreEvent(writerFirstGame, "home", 1, 1);
    const scoredState = stateWithEvent(state, event);
    const append = psqlAsync(
      `select public.append_score_event('${writerFirstGame}',${version},'${event.id}',
        'end',${sqlJson(event.payload)},'integration',${sqlJson(scoredState)})`,
      appendApp,
    );
    waitUntilBlocked(appendApp);
    writer.release();
    expect(await writer.result).toMatchObject({ ok: true });
    const conflicted = await append;
    expect(conflicted.ok).toBe(false);
    expect(conflicted.stderr).toContain("stale game state");
    expect(
      psql(`select count(*),
        (select state#>>'{connections,camera-home}' from public.game_states where game_id='${writerFirstGame}'),
        (select version>${version} from public.game_states where game_id='${writerFirstGame}')
        from public.score_events where game_id='${writerFirstGame}'`).stdout,
    ).toBe("0|false|t");

    const appendFirstGame = randomUUID();
    expect(psql(fixture(appendFirstGame, randomUUID(), randomUUID())).ok).toBe(
      true,
    );
    const appendVersion = psql(
      `select version from public.game_states where game_id='${appendFirstGame}'`,
    ).stdout;
    const appendState = psql(
      `select state from public.game_states where game_id='${appendFirstGame}'`,
    ).stdout;
    const appendEvent = scoreEvent(appendFirstGame, "away", 1, 1);
    const appendScoredState = stateWithEvent(appendState, appendEvent);
    const heldAppend = heldTransaction(
      `select public.append_score_event('${appendFirstGame}',${appendVersion},'${appendEvent.id}',
        'end',${sqlJson(appendEvent.payload)},'integration',${sqlJson(appendScoredState)});`,
      `held_append_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldAppend.ready;
    const staleHeartbeat = JSON.parse(appendState) as {
      connections: Record<string, boolean>;
    };
    staleHeartbeat.connections["camera-home"] = false;
    const ordinaryApp = `ordinary_${randomUUID().replaceAll("-", "")}`;
    const ordinary = psqlAsync(
      `select public.write_game_state(
        '${appendFirstGame}',${appendVersion},${sqlJson(staleHeartbeat)})`,
      ordinaryApp,
    );
    waitUntilBlocked(ordinaryApp);
    heldAppend.release();
    expect(await heldAppend.result).toMatchObject({ ok: true });
    const staleOrdinary = await ordinary;
    expect(staleOrdinary.ok).toBe(false);
    expect(staleOrdinary.stderr).toContain("stale game state");
    expect(
      psql(`select count(*),
        (select jsonb_array_length(state->'scoreEvents') from public.game_states where game_id='${appendFirstGame}'),
        (select state#>>'{connections,camera-home}' from public.game_states where game_id='${appendFirstGame}'),
        (select version>${appendVersion} from public.game_states where game_id='${appendFirstGame}')
        from public.score_events where game_id='${appendFirstGame}'`).stdout,
    ).toBe("1|1|true|t");
  }, 20_000);

  it("serializes deletion with scoring in both orderings", async () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const administratorId = randomUUID();
    const deleteFirstGame = randomUUID();
    expect(
      psql(`${fixture(deleteFirstGame, organizationId, creatorId)}
        ${account(administratorId, organizationId)}
        update public.game_states set state=jsonb_set(state,'{broadcast}','"idle"'::jsonb,true)
          where game_id='${deleteFirstGame}';`).ok,
    ).toBe(true);
    const version = psql(
      `select version from public.game_states where game_id='${deleteFirstGame}'`,
    ).stdout;
    const state = psql(
      `select state from public.game_states where game_id='${deleteFirstGame}'`,
    ).stdout;
    const event = scoreEvent(deleteFirstGame, "home", 1, 1);
    const scoredState = stateWithEvent(state, event);
    const deletion = heldTransaction(
      `select public.soft_delete_team_game('${administratorId}','${deleteFirstGame}');`,
      `delete_first_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await deletion.ready;
    const appendApp = `append_after_delete_${randomUUID().replaceAll("-", "")}`;
    const append = psqlAsync(
      `select public.append_score_event('${deleteFirstGame}',${version},'${event.id}',
        'end',${sqlJson(event.payload)},'integration',${sqlJson(scoredState)});`,
      appendApp,
    );
    waitUntilBlocked(appendApp);
    deletion.release();
    expect(await deletion.result).toMatchObject({ ok: true, stdout: "t" });
    const rejectedAppend = await append;
    expect(rejectedAppend.ok).toBe(false);
    expect(rejectedAppend.stderr).toContain("stale game state");
    expect(
      psql(`select gs.state->>'status',gs.state->'claims'='{}'::jsonb,
        count(se.id) from public.game_states gs
        left join public.score_events se on se.game_id=gs.game_id
        where gs.game_id='${deleteFirstGame}' group by gs.state`).stdout,
    ).toBe("closed|t|0");

    const scoreFirstGame = randomUUID();
    const scoreFirstOrganization = randomUUID();
    const scoreFirstCreator = randomUUID();
    const scoreFirstAdministrator = randomUUID();
    expect(
      psql(`${fixture(scoreFirstGame, scoreFirstOrganization, scoreFirstCreator)}
        ${account(scoreFirstAdministrator, scoreFirstOrganization)}
        update public.game_states set state=jsonb_set(state,'{broadcast}','"idle"'::jsonb,true)
          where game_id='${scoreFirstGame}';`).ok,
    ).toBe(true);
    const nextVersion = psql(
      `select version from public.game_states where game_id='${scoreFirstGame}'`,
    ).stdout;
    const nextState = psql(
      `select state from public.game_states where game_id='${scoreFirstGame}'`,
    ).stdout;
    const nextEvent = scoreEvent(scoreFirstGame, "away", 2, 1);
    const nextScoredState = stateWithEvent(nextState, nextEvent);
    const heldAppend = heldTransaction(
      `select public.append_score_event('${scoreFirstGame}',${nextVersion},'${nextEvent.id}',
        'end',${sqlJson(nextEvent.payload)},'integration',${sqlJson(nextScoredState)});`,
      `score_before_delete_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldAppend.ready;
    const deleteApp = `delete_after_score_${randomUUID().replaceAll("-", "")}`;
    const waitingDelete = psqlAsync(
      `select public.soft_delete_team_game('${scoreFirstAdministrator}','${scoreFirstGame}');`,
      deleteApp,
    );
    waitUntilBlocked(deleteApp);
    heldAppend.release();
    expect(await heldAppend.result).toMatchObject({ ok: true });
    expect(await waitingDelete).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select gs.state->>'status',gs.state->'claims'='{}'::jsonb,
        jsonb_array_length(gs.state->'scoreEvents'),count(se.id)
        from public.game_states gs
        join public.score_events se on se.game_id=gs.game_id
        where gs.game_id='${scoreFirstGame}' group by gs.state`).stdout,
    ).toBe("closed|t|1|1");
  }, 20_000);

  it("serializes deletion with completion and preserves completed state through restore", async () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const administratorId = randomUUID();
    const deleteFirstGame = randomUUID();
    const deleteFirstReview = randomUUID();
    expect(
      psql(`${fixture(deleteFirstGame, organizationId, creatorId)}
        ${account(administratorId, organizationId)}
        update public.game_states set state=jsonb_set(state,'{broadcast}','"idle"'::jsonb,true)
          where game_id='${deleteFirstGame}';`).ok,
    ).toBe(true);
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion('${deleteFirstGame}','${deleteFirstReview}','${administratorId}',false)`,
      ).ok,
    ).toBe(true);
    const deletion = heldTransaction(
      `select public.soft_delete_team_game('${administratorId}','${deleteFirstGame}');`,
      `delete_before_completion_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await deletion.ready;
    const completionApp = `completion_after_delete_${randomUUID().replaceAll("-", "")}`;
    const completion = psqlAsync(
      `select completion_id from public.complete_reviewed_game(
        '${deleteFirstGame}','${deleteFirstReview}','${randomUUID()}','${administratorId}',false);`,
      completionApp,
    );
    waitUntilBlocked(completionApp);
    deletion.release();
    expect(await deletion.result).toMatchObject({ ok: true, stdout: "t" });
    const rejectedCompletion = await completion;
    expect(rejectedCompletion.ok).toBe(false);
    expect(rejectedCompletion.stderr).toContain("game_deleted");
    expect(
      psql(`select count(c.game_id),state->>'status' from public.game_completions c
        right join public.game_states gs on gs.game_id='${deleteFirstGame}'
          and c.game_id=gs.game_id where gs.game_id='${deleteFirstGame}'
        group by gs.state`).stdout,
    ).toBe("0|closed");

    const completeFirstGame = randomUUID();
    const completeFirstReview = randomUUID();
    const completionId = randomUUID();
    const completeFirstOrganization = randomUUID();
    const completeFirstCreator = randomUUID();
    const completeFirstAdministrator = randomUUID();
    expect(
      psql(`${fixture(completeFirstGame, completeFirstOrganization, completeFirstCreator)}
        ${account(completeFirstAdministrator, completeFirstOrganization)}`).ok,
    ).toBe(true);
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion('${completeFirstGame}','${completeFirstReview}','${completeFirstAdministrator}',false)`,
      ).ok,
    ).toBe(true);
    const heldCompletion = heldTransaction(
      `select completion_id from public.complete_reviewed_game(
        '${completeFirstGame}','${completeFirstReview}','${completionId}','${completeFirstAdministrator}',false);`,
      `completion_before_delete_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldCompletion.ready;
    const deleteApp = `delete_after_completion_${randomUUID().replaceAll("-", "")}`;
    const waitingDelete = psqlAsync(
      `select public.soft_delete_team_game('${completeFirstAdministrator}','${completeFirstGame}');`,
      deleteApp,
    );
    waitUntilBlocked(deleteApp);
    heldCompletion.release();
    expect(await heldCompletion.result).toMatchObject({
      ok: true,
      stdout: completionId,
    });
    expect(await waitingDelete).toMatchObject({ ok: true, stdout: "t" });
    const frozen = psql(`select gs.state::text,c.result::text
      from public.game_states gs join public.game_completions c on c.game_id=gs.game_id
      where gs.game_id='${completeFirstGame}'`).stdout;
    expect(
      psqlAsServiceRole(`select status from public.record_game_deletion_cleanup(
        '${completeFirstAdministrator}','${completeFirstGame}',true,null)`)
        .stdout,
    ).toBe("complete");
    expect(
      psqlAsServiceRole(
        `select public.restore_team_game('${completeFirstAdministrator}','${completeFirstGame}')`,
      ),
    ).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select g.deleted_at is null,g.status,gs.state->>'status',
        gs.state->'claims'='{}'::jsonb,
        (gs.state::text||'|'||c.result::text)='${frozen.replaceAll("'", "''")}'
        from public.games g join public.game_states gs on gs.game_id=g.id
        join public.game_completions c on c.game_id=g.id
        where g.id='${completeFirstGame}'`).stdout,
    ).toBe("t|completed|completed|t|t");
  }, 20_000);

  it("serializes restore and delete in both orderings without reviving claims or actors", async () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const owner = randomUUID();
    const administrator = randomUUID();
    const deleteFirstGame = randomUUID();
    expect(
      psql(`${fixture(deleteFirstGame, organizationId, creatorId)}
        ${account(owner, organizationId)}
        ${account(administrator, organizationId, { role: "team_admin" })}
        update public.game_states set state=jsonb_set(state,'{broadcast}','"idle"'::jsonb,true)
          where game_id='${deleteFirstGame}';`).ok,
    ).toBe(true);
    const heldDelete = heldTransaction(
      `select public.soft_delete_team_game('${owner}','${deleteFirstGame}');`,
      `held_delete_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldDelete.ready;
    const restoreApp = `restore_after_delete_${randomUUID().replaceAll("-", "")}`;
    const waitingRestore = psqlAsync(
      `select public.restore_team_game('${administrator}','${deleteFirstGame}');`,
      restoreApp,
    );
    waitUntilBlocked(restoreApp);
    heldDelete.release();
    expect(await heldDelete.result).toMatchObject({ ok: true, stdout: "t" });
    expect(await waitingRestore).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select g.deleted_at is null,g.deleted_by_user_id is null,
        gs.state->>'status',gs.state->'claims'='{}'::jsonb
        from public.games g join public.game_states gs on gs.game_id=g.id
        where g.id='${deleteFirstGame}'`).stdout,
    ).toBe("t|t|closed|t");

    const restoreFirstGame = randomUUID();
    const restoreFirstOrganization = randomUUID();
    const restoreFirstCreator = randomUUID();
    const restoreFirstOwner = randomUUID();
    const restoreFirstAdministrator = randomUUID();
    expect(
      psql(`${fixture(restoreFirstGame, restoreFirstOrganization, restoreFirstCreator)}
        ${account(restoreFirstOwner, restoreFirstOrganization)}
        ${account(restoreFirstAdministrator, restoreFirstOrganization, { role: "team_admin" })}
        update public.game_states set state=jsonb_set(state,'{broadcast}','"idle"'::jsonb,true)
          where game_id='${restoreFirstGame}';`).ok,
    ).toBe(true);
    expect(
      psqlAsServiceRole(
        `select public.soft_delete_team_game('${restoreFirstOwner}','${restoreFirstGame}')`,
      ).stdout,
    ).toBe("t");
    expect(
      psqlAsServiceRole(`select status from public.record_game_deletion_cleanup(
        '${restoreFirstOwner}','${restoreFirstGame}',true,null)`).stdout,
    ).toBe("complete");
    const heldRestore = heldTransaction(
      `select public.restore_team_game('${restoreFirstAdministrator}','${restoreFirstGame}');`,
      `held_restore_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldRestore.ready;
    const deleteApp = `delete_after_restore_${randomUUID().replaceAll("-", "")}`;
    const waitingDelete = psqlAsync(
      `select public.soft_delete_team_game('${restoreFirstAdministrator}','${restoreFirstGame}');`,
      deleteApp,
    );
    waitUntilBlocked(deleteApp);
    heldRestore.release();
    expect(await heldRestore.result).toMatchObject({ ok: true, stdout: "t" });
    expect(await waitingDelete).toMatchObject({ ok: true, stdout: "t" });
    expect(
      psql(`select g.deleted_at is not null,g.deleted_by_user_id='${restoreFirstAdministrator}',
        gs.state->>'status',gs.state->'claims'='{}'::jsonb,
        (select status from public.game_deletion_cleanup
          where game_id='${restoreFirstGame}'),
        (select count(*) from public.audit_events where action='game.deleted'
          and subject_identifier='${restoreFirstGame}'),
        (select count(*) from public.audit_events where action='game.restored'
          and subject_identifier='${restoreFirstGame}')
        from public.games g join public.game_states gs on gs.game_id=g.id
        where g.id='${restoreFirstGame}'`).stdout,
    ).toBe("t|t|closed|t|pending|2|1");
  }, 20_000);

  it("rejects competing claims and prevents stale writers from restoring a released claim", async () => {
    const gameId = randomUUID();
    expect(psql(fixture(gameId, randomUUID(), randomUUID())).ok).toBe(true);
    const version = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const state = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const firstClaim = JSON.parse(state) as {
      claims: Record<string, string>;
    };
    const competingClaim = JSON.parse(state) as typeof firstClaim;
    firstClaim.claims["camera-away"] = "claim-one";
    competingClaim.claims["camera-away"] = "claim-two";

    const heldClaim = heldTransaction(
      `select public.write_game_state(
        '${gameId}',${version},${sqlJson(firstClaim)});`,
      `held_claim_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldClaim.ready;
    const competingApp = `competing_claim_${randomUUID().replaceAll("-", "")}`;
    const competing = psqlAsync(
      `select public.write_game_state(
        '${gameId}',${version},${sqlJson(competingClaim)});`,
      competingApp,
    );
    waitUntilBlocked(competingApp);
    heldClaim.release();
    expect(await heldClaim.result).toMatchObject({ ok: true });
    const rejectedClaim = await competing;
    expect(rejectedClaim.ok).toBe(false);
    expect(rejectedClaim.stderr).toContain("stale game state");
    expect(
      psql(`select state#>>'{claims,camera-away}',version>${version}
        from public.game_states where game_id='${gameId}'`).stdout,
    ).toBe("claim-one|t");

    const releaseVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const claimedState = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const releasedState = JSON.parse(claimedState) as {
      claims: Record<string, string>;
      connections: Record<string, boolean>;
    };
    delete releasedState.claims["camera-away"];
    releasedState.connections["camera-away"] = false;
    const staleHeartbeat = JSON.parse(claimedState) as {
      cameraHealth?: Record<string, unknown>;
      connections: Record<string, boolean>;
    };
    staleHeartbeat.cameraHealth ??= {};
    staleHeartbeat.cameraHealth["camera-away"] = {
      phase: "live",
      updatedAt: 2,
    };
    staleHeartbeat.connections["camera-away"] = true;

    const heldRelease = heldTransaction(
      `select public.write_game_state(
        '${gameId}',${releaseVersion},${sqlJson(releasedState)});`,
      `held_release_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldRelease.ready;
    const staleHeartbeatApp = `stale_heartbeat_${randomUUID().replaceAll("-", "")}`;
    const heartbeat = psqlAsync(
      `select public.write_game_state(
        '${gameId}',${releaseVersion},${sqlJson(staleHeartbeat)});`,
      staleHeartbeatApp,
    );
    waitUntilBlocked(staleHeartbeatApp);
    heldRelease.release();
    expect(await heldRelease.result).toMatchObject({ ok: true });
    const rejectedHeartbeat = await heartbeat;
    expect(rejectedHeartbeat.ok).toBe(false);
    expect(rejectedHeartbeat.stderr).toContain("stale game state");
    expect(
      psql(`select not(state#>'{claims}' ? 'camera-away'),
        state#>>'{connections,camera-away}'
        from public.game_states where game_id='${gameId}'`).stdout,
    ).toBe("t|false");
  }, 20_000);

  it("serializes schedule revision writes with append_score_event in both orderings", async () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const gameId = randomUUID();
    const administratorId = randomUUID();
    const seasonId = randomUUID();
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        ${account(administratorId, organizationId)}
        insert into public.seasons(id,organization_id,name,start_date,end_date,status,created_by)
        values ('${seasonId}','${organizationId}','Test season','2026-01-01','2026-12-31','active','${administratorId}');`)
        .ok,
    ).toBe(true);
    const scheduledConfig = {
      eventName: "Snapshot event name",
      homeName: "Configured home",
      awayName: "Snapshot opponent name",
      homeColor: "#123456",
      awayColor: "#abcdef",
      scheduledEnds: 10,
      youtubeTitle: "Updated broadcast title",
      youtubeVisibility: "unlisted",
    };
    const scheduleSql = `select public.update_scheduled_team_game(
      '${administratorId}','${gameId}','${seasonId}',null,null,
      '2026-09-05T18:00:00Z','America/Toronto',null,'Integration schedule',
      ${sqlJson(scheduledConfig)});`;

    const schedule = heldTransaction(
      scheduleSql,
      `schedule_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await schedule.ready;
    const version = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const state = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const event = scoreEvent(gameId, "home", 1, 1);
    const scoredState = stateWithEvent(state, event);
    const appendApp = `schedule_waiting_append_${randomUUID().replaceAll("-", "")}`;
    const append = psqlAsync(
      `select public.append_score_event('${gameId}',${version},'${event.id}',
        'end',${sqlJson(event.payload)},'integration',${sqlJson(scoredState)})`,
      appendApp,
    );
    waitUntilBlocked(appendApp);
    schedule.release();
    expect(await schedule.result).toMatchObject({ ok: true });
    const staleAppend = await append;
    expect(staleAppend.ok).toBe(false);
    expect(staleAppend.stderr).toContain("stale game state");
    expect(
      psql(`select count(se.id),g.config=gs.state->'config',
        gs.state#>>'{config,homeName}',gs.state#>>'{config,eventName}',
        gs.version>${version}
        from public.games g join public.game_states gs on gs.game_id=g.id
        left join public.score_events se on se.game_id=g.id
        where g.id='${gameId}' group by g.config,gs.state,gs.version`).stdout,
    ).toBe("0|t|Configured home|Snapshot event name|t");

    const nextVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const nextState = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const nextEvent = scoreEvent(gameId, "away", 1, 2);
    const nextScoredState = stateWithEvent(nextState, nextEvent);
    const heldAppend = heldTransaction(
      `select public.append_score_event('${gameId}',${nextVersion},'${nextEvent.id}',
        'end',${sqlJson(nextEvent.payload)},'integration',${sqlJson(nextScoredState)});`,
      `schedule_held_append_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldAppend.ready;
    const scheduleApp = `waiting_schedule_${randomUUID().replaceAll("-", "")}`;
    const waitingSchedule = psqlAsync(scheduleSql, scheduleApp);
    waitUntilBlocked(scheduleApp);
    heldAppend.release();
    expect(await heldAppend.result).toMatchObject({ ok: true });
    expect(await waitingSchedule).toMatchObject({ ok: true });
    expect(
      psql(`select count(*),
        (select jsonb_array_length(state->'scoreEvents') from public.game_states where game_id='${gameId}'),
        (select version>${nextVersion} from public.game_states where game_id='${gameId}')
        from public.score_events where game_id='${gameId}'`).stdout,
    ).toBe("1|1|t");

    const legacyVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    expect(
      psqlAsServiceRole(`select public.update_scheduled_team_game(
        '${administratorId}','${gameId}','${seasonId}',null,null,
        '2026-09-05T19:00:00Z','America/Toronto',null,'Legacy caller');`),
    ).toMatchObject({ ok: true });
    expect(
      psql(`select version>${legacyVersion},state#>>'{config,eventName}'
        from public.game_states where game_id='${gameId}'`).stdout,
    ).toBe("t|Legacy caller");
  }, 20_000);

  it("persists safe End Game summaries, watch links, cleanup attempts, and schedule results", () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    const gameId = randomUUID();
    const administratorId = randomUUID();
    const reviewId = randomUUID();
    const completionId = randomUUID();
    const watchUrl = "https://youtu.be/abcdefghijk";
    expect(
      psql(`${fixture(gameId, organizationId, creatorId)}
        ${account(administratorId, organizationId)}`).ok,
    ).toBe(true);
    const invalid = psqlAsServiceRole(
      `select * from public.review_game_completion_with_link(
        '${gameId}','${randomUUID()}','${administratorId}',false,'https://example.com/not-youtube')`,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.stderr).toContain("invalid_youtube_watch_url");
    expect(
      psqlAsServiceRole(
        `select review_id from public.review_game_completion_with_link(
          '${gameId}','${reviewId}','${administratorId}',false,'${watchUrl}')`,
      ),
    ).toMatchObject({ ok: true, stdout: reviewId });
    expect(
      psqlAsServiceRole(
        `select completion_id from public.complete_reviewed_game(
          '${gameId}','${reviewId}','${completionId}','${administratorId}',false)`,
      ),
    ).toMatchObject({ ok: true, stdout: completionId });
    expect(
      psqlAsServiceRole(`select
        s->>'status',s->>'youtubeWatchUrl',s#>>'{result,outcome}',
        (s ? 'reviewId')::text,(s ? 'completedByUserId')::text,(s ? 'claims')::text
        from (select public.read_game_completion_summary('${gameId}') s) value`)
        .stdout,
    ).toBe(`completed|${watchUrl}|no_result|false|false|false`);
    expect(
      psqlAsServiceRole(`select status,attempts,last_error from
        public.record_game_completion_cleanup('${gameId}','${administratorId}',false,false,'provider unavailable')`)
        .stdout,
    ).toBe("failed|1|provider unavailable");
    expect(
      psqlAsServiceRole(`select status,attempts,last_error is null from
        public.record_game_completion_cleanup('${gameId}','${administratorId}',false,true,null)`)
        .stdout,
    ).toBe("complete|2|t");
    expect(
      psqlAsServiceRole(`select status,attempts,last_error is null from
        public.record_game_completion_cleanup('${gameId}','${administratorId}',false,false,'late outage')`)
        .stdout,
    ).toBe("complete|2|t");
    expect(
      psqlAsServiceRole(`select game_status,completion_result->>'outcome',youtube_watch_url
        from public.list_team_hierarchy_games('${administratorId}')
        where id='${gameId}'`).stdout,
    ).toBe(`completed|no_result|${watchUrl}`);
    expect(
      psql(`update public.games set deleted_at=now() where id='${gameId}'`).ok,
    ).toBe(true);
    expect(
      psqlAsServiceRole(
        `select public.read_game_completion_summary('${gameId}') is null`,
      ).stdout,
    ).toBe("t");
  });
});
