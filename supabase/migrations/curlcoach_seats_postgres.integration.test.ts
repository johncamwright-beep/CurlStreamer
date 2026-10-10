import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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

describe.skipIf(!enabled)("CurlCoach licensed seat boundary", () => {
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
    const seats = applyMigration(
      fileURLToPath(new URL("./0059_curlcoach_seats.sql", import.meta.url)),
      disposableDatabase,
    );
    expect(seats.ok, seats.stderr).toBe(true);
  });

  afterAll(() => {
    if (!disposableDatabase) return;
    const dropped = psql(
      `drop database if exists ${disposableDatabase} with (force)`,
      "postgres",
    );
    if (!dropped.ok) throw new Error(dropped.stderr);
  });

  it("limits seats, allows owner transfers, rejects outsiders, and preserves private sessions", () => {
    const o = randomUUID(),
      owner = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID(),
      admin = randomUUID(),
      game = randomUUID();
    const seeded =
      psql(`insert into public.organizations(id,name) values('${o}','Seat test');
      ${account(owner, o)} ${account(member, o)} ${account(outsider)} ${account(admin)}
      update public.team_memberships set role='owner' where user_id='${owner}';
      insert into public.platform_roles(name,description) values('super_admin','test') on conflict(name) do nothing;
      insert into public.user_platform_roles(user_id,role_id) select '${admin}',id from public.platform_roles where name='super_admin';
      select public.set_curlcoach_entitlement('${admin}','${o}',null);
      insert into public.games(id,organization_id,config,status,created_by) values('${game}','${o}','{}','active','${owner}');
    `);
    expect(seeded.ok, seeded.stderr).toBe(true);
    const membership = (u: string) =>
      psql(`select id from public.team_memberships where user_id='${u}'`)
        .stdout;
    const a = membership(owner),
      b = membership(member);
    const assign = (actor: string, ids: string[]) =>
      psql(
        `select public.assign_team_curlcoach('${actor}',array[${ids.map((i) => `'${i}'::uuid`).join(",")}]::uuid[])`,
        disposableDatabase,
        true,
      );
    expect(assign(member, [b]).ok).toBe(false);
    expect(assign(owner, [outsider]).ok).toBe(false);
    expect(assign(owner, [a, b]).ok).toBe(false);
    expect(assign(owner, [a, a]).ok).toBe(false);
    let result = assign(owner, [a]);
    expect(result.ok, result.stderr).toBe(true);
    expect(
      psql(
        `select public.grant_curlcoach_access('${admin}','${member}',null)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    // Store a private session using the established schema, then transfer only the grant.
    const stored = psql(
      `insert into public.curlcoach_sessions(organization_id,game_id,actor_user_id,status,revision,state) values('${o}','${game}','${owner}','open',0,'{"private":"original coach"}')`,
    );
    expect(stored.ok, stored.stderr).toBe(true);
    result = assign(owner, [b]);
    expect(result.ok, result.stderr).toBe(true);
    expect(
      psql(
        `select user_id from public.curlcoach_coach_access where organization_id='${o}'`,
      ).stdout,
    ).toBe(member);
    expect(
      psql(
        `select actor_user_id from public.curlcoach_sessions where game_id='${game}'`,
      ).stdout,
    ).toBe(owner);
    expect(
      psql(
        `select public.read_curlcoach_state('${member}','${o}','${game}')`,
        disposableDatabase,
        true,
      ).stdout,
    ).not.toContain("original coach");
    expect(
      psql(
        `select public.set_curlcoach_seats('${owner}','${o}',2)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    result = psql(
      `select public.set_curlcoach_seats('${admin}','${o}',2)`,
      disposableDatabase,
      true,
    );
    expect(result.ok, result.stderr).toBe(true);
    result = assign(owner, [a, b]);
    expect(result.ok, result.stderr).toBe(true);
    expect(
      psql(
        `select count(*) from public.curlcoach_coach_access where organization_id='${o}'`,
      ).stdout,
    ).toBe("2");
    expect(
      psql(
        `select public.set_curlcoach_seats('${admin}','${o}',1)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    psql(
      `update public.curlcoach_module_entitlements set expires_at=now()-interval '1 day' where organization_id='${o}'`,
    );
    expect(assign(owner, [a]).ok).toBe(false);
    expect(assign(owner, []).ok).toBe(true);
    expect(
      psql(
        `set role authenticated;select public.assign_team_curlcoach('${owner}','{}')`,
      ).ok,
    ).toBe(false);
  });
  it("serializes concurrent grants against the last available seat", async () => {
    const o = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    const seed = psql(
      `insert into public.organizations(id,name) values('${o}','Concurrent seats');${account(a, o)}${account(b, o)} insert into public.curlcoach_module_entitlements(organization_id) values('${o}');`,
    );
    expect(seed.ok, seed.stderr).toBe(true);
    const grant = (u: string) =>
      new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          psqlCommand,
          [
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            `begin; insert into public.curlcoach_coach_access(organization_id,user_id) values('${o}','${u}'); select pg_sleep(0.2); commit;`,
          ],
          { env: environment(disposableDatabase), stdio: "ignore" },
        );
        child.once("error", reject);
        child.once("exit", resolve);
      });
    const results = await Promise.all([grant(a), grant(b)]);
    expect(results.filter((code) => code === 0)).toHaveLength(1);
    expect(
      psql(
        `select count(*) from public.curlcoach_coach_access where organization_id='${o}'`,
      ).stdout,
    ).toBe("1");
  });
});
