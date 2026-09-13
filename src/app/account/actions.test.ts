import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  }),
}));
import { setStudioPassword } from "./actions";

const passwordForm = () => {
  const form = new FormData();
  form.set("password", "a-long-studio-password");
  form.set("passwordConfirmation", "a-long-studio-password");
  return form;
};

describe("setStudioPassword", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["weak_password", "same_password"])(
    "explains %s without requesting another login",
    async (code) => {
      mocks.getUser.mockResolvedValueOnce({
        data: {
          user: { id: "current-user", email_confirmed_at: "2026-01-01" },
        },
      });
      mocks.updateUser.mockResolvedValueOnce({
        error: { code, message: "Provider description" },
      });
      expect(await setStudioPassword({}, passwordForm())).toEqual({
        message: "Choose a different, stronger password and try again.",
      });
    },
  );
  it("validates a matching 12-character password before changing the user", async () => {
    const form = new FormData();
    form.set("password", "short");
    form.set("passwordConfirmation", "different");
    expect(await setStudioPassword({}, form)).toEqual({
      errors: expect.objectContaining({
        password: expect.any(Array),
        passwordConfirmation: expect.any(Array),
      }),
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("requires the current authenticated session and updates only its user", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    await expect(setStudioPassword({}, passwordForm())).resolves.toEqual({
      message: "Please sign out and sign in again before setting a password.",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();

    mocks.getUser.mockResolvedValueOnce({
      data: {
        user: { id: "current-user", email_confirmed_at: "2026-01-01" },
      },
    });
    mocks.updateUser.mockResolvedValueOnce({ error: null });
    await expect(setStudioPassword({}, passwordForm())).resolves.toEqual({
      message:
        "Studio password set. You can now use email and password in Windows Studio.",
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "a-long-studio-password",
    });
  });
});
