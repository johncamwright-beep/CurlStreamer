import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const enabled = Boolean(
  parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(parsed.pathname) &&
  spawnSync("psql", ["--version"]).status === 0,
);
function sql(query: string, service = true) {
  const result = spawnSync(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `${service ? "set role service_role;" : ""}${query}`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: parsed!.hostname,
        PGPORT: parsed!.port || "5432",
        PGDATABASE: parsed!.pathname.slice(1),
        PGUSER: decodeURIComponent(parsed!.username),
        PGPASSWORD: decodeURIComponent(parsed!.password),
      },
    },
  );
  return {
    ok: result.status === 0,
    output: result.stdout.trim(),
    error: result.stderr.trim(),
  };
}
function checked(query: string, service = true) {
  const result = sql(query, service);
  expect(result.ok, result.error).toBe(true);
  return result.output;
}
const hash = () => randomUUID().replaceAll("-", "").repeat(2);
function fixture(visibility: string, role = "owner") {
  const org = randomUUID(),
    owner = randomUUID(),
    id = randomUUID();
  const config = {
    eventName: "Public test",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#000000",
    awayColor: "#ffffff",
    scheduledEnds: 8,
    youtubeTitle: "Public test",
    youtubeVisibility: visibility,
    youtubeEnabled: false,
  };
  const state = {
    id,
    config,
    createdAt: 1,
    scoreEvents: [],
    layout: "split",
    broadcast: "idle",
    status: "active",
    claims: {},
    connections: {},
    sponsors: [],
  };
  checked(
    `insert into public.organizations(id,name) values('${org}','Visibility test');
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','${owner}@visibility.test',now());
    insert into public.user_profiles(user_id,display_name,status) values('${owner}','Visibility user','active');
    insert into public.team_memberships(organization_id,user_id,role,status) values('${org}','${owner}','${role}','active');
    insert into public.team_access(organization_id,paid_expires_at) values('${org}',now()+interval '1 day') on conflict(organization_id) do update set paid_expires_at=excluded.paid_expires_at;
    insert into public.games(id,organization_id,config,status,created_by) values('${id}','${org}','${JSON.stringify(config)}','active','${owner}');
    insert into public.game_states(game_id,version,state) values('${id}',1,'${JSON.stringify(state)}');
    insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,channel_title,connection_status,connection_version) values('${org}','youtube','opaque','channel-public','Visibility','connected',1);`,
    false,
  );
  return { org, owner, id, config, state };
}
function claim(
  a: ReturnType<typeof fixture>,
  desired = "prepared",
  token = randomUUID(),
) {
  return sql(
    `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'${desired}','${token}')`,
  );
}
function delivered(visibility: string) {
  const a = fixture(visibility),
    code = hash(),
    challenge = hash(),
    bearer = hash(),
    token = randomUUID();
  checked(
    `select * from public.approve_m4_desktop_pairing('${a.id}','${a.owner}',false,'${code}','${challenge}')`,
  );
  const grant = JSON.parse(
    checked(
      `select row_to_json(x) from public.exchange_m4_desktop_pairing('${a.id}','${code}','${challenge}','${bearer}') x`,
    ),
  );
  const claimed = claim(a, "prepared", token);
  expect(claimed.ok, claimed.error).toBe(true);
  const journal = JSON.parse(claimed.output);
  checked(
    `select public.record_m4_broadcast_operation('${a.id}',${journal.generation},'${token}','prepared',p_youtube_broadcast_id=>'public-broadcast',p_youtube_stream_id=>'public-stream',p_watch_url=>'https://www.youtube.com/watch?v=publicvideo',p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready')`,
  );
  const intent = randomUUID();
  const args = `'${a.id}','${grant.session_id}',${grant.generation},'${bearer}','${intent}'`;
  checked(`select * from public.claim_m4_output_intent(${args})`);
  checked(`select * from public.consume_m4_output_delivery(${args})`);
  return { ...a, args, intent };
}

describe.skipIf(!enabled)(
  "saved YouTube visibility PostgreSQL authority",
  () => {
    it("allows privacy before claim and freezes it across intent, ready, and Studio sessions", () => {
      const a = fixture("unlisted"),
        season = randomUUID();
      checked(
        `insert into public.seasons(id,organization_id,name,start_date,end_date,status) values('${season}','${a.org}','Edit visibility','2026-09-01','2027-08-31','active')`,
        false,
      );
      const update = (visibility: string) =>
        sql(
          `select public.update_scheduled_team_game('${a.owner}','${a.id}','${season}',null,null,'2027-01-01T12:00:00Z','UTC',null,null,'${JSON.stringify({ ...a.config, youtubeEnabled: true, youtubeVisibility: visibility })}')`,
        );
      expect(update("public").ok).toBe(true);
      const claimed = JSON.parse(
        checked(
          `select row_to_json(x) from public.claim_scheduled_youtube_broadcast('${a.owner}','${a.id}') x`,
        ),
      );
      expect(claimed.youtube_visibility).toBe("public");
      expect(update("private").error).toContain("youtube_visibility_locked");
      checked(
        `select * from public.record_scheduled_youtube_broadcast('${a.owner}','${a.id}','saved-public','https://youtu.be/savedpublic',null,'channel-public',1)`,
      );
      expect(update("private").error).toContain("youtube_visibility_locked");
      const session = fixture("public"),
        sessionSeason = randomUUID();
      checked(
        `insert into public.seasons(id,organization_id,name,start_date,end_date,status) values('${sessionSeason}','${session.org}','Session privacy','2026-09-01','2027-08-31','active')`,
        false,
      );
      expect(claim(session).ok).toBe(true);
      const edit = sql(
        `select public.update_scheduled_team_game('${session.owner}','${session.id}','${sessionSeason}',null,null,'2027-01-01T12:00:00Z','UTC',null,null,'${JSON.stringify({ ...session.config, youtubeVisibility: "private" })}')`,
      );
      expect(edit.error).toContain("youtube_visibility_locked");
      const foreign = fixture("public");
      expect(
        sql(
          `select * from public.get_scheduled_youtube_credentials('${foreign.owner}','${a.id}')`,
        ).ok,
      ).toBe(false);
    }, 20_000);
    it.each(["unlisted", "public", "private"])(
      "prepares and asserts %s under the original once-only authority",
      (visibility) => {
        const a = delivered(visibility);
        const asserted = JSON.parse(
          checked(
            `select row_to_json(x) from public.assert_m4_output_delivery(${a.args}) x`,
          ),
        );
        expect(asserted.youtube_visibility).toBe(visibility);
        expect(
          sql(`select * from public.consume_m4_output_delivery(${a.args})`).ok,
        ).toBe(false);
        expect(
          sql(
            `set role authenticated; select * from public.assert_m4_output_delivery(${a.args})`,
            false,
          ).ok,
        ).toBe(false);
        expect(
          sql(
            `select * from public.visibility_legacy_assert_m4_output_delivery(${a.args})`,
          ).ok,
        ).toBe(false);
        checked(
          `update public.games set status='closed' where id='${a.id}'`,
          false,
        );
        expect(
          sql(`select * from public.assert_m4_output_delivery(${a.args})`).ok,
        ).toBe(false);
      },
    );
    it("keeps same-team authorization and rejects missing or invalid visibility", () => {
      const a = fixture("public"),
        b = fixture("public");
      expect(claim({ ...a, owner: b.owner }).ok).toBe(false);
      for (const value of ["invalid", "", null]) {
        const item = fixture("unlisted");
        checked(
          `update public.games set config=jsonb_set(config,'{youtubeVisibility}','${JSON.stringify(value)}') where id='${item.id}'`,
          false,
        );
        expect(claim(item).ok).toBe(false);
      }
    });
    it("retains Public configuration in an empty replacement and fences a saved stopped link", () => {
      const a = fixture("public"),
        stopped = claim(a, "stopped");
      expect(stopped.ok, stopped.error).toBe(true);
      const replacement = claim(a);
      expect(replacement.ok, replacement.error).toBe(true);
      expect(JSON.parse(replacement.output).visibility).toBe("public");
      const saved = delivered("public"),
        token = randomUUID();
      const stopping = claim(saved, "stopped", token);
      expect(stopping.ok, stopping.error).toBe(true);
      checked(
        `select public.record_m4_broadcast_operation('${saved.id}',${JSON.parse(stopping.output).generation},'${token}','stopped')`,
      );
      expect(claim(saved).error).toContain(
        "previous output lease has not expired",
      );
      checked(
        `update public.m4_desktop_sessions set lease_expires_at=now()-interval '10 seconds' where game_id='${saved.id}'`,
        false,
      );
      const ended = claim(saved);
      expect(ended.ok).toBe(false);
      expect(ended.error).toContain("saved broadcast has ended");
    });
    it.each(["public", "private", "unlisted"])(
      "creates and journals one %s scheduled page for an authorized operator",
      (visibility) => {
        const a = fixture(visibility, "game_operator"),
          season = randomUUID(),
          id = randomUUID();
        checked(
          `insert into public.seasons(id,organization_id,name,start_date,end_date,status) values('${season}','${a.org}','Visibility season','2026-09-01','2027-08-31','active')`,
          false,
        );
        const config = { ...a.config, youtubeEnabled: true };
        const state = { ...a.state, id, config };
        const args = `'${a.owner}','${id}','${season}',null,null,'2027-01-01T12:00:00Z','UTC',null,null,'${JSON.stringify(config)}','${JSON.stringify(state)}'`;
        checked(`select public.create_scheduled_team_game(${args})`);
        const claimed = JSON.parse(
          checked(
            `select row_to_json(x) from public.claim_scheduled_youtube_broadcast('${a.owner}','${id}') x`,
          ),
        );
        expect(claimed.action).toBe("run");
        expect(claimed.youtube_visibility).toBe(visibility);
        const credentials = JSON.parse(
          checked(
            `select row_to_json(x) from public.get_scheduled_youtube_credentials('${a.owner}','${id}') x`,
          ),
        );
        expect(credentials.youtube_visibility).toBe(visibility);
        const record = `'${a.owner}','${id}','scheduled-public','https://www.youtube.com/watch?v=scheduledpublic',null,'channel-public',1`;
        expect(
          JSON.parse(
            checked(
              `select row_to_json(x) from public.record_scheduled_youtube_broadcast(${record}) x`,
            ),
          ).status,
        ).toBe("ready");
        expect(
          JSON.parse(
            checked(
              `select row_to_json(x) from public.claim_scheduled_youtube_broadcast('${a.owner}','${id}') x`,
            ),
          ).action,
        ).toBe("none");
        const invalidId = randomUUID();
        expect(
          sql(
            `select public.create_scheduled_team_game('${a.owner}','${invalidId}','${season}',null,null,'2027-01-01T12:00:00Z','UTC',null,null,'${JSON.stringify({ ...config, youtubeVisibility: "invalid" })}','${JSON.stringify({ ...state, id: invalidId })}')`,
          ).ok,
        ).toBe(false);
      },
    );
  },
);
