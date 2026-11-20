import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const sourceDatabase = parsed?.pathname.slice(1);
const command = process.env.CURLCAST_PSQL || "psql";
const enabled = Boolean(
  parsed &&
  sourceDatabase &&
  /^[a-z][a-z0-9_]*$/i.test(sourceDatabase) &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(sourceDatabase) &&
  spawnSync(command, ["--version"]).status === 0,
);
let database = "";
function run(sql: string, target = database, file?: string) {
  const result = spawnSync(
    command,
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      ...(file ? ["-f", file] : ["-c", sql]),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: parsed?.hostname,
        PGPORT: parsed?.port || "5432",
        PGDATABASE: target,
        PGUSER: decodeURIComponent(parsed?.username || ""),
        PGPASSWORD: decodeURIComponent(parsed?.password || ""),
      },
    },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

describe.skipIf(!enabled)("atomic opponent details PostgreSQL", () => {
  beforeAll(() => {
    database =
      "opponent_details_" +
      randomUUID().replaceAll("-", "").slice(0, 16) +
      "_test";
    const cloned = run(
      `create database ${database} template ${sourceDatabase}`,
      "postgres",
    );
    expect(cloned.ok, cloned.stderr).toBe(true);
    if (
      run("select to_regclass('public.opponent_seasons') is not null")
        .stdout !== "t"
    ) {
      const profiles = run(
        "",
        database,
        fileURLToPath(new URL("./0063_opponent_seasons.sql", import.meta.url)),
      );
      expect(profiles.ok, profiles.stderr).toBe(true);
    }
    if (
      run(
        "select to_regprocedure('public.save_opponent_details(uuid,uuid,boolean,text,text,uuid,text,jsonb,integer)') is not null",
      ).stdout !== "t"
    ) {
      const migrated = run(
        "",
        database,
        fileURLToPath(new URL("./0070_opponent_details.sql", import.meta.url)),
      );
      expect(migrated.ok, migrated.stderr).toBe(true);
    }
  });
  afterAll(() => {
    if (database) {
      const dropped = run(
        `drop database if exists ${database} with (force)`,
        "postgres",
      );
      expect(dropped.ok, dropped.stderr).toBe(true);
    }
  });
  function seed() {
    const org = randomUUID(),
      user = randomUUID(),
      viewer = randomUUID(),
      operator = randomUUID(),
      unconfirmed = randomUUID(),
      season = randomUUID(),
      prior = randomUUID(),
      opponent = randomUUID(),
      duplicate = randomUUID();
    const accounts = [
      [user, "owner"],
      [viewer, "viewer"],
      [operator, "game_operator"],
      [unconfirmed, "owner"],
    ];
    const result = run(`
      insert into public.organizations(id,name) values('${org}','Opponent details');
      ${accounts.map(([id, role]) => `insert into auth.users(id,email,email_confirmed_at) values('${id}','${id}@details.test',${id === unconfirmed ? "null" : "now()"}); insert into public.user_profiles(user_id,display_name,status) values('${id}','Details test','active'); insert into public.team_memberships(organization_id,user_id,role,status) values('${org}','${id}','${role}','active');`).join("\n")}
      insert into public.seasons(id,organization_id,name,start_date,end_date,status) values('${season}','${org}','Current','2026-09-01','2027-08-31','active'),('${prior}','${org}','Prior','2025-09-01','2026-08-31','archived');
      insert into public.opponents(id,organization_id,display_name) values('${opponent}','${org}','Old name'),('${duplicate}','${org}','Other name');
      insert into public.opponent_seasons(organization_id,opponent_id,season_id,level,roster) values('${org}','${opponent}','${season}','U18','{"lead":"Current lead"}'),('${org}','${opponent}','${prior}','U15','{"lead":"Prior lead"}');
    `);
    expect(result.ok, result.stderr).toBe(true);
    return {
      org,
      user,
      viewer,
      operator,
      unconfirmed,
      season,
      prior,
      opponent,
      duplicate,
    };
  }
  function save(
    s: ReturnType<typeof seed>,
    name = "Corrected",
    revision = 1,
    user = s.user,
    opponent = s.opponent,
    create = false,
    expected = "Old name",
    season = s.season,
  ) {
    return run(
      `set role service_role; select row_to_json(saved) from public.save_opponent_details('${user}','${opponent}',${create},'${name}',${create ? "null" : `'${expected}'`},'${season}','U20','{"lead":"New lead","coach":"Coach"}',${revision}) saved`,
    );
  }
  it("commits identity and roster together while preserving other seasons", () => {
    const s = seed();
    const result = save(s);
    expect(result.ok, result.stderr).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({
      opponent_id: s.opponent,
      display_name: "Corrected",
      revision: 2,
      level: "U20",
      roster: { lead: "New lead", coach: "Coach" },
    });
    expect(
      run(
        `select level || ':' || (roster->>'lead') from public.opponent_seasons where opponent_id='${s.opponent}' and season_id='${s.prior}'`,
      ).stdout,
    ).toBe("U15:Prior lead");
  });
  it("rolls back name changes when a profile revision is stale", () => {
    const s = seed();
    expect(save(s, "Unsaved", 0).ok).toBe(false);
    expect(
      run(`select display_name from public.opponents where id='${s.opponent}'`)
        .stdout,
    ).toBe("Old name");
    expect(
      save(s, "Unsaved", 1, s.user, s.opponent, false, "Wrong old name").ok,
    ).toBe(false);
  });
  it("rejects normalized duplicates without overwriting the existing opponent", () => {
    const s = seed();
    expect(save(s, " OTHER   NAME ").ok).toBe(false);
    expect(save(s, "other name", 0, s.user, randomUUID(), true).ok).toBe(false);
    expect(
      run(
        `select count(*) from public.opponents where organization_id='${s.org}'`,
      ).stdout,
    ).toBe("2");
  });
  it("rejects unauthorized actors, foreign IDs and archived seasons", () => {
    const s = seed();
    for (const actor of [s.viewer, s.operator, s.unconfirmed])
      expect(save(s, "Rejected", 1, actor).ok).toBe(false);
    expect(save(s, "Rejected", 1, s.user, randomUUID()).ok).toBe(false);
    expect(
      save(s, "Rejected", 1, s.user, s.opponent, false, "Old name", s.prior).ok,
    ).toBe(false);
    expect(
      run(
        `set role authenticated; select * from public.save_opponent_details('${s.user}','${s.opponent}',false,'Rejected','Old name','${s.season}',null,'{}',1)`,
      ).ok,
    ).toBe(false);
  });
});
