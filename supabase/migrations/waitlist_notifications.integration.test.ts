import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create role service_role;",
  );
  await db.exec(
    readFileSync("supabase/migrations/0046_pilot_waitlist.sql", "utf8"),
  );
  await db.exec(
    "insert into pilot_waitlist(email,team) values('existing@example.com','Existing');",
  );
  await db.exec(
    readFileSync("supabase/migrations/0092_waitlist_notifications.sql", "utf8"),
  );
});
afterAll(() => db.close());
it("keeps existing entries without backfilling email and claims new signups only once", async () => {
  expect(
    (
      await db.query(
        "select * from claim_waitlist_notification('existing@example.com')",
      )
    ).rows,
  ).toEqual([]);
  await db.query("select join_pilot_waitlist('new@example.com','Team',$1)", [
    "a".repeat(64),
  ]);
  const first = await db.query<{ id: string; notification_attempt_id: string }>(
    "select * from claim_waitlist_notification('new@example.com')",
  );
  expect(first.rows).toHaveLength(1);
  expect(
    (
      await db.query(
        "select * from claim_waitlist_notification('new@example.com')",
      )
    ).rows,
  ).toEqual([]);
  const row = first.rows[0];
  await db.query("select finish_waitlist_notification($1,$2,'accepted')", [
    row.id,
    row.notification_attempt_id,
  ]);
  await db.query("select join_pilot_waitlist('new@example.com','Changed',$1)", [
    "b".repeat(64),
  ]);
  expect(
    (
      await db.query(
        "select * from claim_waitlist_notification('new@example.com')",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await db.query(
        "select notification_status,notification_sent_at is not null as sent from pilot_waitlist where email='new@example.com'",
      )
    ).rows,
  ).toEqual([{ notification_status: "accepted", sent: true }]);
});
it("denies public access to notification state and claim functions", async () => {
  const result = await db.query(
    "select has_function_privilege('authenticated','claim_waitlist_notification(text)','execute') claim,has_table_privilege('anon','pilot_waitlist','select') read",
  );
  expect(result.rows).toEqual([{ claim: false, read: false }]);
});
