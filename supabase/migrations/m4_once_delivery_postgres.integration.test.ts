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

function prepared() {
  const a = fixture(),
    pair = approve(a.id, a.owner),
    grant = exchange(a.id, pair.code, pair.challenge),
    s = JSON.parse(grant.result.stdout),
    token = randomUUID();
  const claimed = psql(
    `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'prepared','${token}')`,
    true,
  );
  expect(claimed.ok, claimed.stderr).toBe(true);
  const journal = JSON.parse(claimed.stdout);
  const done = psql(
    `select public.record_m4_broadcast_operation('${a.id}',${journal.generation},'${token}','prepared',p_youtube_broadcast_id=>'broadcast-a',p_youtube_stream_id=>'stream-a',p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready')`,
    true,
  );
  expect(done.ok, done.stderr).toBe(true);
  return { ...a, ...s, bearer: grant.bearer };
}
function output(
  a: ReturnType<typeof prepared>,
  intent = randomUUID(),
  delivery = false,
) {
  return psql(
    `select row_to_json(x) from public.${delivery ? "mark_m4_output_delivery" : "claim_m4_output_intent"}('${a.id}','${a.session_id}',${a.generation},'${a.bearer}','${intent}') x`,
    true,
  );
}

function consume(
  a: ReturnType<typeof prepared>,
  intent: string,
  assertion = false,
) {
  return psql(deliverySql(a, intent, assertion), true);
}
function deliverySql(
  a: ReturnType<typeof prepared>,
  intent: string,
  assertion = false,
) {
  return `select row_to_json(x) from public.${assertion ? "assert" : "consume"}_m4_output_delivery('${a.id}','${a.session_id}',${a.generation},'${a.bearer}','${intent}') x`;
}
describe.skipIf(!enabled)("M4 once-only handoff PostgreSQL authority", () => {
  it("consumes once, exposes bound metadata, and survives lost response without redelivery", () => {
    const a = prepared(),
      i = randomUUID();
    expect(output(a, i).ok).toBe(true);
    expect(consume(a, i, true).ok).toBe(false);
    const first = consume(a, i);
    expect(first.ok, first.stderr).toBe(true);
    expect(JSON.parse(first.stdout)).toMatchObject({
      intent_id: i,
      organization_id: a.org,
      session_id: a.session_id,
      generation: a.generation,
      youtube_stream_id: "stream-a",
      youtube_broadcast_id: "broadcast-a",
      youtube_channel_id: "channel-m4",
      youtube_connection_version: 1,
    });
    expect(consume(a, i).ok).toBe(false);
    expect(consume(a, i, true).stdout).toBe(first.stdout);
    expect(output(a, i).stdout).toContain("quarantined");
    expect(
      psql(
        `select count(*) from public.m4_output_intents where intent_id='${i}' and delivery_recorded_at is not null`,
      ).stdout,
    ).toBe("1");
  });
  it("rejects old idempotent barriers and browser/helper access", () => {
    const a = prepared(),
      i = randomUUID();
    output(a, i);
    output(a, i, true);
    expect(consume(a, i).ok).toBe(false);
    expect(consume(a, i, true).ok).toBe(false);
    expect(psql(`set role authenticated;${deliverySql(a, i)}`).ok).toBe(false);
    expect(
      psql(
        `set role service_role;select * from public.m4_output_delivery_authority('${a.id}','${a.session_id}',${a.generation},'${a.bearer}','${i}',true)`,
      ).ok,
    ).toBe(false);
  });
  it("fences bad bearer, generation, game, provider and expired lease before the barrier", () => {
    const a = prepared(),
      i = randomUUID();
    output(a, i);
    for (const changed of [
      { ...a, bearer: hash() },
      { ...a, generation: a.generation + 1 },
      { ...a, id: randomUUID() },
    ])
      expect(consume(changed, i).ok).toBe(false);
    psql(
      `update public.broadcast_sessions set operation_generation=operation_generation+1 where game_id='${a.id}'`,
    );
    expect(consume(a, i).ok).toBe(false);
    psql(
      `update public.broadcast_sessions set operation_generation=operation_generation-1 where game_id='${a.id}';update public.broadcast_settings set channel_id='different' where organization_id='${a.org}'`,
    );
    expect(consume(a, i).ok).toBe(false);
    psql(
      `update public.broadcast_settings set channel_id='channel-m4' where organization_id='${a.org}';update public.m4_desktop_sessions set lease_expires_at=clock_timestamp()-interval '1 second' where session_id='${a.session_id}'`,
    );
    expect(consume(a, i).ok).toBe(false);
    expect(
      psql(
        `select delivery_recorded_at is null from public.m4_output_intents where intent_id='${i}'`,
      ).stdout,
    ).toBe("t");
  });
  it("rejects channel replacement or stop after consume and retains quarantine", () => {
    const a = prepared(),
      i = randomUUID();
    output(a, i);
    expect(consume(a, i).ok).toBe(true);
    psql(
      `update public.broadcast_settings set connection_version=connection_version+1 where organization_id='${a.org}'`,
    );
    expect(consume(a, i, true).ok).toBe(false);
    expect(desktop(a.id, a.session_id, a.generation, a.bearer, true).ok).toBe(
      true,
    );
    expect(consume(a, i, true).ok).toBe(false);
    expect(approve(a.id, a.owner).result.ok).toBe(false);
  });
  it("permits exactly one concurrent consumer", async () => {
    const a = prepared(),
      i = randomUUID();
    output(a, i);
    const holder = holdTransaction(deliverySql(a, i));
    await holder.ready;
    const name = "m4_once_" + randomUUID().replaceAll("-", "");
    const waiting = psqlAsync(deliverySql(a, i), name);
    try {
      await waitForLock(name);
    } finally {
      holder.release();
    }
    expect((await waiting).ok).toBe(false);
  });
  it("rechecks clock after waiting for a lock instead of transaction-start time", async () => {
    const a = prepared(),
      i = randomUUID();
    output(a, i);
    const holder = holdTransaction(
      `select 1 from public.game_states where game_id='${a.id}' for update;update public.m4_desktop_sessions set lease_expires_at=clock_timestamp()+interval '1 second' where session_id='${a.session_id}'`,
    );
    await holder.ready;
    const name = "m4_expire_" + randomUUID().replaceAll("-", "");
    const waiting = psqlAsync(deliverySql(a, i), name);
    try {
      await waitForLock(name);
      await new Promise((r) => setTimeout(r, 1200));
    } finally {
      holder.release();
    }
    expect((await waiting).ok).toBe(false);
  });
  it("serializes terminal completion before consume without setting barrier", async () => {
    const a = prepared(),
      i = randomUUID(),
      review = randomUUID();
    output(a, i);
    const holder = holdTransaction(
      `select public.review_game_completion_with_link('${a.id}','${review}','${a.owner}',false,null);select public.complete_reviewed_game('${a.id}','${review}','${randomUUID()}','${a.owner}',false)`,
    );
    await holder.ready;
    const name = "m4_terminal_" + randomUUID().replaceAll("-", "");
    const waiting = psqlAsync(deliverySql(a, i), name);
    try {
      await waitForLock(name);
    } finally {
      holder.release();
    }
    expect((await waiting).ok).toBe(false);
    expect(
      psql(
        `select phase||':'||(delivery_recorded_at is not null)::text from public.m4_output_intents where intent_id='${i}'`,
      ).stdout,
    ).toBe("stop_requested:false");
  });
});
describe.skipIf(!enabled)("M4 membership revocation lock race", () => {
  it("reauthorizes consumption and assertion after settings-lock waits", async () => {
    for (const assertion of [false, true]) {
      const a = prepared(),
        i = randomUUID();
      expect(output(a, i).ok).toBe(true);
      if (assertion) expect(consume(a, i).ok).toBe(true);
      expect(psql(account(randomUUID(), a.org)).ok).toBe(true);
      const holder = holdTransaction(
        `select 1 from public.broadcast_settings where organization_id='${a.org}' for update`,
      );
      await holder.ready;
      const name = "m4_revoke_" + randomUUID().replaceAll("-", "");
      const waiting = psqlAsync(deliverySql(a, i, assertion), name);
      try {
        await waitForLock(name);
        const revoked = psql(
          `delete from public.team_memberships where organization_id='${a.org}' and user_id='${a.owner}'`,
        );
        expect(revoked.ok, revoked.stderr).toBe(true);
      } finally {
        holder.release();
      }
      expect((await waiting).ok).toBe(false);
      expect(
        psql(
          `select delivery_recorded_at is not null from public.m4_output_intents where intent_id='${i}'`,
        ).stdout,
      ).toBe(assertion ? "t" : "f");
    }
  });
});
