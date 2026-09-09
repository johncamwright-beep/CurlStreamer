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
type SqlResult = { ok: boolean; stdout: string; stderr: string };

function environment(applicationName?: string) {
  if (!parsed) throw new Error("Disposable PostgreSQL is not configured");
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(applicationName ? { PGAPPNAME: applicationName } : {}),
  };
}

function sql(statement: string): SqlResult {
  const result = spawnSync(
    "psql",
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8", env: environment() },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function service(statement: string) {
  return sql(`set role service_role; ${statement}`);
}

function asyncService(statement: string, applicationName: string) {
  return new Promise<SqlResult>((resolve) => {
    const child = spawn(
      "psql",
      [
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `set role service_role; ${statement}`,
      ],
      { env: environment(applicationName) },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (value) => (stdout += String(value)));
    child.stderr.on("data", (value) => (stderr += String(value)));
    child.on("close", (status) =>
      resolve({
        ok: status === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }),
    );
  });
}

function held(statement: string, applicationName: string) {
  const marker = `READY_${randomUUID().replaceAll("-", "")}`;
  const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: environment(applicationName),
  });
  let stdout = "";
  let stderr = "";
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  child.stdout.on("data", (value) => {
    stdout += String(value);
    if (stdout.includes(marker)) resolveReady();
  });
  child.stderr.on("data", (value) => (stderr += String(value)));
  const result = new Promise<SqlResult>((resolve) =>
    child.on("close", (status) =>
      resolve({
        ok: status === 0,
        stdout: stdout.replace(marker, "").trim(),
        stderr: stderr.trim(),
      }),
    ),
  );
  child.stdin.write(
    `begin; set role service_role; ${statement}; \\echo ${marker}\n`,
  );
  return {
    ready,
    result,
    release() {
      child.stdin.end("commit;\n\\q\n");
    },
  };
}

function waitForLock(applicationName: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const waiting = sql(`select exists(select 1 from pg_stat_activity
      where application_name='${applicationName}' and wait_event_type='Lock')`);
    if (waiting.stdout === "t") return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`PostgreSQL session ${applicationName} did not block`);
}

function fixture(gameId: string) {
  const organizationId = randomUUID();
  const creatorId = randomUUID();
  const state = {
    id: gameId,
    config: { eventName: "Claim generation", homeName: "A", awayName: "B" },
    createdAt: 1,
    scoreEvents: [],
    layout: "split",
    broadcast: "idle",
    status: "active",
    audioMuted: false,
    connections: { "camera-home": false, "camera-away": false, scorer: false },
    claims: {},
    sponsors: [],
    sponsorMode: { active: false, paused: false },
  };
  return `insert into public.organizations(id,name) values ('${organizationId}','Claims');
    insert into public.organizer_users(organization_id,user_id) values ('${organizationId}','${creatorId}');
    insert into public.games(id,organization_id,config,status,created_by)
      values ('${gameId}','${organizationId}','{}','active','${creatorId}');
    insert into public.game_states(game_id,state)
      values ('${gameId}','${JSON.stringify(state)}'::jsonb);`;
}

function prepare(gameId: string, invitationId: string) {
  return `select public.prepare_game_role_invitation(
    '${gameId}','camera-home','${invitationId}',now()+interval '30 minutes')`;
}

function claim(
  gameId: string,
  invitationId: string,
  generation: number | "null",
  deviceId: string,
) {
  return `select assignment_generation from public.claim_game_role(
    '${gameId}','camera-home','${invitationId}',${generation},
    '${deviceId}',now()+interval '30 minutes')`;
}

type Ticket = {
  sessionId: string;
  negotiationId: string;
  generation: number;
  assignmentGeneration: number;
};
function action(
  game: string,
  operation: string,
  side = "receiver",
  session: string | null = null,
  negotiation: string | null = null,
  device: string | null = null,
  generation: number | null = null,
  organization: string | null = null,
  cameraRole = "camera-home",
) {
  const quote = (value: string | null) =>
    value === null ? "null" : "'" + value + "'";
  return (
    "select public.m2_studio_action(" +
    [
      quote(game),
      quote(cameraRole),
      quote(operation),
      quote(side),
      quote(session),
      quote(negotiation),
      quote(device),
      generation ?? "null",
      quote(organization),
    ].join(",") +
    ")"
  );
}
function paired() {
  const game = randomUUID(),
    device = randomUUID(),
    invitation = randomUUID();
  expect(sql(fixture(game)).ok).toBe(true);
  const registration = service(action(game, "register"));
  expect(registration.ok).toBe(true);
  const studio = JSON.parse(registration.stdout) as Ticket;
  expect(service(prepare(game, invitation)).stdout).toBe("1");
  expect(service(claim(game, invitation, 1, device)).stdout).toBe("1");
  const started = service(
    action(game, "begin", "camera", studio.sessionId, null, device, 1),
  );
  expect(started.ok).toBe(true);
  return { game, device, ticket: JSON.parse(started.stdout) as Ticket };
}
describe.skipIf(!enabled)("M2 disposable PostgreSQL authority", () => {
  it("rejects browser RPC access, wrong organizations and duplicate invitation claims", () => {
    const { game, ticket } = paired();
    expect(sql("set role authenticated; " + action(game, "register")).ok).toBe(
      false,
    );
    expect(
      service(
        action(
          game,
          "ticket",
          "receiver",
          ticket.sessionId,
          null,
          null,
          null,
          randomUUID(),
        ),
      ).ok,
    ).toBe(false);
    const other = randomUUID();
    const invitation = randomUUID();
    expect(sql(fixture(other)).ok).toBe(true);
    expect(service(prepare(other, invitation)).ok).toBe(true);
    expect(service(claim(other, invitation, 1, randomUUID())).ok).toBe(true);
    expect(service(claim(other, invitation, 1, randomUUID())).stderr).toContain(
      "invitation_consumed",
    );
  });
  it("fences replaced desktops, negotiations and role assignments", () => {
    const { game, device, ticket } = paired();
    expect(
      service(
        action(
          game,
          "signal",
          "camera",
          ticket.sessionId,
          ticket.negotiationId,
          device,
          0,
        ),
      ).ok,
    ).toBe(false);
    const restarted = service(
      action(game, "begin", "camera", ticket.sessionId, null, device, 1),
    );
    expect(restarted.ok).toBe(true);
    expect(
      service(
        action(
          game,
          "signal",
          "receiver",
          ticket.sessionId,
          ticket.negotiationId,
        ),
      ).ok,
    ).toBe(false);
    expect(
      service(
        "select public.release_game_role('" +
          game +
          "','camera-home','" +
          device +
          "',1)",
      ).ok,
    ).toBe(true);
    expect(
      service(
        action(game, "begin", "camera", ticket.sessionId, null, device, 1),
      ).ok,
    ).toBe(false);
    expect(service(action(game, "register")).ok).toBe(true);
    expect(
      service(action(game, "check", "receiver", ticket.sessionId)).ok,
    ).toBe(false);
  });
  it("expires receiver heartbeats and prevents resurrection", () => {
    const { game, device, ticket } = paired();
    expect(
      sql(
        "update public.m2_studio_sessions set receiver_seen_at=now()-interval '31 seconds' where game_id='" +
          game +
          "'",
      ).ok,
    ).toBe(true);
    expect(
      service(action(game, "check", "receiver", ticket.sessionId)).ok,
    ).toBe(false);
    expect(
      service(
        action(game, "begin", "camera", ticket.sessionId, null, device, 1),
      ).ok,
    ).toBe(false);
  });
  it("denies private receive on wrong topic, expired credential and release", () => {
    const { game, device, ticket } = paired();
    const topic = [
      "m2",
      "camera-home",
      ticket.sessionId,
      ticket.generation,
      ticket.negotiationId,
      "camera",
    ].join(":");
    const claims = {
      m2_camera_role: "camera-home",
      m2_session: ticket.sessionId,
      m2_game: game,
      m2_generation: ticket.generation,
      m2_assignment: 1,
      m2_negotiation: ticket.negotiationId,
      m2_side: "camera",
      m2_topic: topic,
      exp: Math.floor(Date.now() / 1000) + 20,
    };
    const canRead = (overrides: object = {}, target = topic) =>
      sql(
        "set role authenticated; set request.jwt.claims='" +
          JSON.stringify({ ...claims, ...overrides }) +
          "'; select public.m2_can_receive('" +
          target +
          "')",
      );
    expect(canRead().stdout).toBe("t");
    expect(canRead({ exp: 0 }).stdout).toBe("f");
    expect(canRead({ m2_generation: 99 }).stdout).toBe("f");
    expect(canRead({}, topic + "-wrong").stdout).toBe("f");
    expect(
      service(
        "select public.release_game_role('" +
          game +
          "','camera-home','" +
          device +
          "',1)",
      ).ok,
    ).toBe(true);
    expect(canRead().stdout).toBe("f");
  });
  it("keeps restrictive Realtime policies effective even with permissive policies", () => {
    const { game, ticket } = paired();
    const topic = [
      "m2",
      "camera-home",
      ticket.sessionId,
      ticket.generation,
      ticket.negotiationId,
      "receiver",
    ].join(":");
    const checks = sql(
      "begin; create policy m2_test_broad on realtime.messages for all to authenticated using(true) with check(true); insert into realtime.messages(extension,topic) values('broadcast','" +
        topic +
        "'); set role authenticated; set realtime.topic='" +
        topic +
        "'; set request.jwt.claims='{}'; select count(*) from realtime.messages; rollback;",
    );
    expect(checks.ok).toBe(true);
    expect(checks.stdout).toBe("0");
    const send = sql(
      "begin; create policy m2_test_broad on realtime.messages for all to authenticated using(true) with check(true); set role authenticated; set realtime.topic='" +
        topic +
        "'; insert into realtime.messages(extension,topic) values('broadcast','" +
        topic +
        "'); rollback;",
    );
    expect(send.ok).toBe(false);
    expect(send.stderr).toContain("row-level security");
    expect(game).toBeTruthy();
  });
  it("completion holds the lock before a concurrent signaling write", async () => {
    const { game, device, ticket } = paired();
    const review = randomUUID();
    expect(
      service(
        "select * from public.review_game_completion('" +
          game +
          "','" +
          review +
          "',null,true)",
      ).ok,
    ).toBe(true);
    const complete = held(
      "select * from public.complete_reviewed_game('" +
        game +
        "','" +
        review +
        "','" +
        randomUUID() +
        "',null,true)",
      "m2_complete_" + randomUUID(),
    );
    await complete.ready;
    const app = "m2_signal_" + randomUUID();
    const signal = asyncService(
      action(
        game,
        "signal",
        "camera",
        ticket.sessionId,
        ticket.negotiationId,
        device,
        1,
      ),
      app,
    );
    try {
      waitForLock(app);
    } finally {
      complete.release();
    }
    expect((await complete.result).ok).toBe(true);
    expect((await signal).stderr).toContain("game_unavailable");
    expect(service(action(game, "register")).ok).toBe(false);
  }, 15_000);
  it("rejects closed and deleted games and stopped studios", () => {
    const stopped = paired();
    expect(
      service(
        action(stopped.game, "stop", "receiver", stopped.ticket.sessionId),
      ).ok,
    ).toBe(true);
    expect(
      service(
        action(stopped.game, "check", "receiver", stopped.ticket.sessionId),
      ).ok,
    ).toBe(false);
    const closed = paired();
    expect(
      sql(
        "update public.game_states set state=jsonb_set(state,'{status}','\"closed\"') where game_id='" +
          closed.game +
          "'",
      ).ok,
    ).toBe(true);
    expect(
      service(
        action(
          closed.game,
          "signal",
          "receiver",
          closed.ticket.sessionId,
          closed.ticket.negotiationId,
        ),
      ).ok,
    ).toBe(false);
    const deleted = paired();
    expect(
      sql(
        "update public.games set deleted_at=now() where id='" +
          deleted.game +
          "'",
      ).ok,
    ).toBe(true);
    expect(
      service(
        action(deleted.game, "ticket", "receiver", deleted.ticket.sessionId),
      ).ok,
    ).toBe(false);
  });
});

describe.skipIf(!enabled)("M2 camera slot isolation", () => {
  it("replacement, stop, release and cross-slot credentials cannot disturb the other camera", () => {
    const { game, device, ticket: home } = paired();
    const awayDevice = randomUUID(),
      invite = randomUUID();
    expect(
      service(
        `select public.prepare_game_role_invitation('${game}','camera-away','${invite}',now()+interval '30 minutes')`,
      ).ok,
    ).toBe(true);
    expect(
      service(
        `select * from public.claim_game_role('${game}','camera-away','${invite}',1,'${awayDevice}',now()+interval '30 minutes')`,
      ).ok,
    ).toBe(true);
    const awayAction = (
      op: string,
      side = "receiver",
      session: string | null = null,
      negotiation: string | null = null,
      deviceId: string | null = null,
      generation: number | null = null,
    ) =>
      action(
        game,
        op,
        side,
        session,
        negotiation,
        deviceId,
        generation,
        null,
        "camera-away",
      );
    const registered = service(awayAction("register"));
    expect(registered.ok).toBe(true);
    const awayRegistration = JSON.parse(registered.stdout) as Ticket;
    expect(
      service(
        awayAction(
          "begin",
          "camera",
          awayRegistration.sessionId,
          null,
          device,
          1,
        ),
      ).ok,
    ).toBe(false);
    const started = service(
      awayAction(
        "begin",
        "camera",
        awayRegistration.sessionId,
        null,
        awayDevice,
        1,
      ),
    );
    expect(started.ok).toBe(true);
    const away = JSON.parse(started.stdout) as Ticket;
    const awayCheck = () =>
      service(
        awayAction("ticket", "receiver", away.sessionId, away.negotiationId),
      );
    expect(service(awayAction("check", "receiver", home.sessionId)).ok).toBe(
      false,
    );
    expect(service(action(game, "register")).ok).toBe(true);
    expect(service(action(game, "check", "receiver", home.sessionId)).ok).toBe(
      false,
    );
    expect(awayCheck().ok).toBe(true);
    expect(
      service(
        `select public.release_game_role('${game}','camera-home','${device}',1)`,
      ).ok,
    ).toBe(true);
    expect(awayCheck().ok).toBe(true);
    const topic = [
      "m2",
      "camera-away",
      away.sessionId,
      away.generation,
      away.negotiationId,
      "receiver",
    ].join(":");
    const claims = {
      m2_camera_role: "camera-home",
      m2_session: away.sessionId,
      m2_game: game,
      m2_generation: away.generation,
      m2_assignment: 1,
      m2_negotiation: away.negotiationId,
      m2_side: "receiver",
      m2_topic: topic,
      exp: Math.floor(Date.now() / 1000) + 20,
    };
    expect(
      sql(
        `set role authenticated; set request.jwt.claims='${JSON.stringify(claims)}'; select public.m2_can_receive('${topic}')`,
      ).stdout,
    ).toBe("f");
    claims.m2_camera_role = "camera-away";
    expect(
      sql(
        `set role authenticated; set request.jwt.claims='${JSON.stringify(claims)}'; select public.m2_can_receive('${topic}')`,
      ).stdout,
    ).toBe("t");
    expect(service(awayAction("stop", "receiver", away.sessionId)).ok).toBe(
      true,
    );
    expect(awayCheck().ok).toBe(false);
  });
});
