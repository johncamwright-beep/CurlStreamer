import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const url = process.env.CURLCAST_DISPOSABLE_DATABASE_URL;
const connection = url ? new URL(url) : undefined;
const enabled = Boolean(
  connection &&
  ["127.0.0.1", "localhost", "::1"].includes(connection.hostname) &&
  /(test|disposable)/i.test(connection.pathname) &&
  spawnSync("psql", ["--version"]).status === 0,
);

describe.skipIf(!enabled)("same-broadcast restart PostgreSQL authority", () => {
  it("preserves provider identity while fencing stale senders, replay, revoked owners and completed games", () => {
    if (!connection) throw new Error("Disposable PostgreSQL is not configured");
    const sql = readFileSync(
      "supabase/tests/m4_same_broadcast_restart.sql",
      "utf8",
    );
    const result = spawnSync(
      "psql",
      ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PGHOST: connection.hostname,
          PGPORT: connection.port || "5432",
          PGDATABASE: connection.pathname.slice(1),
          PGUSER: decodeURIComponent(connection.username),
          PGPASSWORD: decodeURIComponent(connection.password),
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS: same broadcast restart");
  });
});
