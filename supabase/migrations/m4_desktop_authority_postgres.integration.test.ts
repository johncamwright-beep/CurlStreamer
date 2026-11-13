import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const safeDatabase = Boolean(
  parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(parsed.pathname),
);
const psqlAvailable =
  spawnSync("psql", ["--version"], { encoding: "utf8" }).status === 0;
const enabled = safeDatabase && psqlAvailable;

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

function psql(sql: string, serviceRole = false) {
  const result = spawnSync(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `${serviceRole ? "set role service_role;" : ""}${sql}`,
    ],
    { encoding: "utf8", env: environment() },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function psqlAsync(sql: string, applicationName: string) {
  return new Promise<ReturnType<typeof psql>>((resolve) => {
    const child = spawn(
      "psql",
      [
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `set role service_role;${sql}`,
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

function holdTransaction(sql: string) {
  const marker = `READY_${randomUUID().replaceAll("-", "")}`;
  const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: environment("disconnect_holder"),
  });
  let stdout = "";
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (value) => {
      stdout += String(value);
      if (stdout.includes(marker)) resolve();
    });
    child.stderr.on("data", (value) => reject(new Error(String(value))));
    child.on("close", (status) => {
      if (status && !stdout.includes(marker))
        reject(new Error(`holder exited ${status}`));
    });
  });
  child.stdin.write(`begin;${sql};\\echo ${marker}\n`);
  return {
    ready,
    release() {
      child.stdin.end("commit;\n");
    },
  };
}

async function waitForLock(applicationName: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const locked = psql(
      `select exists(select 1 from pg_stat_activity
        where application_name='${applicationName}' and wait_event_type='Lock')`,
    );
    if (locked.stdout === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${applicationName} never reached a PostgreSQL lock wait`);
}

function account(
  userId: string,
  organizationId: string,
  options: { role?: string; verified?: boolean; active?: boolean } = {},
) {
  return `
    insert into auth.users(id,email,email_confirmed_at) values
      ('${userId}','${userId}@broadcast.test',${options.verified === false ? "null" : "now()"});
    insert into public.user_profiles(user_id,display_name,status) values
      ('${userId}','Broadcast user','${options.active === false ? "suspended" : "active"}');
    insert into public.team_memberships(organization_id,user_id,role,status) values
      ('${organizationId}','${userId}','${options.role ?? "owner"}','active');
  `;
}

function game(gameId: string, organizationId: string, creatorId: string) {
  const state = {
    id: gameId,
    config: {
      eventName: "Final",
      homeName: "Home",
      awayName: "Away",
      homeColor: "#000000",
      awayColor: "#ffffff",
      scheduledEnds: 8,
      youtubeTitle: "Final - Sheet 4",
      youtubeVisibility: "unlisted",
    },
    createdAt: 1,
    scoreEvents: [],
    layout: "split",
    broadcast: "idle",
    status: "active",
    audioMuted: true,
    connections: { "camera-home": false, "camera-away": false, scorer: false },
    claims: {},
    sponsors: [],
    sponsorMode: {
      active: false,
      style: "overlay",
      intervalSeconds: 4,
      startedAt: null,
      rotationOffset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
  return `
    insert into public.games(id,organization_id,config,status,created_by)
      values ('${gameId}','${organizationId}','${JSON.stringify(state.config)}','active','${creatorId}');
    insert into public.game_states(game_id,version,state)
      values ('${gameId}',1,'${JSON.stringify(state)}');
  `;
}

function fixture() {
  const org = randomUUID(),
    owner = randomUUID(),
    id = randomUUID();
  const seeded =
    psql(`insert into public.organizations(id,name) values('${org}','M4 test');${account(owner, org)}${game(id, org, owner)}
    insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,channel_title,connection_status,connection_version) values('${org}','youtube','opaque','channel-m4','M4','connected',1);`);
  expect(seeded.stderr).toBe("");
  return { org, owner, id };
}

function hash() {
  return randomUUID().replaceAll("-", "").repeat(2);
}
function approve(id: string, owner: string, code = hash(), challenge = hash()) {
  const result = psql(
    `select row_to_json(x) from public.approve_m4_desktop_pairing('${id}','${owner}',false,'${code}','${challenge}') x`,
    true,
  );
  return { result, code, challenge };
}
function exchange(
  id: string,
  code: string,
  challenge: string,
  bearer = hash(),
) {
  const result = psql(
    `select row_to_json(x) from public.exchange_m4_desktop_pairing('${id}','${code}','${challenge}','${bearer}') x`,
    true,
  );
  return { result, bearer };
}
function desktop(
  id: string,
  session: string,
  generation: number,
  bearer: string,
  stop = false,
) {
  return psql(
    `select row_to_json(x) from public.${stop ? "stop_m4_desktop" : "heartbeat_m4_desktop"}('${id}','${session}',${generation},'${bearer}') x`,
    true,
  );
}
describe.skipIf(!enabled)("M4 desktop pairing PostgreSQL boundary", () => {
  it("rejects exchange if its approving account was suspended", () => {
    const a = fixture(),
      pair = approve(a.id, a.owner);
    expect(
      psql(
        `update public.user_profiles set status='suspended' where user_id='${a.owner}'`,
      ).ok,
    ).toBe(true);
    expect(exchange(a.id, pair.code, pair.challenge).result.ok).toBe(false);
    expect(
      psql(
        `select count(*) from public.m4_desktop_sessions where game_id='${a.id}' and bearer_hash is not null`,
      ).stdout,
    ).toBe("0");
  });
  it("revoked account approval becomes stop-only without commandeering a broadcast journal", () => {
    const a = fixture(),
      pair = approve(a.id, a.owner);
    const grant = exchange(a.id, pair.code, pair.challenge),
      session = JSON.parse(grant.result.stdout);
    expect(
      psql(
        `select count(*) from public.broadcast_sessions where game_id='${a.id}'`,
      ).stdout,
    ).toBe("0");
    expect(
      psql(
        `update public.user_profiles set status='suspended' where user_id='${a.owner}'`,
      ).ok,
    ).toBe(true);
    const beat = desktop(a.id, session.session_id, 1, grant.bearer);
    expect(beat.ok, beat.stderr).toBe(true);
    expect(JSON.parse(beat.stdout)).toMatchObject({
      desired_action: "stop",
      lease_expires_at: session.lease_expires_at,
    });
    expect(desktop(a.id, session.session_id, 1, grant.bearer, true).ok).toBe(
      true,
    );
  });
  it("binds one-use pairing and heartbeat to game generation and hashed bearer", () => {
    const a = fixture(),
      b = fixture();
    expect(approve(a.id, b.owner).result.ok).toBe(false);
    const pair = approve(a.id, a.owner);
    expect(pair.result.ok, pair.result.stderr).toBe(true);
    const pending = JSON.parse(pair.result.stdout);
    expect(pending.generation).toBe(1);
    expect(approve(a.id, a.owner).result.ok).toBe(false);
    expect(exchange(b.id, pair.code, pair.challenge).result.ok).toBe(false);
    expect(exchange(a.id, pair.code, hash()).result.ok).toBe(false);
    const grant = exchange(a.id, pair.code, pair.challenge);
    expect(grant.result.ok, grant.result.stderr).toBe(true);
    const session = JSON.parse(grant.result.stdout);
    expect(exchange(a.id, pair.code, pair.challenge).result.ok).toBe(false);
    expect(desktop(a.id, session.session_id, 2, grant.bearer).ok).toBe(false);
    expect(desktop(b.id, session.session_id, 1, grant.bearer).ok).toBe(false);
    expect(desktop(a.id, session.session_id, 1, hash()).ok).toBe(false);
    const beat = desktop(a.id, session.session_id, 1, grant.bearer);
    expect(beat.ok, beat.stderr).toBe(true);
    expect(JSON.parse(beat.stdout).desired_action).toBe("wait");
    expect(approve(a.id, a.owner).result.ok).toBe(false);
    expect(
      psql(`set role authenticated;select * from public.m4_desktop_sessions`)
        .ok,
    ).toBe(false);
    expect(
      psql(`set role service_role;select * from public.m4_desktop_sessions`).ok,
    ).toBe(false);
    expect(
      psql(
        `set role authenticated;select * from public.heartbeat_m4_desktop('${a.id}','${session.session_id}',1,'${grant.bearer}')`,
      ).ok,
    ).toBe(false);
  });
  it("rejects expired pairing and lease resurrection; replacement preserves old stop-only history", () => {
    const a = fixture(),
      expired = approve(a.id, a.owner);
    expect(
      psql(
        `update public.m4_desktop_sessions set pairing_expires_at=now()-interval '1 second' where game_id='${a.id}'`,
      ).ok,
    ).toBe(true);
    expect(exchange(a.id, expired.code, expired.challenge).result.ok).toBe(
      false,
    );
    const fresh = approve(a.id, a.owner),
      grant = exchange(a.id, fresh.code, fresh.challenge),
      session = JSON.parse(grant.result.stdout);
    expect(session.generation).toBe(2);
    psql(
      `update public.m4_desktop_sessions set lease_expires_at=now()-interval '1 second' where session_id='${session.session_id}'`,
    );
    expect(desktop(a.id, session.session_id, 2, grant.bearer).ok).toBe(false);
    const replacement = approve(a.id, a.owner);
    expect(replacement.result.ok, replacement.result.stderr).toBe(true);
    expect(JSON.parse(replacement.result.stdout).generation).toBe(3);
    const stopped = desktop(a.id, session.session_id, 2, grant.bearer, true);
    expect(stopped.ok, stopped.stderr).toBe(true);
    expect(JSON.parse(stopped.stdout).desired_action).toBe("stop");
    expect(desktop(a.id, session.session_id, 2, grant.bearer, true).ok).toBe(
      true,
    );
    psql(
      `update public.m4_desktop_sessions set expires_at=now()-interval '1 second' where session_id='${session.session_id}'`,
    );
    expect(desktop(a.id, session.session_id, 2, grant.bearer, true).ok).toBe(
      false,
    );
  });
  it("completion fences heartbeat without lease extension and retains stop-only cleanup", () => {
    const a = fixture(),
      pair = approve(a.id, a.owner),
      grant = exchange(a.id, pair.code, pair.challenge),
      session = JSON.parse(grant.result.stdout),
      review = randomUUID();
    const completed = psql(
      `select public.review_game_completion_with_link('${a.id}','${review}','${a.owner}',false,null);select public.complete_reviewed_game('${a.id}','${review}','${randomUUID()}','${a.owner}',false)`,
      true,
    );
    expect(completed.ok, completed.stderr).toBe(true);
    const heartbeat = desktop(a.id, session.session_id, 1, grant.bearer);
    expect(heartbeat.ok, heartbeat.stderr).toBe(true);
    expect(JSON.parse(heartbeat.stdout)).toMatchObject({
      desired_action: "stop",
      lease_expires_at: session.lease_expires_at,
    });
    expect(desktop(a.id, session.session_id, 1, grant.bearer, true).ok).toBe(
      true,
    );
    expect(approve(a.id, a.owner).result.ok).toBe(false);
  });
  it("consumes a grant exactly once across real concurrent transactions", async () => {
    const a = fixture(),
      pair = approve(a.id, a.owner);
    const holder = holdTransaction(
      `select * from public.exchange_m4_desktop_pairing('${a.id}','${pair.code}','${pair.challenge}','${hash()}')`,
    );
    await holder.ready;
    const name = "m4_pair_" + randomUUID().replaceAll("-", "");
    const waiting = psqlAsync(
      `select * from public.exchange_m4_desktop_pairing('${a.id}','${pair.code}','${pair.challenge}','${hash()}')`,
      name,
    );
    try {
      await waitForLock(name);
    } finally {
      holder.release();
    }
    expect((await waiting).ok).toBe(false);
    expect(
      psql(
        `select count(*) from public.m4_desktop_sessions where game_id='${a.id}' and consumed_at is not null`,
      ).stdout,
    ).toBe("1");
  });
});
