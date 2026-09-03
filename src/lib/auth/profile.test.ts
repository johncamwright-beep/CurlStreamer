import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as Array<{ user_id: string; display_name: string }>,
  audit: [] as unknown[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from(table: string) {
      if (table === "audit_events")
        return {
          insert: async (value: unknown) => {
            state.audit.push(value);
            return { error: null };
          },
        };
      return {
        upsert(value: { user_id: string; display_name: string }) {
          const inserted = !state.rows.some(
            (row) => row.user_id === value.user_id,
          );
          if (inserted) state.rows.push(value);
          return {
            select: async () => ({
              data: inserted ? [{ display_name: value.display_name }] : [],
              error: null,
            }),
          };
        },
        select() {
          return {
            eq(_key: string, id: string) {
              return {
                single: async () => ({
                  data: state.rows.find((row) => row.user_id === id),
                }),
              };
            },
          };
        },
      };
    },
  }),
}));
import { ensureOwnProfile } from "./profile";
const user = {
  id: "immutable-auth-id",
  email: "john@example.com",
  email_confirmed_at: "2026-01-01",
  user_metadata: { display_name: "John" },
};
describe("profile initialization", () => {
  beforeEach(() => {
    state.rows = [];
    state.audit = [];
  });
  it("is idempotent and uses only the verified auth user's immutable id", async () => {
    await ensureOwnProfile(user as never);
    await ensureOwnProfile(user as never);
    expect(state.rows).toEqual([
      { user_id: "immutable-auth-id", display_name: "John" },
    ]);
    expect(state.audit).toHaveLength(1);
  });
  it("refuses an unverified identity", async () => {
    await expect(
      ensureOwnProfile({
        ...user,
        id: "another-id",
        email_confirmed_at: null,
      } as never),
    ).rejects.toThrow("Verified account required");
    expect(state.rows).toEqual([]);
  });
});
