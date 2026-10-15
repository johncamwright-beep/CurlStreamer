import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const org = randomUUID(),
  actor = randomUUID(),
  other = randomUUID(),
  event = randomUUID();
const hash = "a".repeat(64);
let lease = randomUUID();
const args = () =>
  `'${actor}','${org}','${event}','players','${hash}','${lease}'`;
async function scalar(sql: string) {
  return (await db.query<{ value: unknown }>(`select ${sql} as value`)).rows[0]
    .value;
}
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public to service_role,anon,authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
    create table public.events(id uuid primary key,organization_id uuid);
    create table public.games(id uuid primary key,event_id uuid,organization_id uuid,status text,deleted_at timestamptz);
    create function public.assert_curlcoach_access(a uuid,o uuid) returns void language plpgsql as $$
    begin if a not in ('${actor}'::uuid,'${other}'::uuid) or o <> '${org}'::uuid then raise exception 'unauthorized'; end if; end $$;
    insert into auth.users values ('${actor}'),('${other}');
    insert into public.organizations values ('${org}');
    insert into public.events values ('${event}','${org}');
    insert into public.games values ('${randomUUID()}','${event}','${org}','completed',null);
  `);
  for (const name of [
    "0074_shot_tracker_reports.sql",
    "0075_shot_tracker_report_allowance.sql",
    "0087_report_progress.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.exec("set role service_role");
});
afterAll(() => db.close());
it("checkpoints privately, resumes with a new lease and rejects a competing worker", async () => {
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${args()})`),
  ).toMatchObject({ status: "claimed" });
  expect(
    await scalar(
      `public.checkpoint_shot_tracker_report(${args()},'player-1','{"key":"player-1","title":"Private"}')`,
    ),
  ).toBe(true);
  expect(
    await scalar(`public.release_shot_tracker_report_step(${args()})`),
  ).toBe(true);
  const old = lease;
  lease = randomUUID();
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${args()})`),
  ).toMatchObject({ status: "claimed" });
  expect(
    await scalar(
      `public.claim_shot_tracker_report_step('${actor}','${org}','${event}','players','${hash}','${randomUUID()}')`,
    ),
  ).toMatchObject({ status: "processing" });
  expect(
    await scalar(
      `public.checkpoint_shot_tracker_report('${actor}','${org}','${event}','players','${hash}','${old}','player-2','{"key":"player-2"}')`,
    ),
  ).toBe(false);
  const rows = await scalar(
    `public.read_shot_tracker_reports('${actor}','${org}','${event}')`,
  );
  expect(rows).toMatchObject([
    { progress: { "player-1": { title: "Private" } } },
  ]);
  expect(JSON.stringify(rows)).not.toContain(lease);
  expect(
    await scalar(
      `public.read_shot_tracker_reports('${other}','${org}','${event}')`,
    ),
  ).toEqual([]);
  expect(
    await scalar(
      `public.checkpoint_shot_tracker_report('${other}','${org}','${event}','players','${hash}','${lease}','player-2','{"key":"player-2"}')`,
    ),
  ).toBe(false);
});
it("retains successful players after failure and a cooldown retry without another event charge", async () => {
  expect(
    await scalar(`public.finish_shot_tracker_report_step(${args()},null)`),
  ).toBe(true);
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${args()})`),
  ).toMatchObject({ status: "cooldown" });
  await db.exec(
    "reset role; update public.shot_tracker_reports set updated_at=now()-interval '4 minutes'; set role service_role",
  );
  lease = randomUUID();
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${args()})`),
  ).toMatchObject({ status: "claimed" });
  expect(
    await scalar(
      `public.read_shot_tracker_reports('${actor}','${org}','${event}')`,
    ),
  ).toMatchObject([{ progress: { "player-1": { title: "Private" } } }]);
  expect(
    await scalar(
      `public.read_shot_tracker_report_allowance('${actor}','${org}','${event}')`,
    ),
  ).toMatchObject({ used: 1, completed: [] });
});
it("does not expose checkpoint functions to browser roles", async () => {
  await db.exec("set role authenticated");
  await expect(
    scalar(`public.release_shot_tracker_report_step(${args()})`),
  ).rejects.toThrow(/permission denied/);
});

it("upgrades an old edition explicitly, retains its original packet and charges no new event", async () => {
  await db.exec("reset role");
  await db.exec(`update public.shot_tracker_reports set status='failed',updated_at=now()-interval '4 minutes';
    insert into public.shot_tracker_reports(organization_id,actor_user_id,event_id,audience,fingerprint,status,lease,packet)
    values('${org}','${actor}','${event}','coach','${"b".repeat(64)}','ready','${randomUUID()}','{"audience":"coach","policy":"shot-tracker-event-v8","reports":[]}');
    update public.shot_tracker_report_events set completed=array['coach']; set role service_role;`);
  const next = `'${actor}','${org}','${event}','coach','${"c".repeat(64)}','${randomUUID()}'`;
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${next})`),
  ).toMatchObject({
    status: "ready",
    packet: { policy: "shot-tracker-event-v8" },
  });
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${next},true)`),
  ).toMatchObject({ status: "claimed" });
  expect(
    await scalar(
      `public.finish_shot_tracker_report_step(${next},'{"audience":"coach","policy":"shot-tracker-event-v9","reports":[]}')`,
    ),
  ).toBe(true);
  expect(
    await scalar(
      `public.read_shot_tracker_report_allowance('${actor}','${org}','${event}')`,
    ),
  ).toMatchObject({ used: 1, completed: ["coach"] });
  expect(
    await scalar(
      `public.read_shot_tracker_reports('${actor}','${org}','${event}')`,
    ),
  ).toMatchObject([
    { audience: "coach", packet: { policy: "shot-tracker-event-v9" } },
    { audience: "players" },
  ]);
  expect(
    await scalar(`public.claim_shot_tracker_report_step(${next},true)`),
  ).toMatchObject({ status: "ready" });
  await db.exec("reset role");
  expect(
    await scalar(
      "(select count(*) from public.shot_tracker_reports where audience='coach' and status='ready')",
    ),
  ).toBe(2);
});
