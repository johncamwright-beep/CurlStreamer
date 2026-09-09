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
function retiring() {
  const a = prepared(),
    intent = randomUUID();
  expect(output(a, intent).ok).toBe(true);
  expect(consume(a, intent).ok).toBe(true);
  const token = randomUUID();
  const claim = psql(
    `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'stopped','${token}')`,
    true,
  );
  expect(claim.ok, claim.stderr).toBe(true);
  return {
    ...a,
    intent,
    token,
    stopGeneration: JSON.parse(claim.stdout).generation,
  };
}
function confirmation(
  a: ReturnType<typeof retiring>,
  token = a.token,
  stream = "stream-a",
) {
  return `select public.confirm_m4_provider_retirement('${a.id}','${a.owner}',false,${a.stopGeneration},'${token}','broadcast-a','${stream}','channel-m4',1,encode('opaque'::bytea,'base64'))`;
}
function retired() {
  const a = retiring();
  const result = psql(confirmation(a), true);
  expect(result.ok, result.stderr).toBe(true);
  return a;
}
function prepareAgain(a: ReturnType<typeof retiring>, token = randomUUID()) {
  return psql(
    `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'prepared','${token}')`,
    true,
  );
}
describe.skipIf(!enabled)(
  "M4 retired cycle replacement PostgreSQL authority",
  () => {
    it("retires, archives and prepares with fresh pairing and once-only delivery", () => {
      const a = retired();
      const old = psql(
        `select session_key from public.broadcast_sessions where game_id='${a.id}'`,
      ).stdout;
      expect(approve(a.id, a.owner).result.ok).toBe(false);
      const token = randomUUID(),
        result = prepareAgain(a, token);
      expect(result.ok, result.stderr).toBe(true);
      const b = JSON.parse(result.stdout);
      expect(b).toMatchObject({
        action: "run",
        status: "preparing",
        desiredState: "live",
      });
      expect(b.generation).toBe(a.stopGeneration + 1);
      expect(b.sessionKey).not.toBe(old);
      expect(b.youtubeBroadcastId).toBeUndefined();
      expect(b.youtubeStreamId).toBeUndefined();
      expect(
        psql(
          `select metadata->>'youtube_broadcast_id' from public.m4_broadcast_cycle_history where game_id='${a.id}'`,
        ).stdout,
      ).toBe("broadcast-a");
      expect(consume(a, a.intent, true).ok).toBe(false);
      expect(output(a, a.intent).ok).toBe(false);
      expect(
        psql(
          `select public.record_m4_broadcast_operation('${a.id}',${a.stopGeneration},'${a.token}','prepared')`,
          true,
        ).stdout,
      ).toBe("");
      const paired = approve(a.id, a.owner);
      expect(paired.result.ok, paired.result.stderr).toBe(true);
      const ex = exchange(a.id, paired.code, paired.challenge);
      expect(ex.result.ok).toBe(true);
      const fresh = {
        ...a,
        ...JSON.parse(ex.result.stdout),
        bearer: ex.bearer,
      };
      expect(fresh.generation).toBeGreaterThan(a.generation);
      expect(
        psql(
          `select public.record_m4_broadcast_operation('${a.id}',${b.generation},'${token}','prepared',p_youtube_broadcast_id=>'broadcast-b',p_youtube_stream_id=>'stream-b',p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready')`,
          true,
        ).ok,
      ).toBe(true);
      expect(output(fresh, a.intent).ok).toBe(false);
      const intent = randomUUID();
      expect(output(fresh, intent).ok).toBe(true);
      expect(consume(fresh, intent).ok).toBe(true);
      expect(consume(fresh, intent).ok).toBe(false);
    });
    it("denies unresolved delivery and mismatched retirement association", () => {
      const a = retiring();
      expect(prepareAgain(a).ok).toBe(false);
      const b = retired();
      expect(
        psql(
          `update public.m4_output_intents set delivery_channel_id='wrong' where intent_id='${b.intent}'`,
        ).ok,
      ).toBe(true);
      expect(prepareAgain(b).ok).toBe(false);
    });
    it("does not resurrect a terminal game", () => {
      const a = retired();
      expect(
        psql(`update public.games set status='closed' where id='${a.id}'`).ok,
      ).toBe(true);
      expect(prepareAgain(a).ok).toBe(false);
    });
    it("serializes simultaneous preparations into one fresh cycle", async () => {
      const a = retired();
      const results = await Promise.all(
        [1, 2].map((n) =>
          psqlAsync(
            `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'prepared','${randomUUID()}')`,
            "cycle_" + n,
          ),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.map((r) => JSON.parse(r.stdout).action).sort()).toEqual([
        "run",
        "wait",
      ]);
      expect(
        psql(
          `select count(*) from public.m4_broadcast_cycle_history where game_id='${a.id}'`,
        ).stdout,
      ).toBe("1");
    });
    it("reauthorizes replacement after waiting on settings", async () => {
      const a = retired();
      expect(psql(account(randomUUID(), a.org)).ok).toBe(true);
      const holder = holdTransaction(
        `select 1 from public.broadcast_settings where organization_id='${a.org}' for update`,
      );
      await holder.ready;
      const waiter = psqlAsync(
        `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'prepared','${randomUUID()}')`,
        "cycle_reauth",
      );
      try {
        await waitForLock("cycle_reauth");
        expect(
          psql(`delete from public.team_memberships where user_id='${a.owner}'`)
            .ok,
        ).toBe(true);
      } finally {
        holder.release();
      }
      expect((await waiter).ok).toBe(false);
      expect(
        psql(
          `select count(*) from public.m4_broadcast_cycle_history where game_id='${a.id}'`,
        ).stdout,
      ).toBe("0");
    });
    it("allows a provably empty stopped cycle but blocks uncertain creation", () => {
      for (const uncertain of [false, true]) {
        const a = fixture(),
          token = randomUUID();
        let result = psql(
          `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'prepared','${token}')`,
          true,
        );
        expect(result.ok).toBe(true);
        let gen = JSON.parse(result.stdout).generation;
        expect(
          psql(
            `select public.record_m4_broadcast_operation('${a.id}',${gen},'${token}','failed',p_uncertain=>${uncertain},p_youtube_broadcast_create_state=>'${uncertain ? "uncertain" : "none"}')`,
            true,
          ).ok,
        ).toBe(true);
        const stopToken = randomUUID();
        result = psql(
          `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'stopped','${stopToken}')`,
          true,
        );
        expect(result.ok).toBe(true);
        gen = JSON.parse(result.stdout).generation;
        expect(
          psql(
            `select public.record_m4_broadcast_operation('${a.id}',${gen},'${stopToken}','stopped')`,
            true,
          ).ok,
        ).toBe(true);
        const again = psql(
          `select public.claim_m4_broadcast_operation('${a.id}','${a.owner}',false,'prepared','${randomUUID()}')`,
          true,
        );
        expect(again.ok, again.stderr).toBe(!uncertain);
      }
    });
  },
);
