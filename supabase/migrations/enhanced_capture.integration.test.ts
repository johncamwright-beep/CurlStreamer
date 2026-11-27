import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  append,
  emptyState,
  setLineup,
  type Command,
  type State,
} from "../../src/lib/curlcoach/model";
import {
  catalogue,
  defaultPreferences,
  emptySupplement,
  supplementSchema,
} from "../../src/lib/curlcoach/enhanced-catalog";
import { optionFixture } from "../../src/test/enhanced-fixtures";

// In-memory PostgreSQL only: no network, credentials or production data.
const db = new PGlite();
const org = randomUUID(),
  actor = randomUUID(),
  other = randomUUID(),
  outsider = randomUUID(),
  game = randomUUID(),
  shotId = randomUUID();
const q = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
let state: State;
const read = async (a = actor) =>
  (
    await db.query<{ result: unknown[] }>(
      `select public.read_shot_tracker_enhanced('${a}','${org}','${game}') result`,
    )
  ).rows[0].result;
const save = (options: {
  actor?: string;
  kind?: string;
  request?: string;
  expected?: number;
  source?: number;
  value?: unknown;
  command?: Command;
  next?: State;
  game?: string | null;
}) => {
  const kind = options.kind ?? "supplement",
    g =
      options.game === null || kind === "preferences"
        ? "null"
        : `'${options.game ?? game}'`;
  return db.query<{ result: { state: State; revision: number } }>(
    `select public.save_shot_tracker_enhanced('${options.actor ?? actor}','${org}',${g},${kind === "supplement" ? `'${shotId}'` : "null"},'${kind}','${options.request ?? randomUUID()}',${options.expected ?? 0},${options.source ?? 2},${q(options.value ?? emptySupplement())},${options.command ? q(options.command) : "null"},${options.next ? q(options.next) : "null"}) result`,
  );
};
const standard = async (command: Command) => {
  const next = append(state, command, actor);
  await db.query(
    `select public.apply_curlcoach_command('${actor}','${org}','${game}','${command.requestId}',${command.expectedRevision},'command',${q(command)},${q(next)})`,
  );
  state = next;
};
describe("Enhanced PostgreSQL transaction and authorization", () => {
  beforeAll(async () => {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role,anon,authenticated;
      create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create table public.organizations(id uuid primary key);
      create table public.user_profiles(user_id uuid,status text);
      create table public.team_memberships(user_id uuid,organization_id uuid,status text);
      create table public.games(id uuid primary key,organization_id uuid,status text,deleted_at timestamptz);`);
    for (const file of [
      "0058_curlcoach.sql",
      "0071_curlcoach_lineups.sql",
      "0072_curlcoach_closed_game_guard.sql",
      "0077_shot_tracker_charting_lifecycle.sql",
      "0086_enhanced_shot_capture.sql",
    ])
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.exec(
      `insert into auth.users values('${actor}',now()),('${other}',now()),('${outsider}',now()); insert into organizations values('${org}'); insert into user_profiles values('${actor}','active'),('${other}','active'),('${outsider}','active'); insert into team_memberships values('${actor}','${org}','active'),('${other}','${org}','active'),('${outsider}','${org}','active'); insert into games values('${game}','${org}','scheduled',null); insert into curlcoach_module_entitlements(organization_id) values('${org}'); insert into curlcoach_coach_access(organization_id,user_id) values('${org}','${actor}'),('${org}','${other}');`,
    );
    state = { ...emptyState(), organizationId: org, gameId: game };
    const lineup = {
      action: "set-lineup" as const,
      requestId: randomUUID(),
      expectedRevision: 0,
      lineup: [
        "lead",
        "lead",
        "second",
        "second",
        "third",
        "third",
        "fourth",
        "fourth",
      ],
    };
    const next = setLineup(state, lineup, actor);
    await db.exec("set role service_role");
    await db.query(
      `select public.apply_curlcoach_command('${actor}','${org}','${game}','${lineup.requestId}',0,'set-lineup',${q(lineup)},${q(next)})`,
    );
    state = next;
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  it("atomically saves both layers and rejects changed retries", async () => {
    const command: Command = {
      requestId: randomUUID(),
      expectedRevision: 1,
      shotId,
      shot: {
        playerId: "lead",
        position: "Lead",
        end: 1,
        stone: 1,
        type: "Draw",
        turn: "CW C",
        execution: "Make",
        grade: 4,
        deficiency: null,
        line: "On broom",
        review: null,
        excluded: null,
        note: "Keep this",
        flagged: true,
      },
    };
    const next = append(state, command, actor);
    const value = {
      ...emptySupplement(),
      values: { intendedWeight: "back_12" },
    };
    const result = await save({
      command,
      next,
      value,
      request: command.requestId,
    });
    state = result.rows[0].result.state;
    expect(state.events).toHaveLength(1);
    expect(
      (await save({ command, next, value, request: command.requestId }))
        .rows[0],
    ).toEqual(result.rows[0]);
    await expect(
      save({
        command,
        next,
        value: emptySupplement(),
        request: command.requestId,
      }),
    ).rejects.toThrow("Request ID already used");
    expect(await read()).toHaveLength(1);
  });
  it("rolls back Standard writes when the supplement source check fails", async () => {
    const command: Command = {
      requestId: randomUUID(),
      expectedRevision: state.revision!,
      shotId,
      shot: { ...state.events[0].shot!, grade: 0 },
    };
    await expect(
      save({
        command,
        next: append(state, command, actor),
        expected: 1,
        source: 999,
        request: command.requestId,
      }),
    ).rejects.toThrow("Source shot revision conflict");
    const saved = await db.query<{ s: State }>(
      `select public.read_curlcoach_state('${actor}','${org}','${game}') s`,
    );
    expect(saved.rows[0].s).toEqual(state);
    await expect(
      save({
        command,
        next: append(state, command, actor),
        expected: 0,
        source: 3,
        request: command.requestId,
      }),
    ).rejects.toThrow("Enhanced revision conflict");
  });
  it("preserves supplements across Standard mode and old-client grade edits", async () => {
    await save({
      kind: "preferences",
      source: 0,
      value: { ...defaultPreferences, mode: "enhanced" },
    });
    await save({
      kind: "preferences",
      expected: 1,
      source: 0,
      value: defaultPreferences,
    });
    await standard({
      requestId: randomUUID(),
      expectedRevision: state.revision!,
      shotId,
      shot: { ...state.events[0].shot!, grade: 0 },
    });
    await save({
      kind: "preferences",
      expected: 2,
      source: 0,
      value: { ...defaultPreferences, mode: "enhanced" },
    });
    expect(await read()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "supplement",
          revision: 1,
          value: expect.objectContaining({
            values: { intendedWeight: "back_12" },
          }),
        }),
      ]),
    );
    expect(await read(other)).toEqual([]);
    await expect(read(outsider)).rejects.toThrow();
  });
  it("allows closed-game review but not closed-game Standard changes", async () => {
    const requestId = randomUUID(),
      next = {
        ...state,
        revision: state.revision! + 1,
        status: "closed",
        reopened: false,
      };
    await db.query(
      `select public.apply_curlcoach_command('${actor}','${org}','${game}','${requestId}',${state.revision},'finish',${q({ requestId, expectedRevision: state.revision, action: "finish" })},${q(next)})`,
    );
    state = next as State;
    await db.exec(
      `reset role; update public.games set status='completed' where id='${game}'; set role service_role;`,
    );
    await save({
      expected: 1,
      source: 3,
      value: {
        ...emptySupplement(),
        values: { intendedWeight: "back_4", source: "video_review" },
      },
    });
    expect(
      (
        await db.query<{ s: State }>(
          `select public.read_curlcoach_state('${actor}','${org}','${game}') s`,
        )
      ).rows[0].s,
    ).toEqual(state);
    const command = {
      requestId: randomUUID(),
      expectedRevision: state.revision!,
      shotId,
      shot: { ...state.events[0].shot!, grade: 5 },
    };
    await expect(standard(command)).rejects.toThrow();
    await expect(save({ expected: 1, source: 3 })).rejects.toThrow(
      "Enhanced revision conflict",
    );
    const attempts = await Promise.allSettled([
      save({ expected: 2, source: 3 }),
      save({ expected: 2, source: 3 }),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("saves, reloads and corrects every catalogue choice after the event", async () => {
    let revision = 3;
    for (const [key, f] of Object.entries(catalogue))
      for (const choice of f.choices ?? [f.number ? f.max! : f.example]) {
        const value = supplementSchema.parse(
          optionFixture(key, f.multiple ? [String(choice)] : choice),
        );
        await save({ expected: revision++, source: 3, value });
        expect(await read()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "supplement", revision, value }),
          ]),
        );
      }
    expect(
      (
        await db.query<{ s: State }>(
          `select public.read_curlcoach_state('${actor}','${org}','${game}') s`,
        )
      ).rows[0].s,
    ).toEqual(state);
  });
  it("requires explicit reconciliation after a source identity correction", async () => {
    const latest = (await read()).find(
      (d) => (d as { kind: string }).kind === "supplement",
    ) as { revision: number };
    const requestId = randomUUID();
    const next = {
      ...state,
      revision: state.revision! + 1,
      status: "open",
      reopened: true,
    };
    await db.query(
      `select public.apply_curlcoach_command('${actor}','${org}','${game}','${requestId}',${state.revision},'reopen',${q({ requestId, expectedRevision: state.revision, action: "reopen" })},${q(next)})`,
    );
    state = next as State;
    await standard({
      requestId: randomUUID(),
      expectedRevision: state.revision!,
      shotId,
      shot: { ...state.events.at(-1)!.shot!, playerId: "second" },
    });
    const source = state.events.at(-1)!.revision;
    await expect(save({ expected: latest.revision, source })).rejects.toThrow(
      "Explicit source identity reconciliation required",
    );
    await save({
      expected: latest.revision,
      source,
      value: {
        ...emptySupplement(),
        values: {
          sourceReconciliation: "Confirmed the corrected athlete against video",
        },
      },
    });
  });
  it("pins context snapshots and rejects invented definition versions", async () => {
    const latest = (await read()).find(
      (d) => (d as { kind: string }).kind === "supplement",
    ) as { revision: number };
    const source = state.events.at(-1)!.revision;
    await save({
      kind: "context",
      source: 0,
      value: { venue: "Test rink", firstDirection: "a_to_b" },
    });
    const value = {
      ...emptySupplement(),
      definitionRevision: 3,
      contextRevision: 1,
      contextSnapshot: { venue: "Test rink", firstDirection: "a_to_b" },
    };
    await expect(
      save({
        expected: latest.revision,
        source,
        value: { ...value, definitionRevision: 999 },
      }),
    ).rejects.toThrow("Call definition version unavailable");
    await expect(
      save({
        expected: latest.revision,
        source,
        value: { ...value, contextSnapshot: { venue: "Different rink" } },
      }),
    ).rejects.toThrow("Game context version unavailable");
    await save({ expected: latest.revision, source, value });
    await save({
      kind: "context",
      expected: 1,
      source: 0,
      value: { venue: "Test rink", firstDirection: "b_to_a" },
    });
    expect(await read()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "supplement", value }),
      ]),
    );
  });
  it("denies cross-game, removed sources, direct clients and audit mutation", async () => {
    await expect(save({ game: randomUUID(), source: 3 })).rejects.toThrow();
    await expect(save({ actor: other, source: 3 })).rejects.toThrow(
      "Shot unavailable",
    );
    await expect(
      db.exec("select * from public.shot_tracker_enhanced_commands"),
    ).rejects.toThrow();
    await db.exec("reset role");
    await expect(
      db.exec("update public.shot_tracker_enhanced_commands set revision=9"),
    ).rejects.toThrow("append_only");
    await db.exec(
      `update games set deleted_at=now() where id='${game}'; set role service_role;`,
    );
    await expect(read()).rejects.toThrow("Game unavailable");
    await db.exec("reset role; set role authenticated;");
    await expect(read()).rejects.toThrow("permission denied");
    await expect(
      save({ kind: "preferences", value: defaultPreferences }),
    ).rejects.toThrow("permission denied");
  });
});
