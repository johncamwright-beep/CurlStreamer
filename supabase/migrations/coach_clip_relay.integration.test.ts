import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const org = randomUUID();
const foreignOrg = randomUUID();
const coach = randomUUID();
const operator = randomUUID();
const otherCoach = randomUUID();
const game = randomUUID();
const foreignGame = randomUUID();
const file = (name: string) =>
  readFileSync(`supabase/migrations/${name}.sql`, "utf8");

function definition(migration: string, name: string) {
  const sql = file(migration);
  const signature = sql.indexOf(`function public.${name}(`);
  return sql.slice(
    sql.lastIndexOf("create", signature),
    sql.indexOf("$$;", signature) + 3,
  );
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
    create table user_profiles (user_id uuid, status text);
    create table team_memberships (user_id uuid, organization_id uuid, role text, status text);
    create table games (id uuid primary key, organization_id uuid, status text,
      deleted_at timestamptz, completed_at timestamptz);
    create table game_states (game_id uuid, state jsonb);
    create table curlcoach_module_entitlements (organization_id uuid, expires_at timestamptz,
      seat_count integer, billing_seat_count integer, billing_expires_at timestamptz);
    create table team_access (organization_id uuid, paid_expires_at timestamptz);
    create table curlcoach_coach_access (organization_id uuid, user_id uuid, expires_at timestamptz);
    insert into auth.users values ('${coach}', now()), ('${operator}', now()), ('${otherCoach}', now());
    insert into user_profiles values ('${coach}', 'active'), ('${operator}', 'active'), ('${otherCoach}', 'active');
    insert into team_memberships values
      ('${coach}', '${org}', 'scorer', 'active'),
      ('${operator}', '${org}', 'game_operator', 'active'),
      ('${otherCoach}', '${foreignOrg}', 'scorer', 'active');
    insert into games (id, organization_id, status)
      values ('${game}', '${org}', 'active'), ('${foreignGame}', '${foreignOrg}', 'active');
    insert into game_states values ('${game}', '{"status":"active"}'), ('${foreignGame}', '{"status":"active"}');
    insert into curlcoach_module_entitlements values ('${org}', null, 1, 0, null), ('${foreignOrg}', null, 1, 0, null);
    insert into curlcoach_coach_access values ('${org}', '${coach}', null), ('${foreignOrg}', '${otherCoach}', null);
  `);
  const teamAccessMigration = "0060_setup_trial_and_paid_access";
  await db.exec(definition(teamAccessMigration, "effective_curlcoach_seats"));
  await db.exec(definition(teamAccessMigration, "assert_curlcoach_actor"));
  await db.exec(
    definition("0053_game_operator_access", "authorize_game_broadcast_actor"),
  );
  await db.exec(file("0103_coach_clip_relay_authority"));
});
afterAll(() => db.close());

const authorize = (
  gameId: string,
  role: string,
  actorId: string | null,
  organizer: boolean,
  organizationId: string | null = null,
) =>
  db.query("select authorize_coach_clip_relay($1,$2,$3,$4,$5)", [
    gameId,
    role,
    actorId,
    organizer,
    organizationId,
  ]);
const forbidden = { code: "42501" };

it("authorizes only eligible same-team coaches and active-game Studio operators", async () => {
  await db.exec("set role service_role");
  await authorize(game, "coach", coach, false, org);
  await authorize(game, "studio", operator, false);
  await authorize(game, "studio", null, true);
  await expect(authorize(game, "studio", coach, false)).rejects.toMatchObject(
    forbidden,
  );
  await expect(
    authorize(game, "coach", operator, false, org),
  ).rejects.toMatchObject(forbidden);
  await expect(
    authorize(game, "coach", otherCoach, false, foreignOrg),
  ).rejects.toMatchObject(forbidden);
  await expect(
    authorize(foreignGame, "studio", operator, false),
  ).rejects.toMatchObject(forbidden);
  await expect(authorize(game, "coach", null, true, org)).rejects.toMatchObject(
    forbidden,
  );
  await expect(
    authorize(game, "viewer", operator, false),
  ).rejects.toMatchObject(forbidden);
  await db.exec("reset role; set role authenticated");
  await expect(
    authorize(game, "studio", operator, false),
  ).rejects.toMatchObject(forbidden);
  await db.exec("reset role");
});

it("fences terminal game states, revoked memberships, and missing team entitlement", async () => {
  await db.exec(`
    update game_states set state = '{"status":"completed"}' where game_id = '${game}';
    set role service_role;
  `);
  await expect(authorize(game, "studio", null, true)).rejects.toMatchObject(
    forbidden,
  );
  await expect(
    authorize(game, "coach", coach, false, org),
  ).rejects.toMatchObject(forbidden);

  await db.exec(`
    reset role;
    update game_states set state = '{"status":"active"}' where game_id = '${game}';
    update team_memberships set status = 'revoked' where user_id = '${operator}';
    update curlcoach_module_entitlements set expires_at = now() - interval '1 day'
      where organization_id = '${org}';
    set role service_role;
  `);
  await expect(
    authorize(game, "studio", operator, false),
  ).rejects.toMatchObject(forbidden);
  await expect(authorize(game, "studio", null, true)).rejects.toMatchObject({
    code: "P0402",
  });
  await expect(
    authorize(game, "coach", coach, false, org),
  ).rejects.toMatchObject({ code: "P0402" });
  await db.exec("reset role");
});
