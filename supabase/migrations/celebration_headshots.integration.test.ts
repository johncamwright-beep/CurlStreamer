import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table public.organizations(id uuid primary key);
  create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  insert into public.organizations values ('${orgA}'),('${orgB}');`);
  await db.exec(
    readFileSync(
      new URL("./0090_celebration_headshots.sql", import.meta.url),
      "utf8",
    ),
  );
}, 30_000);
afterAll(() => db.close());
it("keeps photo metadata inaccessible to browser roles and the storage bucket private", async () => {
  const { rows } = await db.query<{
    rls: boolean;
    anon_read: boolean;
    authenticated_write: boolean;
    service_write: boolean;
  }>(
    `select c.relrowsecurity as rls,has_table_privilege('anon','public.team_celebration_headshots','select') as anon_read,has_table_privilege('authenticated','public.team_celebration_headshots','insert') as authenticated_write,has_table_privilege('service_role','public.team_celebration_headshots','insert,delete') as service_write from pg_class c where c.oid='public.team_celebration_headshots'::regclass`,
  );
  expect(rows[0]).toEqual({
    rls: true,
    anon_read: false,
    authenticated_write: false,
    service_write: true,
  });
  const bucket = await db.query<{
    public: boolean;
    file_size_limit: number;
    allowed_mime_types: string[];
  }>(
    "select public,file_size_limit,allowed_mime_types from storage.buckets where id='celebration-headshots'",
  );
  expect(bucket.rows[0]).toMatchObject({
    public: false,
    file_size_limit: 2097152,
    allowed_mime_types: ["image/png"],
  });
});
it("permits independent coach identities per team and rejects duplicate coach roles or cross-team paths", async () => {
  const insert = (org: string, id: string, kind: string, pathOrg = org) =>
    db.query(
      "insert into public.team_celebration_headshots(organization_id,roster_player_id,player_name,person_kind,storage_path) values($1,$2,$3,$4,$5)",
      [
        org,
        id,
        "Sample coach",
        kind,
        `${pathOrg}/33333333-3333-4333-8333-333333333333.png`,
      ],
    );
  await insert(orgA, "a".repeat(64), "coach");
  await insert(orgB, "b".repeat(64), "coach");
  await expect(insert(orgA, "c".repeat(64), "coach")).rejects.toThrow();
  await expect(insert(orgA, "d".repeat(64), "owner")).rejects.toThrow();
  await expect(insert(orgA, "e".repeat(64), "roster", orgB)).rejects.toThrow();
  await insert(orgA, "f".repeat(64), "roster");
  expect(
    (
      await db.query(
        "select id from public.team_celebration_headshots where organization_id=$1",
        [orgA],
      )
    ).rows,
  ).toHaveLength(2);
});
