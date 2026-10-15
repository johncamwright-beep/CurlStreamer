import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const enabled = Boolean(
  parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(parsed.pathname) &&
  spawnSync("psql", ["--version"]).status === 0,
);
const environment = () => {
  if (!parsed) throw Error("Disposable PostgreSQL required");
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
};
const args = [
  "-X",
  "-w",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  "VERBOSITY=verbose",
];
function sql(text: string) {
  const result = spawnSync("psql", [...args, "-c", text], {
    encoding: "utf8",
    env: environment(),
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.replaceAll("\r", "").trim(),
    stderr: result.stderr.trim(),
  };
}
function asyncSql(text: string, applicationName: string) {
  return new Promise<ReturnType<typeof sql>>((resolve) => {
    const process = spawn("psql", [...args, "-c", text], {
      env: { ...environment(), PGAPPNAME: applicationName },
    });
    let stdout = "",
      stderr = "";
    process.stdout.on("data", (data) => {
      stdout += String(data);
    });
    process.stderr.on("data", (data) => {
      stderr += String(data);
    });
    process.on("close", (code) =>
      resolve({
        ok: code === 0,
        stdout: stdout.replaceAll("\r", "").trim(),
        stderr: stderr.trim(),
      }),
    );
  });
}
const json = (value: unknown) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const ends = [{ end: 1, team: "away", points: 3, blank: false }];
function fixture(completed = true, published = true) {
  const game = randomUUID(),
    org = randomUUID(),
    owner = randomUUID(),
    review = randomUUID();
  const event = {
    id: randomUUID(),
    at: 1,
    type: "end",
    score: { end: 1, team: "home", points: 1, blank: false },
  };
  const config = {
    eventName: "Correction fixture",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#000000",
    awayColor: "#ffffff",
    scheduledEnds: 8,
    youtubeTitle: "Fixture",
    youtubeVisibility: "unlisted",
  };
  const state = {
    id: game,
    config,
    createdAt: 1,
    scoreEvents: [event],
    layout: "split",
    broadcast: "idle",
    status: "active",
    audioMuted: false,
    claims: {},
    connections: {},
    sponsors: [],
    sponsorMode: { active: false },
  };
  const account = (
    id: string,
    role = "owner",
    verified = true,
    active = true,
    organization = org,
  ) => `
    insert into auth.users(id,email,email_confirmed_at) values('${id}','${id}@result.test',${verified ? "now()" : "null"});
    insert into public.user_profiles(user_id,display_name,status) values('${id}','Fixture','${active ? "active" : "suspended"}');
    insert into public.team_memberships(organization_id,user_id,role,status) values('${organization}','${id}','${role}','active');`;
  const setup = `
    insert into public.organizations(id,name) values('${org}','Result fixture');
    ${account(owner)}
    insert into public.organizer_users(organization_id,user_id) values('${org}','${owner}');
    insert into public.games(id,organization_id,config,status,created_by) values('${game}','${org}',${json(config)},'active','${owner}');
    insert into public.game_states(game_id,state) values('${game}',${json(state)});
    insert into public.score_events(id,game_id,event_type,payload,actor) values('${event.id}','${game}','end',${json(event)},'test');
    insert into public.team_public_profiles(organization_id,slug,settings) values('${org}','t-${org}', '{"published":${published},"results":true}');
    ${
      completed
        ? `select review_id from public.review_game_completion('${game}','${review}','${owner}',false);
    select completion_id from public.complete_reviewed_game('${game}','${review}','${randomUUID()}','${owner}',false);`
        : ""
    }`;
  const revision = `(public.read_completed_game_result('${game}','${owner}')->>'revision')::bigint`;
  const correct = (
    request = randomUUID(),
    actor = owner,
    expected = revision,
    scores: unknown = ends,
    reason = "Correct wrong team",
  ) =>
    `public.correct_completed_game_result('${game}','${actor}','${request}',${expected},${json(scores)},'${reason}')`;
  return { game, org, owner, setup, account, revision, correct };
}

describe.skipIf(!enabled)(
  "completed result correction PostgreSQL transactions",
  () => {
    it("returns the current canonical result on a delayed retry after a newer correction", () => {
      const f = fixture(),
        request = randomUUID();
      const newer = [{ end: 1, team: "home", points: 4, blank: false }];
      const result = sql(`begin;${f.setup}
        create temp table initial_revision as select ${f.revision} original;
        select ${f.correct(request)};
        select ${f.correct(randomUUID(), f.owner, f.revision, newer)};
        select (${f.correct(request, f.owner, "(select original from initial_revision)")})#>>'{completion,result,totals,home}';
        select (${f.correct(request, f.owner, "(select original from initial_revision)")})->>'revision' = ${f.revision}::text;
        select count(*) from public.game_result_corrections where game_id='${f.game}';
        rollback;`);
      expect(result.ok, result.stderr).toBe(true);
      expect(result.stdout.split("\n").slice(-3)).toEqual(["4", "t", "2"]);
    });

    it("preserves original evidence and lifecycle while every final projection derives the correction", () => {
      const f = fixture();
      const request = randomUUID();
      const evidence = `jsonb_build_object('game',to_jsonb(g),'state',gs.state,'completion',to_jsonb(c),'cleanup',to_jsonb(cl),'events',(select jsonb_agg(to_jsonb(e) order by sequence) from public.score_events e where e.game_id=g.id))`;
      const result = sql(`begin; ${f.setup}
      create temp table evidence as select ${evidence} data from public.games g join public.game_states gs on gs.game_id=g.id join public.game_completions c on c.game_id=g.id join public.game_completion_cleanup cl on cl.game_id=g.id where g.id='${f.game}';
      create temp table revision as select ${f.revision} original;
      set role service_role;
      select (${f.correct(request)})#>>'{completion,result,totals,away}';
      reset role;
      select data=${evidence} from evidence,public.games g join public.game_states gs on gs.game_id=g.id join public.game_completions c on c.game_id=g.id join public.game_completion_cleanup cl on cl.game_id=g.id where g.id='${f.game}';
      set role service_role;
      select public.read_game_completion_summary('${f.game}')#>>'{result,totals,away}';
      select completion_result#>>'{totals,away}' from public.list_team_hierarchy_games('${f.owner}') where id='${f.game}';
      select public.read_public_team_games('${f.org}')#>>'{0,result,away}';
      reset role;
      select (${f.correct(request, f.owner, "(select original from revision)")})#>>'{completion,result,totals,away}';
      select count(*) from public.game_result_corrections where game_id='${f.game}';
      rollback;`);
      expect(result.ok, result.stderr).toBe(true);
      expect(result.stdout.split("\n").slice(-7)).toEqual([
        "3",
        "t",
        "3",
        "3",
        "3",
        "3",
        "1",
      ]);
    });

    it("enforces signed-in same-team verified owner/admin authority and terminal/deletion boundaries", () => {
      for (const [role, verified, active] of [
        ["scorer", true, true],
        ["game_operator", true, true],
        ["owner", false, true],
        ["owner", true, false],
      ] as const) {
        const f = fixture(),
          actor = randomUUID();
        const result = sql(
          `begin;${f.setup}${f.account(actor, role, verified, active)} set role service_role;select ${f.correct(randomUUID(), actor)};rollback;`,
        );
        expect(result.ok).toBe(false);
        expect(result.stderr).toContain("42501");
      }
      const admin = fixture(),
        actor = randomUUID();
      const allowed = sql(
        `begin;${admin.setup}${admin.account(actor, "team_admin")}set role service_role;select (${admin.correct(randomUUID(), actor)})#>>'{completion,result,outcome}';rollback;`,
      );
      expect(allowed.ok, allowed.stderr).toBe(true);
      expect(allowed.stdout.split("\n").at(-1)).toBe("away_win");
      for (const completed of [false, true]) {
        const f = fixture(completed);
        const result = sql(
          `begin;${f.setup}${completed ? `update public.games set deleted_at=now() where id='${f.game}';` : ""}set role service_role;select ${f.correct()};rollback;`,
        );
        expect(result.ok).toBe(false);
        expect(result.stderr).toContain("55000");
      }
    });

    it("rejects malformed ends, stale revision and reused request IDs; append history cannot be changed directly", () => {
      for (const scores of [
        [{ end: 2, team: "away", points: 3, blank: false }],
        [{ end: 1, team: "home", points: 0, blank: false }],
        [{ end: 1, team: "home", points: 2, blank: true }],
        [{ end: 1, team: null, points: 0, blank: false }],
      ]) {
        const f = fixture();
        const result = sql(
          `begin;${f.setup}set role service_role;select ${f.correct(randomUUID(), f.owner, f.revision, scores)};rollback;`,
        );
        expect(result.ok).toBe(false);
        expect(result.stderr).toContain("22023");
      }
      for (const stale of [true, false]) {
        const f = fixture(),
          request = randomUUID();
        const result = sql(
          `begin;${f.setup}create temp table rev as select ${f.revision} original;select ${f.correct(request)};select ${stale ? f.correct(randomUUID(), f.owner, "(select original from rev)") : f.correct(request, f.owner, "(select original from rev)", [], "Different payload")};rollback;`,
        );
        expect(result.ok).toBe(false);
        expect(result.stderr).toContain("PT409");
      }
      const f = fixture();
      for (const mutation of [
        "update public.game_result_corrections set reason='changed'",
        "delete from public.game_result_corrections",
      ]) {
        const result = sql(
          `begin;${f.setup}select ${f.correct()};${mutation} where game_id='${f.game}';rollback;`,
        );
        expect(result.ok).toBe(false);
        expect(result.stderr).toContain("result_corrections_append_only");
      }
      for (const role of ["anon", "authenticated", "service_role"]) {
        expect(
          sql(`set role ${role};select * from public.game_result_corrections`)
            .ok,
        ).toBe(false);
        if (role !== "service_role")
          expect(
            sql(
              `set role ${role};select public.read_completed_game_result('${f.game}','${f.owner}')`,
            ).ok,
          ).toBe(false);
        expect(
          sql(
            `set role ${role};select public.authorize_completed_result_actor('${f.game}','${f.owner}')`,
          ).ok,
        ).toBe(false);
      }
    });

    it("keeps unpublished and deleted results private and rejects another team's owner", () => {
      const f = fixture(true, false),
        otherOrg = randomUUID(),
        outsider = randomUUID();
      const denied = sql(
        `begin;${f.setup}insert into public.organizations(id,name) values('${otherOrg}','Other team');${f.account(outsider, "owner", true, true, otherOrg)}set role service_role;select public.read_completed_game_result('${f.game}','${outsider}');rollback;`,
      );
      expect(denied.ok).toBe(false);
      expect(denied.stderr).toContain("42501");
      const privateResult = sql(`begin;${f.setup}select ${f.correct()};
        set role service_role;select public.read_public_team_games('${f.org}');reset role;
        select public.soft_delete_team_game('${f.owner}','${f.game}');
        set role service_role;select public.read_public_team_games('${f.org}');
        select count(*) from public.list_team_hierarchy_games('${f.owner}') where id='${f.game}';
        select public.read_game_completion_summary('${f.game}') is null;
        rollback;`);
      expect(privateResult.ok, privateResult.stderr).toBe(true);
      expect(privateResult.stdout.split("\n").slice(-5)).toEqual([
        "[]",
        "t",
        "[]",
        "0",
        "t",
      ]);
    });

    it("serializes with deletion and observes the terminal deletion after the lock is released", async () => {
      const f = fixture();
      expect(sql(f.setup).ok).toBe(true);
      const revision = sql(`select ${f.revision}`).stdout;
      const application = `result-delete-${randomUUID()}`;
      const deletion = asyncSql(
        `begin;set role service_role;select public.soft_delete_team_game('${f.owner}','${f.game}');select pg_sleep(1);commit;`,
        application,
      );
      let acquired = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        acquired =
          sql(
            `select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event='PgSleep')`,
          ).stdout === "t";
        if (acquired) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(acquired).toBe(true);
      const correction = asyncSql(
        `set role service_role;select ${f.correct(randomUUID(), f.owner, revision)};`,
        `${application}-correction`,
      );
      expect((await deletion).ok).toBe(true);
      const denied = await correction;
      expect(denied.ok).toBe(false);
      expect(denied.stderr).toContain("55000");
      expect(
        sql(
          `select count(*) from public.game_result_corrections where game_id='${f.game}'`,
        ).stdout,
      ).toBe("0");
    }, 10_000);

    it("serializes concurrent corrections on lifecycle rows so only one expected revision succeeds", async () => {
      const f = fixture();
      expect(sql(f.setup).ok).toBe(true);
      const revision = sql(`select ${f.revision}`).stdout;
      const application = `result-correction-${randomUUID()}`;
      const first = asyncSql(
        `begin;set role service_role;select ${f.correct(randomUUID(), f.owner, revision)};select pg_sleep(1);commit;`,
        application,
      );
      let acquired = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        acquired =
          sql(
            `select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event='PgSleep')`,
          ).stdout === "t";
        if (acquired) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(acquired).toBe(true);
      const second = asyncSql(
        `set role service_role;select ${f.correct(randomUUID(), f.owner, revision, [])};`,
        `${application}-second`,
      );
      expect((await first).ok).toBe(true);
      const rejected = await second;
      expect(rejected.ok).toBe(false);
      expect(rejected.stderr).toContain("PT409");
      expect(
        sql(
          `select count(*) from public.game_result_corrections where game_id='${f.game}'`,
        ).stdout,
      ).toBe("1");
    }, 10_000);
  },
);
