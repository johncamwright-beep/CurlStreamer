import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const sourceDatabase = parsed?.pathname.slice(1);
const safeDatabase = Boolean(
  parsed &&
  sourceDatabase &&
  /^[a-z][a-z0-9_]*$/i.test(sourceDatabase) &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(parsed.pathname),
);
const psqlCommand = process.env.CURLCAST_PSQL || "psql";
const psqlAvailable =
  spawnSync(psqlCommand, ["--version"], { encoding: "utf8" }).status === 0;
const migration = fileURLToPath(
  new URL("./0058_curlcoach.sql", import.meta.url),
);
const gameOperatorMigration = fileURLToPath(
  new URL("./0051_game_operator_role.sql", import.meta.url),
);
const platformAdminMigration = fileURLToPath(
  new URL("./0052_platform_admin_and_team_invites.sql", import.meta.url),
);

let disposableDatabase = "";

function environment(database = sourceDatabase) {
  if (!parsed || !database)
    throw new Error("Disposable PostgreSQL is not configured");
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
}

const enabled =
  safeDatabase &&
  psqlAvailable &&
  [migration, gameOperatorMigration, platformAdminMigration].every(existsSync);

function psql(sql: string, database = disposableDatabase, serviceRole = false) {
  const result = spawnSync(
    psqlCommand,
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `${serviceRole ? "set role service_role;" : ""}${sql}`,
    ],
    { encoding: "utf8", env: environment(database) },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function applyMigration(file: string, database: string) {
  const result = spawnSync(
    psqlCommand,
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file],
    { encoding: "utf8", env: environment(database) },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function platformAdminReady(database: string) {
  return (
    psql(
      "select (to_regprocedure('public.require_platform_admin(uuid)') is not null and to_regprocedure('public.is_platform_admin(uuid)') is not null)::text",
      database,
    ).stdout === "true"
  );
}

function gameOperatorRoleReady(database: string) {
  return (
    psql(
      `select exists(
        select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
        where t.typname='team_membership_role' and e.enumlabel='game_operator'
      )::text`,
      database,
    ).stdout === "true"
  );
}

function account(userId: string, organizationId?: string) {
  return `
    insert into auth.users(id,email,email_confirmed_at)
      values ('${userId}','${userId}@curlcoach.test',now());
    insert into public.user_profiles(user_id,display_name,status)
      values ('${userId}','Coach test','active');
    ${
      organizationId
        ? `insert into public.team_memberships(organization_id,user_id,role,status)
             values ('${organizationId}','${userId}','viewer','active');`
        : ""
    }
  `;
}

function state(
  organizationId: string,
  gameId: string,
  actorUserId: string,
  revision: number,
  status: "open" | "closed",
  events: unknown[],
) {
  return JSON.stringify({
    organizationId,
    gameId,
    profile: "tracker-provisional-v1",
    revision,
    status,
    roster: [{ id: "lead", name: "Avery", position: "Lead" }],
    events,
    actorUserId,
  });
}

function shotEvent(requestId: string, actorUserId: string, revision: number) {
  return {
    requestId,
    expectedRevision: revision - 1,
    shotId: randomUUID(),
    shot: {
      playerId: "lead",
      position: "Lead",
      end: revision,
      stone: 1,
      type: "Draw",
      turn: null,
      execution: null,
      grade: 4,
      deficiency: null,
      review: null,
      excluded: null,
      note: `private note ${revision}`,
    },
    revision,
    at: "2026-09-13T12:00:00.000Z",
    actor: actorUserId,
  };
}

function executeCommand(
  actorUserId: string,
  organizationId: string,
  gameId: string,
  requestId: string,
  expectedRevision: number,
  commandType: "command" | "finish" | "reopen",
  nextState: string,
  payload: object,
) {
  return psql(
    `select public.apply_curlcoach_command(
      '${actorUserId}','${organizationId}','${gameId}','${requestId}',
      ${expectedRevision},'${commandType}',$$${JSON.stringify(payload)}$$::jsonb,
      $$${nextState}$$::jsonb
    )::text`,
    disposableDatabase,
    true,
  );
}

describe.skipIf(!enabled)("CurlCoach private PostgreSQL boundary", () => {
  beforeAll(() => {
    disposableDatabase = `curlcoach_${randomUUID().replaceAll("-", "").slice(0, 20)}_test`;
    const cloned = psql(
      `create database ${disposableDatabase} template ${sourceDatabase}`,
      "postgres",
    );
    expect(cloned.ok, cloned.stderr).toBe(true);
    // Bring only this clone up to 0052 when an older disposable fixture is
    // available.  The source database is never changed by this test.
    if (!gameOperatorRoleReady(disposableDatabase)) {
      const gameOperator = applyMigration(
        gameOperatorMigration,
        disposableDatabase,
      );
      expect(gameOperator.ok, gameOperator.stderr).toBe(true);
    }
    if (!platformAdminReady(disposableDatabase)) {
      const platformAdmin = applyMigration(
        platformAdminMigration,
        disposableDatabase,
      );
      expect(platformAdmin.ok, platformAdmin.stderr).toBe(true);
    }
    expect(platformAdminReady(disposableDatabase)).toBe(true);
    const applied = applyMigration(migration, disposableDatabase);
    expect(applied.ok, applied.stderr).toBe(true);
  });

  afterAll(() => {
    if (!disposableDatabase) return;
    const dropped = psql(
      `drop database if exists ${disposableDatabase} with (force)`,
      "postgres",
    );
    if (!dropped.ok) throw new Error(dropped.stderr);
  });

  it("executes the migration and isolates private sessions from team mates and platform administrators", () => {
    const organizationId = randomUUID();
    const gameId = randomUUID();
    const coachA = randomUUID();
    const coachB = randomUUID();
    const platformAdmin = randomUUID();
    const seeded = psql(`
      insert into public.organizations(id,name) values ('${organizationId}','CurlCoach test');
      ${account(coachA, organizationId)}
      ${account(coachB, organizationId)}
      ${account(platformAdmin)}
      insert into public.games(id,organization_id,config,status,created_by)
        values ('${gameId}','${organizationId}','{}'::jsonb,'active','${coachA}');
      insert into public.game_states(game_id,version,state)
        values ('${gameId}',17,'{"scoreEvents":[]}'::jsonb);
      insert into public.platform_roles(name,description) values ('super_admin','test')
        on conflict(name) do nothing;
      insert into public.user_platform_roles(user_id,role_id)
        select '${platformAdmin}',id from public.platform_roles where name='super_admin';
    `);
    expect(seeded.ok, seeded.stderr).toBe(true);
    expect(
      psql(
        `select public.set_curlcoach_entitlement('${platformAdmin}','${organizationId}',null)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select public.grant_curlcoach_access('${platformAdmin}','${coachA}',null)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);

    const requestId = randomUUID();
    const firstEvent = shotEvent(requestId, coachA, 1);
    const firstState = state(organizationId, gameId, coachA, 1, "open", [
      firstEvent,
    ]);
    const write = executeCommand(
      coachA,
      organizationId,
      gameId,
      requestId,
      0,
      "command",
      firstState,
      {
        requestId,
        expectedRevision: 0,
        shotId: firstEvent.shotId,
        shot: firstEvent.shot,
      },
    );
    expect(write.ok, write.stderr).toBe(true);
    expect(
      psql(
        `select public.read_curlcoach_state('${coachA}','${organizationId}','${gameId}')::text`,
        disposableDatabase,
        true,
      ).stdout,
    ).toContain("private note 1");
    // A team mate has no grant, and a platform administrator has no implicit
    // right to private session contents.
    expect(
      psql(
        `select public.read_curlcoach_state('${coachB}','${organizationId}','${gameId}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `select public.read_curlcoach_state('${platformAdmin}','${organizationId}','${gameId}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `select public.grant_curlcoach_access('${platformAdmin}','${coachB}',null)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select public.read_curlcoach_state('${coachB}','${organizationId}','${gameId}') is null`,
        disposableDatabase,
        true,
      ).stdout,
    ).toBe("t");
  });

  it("finishes and reopens only the private session, rejects expiry and stale CAS", () => {
    const organizationId = randomUUID();
    const gameId = randomUUID();
    const coach = randomUUID();
    const platformAdmin = randomUUID();
    const seeded = psql(`
      insert into public.organizations(id,name) values ('${organizationId}','Lifecycle test');
      ${account(coach, organizationId)}
      ${account(platformAdmin)}
      insert into public.games(id,organization_id,config,status,created_by)
        values ('${gameId}','${organizationId}','{}'::jsonb,'active','${coach}');
      insert into public.game_states(game_id,version,state)
        values ('${gameId}',23,'{"scoreEvents":[]}'::jsonb);
      insert into public.user_platform_roles(user_id,role_id)
        select '${platformAdmin}',id from public.platform_roles where name='super_admin';
    `);
    expect(seeded.ok, seeded.stderr).toBe(true);
    for (const statement of [
      `select public.set_curlcoach_entitlement('${platformAdmin}','${organizationId}',null)`,
      `select public.grant_curlcoach_access('${platformAdmin}','${coach}',null)`,
    ])
      expect(psql(statement, disposableDatabase, true).ok).toBe(true);

    const requestId = randomUUID();
    const event = shotEvent(requestId, coach, 1);
    const open = state(organizationId, gameId, coach, 1, "open", [event]);
    expect(
      executeCommand(
        coach,
        organizationId,
        gameId,
        requestId,
        0,
        "command",
        open,
        {
          requestId,
          expectedRevision: 0,
          shotId: event.shotId,
          shot: event.shot,
        },
      ).ok,
    ).toBe(true);
    const gameBefore = psql(
      `select jsonb_build_object('status',g.status,'version',s.version,'state',s.state)::text
       from public.games g join public.game_states s on s.game_id=g.id where g.id='${gameId}'`,
    ).stdout;

    const finishRequest = randomUUID();
    const closed = state(organizationId, gameId, coach, 2, "closed", [event]);
    expect(
      executeCommand(
        coach,
        organizationId,
        gameId,
        finishRequest,
        1,
        "finish",
        closed,
        { action: "finish", requestId: finishRequest, expectedRevision: 1 },
      ).ok,
    ).toBe(true);
    const reopenRequest = randomUUID();
    const reopened = state(organizationId, gameId, coach, 3, "open", [event]);
    expect(
      executeCommand(
        coach,
        organizationId,
        gameId,
        reopenRequest,
        2,
        "reopen",
        reopened,
        { action: "reopen", requestId: reopenRequest, expectedRevision: 2 },
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select jsonb_build_object('status',g.status,'version',s.version,'state',s.state)::text
         from public.games g join public.game_states s on s.game_id=g.id where g.id='${gameId}'`,
      ).stdout,
    ).toBe(gameBefore);

    expect(
      psql(
        `select public.set_curlcoach_entitlement('${platformAdmin}','${organizationId}',now()-interval '1 second')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select public.read_curlcoach_state('${coach}','${organizationId}','${gameId}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `select public.set_curlcoach_entitlement('${platformAdmin}','${organizationId}',null)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    const stale = executeCommand(
      coach,
      organizationId,
      gameId,
      randomUUID(),
      2,
      "command",
      reopened,
      { requestId: randomUUID(), expectedRevision: 2 },
    );
    expect(stale.ok).toBe(false);
    expect(stale.stderr).toContain("curlcoach revision conflict");
  });
});
