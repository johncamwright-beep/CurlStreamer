import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("resolves an active team through the service RPC while games remains unreadable", async () => {
  const db = new PGlite();
  const game = "11111111-1111-4111-8111-111111111111";
  const org = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.games(id uuid primary key, organization_id uuid, status text, deleted_at timestamptz, completed_at timestamptz);
      create table public.game_states(game_id uuid, state jsonb);
      insert into public.games values ('${game}','${org}','scheduled',null,null);
      insert into public.game_states values ('${game}','{"status":"active"}');
    `);
    await db.exec(
      readFileSync(
        "supabase/migrations/0091_celebration_game_lookup.sql",
        "utf8",
      ),
    );
    await db.exec("set role service_role");
    await expect(
      db.query("select organization_id from public.games"),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await db.query(
          `select public.read_celebration_game_organization('${game}') as org`,
        )
      ).rows,
    ).toEqual([{ org }]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await expect(
        db.query(`select public.read_celebration_game_organization('${game}')`),
      ).rejects.toThrow(/permission denied/);
    }
    await db.exec("reset role");
    for (const change of [
      "deleted_at = now()",
      "completed_at = now()",
      "status = 'closed'",
      "status = 'completed'",
    ]) {
      await db.exec(
        `update public.games set deleted_at=null, completed_at=null, status='scheduled'; update public.games set ${change}; set role service_role`,
      );
      expect(
        (
          await db.query(
            `select public.read_celebration_game_organization('${game}') as org`,
          )
        ).rows,
      ).toEqual([{ org: null }]);
      await db.exec("reset role");
    }
    await db.exec(
      "update public.games set status='scheduled'; update public.game_states set state='{}'; set role service_role",
    );
    expect(
      (
        await db.query(
          `select public.read_celebration_game_organization('${game}') as org`,
        )
      ).rows,
    ).toEqual([{ org: null }]);
  } finally {
    await db.close();
  }
}, 30000);
