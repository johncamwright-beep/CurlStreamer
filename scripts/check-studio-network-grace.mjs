// Disposable PostgreSQL/WASM harness. No network database or production records.
// Uses the same local PGlite installation as validate-coach-repair.mjs.
import { PGlite } from "../work/coach-sql-validation/node_modules/@electric-sql/pglite/dist/index.js";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const read = (name) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table games(id uuid primary key, organization_id uuid, deleted_at timestamptz, completed_at timestamptz, status text);
create table game_states(game_id uuid primary key, state jsonb);
create table m4_desktop_sessions(session_id uuid primary key, game_id uuid, organization_id uuid, generation bigint, code_hash text, challenge_hash text, bearer_hash text, status text, consumed_at timestamptz, pairing_expires_at timestamptz, approved_by uuid, expires_at timestamptz, lease_expires_at timestamptz, revoked_at timestamptz);
create table game_completion_closing(game_id uuid, session_id uuid, generation bigint, intent_id uuid, deadline_at timestamptz);
create table m4_output_intents(intent_id uuid, phase text, delivery_recorded_at timestamptz);
create table broadcast_sessions(game_id uuid, provider text, transport text, desired_state text, operation_generation bigint);
create function authorize_game_broadcast_actor(uuid,uuid,boolean) returns boolean language sql as 'select true';
`);
const exchange = read("0026_add_m4_desktop_authority.sql").match(
  /create function public.exchange_m4_desktop_pairing\([\s\S]*?end \$\$;/,
)[0];
const action = read("0073_bounded_game_completion_closing.sql").match(
  /create or replace function public.m4_desktop_authority_action\([\s\S]*?end \$\$;/,
)[0];
await db.exec(
  exchange +
    action +
    `
revoke all on function exchange_m4_desktop_pairing(uuid,text,text,text), m4_desktop_authority_action(uuid,uuid,bigint,text,boolean) from public;
grant execute on function exchange_m4_desktop_pairing(uuid,text,text,text), m4_desktop_authority_action(uuid,uuid,bigint,text,boolean) to service_role;
insert into games values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',null,null,'active');
insert into game_states values ('11111111-1111-4111-8111-111111111111','{"status":"active"}');
insert into m4_desktop_sessions(session_id,game_id,organization_id,generation,code_hash,challenge_hash,status,pairing_expires_at) values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1,repeat('a',64),repeat('b',64),'pending',now()+interval '1 minute');
`,
);
await db.exec(read("0083_studio_network_grace.sql"));
await db.exec(read("0083_studio_network_grace.sql")); // repeat-safe
await db.exec("set role service_role");
let result = await db.query(
  `select extract(epoch from lease_expires_at-now())::int as seconds from exchange_m4_desktop_pairing('11111111-1111-4111-8111-111111111111',repeat('a',64),repeat('b',64),repeat('c',64))`,
);
assert.equal(result.rows[0].seconds, 90);
const call = (stop) =>
  `select *,extract(epoch from lease_expires_at-now())::int as seconds from m4_desktop_authority_action('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,repeat('c',64),${stop})`;
result = await db.query(call(false));
assert.equal(result.rows[0].seconds, 90);
assert.equal(result.rows[0].desired_action, "wait");
await assert.rejects(
  db.query(call(false).replace("repeat('c',64)", "repeat('d',64)")),
);
await db.exec(
  "reset role; update m4_desktop_sessions set lease_expires_at=now()-interval '1 second'; set role service_role;",
);
await assert.rejects(db.query(call(false)), /expired/);
await db.exec(`reset role;
update m4_desktop_sessions set lease_expires_at=now()+interval '90 seconds';
update games set status='completed',completed_at=now();
insert into game_completion_closing select id,'33333333-3333-4333-8333-333333333333',1,'44444444-4444-4444-8444-444444444444',now()+interval '15 seconds' from games;
insert into m4_output_intents values ('44444444-4444-4444-8444-444444444444','quarantined',now()); set role service_role;`);
result = await db.query(call(false));
assert.ok(result.rows[0].seconds <= 15);
assert.equal(result.rows[0].desired_action, "wait");
result = await db.query(call(true));
assert.equal(result.rows[0].desired_action, "stop");
result = await db.query(call(false));
assert.equal(result.rows[0].desired_action, "stop");
await db.exec("reset role; set role anon");
await assert.rejects(db.query(call(false)), /permission denied/);
await db.close();
console.log(
  "PASS: 90-second exchange/renewal, expired/bad bearer denial, bounded closing, terminal Stop, unchanged role permissions, repeat-safe migration.",
);
