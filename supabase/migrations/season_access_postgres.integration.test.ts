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

describe.skipIf(!enabled)("Season purchase and trial boundary", () => {
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
    const prereq = psql(
      `create function public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) returns jsonb language sql as 'select ''{}''::jsonb';`,
    );
    expect(prereq.ok, prereq.stderr).toBe(true);
    for (const file of [
      "0036_team_public_profiles.sql",
      "0050_team_trials.sql",
    ]) {
      const r = applyMigration(
        fileURLToPath(new URL(`./${file}`, import.meta.url)),
        disposableDatabase,
      );
      expect(r.ok, r.stderr).toBe(true);
    }
    const applied = applyMigration(migration, disposableDatabase);
    expect(applied.ok, applied.stderr).toBe(true);
    const seats = applyMigration(
      fileURLToPath(new URL("./0059_curlcoach_seats.sql", import.meta.url)),
      disposableDatabase,
    );
    expect(seats.ok, seats.stderr).toBe(true);
    for (const file of [
      "0060_setup_trial_and_paid_access.sql",
      "0061_season_checkout.sql",
    ]) {
      const r = applyMigration(
        fileURLToPath(new URL(`./${file}`, import.meta.url)),
        disposableDatabase,
      );
      expect(r.ok, r.stderr).toBe(true);
    }
  });

  afterAll(() => {
    if (!disposableDatabase) return;
    const dropped = psql(
      `drop database if exists ${disposableDatabase} with (force)`,
      "postgres",
    );
    if (!dropped.ok) throw new Error(dropped.stderr);
  });

  it("starts one seven-day setup trial, blocks streaming and hides expired pages without deleting data", () => {
    const org = randomUUID(),
      owner = randomUUID();
    const seed = psql(
      `insert into public.organizations(id,name) values('${org}','Trial team');${account(owner, org)} update public.team_memberships set role='owner' where user_id='${owner}';`,
    );
    expect(seed.ok, seed.stderr).toBe(true);
    expect(
      psql(
        `select (setup_trial_expires_at-p.setup_trial_started_at=interval '7 days') from public.team_access a join public.user_profiles p on p.user_id='${owner}' where a.organization_id='${org}'`,
      ).stdout,
    ).toBe("t");
    expect(psql(`select public.team_has_page_access('${org}')`).stdout).toBe(
      "t",
    );
    expect(
      psql(
        `select public.assert_team_broadcast_access('${org}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `select public.assert_curlcoach_access('${owner}','${org}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    const clock = psql(
      `select setup_trial_started_at from public.user_profiles where user_id='${owner}'`,
    ).stdout;
    psql(
      `update public.user_profiles set setup_trial_started_at=now()+interval '1 year' where user_id='${owner}'; update public.team_access set setup_trial_expires_at=now()-interval '1 second' where organization_id='${org}'; update public.team_memberships set role='owner' where user_id='${owner}';`,
    );
    expect(
      psql(
        `select setup_trial_started_at from public.user_profiles where user_id='${owner}'`,
      ).stdout,
    ).toBe(clock);
    expect(psql(`select public.team_has_page_access('${org}')`).stdout).toBe(
      "f",
    );
    expect(
      psql(`select count(*) from public.organizations where id='${org}'`)
        .stdout,
    ).toBe("1");
  });
  it("fulfils live seasonal purchases, never sandbox payments, and requires coach assignment", () => {
    const org = randomUUID(),
      owner = randomUUID();
    expect(
      psql(
        `insert into public.organizations(id,name) values('${org}','Paid team');${account(owner, org)} update public.team_memberships set role='owner' where user_id='${owner}'; update public.team_access set setup_trial_expires_at=now()-interval '1 day' where organization_id='${org}';`,
      ).ok,
    ).toBe(true);
    const purchase = (live: boolean) => {
      const r = psql(
        `select public.claim_season_order('${owner}',${live},true,2)`,
        disposableDatabase,
        true,
      );
      expect(r.ok, r.stderr).toBe(true);
      return JSON.parse(r.stdout);
    };
    const abandoned = purchase(false);
    expect(
      psql(
        `update public.team_season_orders set created_at=now()-interval '23 hours 1 second' where id='${abandoned.id}'`,
      ).ok,
    ).toBe(true);
    const recovered = purchase(false);
    expect(recovered.id).toBe(abandoned.id);
    expect(
      psql(
        `select public.release_empty_season_order('${abandoned.id}','${org}')`,
        disposableDatabase,
        true,
      ).stdout,
    ).toBe("t");
    const retried = purchase(false);
    expect(retried.id).not.toBe(abandoned.id);
    expect(
      psql(
        `select status from public.team_season_orders where id='${abandoned.id}'`,
      ).stdout,
    ).toBe("expired");
    const sync = (order: string, status: string) => {
      const event = randomUUID(),
        token = randomUUID();
      expect(
        psql(
          `select public.begin_season_sync('${order}','${event}','${token}')`,
          disposableDatabase,
          true,
        ).stdout,
      ).toBe("claimed");
      const r = psql(
        `select public.finish_season_sync('${order}','${event}','${token}','${status}',null)`,
        disposableDatabase,
        true,
      );
      expect(r.ok, r.stderr).toBe(true);
    };
    const testOrder = purchase(false);
    sync(testOrder.id, "paid");
    expect(psql(`select public.team_has_page_access('${org}')`).stdout).toBe(
      "f",
    );
    const liveOrder = purchase(true);
    sync(liveOrder.id, "paid");
    expect(psql(`select public.team_has_page_access('${org}')`).stdout).toBe(
      "t",
    );
    expect(
      psql(
        `select public.assert_team_broadcast_access('${org}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(`select public.effective_curlcoach_seats('${org}')`).stdout,
    ).toBe("2");
    expect(
      psql(
        `select public.assert_curlcoach_access('${owner}','${org}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    const member = psql(
      `select id from public.team_memberships where user_id='${owner}'`,
    ).stdout;
    const assigned = psql(
      `select public.assign_team_curlcoach('${owner}',array['${member}'::uuid])`,
      disposableDatabase,
      true,
    );
    expect(assigned.ok, assigned.stderr).toBe(true);
    expect(
      psql(
        `select public.assert_curlcoach_access('${owner}','${org}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select public.claim_season_order('${owner}',true,true,0)`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    sync(liveOrder.id, "revoked");
    expect(psql(`select public.team_has_page_access('${org}')`).stdout).toBe(
      "f",
    );
    expect(
      psql(
        `select public.assert_curlcoach_access('${owner}','${org}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `set role authenticated;select public.claim_season_order('${owner}',true,true,2)`,
      ).ok,
    ).toBe(false);
  });
});
