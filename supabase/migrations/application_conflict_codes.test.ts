import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application conflict migration", () => {
  it("changes only the error code in every affected deployed function", () => {
    const directory = "supabase/migrations";
    const latest = new Map<string, string>();
    const definitions = (sql: string) => [
      ...sql.matchAll(
        /create (?:or replace )?function\s+(public\.\w+)\s*\(([\s\S]*?)\)\s*returns\b[\s\S]*?\$\$;/gi,
      ),
    ];
    for (const file of readdirSync(directory)
      .filter((name) => /^00(?:[0-2]\d|3[01])_.*\.sql$/.test(name))
      .sort()) {
      for (const match of definitions(
        readFileSync(`${directory}/${file}`, "utf8"),
      )) {
        latest.set(`${match[1]}(${match[2].replace(/\s+/g, " ")})`, match[0]);
      }
    }
    const affected = [...latest.values()].filter((sql) =>
      sql.includes("errcode = '40001'"),
    );
    const migration = readFileSync(
      `${directory}/0032_stop_application_conflict_retry_loops.sql`,
      "utf8",
    );
    expect(affected).toHaveLength(6);
    expect(definitions(migration).map((match) => match[0])).toEqual(
      affected.map((sql) =>
        sql
          .replace(
            /^create (?:or replace )?function/i,
            "create or replace function",
          )
          .replaceAll("errcode = '40001'", "errcode = 'PT409'"),
      ),
    );
    expect(migration).not.toMatch(/\b(?:grant|revoke|drop)\s/i);
  });
});
