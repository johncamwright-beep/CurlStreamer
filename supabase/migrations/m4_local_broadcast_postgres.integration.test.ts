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
function claim(
  id: string,
  owner: string,
  desired = "prepared",
  token = randomUUID(),
) {
  return psql(
    `select public.claim_m4_broadcast_operation('${id}','${owner}',false,'${desired}','${token}')`,
    true,
  );
}
function recorded(
  id: string,
  generation: number,
  token: string,
  status: string,
  extra = "",
) {
  return psql(
    `select public.record_m4_broadcast_operation('${id}',${generation},'${token}','${status}'${extra})`,
    true,
  );
}
describe.skipIf(!enabled)("M4 local broadcast PostgreSQL authority", () => {
  it("leases preparation once, preserves intents across recovery, and fences late writes", () => {
    const { id, owner } = fixture(),
      token = randomUUID();
    const first = claim(id, owner, "prepared", token);
    expect(first.ok, first.stderr).toBe(true);
    const a = JSON.parse(first.stdout);
    expect(a).toMatchObject({
      action: "run",
      transport: "local-obs",
      status: "preparing",
    });
    expect(JSON.parse(claim(id, owner).stdout).action).toBe("wait");
    const intent = recorded(
      id,
      a.generation,
      token,
      "preparing",
      `,p_uncertain=>true,p_youtube_broadcast_create_state=>'intent'`,
    );
    expect(intent.ok, intent.stderr).toBe(true);
    expect(
      psql(
        `update public.broadcast_sessions set lease_expires_at=now()-interval '1 second' where game_id='${id}'`,
      ).ok,
    ).toBe(true);
    expect(recorded(id, a.generation, token, "failed").stdout).toBe("");
    const fresh = randomUUID(),
      b = JSON.parse(claim(id, owner, "prepared", fresh).stdout);
    expect(b.generation).toBeGreaterThan(a.generation);
    expect(b.youtubeBroadcastCreateState).toBe("intent");
    expect(recorded(id, a.generation, token, "failed").stdout).toBe("");
    const ready = recorded(
      id,
      b.generation,
      fresh,
      "prepared",
      `,p_youtube_broadcast_id=>'broadcast-m4',p_youtube_stream_id=>'stream-m4',p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready'`,
    );
    expect(ready.ok, ready.stderr).toBe(true);
    expect(JSON.parse(ready.stdout).status).toBe("prepared");
    expect(
      psql(
        `update public.broadcast_settings set channel_id='different-channel' where organization_id=(select organization_id from public.games where id='${id}')`,
      ).ok,
    ).toBe(false);
    expect(JSON.parse(claim(id, owner).stdout).action).toBe("none");
    expect(recorded(id, b.generation, fresh, "failed").stdout).toBe("");
    const stopToken = randomUUID(),
      stop = JSON.parse(claim(id, owner, "stopped", stopToken).stdout);
    expect(recorded(id, stop.generation, stopToken, "stopped").ok).toBe(true);
    expect(claim(id, owner).ok).toBe(false);
  });
  it("prevents legacy commandeering and M4 takeover while preserving legacy behavior", () => {
    const local = fixture();
    expect(claim(local.id, local.owner).ok).toBe(true);
    for (const call of [
      `claim_game_broadcast_operation('${local.id}','${local.owner}',false,'stopped','${randomUUID()}')`,
      `get_game_broadcast_session('${local.id}','${local.owner}',false)`,
    ])
      expect(psql(`select public.${call}`, true).ok).toBe(false);
    expect(
      psql(
        `select public.get_game_broadcast_transport('${local.id}','${local.owner}',false)`,
        true,
      ).stdout,
    ).toBe("local-obs");
    expect(
      psql(
        `select public.legacy_get_game_broadcast_session('${local.id}','${local.owner}',false)`,
        true,
      ).ok,
    ).toBe(false);
    const legacy = fixture();
    const result = psql(
      `select public.claim_game_broadcast_operation('${legacy.id}','${legacy.owner}',false,'live','${randomUUID()}')`,
      true,
    );
    expect(result.ok, result.stderr).toBe(true);
    expect(JSON.parse(result.stdout).action).toBe("run");
    expect(claim(legacy.id, legacy.owner).ok).toBe(false);
    expect(
      psql(
        `select public.get_game_broadcast_session('${legacy.id}','${legacy.owner}',false)->>'status'`,
        true,
      ).stdout,
    ).toBe("preparing");
  });
  it("enforces same-team authority, unlisted preparation, and completed-game late-write fencing", () => {
    const a = fixture(),
      b = fixture();
    expect(claim(a.id, b.owner).ok).toBe(false);
    expect(
      psql(
        `set role authenticated;select public.get_m4_broadcast_session('${a.id}','${a.owner}',false)`,
      ).ok,
    ).toBe(false);
    psql(
      `update public.games set config=jsonb_set(config,'{youtubeVisibility}','"public"') where id='${a.id}'`,
    );
    expect(claim(a.id, a.owner).ok).toBe(false);
    psql(
      `update public.games set config=jsonb_set(config,'{youtubeVisibility}','"unlisted"') where id='${a.id}'`,
    );
    const token = randomUUID(),
      start = JSON.parse(claim(a.id, a.owner, "prepared", token).stdout);
    const review = randomUUID();
    const terminal = psql(
      `select public.review_game_completion_with_link('${a.id}','${review}','${a.owner}',false,null);
       select public.complete_reviewed_game('${a.id}','${review}','${randomUUID()}','${a.owner}',false)`,
      true,
    );
    expect(terminal.ok, terminal.stderr).toBe(true);
    expect(
      recorded(
        a.id,
        start.generation,
        token,
        "prepared",
        `,p_youtube_broadcast_id=>'late',p_youtube_stream_id=>'late',p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready'`,
      ).stdout,
    ).toBe("");
    expect(claim(a.id, a.owner).ok).toBe(false);
    expect(claim(a.id, a.owner, "stopped").ok).toBe(true);
  });
  it("serializes two actual concurrent claim transactions", async () => {
    const { id, owner } = fixture();
    const holder = holdTransaction(
      `select public.claim_m4_broadcast_operation('${id}','${owner}',false,'prepared','${randomUUID()}')`,
    );
    await holder.ready;
    const name = "m4_wait_" + randomUUID().replaceAll("-", "");
    const waiting = psqlAsync(
      `select public.claim_m4_broadcast_operation('${id}','${owner}',false,'prepared','${randomUUID()}')`,
      name,
    );
    try {
      await waitForLock(name);
    } finally {
      holder.release();
    }
    const result = await waiting;
    expect(result.ok, result.stderr).toBe(true);
    expect(JSON.parse(result.stdout).action).toBe("wait");
  });
});
