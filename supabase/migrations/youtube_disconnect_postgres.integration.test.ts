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
function env() {
  return {
    ...process.env,
    PGHOST: parsed!.hostname,
    PGPORT: parsed!.port || "5432",
    PGDATABASE: parsed!.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed!.username),
    PGPASSWORD: decodeURIComponent(parsed!.password),
  };
}
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
    { encoding: "utf8", env: env() },
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
function fixture() {
  const org = randomUUID(),
    owner = randomUUID(),
    game = randomUUID();
  checked(
    `insert into public.organizations(id,name) values('${org}','Revocation fixture');
  insert into auth.users(id,email,email_confirmed_at) values('${owner}','${owner}@revocation.test',now());
  insert into public.user_profiles(user_id,display_name,status) values('${owner}','Fixture owner','active');
  insert into public.team_memberships(organization_id,user_id,role,status) values('${org}','${owner}','owner','active');
  insert into public.team_access(organization_id,paid_expires_at) values('${org}',now()+interval '1 day') on conflict(organization_id) do update set paid_expires_at=excluded.paid_expires_at;
  insert into public.games(id,organization_id,config,status,created_by) values('${game}','${org}','{"youtubeEnabled":false,"youtubeVisibility":"unlisted"}','active','${owner}');
  insert into public.game_states(game_id,state) values('${game}','{"status":"active","broadcast":"idle","scoreEvents":[]}');
  insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,channel_title,connection_status,connection_version) values('${org}','youtube','opaque','fixture-channel','Fixture','connected',1);`,
    false,
  );
  return { org, owner, game };
}
type Fixture = ReturnType<typeof fixture>;
function begin(a: Fixture) {
  return JSON.parse(
    checked(
      `select row_to_json(r) from public.begin_youtube_disconnect('${a.owner}') r`,
    ),
  ) as {
    organization_id: string;
    encrypted_credentials: string | null;
    connection_version: number;
    disconnect_operation_id: string | null;
  };
}
function finish(
  a: Fixture,
  r: ReturnType<typeof begin>,
  operation = r.disconnect_operation_id,
  version = r.connection_version,
  organization = a.org,
) {
  return sql(
    `select public.finish_youtube_disconnect('${a.owner}','${organization}',${version},'${operation}')`,
  );
}
function expectPending(result: ReturnType<typeof sql>) {
  expect(result.ok).toBe(false);
  expect(result.error).toContain("youtube disconnect pending");
}

describe.skipIf(!enabled)("YouTube disconnect PostgreSQL fence", () => {
  it("preserves an encrypted retry receipt and blocks account, scheduling and manual-stream credential reads", () => {
    const a = fixture();
    checked(
      `insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state,transport,youtube_channel_id) values('${a.game}','${a.org}','youtube','stopped','stopped','local-obs','fixture-channel'); update public.games set config='{"youtubeEnabled":true,"youtubeVisibility":"unlisted"}' where id='${a.game}';`,
      false,
    );
    const r = begin(a);
    expect(r).toMatchObject({
      organization_id: a.org,
      encrypted_credentials: Buffer.from("opaque").toString("base64"),
      connection_version: 2,
    });
    expect(r.disconnect_operation_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(begin(a)).toEqual(r);
    expect(
      checked(
        `select youtube_disconnect_pending,connection_status,last_error_code,encrypted_credentials is not null from public.broadcast_settings where organization_id='${a.org}'`,
        false,
      ),
    ).toBe("t|reconnect_required|disconnect_pending|t");
    expectPending(
      sql(`select * from public.get_youtube_credentials('${a.owner}')`),
    );
    expectPending(
      sql(
        `select * from public.get_scheduled_youtube_credentials('${a.owner}','${a.game}')`,
      ),
    );
    expectPending(
      sql(
        `select public.get_m4_broadcast_session('${a.game}','${a.owner}',false)`,
      ),
    );
    expectPending(
      sql(
        `select * from public.begin_youtube_oauth('${a.owner}','${"a".repeat(64)}',now()+interval '5 minutes')`,
      ),
    );
    expectPending(
      sql(
        `select public.complete_youtube_connection('${a.owner}','${a.org}',2,'${Buffer.from("new-opaque").toString("base64")}','fixture-channel','New')`,
      ),
    );
    expectPending(
      sql(
        `select public.finish_youtube_connection_test('${a.owner}','${a.org}',2,true,null)`,
      ),
    );
  });

  it("cleans only the matching receipt, accepts duplicate completion, and cannot erase a new grant", () => {
    const a = fixture(),
      r = begin(a);
    for (const attempt of [
      finish(a, r, randomUUID()),
      finish(a, r, r.disconnect_operation_id, 1),
      finish(
        a,
        r,
        r.disconnect_operation_id,
        r.connection_version,
        randomUUID(),
      ),
    ])
      expect(attempt.ok).toBe(false);
    expect(
      checked(
        `select encrypted_credentials is not null from public.broadcast_settings where organization_id='${a.org}'`,
        false,
      ),
    ).toBe("t");
    expect(finish(a, r).output).toBe("3");
    expect(finish(a, r).output).toBe("3");
    expect(
      checked(
        `select connection_status,encrypted_credentials is null,youtube_disconnect_pending,connection_version from public.broadcast_settings where organization_id='${a.org}'`,
        false,
      ),
    ).toBe("disconnected|t|f|3");
    expect(begin(a)).toMatchObject({
      encrypted_credentials: null,
      disconnect_operation_id: null,
      connection_version: 3,
    });
    checked(
      `select public.complete_youtube_connection('${a.owner}','${a.org}',3,'${Buffer.from("new-opaque").toString("base64")}','new-channel','New')`,
    );
    expect(finish(a, r).ok).toBe(false);
    expect(
      checked(
        `select channel_id,connection_version,encrypted_credentials is not null from public.broadcast_settings where organization_id='${a.org}'`,
        false,
      ),
    ).toBe("new-channel|4|t");
  });

  it("requires a verified active manager on begin and completion and denies client RPC access", () => {
    const a = fixture();
    const backupOwner = randomUUID();
    checked(
      `insert into auth.users(id,email,email_confirmed_at) values('${backupOwner}','${backupOwner}@revocation.test',now()); insert into public.user_profiles(user_id,display_name,status) values('${backupOwner}','Backup owner','active'); insert into public.team_memberships(organization_id,user_id,role,status) values('${a.org}','${backupOwner}','owner','active');`,
      false,
    );
    checked(
      `update public.team_memberships set role='scorer' where user_id='${a.owner}'`,
      false,
    );
    expect(
      sql(`select * from public.begin_youtube_disconnect('${a.owner}')`).ok,
    ).toBe(false);
    checked(
      `update public.team_memberships set role='team_admin' where user_id='${a.owner}'`,
      false,
    );
    const r = begin(a);
    checked(
      `update auth.users set email_confirmed_at=null where id='${a.owner}'`,
      false,
    );
    expect(finish(a, r).ok).toBe(false);
    checked(
      `update auth.users set email_confirmed_at=now() where id='${a.owner}';update public.user_profiles set status='suspended' where user_id='${a.owner}'`,
      false,
    );
    expect(finish(a, r).ok).toBe(false);
    const other = fixture();
    checked(
      `update public.user_profiles set status='active' where user_id='${a.owner}'; update public.team_memberships set organization_id='${other.org}' where user_id='${a.owner}'`,
      false,
    );
    const moved = finish(a, r);
    expect(moved.ok).toBe(false);
    expect(moved.error).toContain("youtube organization changed");
    expect(
      checked(
        `select has_function_privilege('service_role','public.begin_youtube_disconnect(uuid)','execute'),has_function_privilege('authenticated','public.begin_youtube_disconnect(uuid)','execute'),has_function_privilege('anon','public.finish_youtube_disconnect(uuid,uuid,bigint,uuid)','execute'),has_function_privilege('service_role','public.disconnect_youtube_connection(uuid)','execute')`,
        false,
      ),
    ).toBe("t|f|f|f");
  });

  it.each(["preparing", "prepared", "live", "stopping", "failed"])(
    "blocks revocation while a session is %s",
    (status) => {
      const a = fixture();
      checked(
        `insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state) values('${a.game}','${a.org}','youtube','${status}','live')`,
        false,
      );
      const result = sql(
        `select * from public.begin_youtube_disconnect('${a.owner}')`,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("unfinished broadcast");
      expect(
        checked(
          `select youtube_disconnect_pending,connection_version,connection_status from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("f|1|connected");
    },
  );

  it("fences new sessions and in-flight scheduling while allowing idle reserved watch pages to disconnect", () => {
    const a = fixture();
    checked(
      `update public.games set youtube_scheduled_status='ready',youtube_scheduled_broadcast_id='reserved01',youtube_scheduled_watch_url='https://www.youtube.com/watch?v=reserved01' where id='${a.game}'`,
      false,
    );
    begin(a);
    expectPending(
      sql(
        `insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state) values('${a.game}','${a.org}','youtube','preparing','live')`,
        false,
      ),
    );
    expectPending(
      sql(
        `update public.games set youtube_scheduled_status='intent' where id='${a.game}'`,
        false,
      ),
    );
    const b = fixture();
    checked(
      `update public.games set youtube_scheduled_status='intent' where id='${b.game}'`,
      false,
    );
    expect(
      sql(`select * from public.begin_youtube_disconnect('${b.owner}')`).error,
    ).toContain("unfinished broadcast");
    const c = fixture();
    checked(
      `insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state,youtube_channel_id) values('${c.game}','${c.org}','youtube','idle','stopped','fixture-channel')`,
      false,
    );
    begin(c);
    expectPending(
      sql(
        `select public.get_game_broadcast_session('${c.game}','${c.owner}',false)`,
      ),
    );
    expectPending(
      sql(
        `update public.broadcast_sessions set status='preparing',desired_state='live' where game_id='${c.game}'`,
        false,
      ),
    );
  });

  it("serializes an in-flight session insert before the disconnect preflight", async () => {
    const a = fixture();
    const marker = `revocation-race-${randomUUID()}`;
    const query = `begin; insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state) values('${a.game}','${a.org}','youtube','preparing','live'); select pg_sleep(0.6) /* ${marker} */; commit;`;
    const child = spawn(
      "psql",
      ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", query],
      { env: env(), stdio: "ignore" },
    );
    const completion = new Promise<number | null>((resolve) =>
      child.on("exit", resolve),
    );
    let sleeping = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      sleeping =
        checked(
          `select exists(select 1 from pg_stat_activity where query like '%${marker}%' and wait_event='PgSleep')`,
          false,
        ) === "t";
      if (sleeping) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sleeping).toBe(true);
    const result = sql(
      `select * from public.begin_youtube_disconnect('${a.owner}')`,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unfinished broadcast");
    expect(await completion).toBe(0);
  });
  it("serializes a disconnect fence before a concurrent new session", async () => {
    const a = fixture(),
      marker = `revocation-first-${randomUUID()}`;
    const query = `begin; select * from public.begin_youtube_disconnect('${a.owner}'); select pg_sleep(0.6) /* ${marker} */; commit;`;
    const child = spawn(
      "psql",
      ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", query],
      { env: env(), stdio: "ignore" },
    );
    const completion = new Promise<number | null>((resolve) =>
      child.on("exit", resolve),
    );
    let sleeping = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      sleeping =
        checked(
          `select exists(select 1 from pg_stat_activity where query like '%${marker}%' and wait_event='PgSleep')`,
          false,
        ) === "t";
      if (sleeping) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sleeping).toBe(true);
    expectPending(
      sql(
        `insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state) values('${a.game}','${a.org}','youtube','preparing','live')`,
        false,
      ),
    );
    expect(await completion).toBe(0);
    expect(
      checked(
        `select count(*) from public.broadcast_sessions where game_id='${a.game}'`,
        false,
      ),
    ).toBe("0");
  });
});
