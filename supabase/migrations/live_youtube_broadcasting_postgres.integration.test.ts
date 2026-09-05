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

describe.skipIf(!enabled)(
  "live YouTube broadcasting PostgreSQL boundary",
  () => {
    it("enforces verified same-team authority and supports organizer credentials", () => {
      const organizationA = randomUUID();
      const organizationB = randomUUID();
      const gameId = randomUUID();
      const owner = randomUUID();
      const admin = randomUUID();
      const scorer = randomUUID();
      const unverified = randomUUID();
      const inactive = randomUUID();
      const otherOwner = randomUUID();
      const seed = psql(`
        insert into public.organizations(id,name) values
          ('${organizationA}','Broadcast A'),('${organizationB}','Broadcast B');
        ${account(owner, organizationA)}
        ${account(admin, organizationA, { role: "team_admin" })}
        ${account(scorer, organizationA, { role: "scorer" })}
        ${account(unverified, organizationA, { verified: false })}
        ${account(inactive, organizationA, { active: false })}
        ${account(otherOwner, organizationB)}
        ${game(gameId, organizationA, owner)}
        insert into public.broadcast_settings(
          organization_id,provider,encrypted_credentials,channel_id,channel_title,
          connection_status,connection_version
        ) values ('${organizationA}','youtube','opaque','channel-a','Club A','connected',1);
      `);
      expect(seed.stderr).toBe("");

      for (const user of [scorer, unverified, inactive, otherOwner]) {
        expect(
          psql(
            `select public.claim_game_broadcast_operation('${gameId}','${user}',false,'live','${randomUUID()}')`,
            true,
          ).ok,
        ).toBe(false);
      }
      for (const user of [owner, admin]) {
        const value = psql(
          `select public.get_game_broadcast_session('${gameId}','${user}',false)->>'status'`,
          true,
        );
        expect(value).toEqual({ ok: true, stdout: "idle", stderr: "" });
      }
      expect(
        psql(
          `select public.get_game_broadcast_session('${gameId}',null,true)->>'status'`,
          true,
        ).stdout,
      ).toBe("idle");
      expect(
        psql(
          `select has_function_privilege('authenticated','public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid)','execute')`,
        ).stdout,
      ).toBe("f");
    });

    it("makes claims idempotent, fences late starts, and makes Stop final", () => {
      const organizationId = randomUUID();
      const owner = randomUUID();
      const gameId = randomUUID();
      const stopIntentGame = randomUUID();
      const token = randomUUID();
      const seed = psql(`
        insert into public.organizations(id,name) values ('${organizationId}','Fence team');
        ${account(owner, organizationId)}
        ${game(gameId, organizationId, owner)}
        ${game(stopIntentGame, organizationId, owner)}
        insert into public.broadcast_settings(
          organization_id,provider,encrypted_credentials,channel_id,channel_title,
          connection_status,connection_version
        ) values ('${organizationId}','youtube','opaque','channel-a','Club A','connected',1);
      `);
      expect(seed.stderr).toBe("");
      const claimed = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation('${gameId}','${owner}',false,'live','${token}')`,
          true,
        ).stdout,
      );
      expect(claimed).toMatchObject({ action: "run", status: "preparing" });
      const duplicate = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation('${gameId}','${owner}',false,'live','${randomUUID()}')`,
          true,
        ).stdout,
      );
      expect(duplicate).toMatchObject({
        action: "wait",
        generation: claimed.generation,
      });

      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${claimed.generation},'${token}','preparing','youtube-id',null,null,
          'https://www.youtube.com/watch?v=abcdefghi',null,'youtube-broadcast-ready',false)->>'status'`,
          true,
        ).stdout,
      ).toBe("preparing");
      expect(
        psql(
          `select public.soft_delete_team_game('${owner}','${gameId}')`,
          true,
        ).stdout,
      ).toBe("t");
      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${claimed.generation},'${token}','live',null,null,'late-egress',null,null,'live',false)`,
          true,
        ).stdout,
      ).toBe("");
      const stop = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation('${gameId}','${owner}',false,'stopped','${randomUUID()}')`,
          true,
        ).stdout,
      );
      expect(stop).toMatchObject({ action: "run", desiredState: "stopped" });
      expect(
        psql(
          `select public.claim_game_broadcast_operation('${gameId}','${owner}',false,'live','${randomUUID()}')`,
          true,
        ).ok,
      ).toBe(false);

      const firstIntent = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation('${stopIntentGame}','${owner}',false,'live','${randomUUID()}')`,
          true,
        ).stdout,
      );
      expect(firstIntent.action).toBe("run");
      expect(
        JSON.parse(
          psql(
            `select public.claim_game_broadcast_operation('${stopIntentGame}','${owner}',false,'stopped','${randomUUID()}')`,
            true,
          ).stdout,
        ),
      ).toMatchObject({ action: "run", status: "stopping" });
      expect(
        psql(
          `select public.claim_game_broadcast_operation('${stopIntentGame}','${owner}',false,'live','${randomUUID()}')`,
          true,
        ).ok,
      ).toBe(false);
    });

    it("blocks channel replacement and returns the provider replay URL from completion", () => {
      const organizationId = randomUUID();
      const owner = randomUUID();
      const gameId = randomUUID();
      const reviewId = randomUUID();
      const completionId = randomUUID();
      const operationToken = randomUUID();
      const seed = psql(`
        insert into public.organizations(id,name) values ('${organizationId}','Replay team');
        ${account(owner, organizationId)}
        ${game(gameId, organizationId, owner)}
        insert into public.broadcast_settings(
          organization_id,provider,encrypted_credentials,channel_id,channel_title,
          connection_status,connection_version
        ) values ('${organizationId}','youtube','opaque','channel-a','Club A','connected',1);
      `);
      expect(seed.stderr).toBe("");
      const claim = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation('${gameId}','${owner}',false,'live','${operationToken}')`,
          true,
        ).stdout,
      );
      expect(
        psql(
          `update public.broadcast_settings set encrypted_credentials='fresh'
          where organization_id='${organizationId}' and provider='youtube'`,
        ).ok,
      ).toBe(true);
      expect(
        psql(
          `update public.broadcast_settings set channel_id='channel-b'
          where organization_id='${organizationId}' and provider='youtube'`,
        ).ok,
      ).toBe(false);
      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${claim.generation},'${operationToken}','preparing','replay-id',null,null,
          'https://www.youtube.com/watch?v=original1',null,'youtube-broadcast-ready',false)`,
          true,
        ).ok,
      ).toBe(true);
      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${claim.generation},'${operationToken}','live',null,null,'egress-replay',
          null,null,'live',false)`,
          true,
        ).ok,
      ).toBe(true);
      const stopToken = randomUUID();
      const stop = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation(
          '${gameId}','${owner}',false,'stopped','${stopToken}')`,
          true,
        ).stdout,
      );
      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${stop.generation},'${stopToken}','stopped',null,null,null,
          null,null,'stopped',false)`,
          true,
        ).ok,
      ).toBe(true);
      expect(
        psql(
          `select review_id from public.review_game_completion_with_link(
          '${gameId}','${reviewId}','${owner}',false,'https://youtu.be/manual99')`,
          true,
        ).stdout,
      ).toBe(reviewId);
      expect(
        psql(
          `select completion_id from public.complete_reviewed_game(
          '${gameId}','${reviewId}','${completionId}','${owner}',false)`,
          true,
        ).stdout,
      ).toBe(completionId);
      expect(
        psql(
          `select youtube_watch_url from public.game_completions where game_id='${gameId}'`,
        ).stdout,
      ).toBe("https://www.youtube.com/watch?v=original1");
    });

    it("retains the reviewed URL when preparation never reached live", () => {
      const organizationId = randomUUID();
      const owner = randomUUID();
      const gameId = randomUUID();
      const reviewId = randomUUID();
      const completionId = randomUUID();
      const startToken = randomUUID();
      const seed = psql(`
        insert into public.organizations(id,name) values ('${organizationId}','Fallback team');
        ${account(owner, organizationId)}
        ${game(gameId, organizationId, owner)}
        insert into public.broadcast_settings(
          organization_id,provider,encrypted_credentials,channel_id,channel_title,
          connection_status,connection_version
        ) values ('${organizationId}','youtube','opaque','channel-a','Club A','connected',1);
      `);
      expect(seed.stderr).toBe("");
      const start = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation(
          '${gameId}','${owner}',false,'live','${startToken}')`,
          true,
        ).stdout,
      );
      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${start.generation},'${startToken}','preparing','deleted-video',null,null,
          'https://www.youtube.com/watch?v=deleted01',null,'youtube-broadcast-ready',false)`,
          true,
        ).ok,
      ).toBe(true);
      const stopToken = randomUUID();
      const stop = JSON.parse(
        psql(
          `select public.claim_game_broadcast_operation(
          '${gameId}','${owner}',false,'stopped','${stopToken}')`,
          true,
        ).stdout,
      );
      expect(
        psql(
          `select public.record_game_broadcast_operation(
          '${gameId}',${stop.generation},'${stopToken}','stopped',null,null,null,
          null,null,'stopped',false)`,
          true,
        ).ok,
      ).toBe(true);
      expect(
        psql(
          `select review_id from public.review_game_completion_with_link(
          '${gameId}','${reviewId}','${owner}',false,'https://youtu.be/manual99')`,
          true,
        ).stdout,
      ).toBe(reviewId);
      expect(
        psql(
          `select completion_id from public.complete_reviewed_game(
          '${gameId}','${reviewId}','${completionId}','${owner}',false)`,
          true,
        ).stdout,
      ).toBe(completionId);
      expect(
        psql(
          `select youtube_watch_url from public.game_completions where game_id='${gameId}'`,
        ).stdout,
      ).toBe("https://youtu.be/manual99");
    });

    it("serializes Start against disconnect without stranding a session", async () => {
      const organizationId = randomUUID();
      const owner = randomUUID();
      const gameId = randomUUID();
      const seed = psql(`
      insert into public.organizations(id,name) values ('${organizationId}','Race team');
      ${account(owner, organizationId)}
      ${game(gameId, organizationId, owner)}
      insert into public.broadcast_settings(
        organization_id,provider,encrypted_credentials,channel_id,channel_title,
        connection_status,connection_version
      ) values ('${organizationId}','youtube','opaque','channel-a','Club A','connected',1);
    `);
      expect(seed.stderr).toBe("");
      const holder = holdTransaction(`
      update public.broadcast_settings set encrypted_credentials=null,
        channel_id=null, channel_title=null, connection_status='disconnected'
      where organization_id='${organizationId}' and provider='youtube'
    `);
      await holder.ready;
      const waiterName = `start_waiter_${randomUUID().replaceAll("-", "")}`;
      const starting = psqlAsync(
        `select public.claim_game_broadcast_operation(
        '${gameId}','${owner}',false,'live','${randomUUID()}')`,
        waiterName,
      );
      await waitForLock(waiterName);
      holder.release();
      const result = await starting;
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("youtube reconnect required");
      expect(
        psql(
          `select count(*) from public.broadcast_sessions where game_id='${gameId}'`,
        ).stdout,
      ).toBe("0");
    });
  },
);
