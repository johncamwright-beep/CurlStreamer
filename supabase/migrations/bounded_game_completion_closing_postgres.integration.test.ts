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
function psql(sql: string, service = true) {
  if (!parsed) throw new Error("Disposable PostgreSQL is not configured");
  const result = spawnSync(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      (service ? "set role service_role;" : "") + sql,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || "5432",
        PGDATABASE: parsed.pathname.slice(1),
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
      },
    },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}
function ok(sql: string, service = true) {
  const result = psql(sql, service);
  expect(result.ok, result.stderr).toBe(true);
  return result.stdout;
}
const hash = () => randomUUID().replaceAll("-", "").repeat(2);
function fixture() {
  const a = {
    id: randomUUID(),
    org: randomUUID(),
    owner: randomUUID(),
    backupOwner: randomUUID(),
    session: randomUUID(),
    intent: randomUUID(),
    review: randomUUID(),
    completion: randomUUID(),
    bearer: hash(),
    generation: 1,
  };
  const config = {
    eventName: "Closing final",
    homeName: "Red",
    awayName: "Blue",
    homeColor: "#ff0000",
    awayColor: "#0000ff",
    scheduledEnds: 8,
    youtubeVisibility: "unlisted",
    youtubeTitle: "Closing final",
  };
  const state = {
    id: a.id,
    config,
    createdAt: 1,
    scoreEvents: [],
    layout: "split",
    broadcast: "live",
    status: "active",
    audioMuted: false,
    claims: { "camera-home": randomUUID(), scorer: randomUUID() },
    connections: { "camera-home": true, "camera-away": true, scorer: true },
    cameraHealth: { "camera-home": { phase: "live", updatedAt: 1 } },
    sponsors: [],
    sponsorMode: {
      active: false,
      paused: false,
      style: "overlay",
      intervalSeconds: 4,
      startedAt: null,
      rotationOffset: 0,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
  const event = (team: string, points: number, end: number) => {
    const id = randomUUID();
    return `insert into public.score_events(id,game_id,event_type,payload,actor) values ('${id}','${a.id}','end','${JSON.stringify({ id, at: end, type: "end", score: { end, team, points, blank: false } })}','closing-integration');`;
  };
  // Admin seeds a previously delivered output; all assertions exercise service-only RPCs.
  ok(
    `insert into public.organizations(id,name) values('${a.org}','Closing integration');
    insert into auth.users(id,email,email_confirmed_at) values('${a.owner}','${a.owner}@closing.test',now());
    insert into public.user_profiles(user_id,display_name,status) values('${a.owner}','Closing owner','active');
    insert into public.team_memberships(organization_id,user_id,role,status) values('${a.org}','${a.owner}','owner','active');
    insert into auth.users(id,email,email_confirmed_at) values('${a.backupOwner}','${a.backupOwner}@closing.test',now());
    insert into public.user_profiles(user_id,display_name,status) values('${a.backupOwner}','Backup owner','active');
    insert into public.team_memberships(organization_id,user_id,role,status) values('${a.org}','${a.backupOwner}','owner','active');
    insert into public.games(id,organization_id,config,status,created_by) values('${a.id}','${a.org}','${JSON.stringify(config)}','active','${a.owner}');
    insert into public.game_states(game_id,version,state) values('${a.id}',1,'${JSON.stringify(state)}');
    ${event("home", 4, 1)} ${event("away", 2, 2)}
    insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,connection_status,connection_version) values('${a.org}','youtube','opaque','closing-channel','connected',1);
    insert into public.broadcast_sessions(game_id,organization_id,provider,status,transport,desired_state,operation_generation,youtube_broadcast_id,youtube_stream_id,youtube_channel_id,youtube_connection_version,youtube_broadcast_create_state,youtube_stream_create_state)
      values('${a.id}','${a.org}','youtube','prepared','local-obs','live',1,'broadcast-${a.id}','stream-${a.id}','closing-channel',1,'ready','ready');
    insert into public.m4_desktop_sessions(session_id,game_id,organization_id,generation,status,code_hash,challenge_hash,bearer_hash,approved_by,consumed_at,expires_at,lease_expires_at)
      values('${a.session}','${a.id}','${a.org}',1,'active','${hash()}','${hash()}','${a.bearer}','${a.owner}',now(),now()+interval '4 hours',now()+interval '30 seconds');
    insert into public.m4_output_intents(intent_id,game_id,organization_id,session_id,generation,broadcast_generation,youtube_broadcast_id,youtube_stream_id,phase,delivery_recorded_at,delivery_channel_id,delivery_connection_version)
      values('${a.intent}','${a.id}','${a.org}','${a.session}',1,1,'broadcast-${a.id}','stream-${a.id}','quarantined',now(),'closing-channel',1);`,
    false,
  );
  const reviewResult = JSON.parse(
    ok(
      `select row_to_json(x) from public.review_game_completion_with_link('${a.id}','${a.review}','${a.owner}',false,'https://youtu.be/abcdefghijk') x`,
    ),
  );
  return { ...a, reviewResult };
}
type Fixture = ReturnType<typeof fixture>;
function complete(
  a: Fixture,
  changes: Record<string, unknown> = {},
  review = a.review,
  owner = a.owner,
) {
  const closing = {
    sessionId: a.session,
    generation: a.generation,
    intentId: a.intent,
    capability: "final-card-v1",
    ...changes,
  };
  return psql(
    `select public.complete_reviewed_game_with_closing('${a.id}','${review}','${a.completion}','${owner}',false,'${JSON.stringify(closing)}')`,
  );
}
function completed(a: Fixture) {
  const result = complete(a);
  expect(result.ok, result.stderr).toBe(true);
  return JSON.parse(result.stdout);
}
function grant(
  a: Fixture,
  bearer = a.bearer,
  session = a.session,
  generation = a.generation,
) {
  return psql(
    `select row_to_json(x) from public.read_m4_completion_closing('${a.id}','${session}',${generation},'${bearer}') x`,
  );
}
function ready(a: Fixture) {
  return ok(
    `select public.game_completion_cleanup_ready('${a.id}','${a.owner}',false)`,
  );
}
function baseline(a: Fixture) {
  return JSON.parse(
    ok(
      `select json_build_object('gameStatus',g.status,'completedAt',g.completed_at,'desktopStatus',s.status,'revokedAt',s.revoked_at,'lease',s.lease_expires_at,'grants',(select count(*) from public.game_completion_closing where game_id=g.id),'completions',(select count(*) from public.game_completions where game_id=g.id)) from public.games g join public.m4_desktop_sessions s on s.game_id=g.id where g.id='${a.id}'`,
      false,
    ),
  );
}

describe.skipIf(!enabled)(
  "bounded completion closing PostgreSQL authority",
  () => {
    it("commits exact reviewed result/identity and an immutable fifteen-second grant, including legitimate retries", () => {
      const a = fixture(),
        saved = completed(a);
      expect(saved).toMatchObject({
        completion_id: a.completion,
        review_id: a.review,
        input_revision: a.reviewResult.input_revision,
        result: a.reviewResult.result,
        cleanup_status: "pending",
        closing: { sessionId: a.session, generation: 1, intentId: a.intent },
      });
      expect(saved.result.totals).toEqual({ home: 4, away: 2 });
      expect(
        ok(
          `select extract(epoch from deadline_at-created_at) from public.game_completion_closing where game_id='${a.id}'`,
          false,
        ),
      ).toBe("15.000000");
      const retry = complete(a, {}, randomUUID());
      expect(retry.ok, retry.stderr).toBe(true);
      expect(JSON.parse(retry.stdout)).toEqual(saved);
      expect(JSON.parse(grant(a).stdout)).toMatchObject({
        session_id: a.session,
        generation: 1,
        intent_id: a.intent,
        deadline_at: saved.closing.deadlineAt,
      });
      expect(
        ok(
          `select count(*) from public.game_completion_closing where game_id='${a.id}'`,
          false,
        ),
      ).toBe("1");
      expect(
        ok(`select public.read_game_completion_summary('${a.id}')`),
      ).toContain("abcdefghijk");
    });
    it("starts the full fixed window when the grant is established after transaction delay", () => {
      const a = fixture();
      const closing = {
        sessionId: a.session,
        generation: 1,
        intentId: a.intent,
        capability: "final-card-v1",
      };
      const result = ok(
        `begin; select pg_sleep(0.2); select public.complete_reviewed_game_with_closing('${a.id}','${a.review}','${a.completion}','${a.owner}',false,'${JSON.stringify(closing)}'); reset role; select created_at>transaction_timestamp()+interval '0.1 seconds',extract(epoch from deadline_at-created_at) from public.game_completion_closing where game_id='${a.id}'; commit;`,
      );
      expect(result.split("\n").at(-1)).toBe("t|15.000000");
      expect(grant(a).ok).toBe(true);
      expect(ready(a)).toBe("f");
    });
    it("does not tear down before authenticated desktop Stop, and capability-free completion retries cannot bypass it", () => {
      const a = fixture();
      completed(a);
      expect(ready(a)).toBe("f");
      ok(
        `select row_to_json(x) from public.complete_reviewed_game('${a.id}','${a.review}','${randomUUID()}','${a.owner}',false) x`,
      );
      expect(ready(a)).toBe("f");
      ok(
        `select row_to_json(x) from public.stop_m4_desktop('${a.id}','${a.session}',1,'${a.bearer}') x`,
      );
      expect(grant(a).ok).toBe(false);
      expect(ready(a)).toBe("t");
      expect(
        ok(
          `select phase from public.m4_output_intents where intent_id='${a.intent}'`,
          false,
        ),
      ).toBe("stop_requested");
    });
    it("keeps heartbeats capped at the fixed deadline and blocks all new target/pair/camera authority", () => {
      const a = fixture(),
        saved = completed(a);
      const heartbeat = JSON.parse(
        ok(
          `select row_to_json(x) from public.heartbeat_m4_desktop('${a.id}','${a.session}',1,'${a.bearer}') x`,
        ),
      );
      expect(heartbeat.desired_action).toBe("wait");
      expect(Date.parse(heartbeat.lease_expires_at)).toBe(
        Date.parse(saved.closing.deadlineAt),
      );
      for (const name of [
        "consume_m4_output_delivery",
        "assert_m4_output_delivery",
      ])
        expect(
          psql(
            `select * from public.${name}('${a.id}','${a.session}',1,'${a.bearer}','${a.intent}')`,
          ).ok,
        ).toBe(false);
      expect(
        psql(
          `select * from public.claim_m4_output_intent('${a.id}','${a.session}',1,'${a.bearer}','${randomUUID()}')`,
        ).ok,
      ).toBe(false);
      expect(
        psql(
          `select * from public.approve_m4_desktop_pairing('${a.id}','${a.owner}',false,'${hash()}','${hash()}')`,
        ).ok,
      ).toBe(false);
      expect(
        psql(
          `select public.prepare_game_role_invitation('${a.id}','camera-home','${randomUUID()}',now()+interval '1 hour')`,
        ).ok,
      ).toBe(false);
      expect(
        JSON.parse(
          ok(
            `select json_build_object('claims',state->'claims','connections',state->'connections','health',state->'cameraHealth','status',state->>'status') from public.game_states where game_id='${a.id}'`,
            false,
          ),
        ),
      ).toEqual({
        claims: {},
        connections: {
          "camera-home": false,
          "camera-away": false,
          scorer: false,
        },
        health: {},
        status: "completed",
      });
    });
    it.each([
      "session",
      "generation",
      "intent",
      "newIntent",
      "foreignOwner",
      "outputOrganization",
    ])(
      "denies mismatched %s without creating a grant or altering the live game",
      (mismatch) => {
        const a = fixture(),
          before = baseline(a),
          foreign = fixture();
        if (mismatch === "outputOrganization")
          ok(
            `update public.m4_output_intents set organization_id='${foreign.org}' where intent_id='${a.intent}'`,
            false,
          );
        const changes =
          mismatch === "newIntent"
            ? { intentId: randomUUID() }
            : mismatch === "session"
              ? { sessionId: foreign.session }
              : mismatch === "generation"
                ? { generation: 2 }
                : mismatch === "intent"
                  ? { intentId: foreign.intent }
                  : {};
        expect(
          complete(
            a,
            changes,
            a.review,
            mismatch === "foreignOwner" ? foreign.owner : a.owner,
          ).ok,
        ).toBe(false);
        expect(baseline(a)).toEqual(before);
      },
    );
    it("rolls back the inserted grant and capped desktop lease when reviewed scoring becomes stale", () => {
      const a = fixture(),
        before = baseline(a),
        id = randomUUID();
      ok(
        `insert into public.score_events(id,game_id,event_type,payload,actor) values('${id}','${a.id}','end','${JSON.stringify({ id, at: 3, type: "end", score: { end: 3, team: "home", points: 1, blank: false } })}','closing-integration')`,
        false,
      );
      const result = complete(a);
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("completion_review_conflict");
      expect(baseline(a)).toEqual(before);
    });
    it.each(["bearer", "session", "generation"])(
      "dedicated grant read rejects wrong %s",
      (mismatch) => {
        const a = fixture();
        completed(a);
        expect(
          grant(
            a,
            mismatch === "bearer" ? hash() : a.bearer,
            mismatch === "session" ? randomUUID() : a.session,
            mismatch === "generation" ? 2 : 1,
          ).ok,
        ).toBe(false);
        expect(grant(a).ok).toBe(true);
        expect(ready(a)).toBe("f");
      },
    );
    it("expired grants fail closed and authorize bounded cleanup without renewal", () => {
      const a = fixture();
      completed(a);
      // Test admin advances fixture time while retaining the exact 15s constraint.
      ok(
        `update public.game_completion_closing set created_at=now()-interval '16 seconds',deadline_at=now()-interval '1 second' where game_id='${a.id}'; update public.m4_desktop_sessions set lease_expires_at=now()-interval '1 second' where session_id='${a.session}'`,
        false,
      );
      expect(grant(a).ok).toBe(false);
      expect(
        psql(
          `select * from public.heartbeat_m4_desktop('${a.id}','${a.session}',1,'${a.bearer}')`,
        ).ok,
      ).toBe(false);
      expect(ready(a)).toBe("t");
      expect(baseline(a).desktopStatus).toBe("revoked");
    });
    it.each(["delete", "revoke", "providerStop"])(
      "explicit %s overrides closing immediately",
      (action) => {
        const a = fixture();
        completed(a);
        if (action === "delete")
          ok(
            `update public.games set deleted_at=now() where id='${a.id}'`,
            false,
          );
        else if (action === "revoke")
          ok(
            `update public.m4_desktop_sessions set status='revoked',revoked_at=now() where session_id='${a.session}'`,
            false,
          );
        else
          ok(
            `update public.broadcast_sessions set desired_state='stopped' where game_id='${a.id}'; update public.m4_output_intents set phase='stop_requested' where intent_id='${a.intent}'`,
            false,
          );
        expect(grant(a).ok).toBe(false);
        expect(ready(a)).toBe("t");
      },
    );
    it("membership revocation removes dedicated grant and heartbeat closing authority", () => {
      const a = fixture();
      completed(a);
      ok(
        `update public.team_memberships set status='removed' where user_id='${a.owner}' and organization_id='${a.org}'`,
        false,
      );
      expect(grant(a).ok).toBe(false);
      expect(
        JSON.parse(
          ok(
            `select row_to_json(x) from public.heartbeat_m4_desktop('${a.id}','${a.session}',1,'${a.bearer}') x`,
          ),
        ).desired_action,
      ).toBe("stop");
    });
    it("ordinary roles cannot read grant rows or invoke the desktop grant RPC", () => {
      const a = fixture();
      completed(a);
      for (const role of ["anon", "authenticated"]) {
        expect(
          psql(
            `set role ${role};select * from public.game_completion_closing`,
            false,
          ).ok,
        ).toBe(false);
        expect(
          psql(
            `set role ${role};select * from public.read_m4_completion_closing('${a.id}','${a.session}',1,'${a.bearer}')`,
            false,
          ).ok,
        ).toBe(false);
      }
    });
    it("all three terminal fences preserve only the named closing output, then deletion fences the broadcast generation", () => {
      const a = fixture();
      completed(a);
      expect(
        JSON.parse(
          ok(
            `select json_build_object('desktop',s.status,'output',i.phase,'desired',b.desired_state,'broadcast',b.status,'generation',b.operation_generation) from public.m4_desktop_sessions s join public.m4_output_intents i on i.session_id=s.session_id join public.broadcast_sessions b on b.game_id=s.game_id where s.session_id='${a.session}'`,
            false,
          ),
        ),
      ).toEqual({
        desktop: "active",
        output: "quarantined",
        desired: "live",
        broadcast: "prepared",
        generation: 1,
      });
      ok(`update public.games set deleted_at=now() where id='${a.id}'`, false);
      expect(
        JSON.parse(
          ok(
            `select json_build_object('desktop',s.status,'output',i.phase,'desired',b.desired_state,'broadcast',b.status,'generation',b.operation_generation) from public.m4_desktop_sessions s join public.m4_output_intents i on i.session_id=s.session_id join public.broadcast_sessions b on b.game_id=s.game_id where s.session_id='${a.session}'`,
            false,
          ),
        ),
      ).toEqual({
        desktop: "revoked",
        output: "stop_requested",
        desired: "stopped",
        broadcast: "stopping",
        generation: 2,
      });
    });
    it("legacy immediate completion still executes all terminal revocations", () => {
      const a = fixture();
      ok(
        `select * from public.complete_reviewed_game('${a.id}','${a.review}','${a.completion}','${a.owner}',false)`,
      );
      expect(baseline(a)).toMatchObject({
        gameStatus: "completed",
        desktopStatus: "revoked",
        grants: 0,
        completions: 1,
      });
      expect(
        ok(
          `select desired_state||':'||status||':'||operation_generation from public.broadcast_sessions where game_id='${a.id}'`,
          false,
        ),
      ).toBe("stopped:stopping:2");
      expect(
        ok(
          `select phase from public.m4_output_intents where intent_id='${a.intent}'`,
          false,
        ),
      ).toBe("stop_requested");
      expect(ready(a)).toBe("t");
      expect(grant(a).ok).toBe(false);
    });
  },
);
