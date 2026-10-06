// Isolated PostgreSQL checks. Pass a local PGlite module path; never uses production.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role; create schema auth;
create type team_membership_role as enum ('owner','team_admin','game_operator');
create type team_membership_status as enum ('active','suspended','removed');
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table organizations(id uuid primary key);
create table user_profiles(user_id uuid primary key,status text default 'active');
create table team_memberships(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),user_id uuid references auth.users(id),role team_membership_role,status team_membership_status default 'active',updated_at timestamptz,created_at timestamptz default now());
create table audit_events(actor_user_id uuid,organization_id uuid,action text,subject_type text,subject_identifier text,metadata jsonb);
create function is_platform_admin(uuid) returns boolean language sql as $$ select false $$;
create function member_manager_org(p_user uuid,p_org uuid default null) returns uuid language plpgsql as $$ declare o uuid; begin select organization_id into o from public.team_memberships where user_id=p_user and role='owner' and status='active'; if o is null then raise exception 'owner required'; end if; return o; end $$;
`);
const original = readFileSync(
  new URL(
    "../supabase/migrations/0052_platform_admin_and_team_invites.sql",
    import.meta.url,
  ),
  "utf8",
);
await db.exec(
  original.slice(
    original.indexOf("create table public.team_member_invitations"),
    original.indexOf("create function public.member_manager_org"),
  ),
);
await db.exec(
  readFileSync(
    new URL(
      "../supabase/migrations/0078_team_invitation_links.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
async function account(email, verified = true) {
  const id = randomUUID();
  await db.query("insert into auth.users values($1,$2,$3)", [
    id,
    email,
    verified ? new Date().toISOString() : null,
  ]);
  await db.query("insert into user_profiles(user_id) values($1)", [id]);
  return id;
}
async function fixture() {
  const org = randomUUID(),
    owner = await account("owner@example.com");
  await db.query("insert into organizations values($1)", [org]);
  await db.query(
    "insert into team_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [org, owner],
  );
  const h = hash();
  const invite = (
    await db.query(
      "select manage_team_member($1,'invite','contact@example.com','team_admin',null,$2) id",
      [owner, h],
    )
  ).rows[0].id;
  return { org, owner, h, invite };
}
const accept = (actor, h) =>
  db.query("select accept_team_member_invitation($1,$2) org", [actor, h]);
const f = await fixture();
const parent = await account("different@example.com");
assert.equal((await accept(parent, f.h)).rows[0].org, f.org);
assert.equal((await accept(parent, f.h)).rows[0].org, f.org); // same-user retry is idempotent
assert.equal(
  (
    await db.query(
      "select count(*)::int n from audit_events where action='team_access.accepted'",
    )
  ).rows[0].n,
  1,
);
await assert.rejects(
  accept(await account("second@example.com"), f.h),
  /invitation unavailable/,
);
for (const field of [
  "revoked_at=now()",
  "expires_at=now()-interval '1 second'",
]) {
  const x = await fixture();
  await db.query(`update team_member_invitations set ${field} where id=$1`, [
    x.invite,
  ]);
  await assert.rejects(
    accept(await account("any@example.com"), x.h),
    /invitation unavailable/,
  );
}
const unverified = await fixture();
await assert.rejects(
  accept(await account("unverified@example.com", false), unverified.h),
  /verified active/,
);
const suspended = await account("suspended@example.com");
await db.query("update user_profiles set status='suspended' where user_id=$1", [
  suspended,
]);
await assert.rejects(accept(suspended, unverified.h), /verified active/);
const revokedOwner = await fixture();
await db.query(
  "update team_memberships set status='removed' where user_id=$1",
  [revokedOwner.owner],
);
await assert.rejects(
  accept(await account("new@example.com"), revokedOwner.h),
  /invitation unavailable/,
);
const already = await fixture();
await assert.rejects(accept(f.owner, already.h), /account already belongs/);
const full = await fixture();
await db.query(
  "insert into team_memberships(organization_id,user_id,role) values($1,$2,'game_operator')",
  [full.org, await account("occupied@example.com")],
);
await assert.rejects(
  accept(await account("extra@example.com"), full.h),
  /two logins/,
);
await assert.rejects(accept(parent, hash()), /invitation unavailable/);
assert.equal(
  (
    await db.query(
      "select has_function_privilege('authenticated','public.accept_team_member_invitation(uuid,text)','execute') allowed",
    )
  ).rows[0].allowed,
  false,
);
console.log(
  "PASS: different-email acceptance, idempotency, single use, expiry, revocation, verification, suspension, inviter authority, existing membership, seats, invalid token and server-only grants.",
);
const limited = await fixture();
await db.query(
  "update team_member_invitations set revoked_at=now() where id=$1",
  [limited.invite],
);
for (let n = 0; n < 9; n++) {
  const id = (
    await db.query(
      "select manage_team_member($1,'invite','contact@example.com','team_admin',null,$2) id",
      [limited.owner, hash()],
    )
  ).rows[0].id;
  await db.query(
    "update team_member_invitations set revoked_at=now() where id=$1",
    [id],
  );
}
await assert.rejects(
  db.query(
    "select manage_team_member($1,'invite','contact@example.com','team_admin',null,$2)",
    [limited.owner, hash()],
  ),
  /hourly limit/,
);
console.log(
  "PASS: invite/revoke cycles cannot bypass the ten-per-hour team email limit.",
);
await db.close();
