import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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

function environment() {
  if (!parsed) throw new Error("Disposable PostgreSQL is not configured");
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
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

function account(
  userId: string,
  organizationId: string,
  options: {
    role?: "owner" | "team_admin" | "scorer";
    verified?: boolean;
    active?: boolean;
  } = {},
) {
  return `
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('${userId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      '${userId}@youtube.test','',${options.verified === false ? "null" : "now()"},'{}','{}',now(),now());
    insert into public.user_profiles(user_id,display_name,status)
      values ('${userId}','YouTube account','${options.active === false ? "suspended" : "active"}');
    insert into public.team_memberships(organization_id,user_id,role,status)
      values ('${organizationId}','${userId}','${options.role ?? "owner"}','active');
  `;
}

describe.skipIf(!enabled)("team YouTube connection PostgreSQL boundary", () => {
  it("authorizes administrators and rejects stale organization/version writes", () => {
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const owner = randomUUID();
    const administrator = randomUUID();
    const scorer = randomUUID();
    const unverified = randomUUID();
    const inactive = randomUUID();
    const otherOwner = randomUUID();
    const ciphertext = Buffer.from("opaque-encrypted-envelope").toString(
      "base64",
    );
    expect(
      psql(`
        insert into public.organizations(id,name) values
          ('${organizationA}','YouTube A'),('${organizationB}','YouTube B');
        ${account(owner, organizationA)}
        ${account(administrator, organizationA, { role: "team_admin" })}
        ${account(scorer, organizationA, { role: "scorer" })}
        ${account(unverified, organizationA, { verified: false })}
        ${account(inactive, organizationA, { active: false })}
        ${account(otherOwner, organizationB)}
      `).ok,
    ).toBe(true);

    const ownerAttempt = "a".repeat(64);
    expect(
      psql(
        `select organization_id,expected_version from public.begin_youtube_oauth(
          '${owner}','${ownerAttempt}',now()+interval '10 minutes')`,
        true,
      ).stdout,
    ).toBe(`${organizationA}|0`);
    expect(
      psql(
        `select organization_id,expected_version from public.consume_youtube_oauth(
          '${owner}','${ownerAttempt}')`,
        true,
      ).stdout,
    ).toBe(`${organizationA}|0`);
    expect(
      psql(
        `select public.complete_youtube_connection('${owner}','${organizationA}',0,
          '${ciphertext}','channel-a','Club A')`,
        true,
      ).stdout,
    ).toBe("1");
    expect(
      psql(
        `select channel_id,channel_title,connection_status,connection_version,can_manage
          from public.get_youtube_connection('${administrator}')`,
        true,
      ).stdout,
    ).toBe("channel-a|Club A|connected|1|t");

    for (const denied of [scorer, unverified, inactive]) {
      const result = psql(
        `select * from public.begin_youtube_oauth('${denied}','${randomUUID().replaceAll("-", "").padEnd(64, "0")}',now()+interval '10 minutes')`,
        true,
      );
      expect(result.ok).toBe(false);
      expect(result.stderr).toMatch(
        /team administrator|required|verified active/i,
      );
    }

    const staleAttempt = "b".repeat(64);
    expect(
      psql(
        `select * from public.begin_youtube_oauth('${administrator}','${staleAttempt}',now()+interval '10 minutes');
         select * from public.consume_youtube_oauth('${administrator}','${staleAttempt}')`,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select public.disconnect_youtube_connection('${administrator}')`,
        true,
      ).stdout,
    ).toBe("2");
    const staleCallback = psql(
      `select public.complete_youtube_connection('${administrator}','${organizationA}',1,
        '${ciphertext}','stale-channel','Stale')`,
      true,
    );
    expect(staleCallback.ok).toBe(false);
    expect(staleCallback.stderr).toContain("youtube connection changed");
    expect(
      psql(`select connection_status,connection_version,channel_id is null
        from public.broadcast_settings where organization_id='${organizationA}' and provider='youtube'`)
        .stdout,
    ).toBe("disconnected|2|t");

    const movedAttempt = "c".repeat(64);
    expect(
      psql(
        `select * from public.begin_youtube_oauth('${owner}','${movedAttempt}',now()+interval '10 minutes');
         select * from public.consume_youtube_oauth('${owner}','${movedAttempt}')`,
        true,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `update public.team_memberships set organization_id='${organizationB}' where user_id='${owner}'`,
      ).ok,
    ).toBe(true);
    const wrongOrganization = psql(
      `select public.complete_youtube_connection('${owner}','${organizationA}',2,
        '${ciphertext}','channel-a','Club A')`,
      true,
    );
    expect(wrongOrganization.ok).toBe(false);
    expect(wrongOrganization.stderr).toContain("youtube organization changed");
    expect(
      psql(
        `select count(*) from public.broadcast_settings where organization_id='${organizationB}'`,
      ).stdout,
    ).toBe("0");

    expect(
      psql(
        `update public.team_memberships set organization_id='${organizationA}' where user_id='${owner}'`,
      ).ok,
    ).toBe(true);
    expect(
      psql(
        `select public.complete_youtube_connection('${owner}','${organizationA}',2,
          '${ciphertext}','channel-a','Club A')`,
        true,
      ).stdout,
    ).toBe("3");
    expect(
      psql(
        `select public.complete_youtube_connection('${administrator}','${organizationA}',3,
          '${ciphertext}','channel-a','Club A')`,
        true,
      ).stdout,
    ).toBe("4");
    const staleTest = psql(
      `select public.finish_youtube_connection_test(
        '${owner}','${organizationA}',3,true,null)`,
      true,
    );
    expect(staleTest.ok).toBe(false);
    expect(staleTest.stderr).toContain("youtube connection changed");
    expect(
      psql(`select connection_status,connection_version,channel_id
        from public.broadcast_settings where organization_id='${organizationA}' and provider='youtube'`)
        .stdout,
    ).toBe("connected|4|channel-a");

    expect(
      psql(`select
        has_function_privilege('service_role','public.get_youtube_connection(uuid)','execute'),
        has_function_privilege('authenticated','public.get_youtube_connection(uuid)','execute'),
        has_function_privilege('service_role','public.youtube_team(uuid,boolean)','execute'),
        has_table_privilege('service_role','public.youtube_oauth_states','select')`)
        .stdout,
    ).toBe("t|f|f|f");
  });
});
