import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("./0003_append_score_event_rpc.sql", import.meta.url),
);
const sql = readFileSync(migrationPath, "utf8")
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const signature =
  "public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)";

describe("append_score_event migration contract", () => {
  it("atomically guards the state version and appends an event", () => {
    expect(sql).toContain("update public.game_states");
    expect(sql).toContain("and version = p_expected_version");
    expect(sql).toContain("if not found then raise exception");
    expect(sql).toContain("insert into public.score_events");
    expect(sql).toContain(
      "p_event_id, p_game_id, p_event_type, p_payload, p_actor",
    );
  });

  it("keeps sequence allocation database-managed and restricts execution", () => {
    expect(sql).not.toMatch(/insert into public\.score_events \([^)]*sequence/);
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(
        `revoke all on function ${signature} from ${role};`,
      );
    }
    expect(sql).toContain(
      `grant execute on function ${signature} to service_role;`,
    );
  });
});
