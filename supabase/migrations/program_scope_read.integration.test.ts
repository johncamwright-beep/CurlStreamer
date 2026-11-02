import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const db = new PGlite();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const check = async (org = 2, home = 3, away = 4) =>
  (
    await db.query<{ value: boolean }>(
      "select public.m3_program_scope_available($1,$2,$3,$4) as value",
      [id(1), id(org), id(home), id(away)],
    )
  ).rows[0].value;
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.games(id uuid primary key,organization_id uuid,status text,deleted_at timestamptz,completed_at timestamptz);
    create table public.game_states(game_id uuid primary key,state jsonb);
    create table public.m2_studio_sessions(game_id uuid,camera_role text,organization_id uuid,id uuid,status text,expires_at timestamptz,receiver_seen_at timestamptz,primary key(game_id,camera_role));
  `);
  await db.exec(
    readFileSync("supabase/migrations/0088_program_scope_read.sql", "utf8"),
  );
});
beforeEach(async () => {
  await db.exec(`reset role; truncate games,game_states,m2_studio_sessions;
    insert into games values('${id(1)}','${id(2)}','active',null,null);
    insert into game_states values('${id(1)}','{"status":"active"}');
    insert into m2_studio_sessions values
      ('${id(1)}','camera-home','${id(2)}','${id(3)}','active',now()+interval '1 hour',now()-interval '1 minute'),
      ('${id(1)}','camera-away','${id(2)}','${id(4)}','active',now()+interval '1 hour',now());`);
});
afterAll(() => db.close());
it("allows either fixed role, but rejects replacement, wrong role and wrong organization", async () => {
  expect(await check()).toBe(true);
  expect(await check(2, 9, 4)).toBe(true);
  expect(await check(2, 3, 9)).toBe(true);
  expect(await check(2, 9, 9)).toBe(false);
  expect(await check(2, 4, 3)).toBe(false);
  expect(await check(9)).toBe(false);
});
it.each([
  "update games set status='completed'",
  "update games set deleted_at=now()",
  "update games set completed_at=now()",
  "update game_states set state='{}'",
  "delete from game_states",
  "update m2_studio_sessions set status='stopped'",
  "update m2_studio_sessions set expires_at=now()",
  "update m2_studio_sessions set organization_id='" + id(9) + "'",
])("denies unavailable authority: %s", async (sql) => {
  await db.exec(sql);
  expect(await check()).toBe(false);
});
it("works in a read-only transaction without renewing stale receiver presence", async () => {
  const before = (
    await db.query("select * from m2_studio_sessions order by camera_role")
  ).rows;
  await db.exec("begin read only; set local role service_role");
  try {
    expect(await check()).toBe(true);
    expect(await check()).toBe(true);
  } finally {
    await db.exec("rollback");
  }
  expect(
    (await db.query("select * from m2_studio_sessions order by camera_role"))
      .rows,
  ).toEqual(before);
});
it.each(["anon", "authenticated"])(
  "denies direct %s execution",
  async (role) => {
    await db.exec(`set role ${role}`);
    await expect(check()).rejects.toThrow(/permission denied/);
  },
);
