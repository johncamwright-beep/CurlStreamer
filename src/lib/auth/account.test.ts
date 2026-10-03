import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  profile: vi.fn(),
  members: vi.fn(),
  ensure: vi.fn(),
  reads: [] as string[],
}));
vi.mock("./profile", () => ({ ensureOwnProfile: m.ensure }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from(table: string) {
      m.reads.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        maybeSingle: () => m.profile(),
        limit: () => m.members(),
      };
      return q;
    },
  }),
}));
import { getAccountContext } from "./account";
const user = { id: "one", email_confirmed_at: "now" } as never;
beforeEach(() => {
  vi.clearAllMocks();
  m.reads = [];
  m.profile.mockResolvedValue({
    data: { display_name: "Owner", status: "active" },
    error: null,
  });
  m.members.mockResolvedValue({
    data: [
      {
        organization_id: "team",
        role: "owner",
        organizations: { name: "Team" },
      },
    ],
    error: null,
  });
});
it("uses two reads and no profile initialization for existing accounts", async () => {
  expect((await getAccountContext(user)).ok).toBe(true);
  expect(m.reads).toEqual(["user_profiles", "team_memberships"]);
  expect(m.ensure).not.toHaveBeenCalled();
  expect(m.profile).toHaveBeenCalledTimes(1);
});
it("initializes only confirmed missing profiles and rereads authoritative status", async () => {
  m.profile.mockResolvedValueOnce({ data: null, error: null });
  const result = await getAccountContext(user);
  expect(result.ok).toBe(true);
  expect(m.ensure).toHaveBeenCalledExactlyOnceWith(user);
  expect(m.profile).toHaveBeenCalledTimes(2);
});
it("never initializes through a failed database read", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    m.profile.mockResolvedValue({ data: null, error: { code: "connection" } });
    expect(await getAccountContext(user)).toEqual({ ok: false });
    expect(m.ensure).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
it("does not cache membership across requests or accept an unverified user", async () => {
  await getAccountContext(user);
  m.members.mockResolvedValue({ data: [], error: null });
  const result = await getAccountContext(user);
  expect(result.ok && result.account.membership).toBeNull();
  await expect(
    getAccountContext({ id: "unverified" } as never),
  ).rejects.toThrow("Verified");
  expect(m.members).toHaveBeenCalledTimes(2);
});
it("starts profile and membership reads without a serial database wait", async () => {
  let release!: (value: unknown) => void;
  m.profile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = getAccountContext(user);
  expect(m.members).toHaveBeenCalledTimes(1);
  release({ data: { display_name: "Owner", status: "active" }, error: null });
  await pending;
});
