import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Dedicated local test cluster only. Never point this harness at application storage.
const url = process.env.SHOT_TRACKER_TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
const safe =
  parsed &&
  ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
  /test|disposable/.test(parsed.pathname);
const executable = process.env.CURLCAST_PSQL ?? "psql";
const db = `shot_tracker_${randomUUID().replaceAll("-", "")}_test`;
function sql(text: string, database = db) {
  const r = spawnSync(
    executable,
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", text],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: parsed!.hostname,
        PGPORT: parsed!.port,
        PGUSER: parsed!.username,
        PGPASSWORD: parsed!.password,
        PGDATABASE: database,
      },
    },
  );
  return { ok: r.status === 0, out: r.stdout.trim(), error: r.stderr.trim() };
}
const org = "10000000-0000-4000-8000-000000000001",
  actor = "10000000-0000-4000-8000-000000000002",
  event = "10000000-0000-4000-8000-000000000003",
  game = "10000000-0000-4000-8000-000000000004",
  other = "10000000-0000-4000-8000-000000000005",
  lease = randomUUID(),
  hash = "a".repeat(64);
const claim = (a = actor, audience = "team", fingerprint = hash) =>
  `set role service_role;select public.claim_shot_tracker_report('${a}','${org}','${event}','${audience}','${fingerprint}','${lease}');`;
describe.skipIf(!safe)(
  "Shot Tracker private report PostgreSQL boundary",
  () => {
    beforeAll(() => {
      expect(sql(`create database ${db}`, parsed!.pathname.slice(1)).ok).toBe(
        true,
      );
      const bootstrap = `create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create table public.organizations(id uuid primary key);create table public.events(id uuid primary key,organization_id uuid);create table public.games(id uuid primary key,event_id uuid,organization_id uuid,status text,deleted_at timestamptz);create table public.user_profiles(user_id uuid,status text);create table public.team_memberships(user_id uuid,organization_id uuid,status text);create table public.curlcoach_module_entitlements(organization_id uuid,module_key text,expires_at timestamptz);create table public.curlcoach_coach_access(organization_id uuid,user_id uuid,expires_at timestamptz);
  do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;grant usage on schema public to service_role,anon,authenticated;`;
      expect(sql(bootstrap).ok).toBe(true);
      const source = readFileSync(
        "supabase/migrations/0058_curlcoach.sql",
        "utf8",
      );
      const start = source.indexOf(
        "create function public.assert_curlcoach_access(",
      );
      const end = source.indexOf("$$;", start) + 3;
      expect(start).toBeGreaterThan(0);
      expect(sql(source.slice(start, end)).ok).toBe(true);
      const migration = sql(
        readFileSync(
          "supabase/migrations/0074_shot_tracker_reports.sql",
          "utf8",
        ),
      );
      expect(migration.ok, migration.error).toBe(true);
      const seed = sql(
        `insert into auth.users values('${actor}',now()),('${other}',now());insert into organizations values('${org}');insert into events values('${event}','${org}');insert into games values('${game}','${event}','${org}','completed',null);insert into user_profiles values('${actor}','active'),('${other}','active');insert into team_memberships values('${actor}','${org}','active'),('${other}','${org}','active');insert into curlcoach_module_entitlements values('${org}','curlcoach',null);insert into curlcoach_coach_access values('${org}','${actor}',null);`,
      );
      expect(seed.ok, seed.error).toBe(true);
    });
    afterAll(() => {
      if (safe)
        expect(
          sql(`drop database ${db} with(force)`, parsed!.pathname.slice(1)).ok,
        ).toBe(true);
    });
    it("denies direct access and teammates without a coach grant", () => {
      expect(
        sql("set role authenticated;select * from shot_tracker_reports;").ok,
      ).toBe(false);
      expect(sql(claim(other)).ok).toBe(false);
    });
    it("deduplicates claims, enforces leases, caches success and isolates audiences", () => {
      const first = sql(claim());
      expect(first.ok, first.error).toBe(true);
      expect(JSON.parse(first.out).status).toBe("claimed");
      expect(JSON.parse(sql(claim()).out).status).toBe("processing");
      const finish = (token: string) =>
        `set role service_role;select public.finish_shot_tracker_report('${actor}','${org}','${event}','team','${hash}','${token}','{"audience":"team","reports":[]}'::jsonb);`;
      expect(sql(finish(randomUUID())).out).toBe("f");
      expect(sql(finish(lease)).out).toBe("t");
      expect(JSON.parse(sql(claim()).out).status).toBe("ready");
      expect(JSON.parse(sql(claim(actor, "coach")).out).status).toBe("claimed");
      expect(
        sql(
          `set role service_role;select public.read_shot_tracker_reports('${other}','${org}','${event}');`,
        ).ok,
      ).toBe(false);
    });
    it("caps generation attempts and applies retry cooldowns", () => {
      sql(
        "update shot_tracker_reports set status='failed',attempts=20,updated_at=now()-interval '4 minutes';",
      );
      expect(
        JSON.parse(sql(claim(actor, "players", "c".repeat(64))).out).status,
      ).toBe("limit");
      sql("update shot_tracker_reports set attempts=1;");
      expect(
        JSON.parse(sql(claim(actor, "players", "c".repeat(64))).out).status,
      ).toBe("claimed");
      sql(
        "update shot_tracker_reports set status='failed',updated_at=now() where audience='players';",
      );
      expect(
        JSON.parse(sql(claim(actor, "players", "c".repeat(64))).out).status,
      ).toBe("cooldown");
      sql(
        "update shot_tracker_reports set updated_at=now()-interval '4 minutes' where audience='players';",
      );
      expect(
        JSON.parse(sql(claim(actor, "players", "c".repeat(64))).out).status,
      ).toBe("claimed");
      expect(
        sql(
          "select attempts from shot_tracker_reports where audience='players';",
        ).out,
      ).toBe("2");
    });
    it("rejects active events, foreign events and revoked entitlement", () => {
      sql(`update games set status='active';`);
      expect(sql(claim(actor, "players")).ok).toBe(false);
      sql(`update games set status='completed';`);
      expect(
        sql(
          `set role service_role;select public.read_shot_tracker_reports('${actor}','${org}','${randomUUID()}');`,
        ).ok,
      ).toBe(false);
      sql("delete from curlcoach_module_entitlements;");
      expect(sql(claim()).ok).toBe(false);
    });
  },
);
