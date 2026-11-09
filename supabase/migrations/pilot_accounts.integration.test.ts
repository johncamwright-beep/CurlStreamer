import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite(),
  admin = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
 create table public.organizations(id uuid primary key default gen_random_uuid(),name text);
 create table public.user_profiles(user_id uuid primary key,display_name text,status text);
 create table public.team_memberships(organization_id uuid,user_id uuid,role text,status text);
 create table public.team_access(organization_id uuid primary key,trial_expires_at timestamptz);
 create table public.curlcoach_module_entitlements(organization_id uuid primary key,expires_at timestamptz,seat_count integer,granted_by_user_id uuid);
 create table public.curlcoach_coach_access(organization_id uuid,user_id uuid,expires_at timestamptz,granted_by_user_id uuid);
 create table public.audit_events(actor_user_id uuid,organization_id uuid,action text,subject_type text,subject_identifier text);
 create table public.games(id uuid,organization_id uuid,deleted_at timestamptz);
 create table public.curlcoach_sessions(id uuid,organization_id uuid);
 create function public.require_platform_admin(u uuid) returns void language plpgsql as $$ begin if u<>'${admin}' then raise exception 'Admin required'; end if; end $$;
 insert into auth.users(id,email) values('${admin}','admin@example.test'),('${other}','other@example.test');`);
  await db.exec(
    readFileSync(new URL("./0093_pilot_accounts.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    "alter table auth.users add column email_confirmed_at timestamptz, add column encrypted_password text;",
  );
  await db.exec(
    readFileSync(
      new URL("./0094_approve_existing_pilots.sql", import.meta.url),
      "utf8",
    ),
  );
});
afterAll(() => db.close());
it("approves only an eligible existing login into a blank team, preserving its password and preventing duplicates", async () => {
  const u = randomUUID();
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,'existing@example.test',now(),'unchanged-hash')",
    [u],
  );
  await db.query(
    "insert into user_profiles values($1,'Existing Owner','active')",
    [u],
  );
  const approve = (actor = admin) =>
    db.query<{ r: { id: string; organization_id: string } }>(
      "select approve_existing_pilot($1,$2,'Owner','5551234567','New Team',now()+interval '30 days',2) r",
      [actor, u],
    );
  await expect(approve(other)).rejects.toThrow();
  const r = (await approve()).rows[0].r;
  expect(
    (
      await db.query("select * from games where organization_id=$1", [
        r.organization_id,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ encrypted_password: string }>(
        "select encrypted_password from auth.users where id=$1",
        [u],
      )
    ).rows[0].encrypted_password,
  ).toBe("unchanged-hash");
  expect(
    (
      await db.query(
        "select * from curlcoach_coach_access where organization_id=$1 and user_id=$2",
        [r.organization_id, u],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(approve()).rejects.toThrow();
  expect(
    (await db.query("select * from claim_pilot_email($1,$2)", [admin, r.id]))
      .rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query("select * from claim_pilot_approval_email($1,$2)", [
        admin,
        r.id,
      ])
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query("select * from claim_pilot_approval_email($1,$2)", [
        admin,
        r.id,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("refuses unverified, suspended, and already attached accounts without creating an organization", async () => {
  for (const scenario of ["unverified", "suspended", "member"]) {
    const u = randomUUID();
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)",
      [
        u,
        scenario + "@example.test",
        scenario === "unverified" ? null : new Date().toISOString(),
      ],
    );
    await db.query("insert into user_profiles values($1,'Owner',$2)", [
      u,
      scenario === "suspended" ? "suspended" : "active",
    ]);
    if (scenario === "member")
      await db.query(
        "insert into team_memberships values($1,$2,'owner','active')",
        [randomUUID(), u],
      );
    await expect(
      db.query(
        "select approve_existing_pilot($1,$2,'Owner','5551234567','New Team',now()+interval '30 days',1)",
        [admin, u],
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("select * from pilot_accounts where user_id=$1", [u]))
        .rows,
    ).toHaveLength(0);
  }
});
async function prepare(email: string, actor = admin) {
  return (
    await db.query<{ id: string }>(
      `select public.prepare_pilot_account($1,$2,'Pilot Owner','5551234567','Independent team',now()+interval '30 days',1)->>'id' id`,
      [actor, email],
    )
  ).rows[0].id;
}
it("restricts creation to platform admin and refuses existing identities", async () => {
  await expect(prepare("denied@example.test", other)).rejects.toThrow();
  await expect(prepare("other@example.test")).rejects.toThrow();
  await db.exec("set role anon");
  await expect(
    db.query("select * from public.pilot_accounts"),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await expect(
    db.query(`select public.list_pilot_accounts('${admin}')`),
  ).rejects.toThrow();
  await db.exec("reset role");
});
it("creates independent empty organizations, grants seats, and blocks access until password replacement", async () => {
  const a = await prepare("a@example.test"),
    b = await prepare("b@example.test"),
    u = randomUUID(),
    v = randomUUID();
  await db.query(
    `insert into auth.users(id,email,raw_app_meta_data) values($1,'a@example.test',$2),($3,'b@example.test',$4)`,
    [
      u,
      JSON.stringify({ pilot_id: a, pilot_password_required: true }),
      v,
      JSON.stringify({ pilot_id: b, pilot_password_required: true }),
    ],
  );
  const provision = async (id: string) =>
    (
      await db.query<{ r: { organization_id: string; user_id: string } }>(
        `select public.provision_pilot_account($1,$2) r`,
        [admin, id],
      )
    ).rows[0].r;
  const ra = await provision(a),
    rb = await provision(b);
  expect(ra.organization_id).not.toBe(rb.organization_id);
  expect((await provision(a)).organization_id).toBe(ra.organization_id);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from public.user_profiles where user_id=$1`,
        [u],
      )
    ).rows[0].status,
  ).toBe("suspended");
  expect(
    (
      await db.query(`select * from public.games where organization_id=$1`, [
        ra.organization_id,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        `select * from public.curlcoach_coach_access where organization_id=$1 and user_id=$2`,
        [ra.organization_id, v],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    db.query(`select public.activate_pilot_account($1)`, [u]),
  ).rejects.toThrow();
  await db.query(
    `update auth.users set raw_app_meta_data=raw_app_meta_data || '{"pilot_password_required":false}' where id=$1`,
    [u],
  );
  await db.query(`select public.activate_pilot_account($1)`, [u]);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from public.user_profiles where user_id=$1`,
        [u],
      )
    ).rows[0].status,
  ).toBe("active");
  expect(
    (
      await db.query(`select * from public.claim_pilot_email($1,$2)`, [
        admin,
        a,
      ])
    ).rows,
  ).toHaveLength(0);
  await db.query(`select public.manage_pilot_account($1,$2,now(),true)`, [
    admin,
    a,
  ]);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from public.user_profiles where user_id=$1`,
        [u],
      )
    ).rows[0].status,
  ).toBe("suspended");
});
it("does not attach an unrelated identity to a reserved pilot and serializes email sends", async () => {
  const id = await prepare("collision@example.test");
  await db.query(
    `insert into auth.users(id,email) values($1,'collision@example.test')`,
    [randomUUID()],
  );
  await expect(
    db.query(`select public.provision_pilot_account($1,$2)`, [admin, id]),
  ).rejects.toThrow();
  const first = await db.query(
    `select * from public.claim_pilot_email($1,$2)`,
    [admin, id],
  );
  expect(first.rows).toHaveLength(1);
  expect(
    (
      await db.query(`select * from public.claim_pilot_email($1,$2)`, [
        admin,
        id,
      ])
    ).rows,
  ).toHaveLength(0);
});
