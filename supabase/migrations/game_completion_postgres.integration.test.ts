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

describe.skipIf(!enabled)("game completion PostgreSQL transactions", () => {
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
    const writer = heldTransaction(
      `update public.game_states set
        state=jsonb_set(state,'{claims,camera-home}','"writer-first"'::jsonb,true)
        where game_id='${gameId}';`,
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
    const stale = psqlAsync(
      `update public.game_states set state=jsonb_set(state,'{broadcast}','"live"'::jsonb,true)
       where game_id='${gameId}'`,
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
    expect(staleResult.stderr).toContain("completed_game_terminal");
    expect(await retry).toMatchObject({
      ok: true,
      stdout: `${completionId}|${reviewId}`,
    });
    expect(
      psql(`select count(*) from public.audit_events
        where action='game.completed' and subject_identifier='${gameId}'`)
        .stdout,
    ).toBe("1");
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
    const writer = heldTransaction(
      `update public.game_states set version=version+1 where game_id='${writerFirstGame}';`,
      `state_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await writer.ready;
    const appendApp = `append_${randomUUID().replaceAll("-", "")}`;
    const event = scoreEvent(writerFirstGame, "home", 1, 1);
    const append = psqlAsync(
      `select public.append_score_event('${writerFirstGame}',${version},'${event.id}',
        'end','${JSON.stringify(event.payload)}','integration','${state.replaceAll("'", "''")}')`,
      appendApp,
    );
    waitUntilBlocked(appendApp);
    writer.release();
    expect(await writer.result).toMatchObject({ ok: true });
    const conflicted = await append;
    expect(conflicted.ok).toBe(false);
    expect(conflicted.stderr).toContain("stale game state");
    expect(
      psql(
        `select count(*) from public.score_events where game_id='${writerFirstGame}'`,
      ).stdout,
    ).toBe("0");

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
    const heldAppend = heldTransaction(
      `select public.append_score_event('${appendFirstGame}',${appendVersion},'${appendEvent.id}',
        'end','${JSON.stringify(appendEvent.payload)}','integration','${appendState.replaceAll("'", "''")}');`,
      `held_append_${randomUUID().replaceAll("-", "")}`,
      true,
    );
    await heldAppend.ready;
    const ordinaryApp = `ordinary_${randomUUID().replaceAll("-", "")}`;
    const ordinary = psqlAsync(
      `update public.game_states set version=version+1 where game_id='${appendFirstGame}'`,
      ordinaryApp,
    );
    waitUntilBlocked(ordinaryApp);
    heldAppend.release();
    expect(await heldAppend.result).toMatchObject({ ok: true });
    expect(await ordinary).toMatchObject({ ok: true });
    expect(
      psql(
        `select count(*) from public.score_events where game_id='${appendFirstGame}'`,
      ).stdout,
    ).toBe("1");
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
    const scheduleSql = `select public.update_scheduled_team_game(
      '${administratorId}','${gameId}','${seasonId}',null,null,
      '2026-09-05T18:00:00Z','America/Toronto',null,'Integration schedule');`;

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
    const appendApp = `schedule_waiting_append_${randomUUID().replaceAll("-", "")}`;
    const append = psqlAsync(
      `select public.append_score_event('${gameId}',${version},'${event.id}',
        'end','${JSON.stringify(event.payload)}','integration','${state.replaceAll("'", "''")}')`,
      appendApp,
    );
    waitUntilBlocked(appendApp);
    schedule.release();
    expect(await schedule.result).toMatchObject({ ok: true });
    expect(await append).toMatchObject({ ok: true });

    const nextVersion = psql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const nextState = psql(
      `select state from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const nextEvent = scoreEvent(gameId, "away", 1, 2);
    const heldAppend = heldTransaction(
      `select public.append_score_event('${gameId}',${nextVersion},'${nextEvent.id}',
        'end','${JSON.stringify(nextEvent.payload)}','integration','${nextState.replaceAll("'", "''")}');`,
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
      psql(`select count(*) from public.score_events where game_id='${gameId}'`)
        .stdout,
    ).toBe("2");
  }, 20_000);
});
