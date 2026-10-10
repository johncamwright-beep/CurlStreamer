import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/check-report-email.mjs <path-to-pglite/dist/index.js>",
  );
}
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const actor = "11111111-1111-4111-8111-111111111111",
  org = "22222222-2222-4222-8222-222222222222",
  event = "33333333-3333-4333-8333-333333333333",
  lease = "44444444-4444-4444-8444-444444444444";
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key); create table public.organizations(id uuid primary key); create table public.events(id uuid primary key);
insert into auth.users values('${actor}');insert into organizations values('${org}');insert into events values('${event}');
create function public.shot_tracker_report_access(a uuid,o uuid,e uuid) returns void language plpgsql as $$ begin if a<>'${actor}'::uuid or o<>'${org}'::uuid or e<>'${event}'::uuid then raise exception 'access denied'; end if; end $$;`);
await db.exec(
  readFileSync(
    new URL(
      "../supabase/migrations/0080_private_player_report_email.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    new URL(
      "../supabase/migrations/0082_private_report_family_contacts.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(`insert into team_player_contacts(organization_id,player_id,player_name,parent_email) values('${org}','${"d".repeat(64)}','Pat','parent@example.com');
insert into team_report_coach_contacts(organization_id,coach_email_1,coach_email_2) values('${org}','coach1@example.com','coach2@example.com');`);
for (const role of ["anon", "authenticated"]) {
  for (const table of ["team_player_contacts", "team_report_coach_contacts"]) {
    for (const privilege of ["select", "insert", "update"]) {
      assert.equal(
        (
          await db.query(
            `select has_table_privilege('${role}','${table}','${privilege}') allowed`,
          )
        ).rows[0].allowed,
        false,
      );
    }
  }
}
assert.equal(
  (
    await db.query(
      "select relrowsecurity from pg_class where oid='team_report_coach_contacts'::regclass",
    )
  ).rows[0].relrowsecurity,
  true,
);
await assert.rejects(
  db.exec("update team_report_coach_contacts set coach_email_1='invalid'"),
  /check constraint/,
);
await assert.rejects(
  db.exec("update team_player_contacts set parent_email='invalid'"),
  /check constraint/,
);
const claim = (key = "a".repeat(64), resend = false, a = actor) =>
  db.query("select claim_report_email($1,$2,$3,$4,$5,$6) status", [
    a,
    org,
    event,
    key,
    lease,
    resend,
  ]);
assert.equal((await claim()).rows[0].status, "claimed");
assert.equal((await claim()).rows[0].status, "recent");
await db.query("select finish_report_email($1,$2,$3,$4,$5,'accepted')", [
  actor,
  org,
  event,
  "a".repeat(64),
  lease,
]);
await db.exec(
  "update shot_tracker_report_emails set updated_at=now()-interval '2 minutes'",
);
assert.equal((await claim()).rows[0].status, "accepted");
assert.equal((await claim("a".repeat(64), true)).rows[0].status, "claimed");
await assert.rejects(
  claim("b".repeat(64), false, "55555555-5555-4555-8555-555555555555"),
  /access denied/,
);
await db.exec("update shot_tracker_report_emails set attempts=30");
assert.equal((await claim("b".repeat(64))).rows[0].status, "limit");
for (const role of ["anon", "authenticated"]) {
  assert.equal(
    (
      await db.query(
        `select has_table_privilege('${role}','team_player_contacts','select') allowed`,
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        `select has_function_privilege('${role}','claim_report_email(uuid,uuid,uuid,text,uuid,boolean)','execute') allowed`,
      )
    ).rows[0].allowed,
    false,
  );
}
console.log(
  "PASS: private contacts, authorized claims, duplicate protection, explicit resend, cooldown and hourly limit.",
);
await db.close();
