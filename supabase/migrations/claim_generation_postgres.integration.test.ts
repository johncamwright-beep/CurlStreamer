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

describe.skipIf(!enabled)("claim generation PostgreSQL transactions", () => {
  it("consumes one invitation atomically and keeps same-device retry idempotent", async () => {
    const gameId = randomUUID();
    const invitationId = randomUUID();
    const firstDevice = randomUUID();
    const secondDevice = randomUUID();
    expect(sql(fixture(gameId)).ok).toBe(true);
    expect(service(prepare(gameId, invitationId)).stdout).toBe("1");

    const first = held(
      claim(gameId, invitationId, 1, firstDevice),
      `claim_first_${randomUUID()}`,
    );
    await first.ready;
    const app = `claim_second_${randomUUID()}`;
    const second = asyncService(
      claim(gameId, invitationId, 1, secondDevice),
      app,
    );
    waitForLock(app);
    first.release();
    expect(await first.result).toMatchObject({ ok: true, stdout: "1" });
    const rejected = await second;
    expect(rejected.ok).toBe(false);
    expect(rejected.stderr).toContain("invitation_consumed");

    const version = sql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    expect(service(claim(gameId, invitationId, 1, firstDevice)).stdout).toBe(
      "1",
    );
    expect(
      sql(`select version, state#>>'{claims,camera-home}' from public.game_states
        where game_id='${gameId}'`).stdout,
    ).toBe(`${version}|${firstDevice}`);
  }, 15_000);

  it("rejects stale invitation and legacy writes after release, even for the same device", () => {
    const gameId = randomUUID();
    const invitationId = randomUUID();
    const nextInvitation = randomUUID();
    const deviceId = randomUUID();
    expect(sql(fixture(gameId)).ok).toBe(true);
    expect(service(prepare(gameId, invitationId)).stdout).toBe("1");
    expect(service(claim(gameId, invitationId, 1, deviceId)).stdout).toBe("1");
    expect(
      service(`select released_generation from public.release_game_role(
        '${gameId}','camera-home','${deviceId}',1)`).stdout,
    ).toBe("1");
    expect(
      sql(`select state#>>'{claimGenerations,camera-home}' from public.game_states
      where game_id='${gameId}'`).stdout,
    ).toBe("2");
    expect(service(claim(gameId, invitationId, 1, deviceId)).stderr).toContain(
      "stale_invitation",
    );

    const version = sql(
      `select version from public.game_states where game_id='${gameId}'`,
    ).stdout;
    const state = sql(
      `select jsonb_set(state,'{claims,camera-home}','\"${deviceId}\"'::jsonb,true)
       from public.game_states where game_id='${gameId}'`,
    ).stdout;
    expect(
      service(`select public.write_game_state('${gameId}',${version},
        '${state.replaceAll("'", "''")}'::jsonb)`).stderr,
    ).toContain("claim_generation_required");

    expect(service(prepare(gameId, nextInvitation)).stdout).toBe("3");
    expect(service(claim(gameId, nextInvitation, 3, deviceId)).stdout).toBe(
      "3",
    );
    expect(
      service(`select released_generation from public.release_game_role(
        '${gameId}','camera-home','${deviceId}',1)`).stderr,
    ).toContain("assignment_changed");
    expect(
      sql(`select state#>>'{claims,camera-home}',
        state#>>'{claimGenerations,camera-home}' from public.game_states
        where game_id='${gameId}'`).stdout,
    ).toBe(`${deviceId}|3`);
    expect(
      service(`select role,generation from
        public.list_game_camera_identity_generations('${gameId}')`).stdout,
    ).toMatch(/^camera-home\|1\r?\ncamera-home\|3$/);
  });

  it("invalidates replaced invitations and refuses terminal games", () => {
    const gameId = randomUUID();
    const first = randomUUID();
    const replacement = randomUUID();
    expect(sql(fixture(gameId)).ok).toBe(true);
    expect(service(prepare(gameId, first)).stdout).toBe("1");
    expect(service(prepare(gameId, replacement)).stdout).toBe("2");
    expect(service(claim(gameId, first, 1, randomUUID())).stderr).toContain(
      "stale_invitation",
    );
    expect(service(claim(gameId, replacement, 2, randomUUID())).stdout).toBe(
      "2",
    );

    for (const terminal of ["closed", "deleted", "completed"] as const) {
      const terminalGame = randomUUID();
      const invitation = randomUUID();
      expect(sql(fixture(terminalGame)).ok).toBe(true);
      expect(service(prepare(terminalGame, invitation)).ok).toBe(true);
      if (terminal === "closed")
        expect(
          sql(`update public.game_states set state=jsonb_set(state,'{status}','\"closed\"')
            where game_id='${terminalGame}'`).ok,
        ).toBe(true);
      else
        expect(
          sql(
            `update public.games set ${
              terminal === "deleted"
                ? "deleted_at=now()"
                : `completed_at=now(),completion_id='${randomUUID()}',status='completed'`
            } where id='${terminalGame}'`,
          ).ok,
        ).toBe(true);
      expect(service(claim(terminalGame, invitation, 1, randomUUID())).ok).toBe(
        false,
      );
    }
  });
});
