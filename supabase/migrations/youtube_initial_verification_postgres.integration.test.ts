import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const connection = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const parsed = connection ? new URL(connection) : undefined;
const enabled = Boolean(
  parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(test|disposable)/i.test(parsed.pathname) &&
  spawnSync("psql", ["--version"]).status === 0,
);
const migrations = fileURLToPath(new URL("./", import.meta.url));

describe.skipIf(!enabled)("YouTube initial verification migration", () => {
  it("claims historical resources despite a recent connection test and gives fresh grants their own retry deadline", () => {
    const database = `youtube_initial_verification_test_${randomUUID().replaceAll("-", "")}`;
    function run(args: string[], target = database) {
      const result = spawnSync(
        "psql",
        ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PGHOST: parsed!.hostname,
            PGPORT: parsed!.port || "5432",
            PGDATABASE: target,
            PGUSER: decodeURIComponent(parsed!.username),
            PGPASSWORD: decodeURIComponent(parsed!.password),
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.replaceAll("\r\n", "\n").trim();
    }
    const sql = (query: string) => run(["-c", query]);
    const old = randomUUID(),
      recent = randomUUID(),
      recentOwner = randomUUID(),
      fresh = randomUUID(),
      freshOwner = randomUUID(),
      oldGame = randomUUID();
    run(["-c", `create database ${database}`], parsed!.pathname.slice(1));
    try {
      // Minimal local Supabase catalog surface, without production data.
      sql(`
        do $$ begin
          if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
          if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
          if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
        end $$;
        create schema auth;
        create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
        create schema storage;
        create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
        create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
        create schema realtime;
        create table realtime.messages(id bigint generated always as identity,topic text,extension text,payload jsonb,event text,private boolean);
        create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
        create schema extensions;
      `);
      for (const file of readdirSync(migrations).sort()) {
        if (/^\d{4}_.*\.sql$/.test(file) && file < "0083_")
          run(["-f", `${migrations}${file}`]);
      }
      sql(`
        insert into public.organizations(id,name) values('${old}','Old grant'),('${recent}','Recent grant');
        insert into public.games(id,organization_id,config,status,created_by,created_at) values('${oldGame}','${old}','{}','active','${randomUUID()}',now()-interval '90 days');
        insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,channel_title,connection_status,connection_version,connected_at,tested_at,updated_at)
          values('${old}','youtube','opaque','old-channel','Old','connected',1,now()-interval '90 days',now(),now()),
                ('${recent}','youtube','opaque','recent-channel','Recent','connected',1,now(),now(),now());
        update public.games set youtube_scheduled_status='ready',youtube_scheduled_broadcast_id='historical-video',youtube_scheduled_watch_url='https://www.youtube.com/watch?v=historical-video',youtube_scheduled_channel_id='old-channel',youtube_scheduled_connection_version=1 where id='${oldGame}';
      `);
      run(["-f", `${migrations}0083_youtube_authorized_data_retention.sql`]);
      type Receipt = {
        organization_id: string;
        connection_version: number;
        maintenance_claim_id: string;
      };
      const claims = () =>
        JSON.parse(
          sql(
            "set role service_role; select coalesce(json_agg(r),'[]'::json) from public.claim_youtube_authorization_maintenance(100) r",
          ),
        ) as Receipt[];
      const finish = (receipt: Receipt, result: string) =>
        sql(
          `set role service_role; select public.finish_youtube_authorization_maintenance('${receipt.organization_id}',${receipt.connection_version},'${receipt.maintenance_claim_id}','${result}','Current channel')`,
        );
      const first = claims();
      expect(first.map((r) => r.organization_id).sort()).toEqual(
        [old, recent].sort(),
      );
      const oldClaim = first.find((r) => r.organization_id === old)!;
      const recentClaim = first.find((r) => r.organization_id === recent)!;
      expect(
        sql(
          `set role service_role; select id from public.get_youtube_maintenance_resources('${old}',1,'${oldClaim.maintenance_claim_id}')`,
        ),
      ).toBe("historical-video");
      expect(finish(oldClaim, "unavailable")).toBe("removed_unconfirmed");
      expect(
        sql(
          `select encrypted_credentials is null from public.broadcast_settings where organization_id='${old}'; select youtube_scheduled_watch_url is null from public.games where id='${oldGame}'`,
        ),
      ).toBe("t\nt");
      expect(finish(recentClaim, "unavailable")).toBe("retry");
      expect(
        sql(
          `select youtube_initial_verification_pending,encrypted_credentials is not null,youtube_authorization_checked_at>now()-interval '1 minute' from public.broadcast_settings where organization_id='${recent}'`,
        ),
      ).toBe("t|t|t");
      sql(
        `update public.broadcast_settings set youtube_maintenance_retry_at=null where organization_id='${recent}'`,
      );
      const retry = claims()[0];
      expect(finish(retry, "valid")).toBe("verified");
      expect(claims()).toEqual([]);
      expect(
        sql(
          `select youtube_initial_verification_pending from public.broadcast_settings where organization_id='${recent}'`,
        ),
      ).toBe("f");
      sql(`
        insert into public.organizations(id,name) values('${fresh}','Fresh grant');
        insert into auth.users(id,email,email_confirmed_at) values('${recentOwner}','recent@verification.test',now()),('${freshOwner}','fresh@verification.test',now());
        insert into public.user_profiles(user_id,display_name,status) values('${recentOwner}','Recent owner','active'),('${freshOwner}','Fresh owner','active');
        insert into public.team_memberships(organization_id,user_id,role,status) values('${recent}','${recentOwner}','owner','active'),('${fresh}','${freshOwner}','owner','active');
      `);
      expect(
        sql(
          `set role service_role; select public.complete_youtube_connection('${freshOwner}','${fresh}',0,'b3BhcXVl','fresh-channel','Fresh channel')`,
        ),
      ).toBe("1");
      // A missing timestamp is due immediately, but uses the fresh connection
      // date for the cleanup deadline instead of destroying a new grant.
      sql(
        `update public.broadcast_settings set youtube_authorization_checked_at=null where organization_id='${fresh}'`,
      );
      const freshClaim = claims()[0];
      expect(freshClaim.organization_id).toBe(fresh);
      expect(finish(freshClaim, "unavailable")).toBe("retry");
      expect(
        sql(
          `select youtube_initial_verification_pending,encrypted_credentials is not null from public.broadcast_settings where organization_id='${fresh}'`,
        ),
      ).toBe("t|t");
      // Reconnection has a fresh grace period but still requires full inventory
      // verification; an old claim cannot clear its pending flag.
      sql(
        `update public.broadcast_settings set youtube_authorization_checked_at=now()-interval '90 days' where organization_id='${recent}'`,
      );
      expect(
        sql(
          `set role service_role; select public.complete_youtube_connection('${recentOwner}','${recent}',1,'bmV3IG9wYXF1ZQ==','recent-channel','Recent channel')`,
        ),
      ).toBe("2");
      expect(finish(retry, "valid")).toBe("stale");
      const newClaim = claims()[0];
      expect(newClaim.connection_version).toBe(2);
      expect(finish(newClaim, "unavailable")).toBe("retry");
      expect(
        sql(
          `select youtube_initial_verification_pending,encrypted_credentials is not null from public.broadcast_settings where organization_id='${recent}'`,
        ),
      ).toBe("t|t");
      // Missing verification timestamps cannot retain old data indefinitely.
      sql(
        `update public.broadcast_settings set youtube_authorization_checked_at=null,connected_at=now()-interval '29 days',youtube_maintenance_retry_at=null where organization_id='${recent}'`,
      );
      expect(finish(claims()[0], "unavailable")).toBe("removed_unconfirmed");
    } finally {
      run(["-c", `drop database ${database}`], parsed!.pathname.slice(1));
    }
  }, 120_000);
});
