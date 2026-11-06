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

function due(a: Fixture) {
  checked(
    `update public.broadcast_settings set youtube_authorization_checked_at=now()-interval '25 days' where organization_id='${a.org}'`,
    false,
  );
}
function maintenance(a: Fixture) {
  const rows = JSON.parse(
    checked(
      "select coalesce(json_agg(r),'[]'::json) from public.claim_youtube_authorization_maintenance(100) r",
    ),
  ) as {
    organization_id: string;
    connection_version: number;
    maintenance_claim_id: string;
    disconnect_pending: boolean;
  }[];
  const row = rows.find((r) => r.organization_id === a.org);
  expect(row).toBeDefined();
  return row!;
}
function outcome(
  a: Fixture,
  r: ReturnType<typeof maintenance>,
  result: string,
) {
  return sql(
    `select public.finish_youtube_authorization_maintenance('${a.org}',${r.connection_version},'${r.maintenance_claim_id}','${result}','Current team')`,
  );
}
function providerEvidence(a: Fixture, status = "stopped") {
  const review = randomUUID(),
    manual = randomUUID(),
    desktop = randomUUID(),
    retirement = randomUUID(),
    intent = randomUUID();
  const b = "fixturevideo1",
    stream = "fixture-stream1";
  checked(
    `update public.games set config=config||'{"sharedYoutubeWatchUrl":"https://youtu.be/userentered1"}',youtube_scheduled_status='ready',youtube_scheduled_broadcast_id='${b}',youtube_scheduled_watch_url='https://www.youtube.com/watch?v=${b}',youtube_scheduled_channel_id='fixture-channel',youtube_scheduled_connection_version=1 where id='${a.game}';
  insert into public.broadcast_sessions(game_id,organization_id,provider,status,desired_state,provider_session_id,youtube_broadcast_id,youtube_stream_id,youtube_channel_id,watch_url,started_at) values('${a.game}','${a.org}','youtube','${status}','${status === "stopped" ? "stopped" : "live"}','${b}','${b}','${stream}','fixture-channel','https://www.youtube.com/watch?v=${b}',now());
  insert into public.game_completion_reviews(id,game_id,input_revision,result,reviewer_kind,reviewer_user_id,youtube_watch_url) values('${review}','${a.game}',1,'{"scores":[1,2]}','account','${a.owner}','https://www.youtube.com/watch?v=${b}'),('${manual}','${a.game}',1,'{"scores":[1,2]}','account','${a.owner}','https://youtu.be/userentered2');
  insert into public.game_completions(game_id,completion_id,organization_id,review_id,input_revision,result,result_context,completed_by_kind,completed_by_user_id) values('${a.game}','${randomUUID()}','${a.org}','${review}',1,'{"scores":[1,2]}','{"homeName":"Fixture"}','account','${a.owner}');
  insert into public.m4_desktop_sessions(session_id,game_id,organization_id,generation,status,code_hash,challenge_hash) values('${desktop}','${a.game}','${a.org}',1,'stopped','${randomUUID().replaceAll("-", "").repeat(2)}','${"a".repeat(64)}');
  insert into public.m4_provider_retirements(retirement_id,game_id,organization_id,broadcast_generation,operation_token,youtube_broadcast_id,youtube_stream_id,youtube_channel_id) values('${retirement}','${a.game}','${a.org}',1,'${randomUUID()}','${b}','${stream}','fixture-channel');
  insert into public.m4_output_intents(intent_id,game_id,organization_id,session_id,generation,broadcast_generation,youtube_broadcast_id,youtube_stream_id,phase,delivery_channel_id,provider_retirement_id) values('${intent}','${a.game}','${a.org}','${desktop}',1,1,'${b}','${stream}','stop_requested','fixture-channel','${retirement}');
  insert into public.m4_broadcast_cycle_history(game_id,organization_id,session_key,retirement_id,metadata) values('${a.game}','${a.org}','${randomUUID()}','${retirement}','{"youtube_broadcast_id":"${b}","youtube_stream_id":"${stream}","youtube_channel_id":"fixture-channel","provider_session_id":"${b}","watch_url":"https://www.youtube.com/watch?v=${b}","operation_generation":1}');
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values('${a.owner}','${a.org}','youtube.connected','organization','${a.org}','{"channel_id":"fixture-channel","connection_version":1}'),('${a.owner}','${a.org}','game.youtube_scheduled','game','${a.game}','{"broadcast_id":"${b}"}');`,
    false,
  );
  return { review, manual, b, stream };
}
function assertRedacted(
  a: Fixture,
  e: ReturnType<typeof providerEvidence>,
  retainChannel = false,
) {
  expect(
    checked(
      `select youtube_scheduled_broadcast_id is null,youtube_scheduled_watch_url is null,config->>'sharedYoutubeWatchUrl',status from public.games where id='${a.game}'`,
      false,
    ),
  ).toBe("t|t|https://youtu.be/userentered1|active");
  expect(
    checked(
      `select provider_session_id is null,youtube_broadcast_id is null,youtube_stream_id is null,youtube_channel_id is null,watch_url is null from public.broadcast_sessions where game_id='${a.game}'`,
      false,
    ),
  ).toBe("t|t|t|t|t");
  expect(
    checked(
      `select youtube_broadcast_id is null,youtube_stream_id is null,delivery_channel_id is null from public.m4_output_intents where game_id='${a.game}'`,
      false,
    ),
  ).toBe("t|t|t");
  expect(
    checked(
      `select youtube_broadcast_id is null,youtube_stream_id is null,youtube_channel_id is null from public.m4_provider_retirements where game_id='${a.game}'`,
      false,
    ),
  ).toBe("t|t|t");
  expect(
    checked(
      `select metadata ? 'youtube_broadcast_id',metadata ? 'watch_url',metadata->>'operation_generation' from public.m4_broadcast_cycle_history where game_id='${a.game}'`,
      false,
    ),
  ).toBe("f|f|1");
  expect(
    checked(
      `select youtube_watch_url is null,result->>'scores' from public.game_completions where game_id='${a.game}'`,
      false,
    ),
  ).toBe("t|[1, 2]");
  expect(
    checked(
      `select youtube_watch_url from public.game_completion_reviews where id='${e.manual}'`,
      false,
    ),
  ).toBe("https://youtu.be/userentered2");
  expect(
    checked(
      `select count(*) from public.audit_events where organization_id='${a.org}' and (metadata ? 'broadcast_id' or (${retainChannel ? "false" : "metadata ? 'channel_id'"}))`,
      false,
    ),
  ).toBe("0");
}
describe.skipIf(!enabled)(
  "YouTube authorized-data retention PostgreSQL boundary",
  () => {
    it("redacts every provider copy on in-app withdrawal, preserving scores and independently entered links", () => {
      const a = fixture(),
        e = providerEvidence(a),
        before = checked(
          `select state from public.game_states where game_id='${a.game}'`,
          false,
        );
      const r = begin(a);
      expect(finish(a, r).ok).toBe(true);
      assertRedacted(a, e);
      expect(
        checked(
          `select state from public.game_states where game_id='${a.game}'`,
          false,
        ),
      ).toBe(before);
      expect(finish(a, r).output).toBe("3");
      expect(
        sql(
          `update public.game_completions set result='{"scores":[9,9]}' where game_id='${a.game}'`,
          false,
        ).error,
      ).toContain("immutable");
      expect(
        sql(
          `update public.game_completion_reviews set youtube_watch_url=null,youtube_watch_url_source='none' where id='${e.manual}'`,
          false,
        ).error,
      ).toContain("immutable");
    });
    it("removes externally revoked authorization from a live journal without claiming the broadcast or game stopped", () => {
      const a = fixture(),
        e = providerEvidence(a, "live");
      due(a);
      const r = maintenance(a);
      expect(outcome(a, r, "revoked").output).toBe("removed");
      assertRedacted(a, e);
      expect(
        checked(
          `select status,desired_state from public.broadcast_sessions where game_id='${a.game}'`,
          false,
        ),
      ).toBe("live|live");
      expect(
        checked(
          `select connection_status,encrypted_credentials is null,last_error_code from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("disconnected|t|authorization_revoked_use_youtube_studio");
      expectPending(
        sql(`select * from public.get_youtube_credentials('${a.owner}')`),
      );
    });
    it("resumes pending withdrawal without requiring the original manager still be active", () => {
      const a = fixture();
      begin(a);
      const r = maintenance(a);
      checked(
        `update auth.users set email_confirmed_at=null where id='${a.owner}'`,
        false,
      );
      expect(outcome(a, r, "revocation_confirmed").output).toBe("removed");
      expect(
        checked(
          `select encrypted_credentials is null from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("t");
    });
    it("retains pending credentials during short outages but deletes data before the seven-day limit", () => {
      const a = fixture(),
        e = providerEvidence(a);
      begin(a);
      let r = maintenance(a);
      expect(outcome(a, r, "unavailable").output).toBe("retry");
      expect(
        checked(
          `select encrypted_credentials is not null from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("t");
      checked(
        `update public.broadcast_settings set youtube_withdrawal_requested_at=now()-interval '5 days 1 hour',youtube_maintenance_retry_at=null where organization_id='${a.org}'`,
        false,
      );
      r = maintenance(a);
      expect(outcome(a, r, "unavailable").output).toBe("removed_unconfirmed");
      assertRedacted(a, e);
      expect(
        checked(
          `select last_error_code from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("revocation_unconfirmed_data_removed");
    });
    it("checks due grants at24days, refreshes channel metadata, and prevents duplicate leases", () => {
      const a = fixture();
      due(a);
      const r = maintenance(a);
      const second = JSON.parse(
        checked(
          "select coalesce(json_agg(r),'[]'::json) from public.claim_youtube_authorization_maintenance(100) r",
        ),
      ) as { organization_id: string }[];
      expect(second.some((item) => item.organization_id === a.org)).toBe(false);
      expect(outcome(a, r, "valid").output).toBe("verified");
      expect(
        checked(
          `select channel_title,youtube_authorization_checked_at>now()-interval '1 minute',youtube_maintenance_claim_id is null from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("Current team|t|t");
    });
    it("cannot delete a newer grant after an old maintenance claim returns", () => {
      const a = fixture();
      due(a);
      const r = maintenance(a);
      checked(
        `select public.complete_youtube_connection('${a.owner}','${a.org}',1,'${Buffer.from("new-opaque").toString("base64")}','new-channel','New channel')`,
      );
      expect(outcome(a, r, "revoked").output).toBe("stale");
      expect(
        checked(
          `select channel_id,connection_version,encrypted_credentials is not null from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("new-channel|2|t");
    });
    it("inventories archived IDs and redacts only API-confirmed missing resource links under the matching grant lease", () => {
      const a = fixture(),
        e = providerEvidence(a);
      due(a);
      const r = maintenance(a);
      const items = JSON.parse(
        checked(
          `select json_agg(x) from public.get_youtube_maintenance_resources('${a.org}',${r.connection_version},'${r.maintenance_claim_id}') x`,
        ),
      ) as { kind: string; id: string }[];
      expect(items).toEqual(
        expect.arrayContaining([
          { kind: "broadcast", id: e.b },
          { kind: "stream", id: e.stream },
        ]),
      );
      expect(items.some((item) => item.id.startsWith("userentered"))).toBe(
        false,
      );
      expect(
        checked(
          `select public.record_youtube_resource_verification('${a.org}',${r.connection_version},'${r.maintenance_claim_id}',array['${e.b}'],array['${e.stream}'])`,
        ),
      ).toBe("t");
      assertRedacted(a, e, true);
      expect(
        checked(
          `select encrypted_credentials is not null,connection_status from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("t|connected");
    });

    it("allows a fresh authorized OAuth connection after completed withdrawal", () => {
      const a = fixture();
      const r = begin(a);
      expect(finish(a, r).ok).toBe(true);
      const hash = randomUUID().replaceAll("-", "").repeat(2);
      expect(
        checked(
          `select expected_version from public.begin_youtube_oauth('${a.owner}','${hash}',now()+interval '10 minutes')`,
        ),
      ).toBe("3");
      expect(
        checked(
          `select expected_version from public.consume_youtube_oauth('${a.owner}','${hash}')`,
        ),
      ).toBe("3");
      expect(
        checked(
          `select public.complete_youtube_connection('${a.owner}','${a.org}',3,'bmV3LWdyYW50','new-channel','New channel')`,
        ),
      ).toBe("4");
      expect(
        checked(
          `select encrypted_credentials is not null,youtube_data_redacted_at is null,youtube_authorization_invalidated_at is null from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("t|t|t");
      expect(
        checked(
          `select count(*) from public.get_youtube_credentials('${a.owner}')`,
        ),
      ).toBe("1");
    });
    it("removes unverifiable API data at day28 without falsely recording Google revocation or a stopped broadcast", () => {
      const a = fixture();
      const e = providerEvidence(a, "live");
      checked(
        `update public.broadcast_settings set youtube_authorization_checked_at=now()-interval '28 days 1 hour' where organization_id='${a.org}'`,
        false,
      );
      const r = maintenance(a);
      expect(outcome(a, r, "unavailable").output).toBe("removed_unconfirmed");
      assertRedacted(a, e);
      expect(
        checked(
          `select last_error_code from public.broadcast_settings where organization_id='${a.org}'`,
          false,
        ),
      ).toBe("authorization_unverified_data_removed");
      expect(
        checked(
          `select status from public.broadcast_sessions where game_id='${a.game}'`,
          false,
        ),
      ).toBe("live");
    });
    it("restricts all maintenance and private purge operations to their intended server boundary", () => {
      expect(
        checked(
          `select has_function_privilege('service_role','public.claim_youtube_authorization_maintenance(integer)','execute'),has_function_privilege('authenticated','public.claim_youtube_authorization_maintenance(integer)','execute'),has_function_privilege('service_role','public.purge_youtube_authorized_data(uuid,bigint,text)','execute'),has_function_privilege('anon','public.finish_youtube_authorization_maintenance(uuid,bigint,uuid,text,text)','execute')`,
          false,
        ),
      ).toBe("t|f|f|f");
    });
  },
);
