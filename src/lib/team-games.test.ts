import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  memberships: vi.fn(),
  profileFilter: vi.fn(),
  membershipFilter: vi.fn(),
  membershipLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "user_profiles")
        return {
          select: () => ({
            eq: (...args: unknown[]) => {
              mocks.profileFilter(...args);
              return { maybeSingle: mocks.profile };
            },
          }),
        };
      if (table === "team_memberships") {
        const query = {
          eq: (...args: unknown[]) => {
            mocks.membershipFilter(...args);
            return query;
          },
          limit: (count: number) => {
            mocks.membershipLimit(count);
            return mocks.memberships();
          },
        };
        return { select: () => query };
      }
      throw new Error("Unexpected table");
    },
  }),
}));

import { loadActiveTeam } from "./team-games";

const user = { id: "verified-user" } as User;
const membership = { organization_id: "team-one", role: "scorer" };
type ProfileResult = { data: { status: string } | null; error: unknown };
type MembershipResult = { data: (typeof membership)[] | null; error: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("loadActiveTeam parallel verified-user reads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.profile
      .mockReset()
      .mockResolvedValue({ data: { status: "active" }, error: null });
    mocks.memberships
      .mockReset()
      .mockResolvedValue({ data: [membership], error: null });
    mocks.profileFilter.mockReset();
    mocks.membershipFilter.mockReset();
    mocks.membershipLimit.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("starts both reads before either resolves and waits for both validations", async () => {
    const profile = deferred<ProfileResult>();
    const memberships = deferred<MembershipResult>();
    mocks.profile.mockReturnValue(profile.promise);
    mocks.memberships.mockReturnValue(memberships.promise);
    let settled = false;
    const result = loadActiveTeam(user).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();

    expect(mocks.profile).toHaveBeenCalledOnce();
    expect(mocks.memberships).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    profile.resolve({ data: { status: "active" }, error: null });
    await Promise.resolve();
    expect(settled).toBe(false);
    memberships.resolve({ data: [membership], error: null });
    expect(await result).toEqual({
      kind: "ready",
      team: { organizationId: "team-one", role: "scorer" },
    });
    expect(mocks.profileFilter).toHaveBeenCalledWith("user_id", user.id);
    expect(mocks.membershipFilter.mock.calls).toEqual([
      ["user_id", user.id],
      ["status", "active"],
    ]);
    expect(mocks.membershipLimit).toHaveBeenCalledWith(2);
  });

  it.each([null, { status: "inactive" }])(
    "retains inactive profile precedence over membership errors: %s",
    async (profile) => {
      mocks.profile.mockResolvedValue({ data: profile, error: null });
      mocks.memberships.mockResolvedValue({
        data: null,
        error: { code: "membership_failed" },
      });
      expect(await loadActiveTeam(user)).toEqual({ kind: "inactive" });
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("retains profile error precedence when both queries fail", async () => {
    mocks.profile.mockResolvedValue({
      data: null,
      error: { code: "profile_failed" },
    });
    mocks.memberships.mockRejectedValue({ code: "membership_failed" });
    expect(await loadActiveTeam(user)).toEqual({ kind: "unavailable" });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Team game service unavailable",
      { operation: "profile", code: "profile_failed" },
    );
  });

  it("settles thrown query errors and reports the profile first", async () => {
    mocks.profile.mockImplementation(() => {
      throw { code: "profile_thrown" };
    });
    mocks.memberships.mockImplementation(() => {
      throw { code: "membership_thrown" };
    });
    expect(await loadActiveTeam(user)).toEqual({ kind: "unavailable" });
    expect(mocks.memberships).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Team game service unavailable",
      { operation: "profile", code: "profile_thrown" },
    );
  });

  it("does not let a rejected membership read shadow an inactive profile", async () => {
    mocks.profile.mockResolvedValue({
      data: { status: "inactive" },
      error: null,
    });
    mocks.memberships.mockRejectedValue(new Error("membership unavailable"));
    expect(await loadActiveTeam(user)).toEqual({ kind: "inactive" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["reported", "thrown"])(
    "fails closed for an active profile with a %s membership error",
    async (mode) => {
      const error = { code: "membership_failed" };
      if (mode === "reported")
        mocks.memberships.mockResolvedValue({ data: null, error });
      else mocks.memberships.mockRejectedValue(error);
      expect(await loadActiveTeam(user)).toEqual({ kind: "unavailable" });
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "Team game service unavailable",
        { operation: "membership", code: "membership_failed" },
      );
    },
  );

  it.each([null, []])(
    "rejects an active profile with no active membership: %s",
    async (data) => {
      mocks.memberships.mockResolvedValue({ data, error: null });
      expect(await loadActiveTeam(user)).toEqual({ kind: "no-team" });
    },
  );

  it("rejects multiple active teams instead of selecting the first", async () => {
    mocks.memberships.mockResolvedValue({
      data: [membership, { organization_id: "team-two", role: "owner" }],
      error: null,
    });
    expect(await loadActiveTeam(user)).toEqual({ kind: "multiple-teams" });
  });

  it("performs fresh verified-user reads on every request", async () => {
    await loadActiveTeam(user);
    mocks.memberships.mockResolvedValue({
      data: [{ organization_id: "team-two", role: "viewer" }],
      error: null,
    });
    expect(await loadActiveTeam(user)).toEqual({
      kind: "ready",
      team: { organizationId: "team-two", role: "viewer" },
    });
    expect(mocks.profile).toHaveBeenCalledTimes(2);
    expect(mocks.memberships).toHaveBeenCalledTimes(2);
  });
});
