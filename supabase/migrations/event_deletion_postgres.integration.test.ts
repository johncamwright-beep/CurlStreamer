import { randomUUID } from "node:crypto";
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

const enabled = safeDatabase && psqlAvailable;

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

describe.skipIf(!enabled)("atomic event deletion", () => {
  beforeAll(() => {
    disposableDatabase =
      "event_delete_" + randomUUID().replaceAll("-", "").slice(0, 16) + "_test";
    const cloned = psql(
      "create database " + disposableDatabase + " template " + sourceDatabase,
      "postgres",
    );
    expect(cloned.ok, cloned.stderr).toBe(true);
    const columns = psql(
      "select column_name from information_schema.columns where table_schema='public' and table_name='events'",
    ).stdout;
    if (!columns.includes("accomplishment_year")) {
      const prep = psql(
        "alter table public.events add column if not exists result text, add column if not exists level text, add column if not exists show_level boolean default true, add column if not exists accomplishment_year integer; drop function public.list_events(uuid,uuid);",
      );
      expect(prep.ok, prep.stderr).toBe(true);
    }
    const applied = applyMigration(
      fileURLToPath(new URL("./0062_delete_team_events.sql", import.meta.url)),
      disposableDatabase,
    );
    expect(applied.ok, applied.stderr).toBe(true);
  });
  afterAll(() => {
    if (disposableDatabase) {
      const dropped = psql(
        "drop database if exists " + disposableDatabase + " with (force)",
        "postgres",
      );
      expect(dropped.ok, dropped.stderr).toBe(true);
    }
  });
  function seed() {
    const org = randomUUID(),
      owner = randomUUID(),
      other = randomUUID(),
      event = randomUUID(),
      season = randomUUID(),
      games = [randomUUID(), randomUUID()].sort();
    const sql = `insert into public.organizations(id,name) values('${org}','Event test');
 ${account(owner)} ${account(other)}
 insert into public.team_memberships(organization_id,user_id,role,status) values('${org}','${owner}','owner','active'),('${org}','${other}','viewer','active');
 insert into public.seasons(id,organization_id,name,start_date,end_date,status,created_by) values('${season}','${org}','Season','2026-09-01','2027-08-31','active','${owner}');
 insert into public.events(id,organization_id,season_id,name,event_type,start_date,end_date,timezone,created_by) values('${event}','${org}','${season}','Delete test','tournament','2026-09-19','2026-09-20','America/Toronto','${owner}');
 ${games.map((id) => `insert into public.games(id,organization_id,season_id,event_id,config,status,created_by) values('${id}','${org}','${season}','${event}','{}','active','${owner}');insert into public.game_states(game_id,state) values('${id}','{"status":"active","broadcast":"idle","scoreEvents":[]}');`).join("")}`;
    const result = psql(sql);
    expect(result.ok, result.stderr).toBe(true);
    return { org, owner, other, event, season, games };
  }
  it("denies non-admins and rolls back every game when a later game is live", () => {
    const f = seed();
    expect(
      psql(
        `select public.soft_delete_team_event('${f.other}','${f.event}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    const live = psql(
      `update public.game_states set state=jsonb_set(state,'{broadcast}','"live"') where game_id='${f.games[1]}'`,
    );
    expect(live.ok, live.stderr).toBe(true);
    expect(
      psql(
        `select public.soft_delete_team_event('${f.owner}','${f.event}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `select count(*) from public.games where event_id='${f.event}' and deleted_at is null`,
      ).stdout,
    ).toBe("2");
    expect(
      psql(`select deleted_at is null from public.events where id='${f.event}'`)
        .stdout,
    ).toBe("t");
    expect(
      psql(
        `select count(*) from public.game_deletion_cleanup where game_id in ('${f.games.join("','")}')`,
      ).stdout,
    ).toBe("0");
  });
  it("deletes all games, hides event listings, queues cleanup, retains history and blocks restoring into the deleted event", () => {
    const f = seed();
    const deleted = psql(
      `select public.soft_delete_team_event('${f.owner}','${f.event}')`,
      disposableDatabase,
      true,
    );
    expect(deleted.ok, deleted.stderr).toBe(true);
    expect(
      psql(
        `select count(*) from public.games where event_id='${f.event}' and deleted_at is not null`,
      ).stdout,
    ).toBe("2");
    expect(
      psql(
        `select count(*) from public.list_events('${f.owner}',null) where id='${f.event}'`,
        disposableDatabase,
        true,
      ).stdout,
    ).toBe("0");
    expect(
      psql(
        `select count(*) from public.game_deletion_cleanup where game_id in ('${f.games.join("','")}') and status='pending'`,
      ).stdout,
    ).toBe("2");
    expect(
      psql(
        `select public.restore_team_game('${f.owner}','${f.games[0]}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(false);
    expect(
      psql(
        `select public.soft_delete_team_event('${f.owner}','${f.event}')`,
        disposableDatabase,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select count(*) from public.audit_events where action='event.deleted' and subject_identifier='${f.event}'`,
      ).stdout,
    ).toBe("1");
    const fresh = randomUUID();
    expect(
      psql(
        `insert into public.games(id,organization_id,season_id,event_id,config,status,created_by) values('${fresh}','${f.org}','${f.season}','${f.event}','{}','active','${f.owner}')`,
      ).ok,
    ).toBe(false);
  });
});
