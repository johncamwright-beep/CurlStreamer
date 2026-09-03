import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signIn,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/validation", async (original) => ({
  ...(await original<typeof import("@/lib/auth/validation")>()),
  confirmationUrl: () =>
    "https://curlstreamer.vercel.app/auth/confirm?next=/account",
}));
import { signup } from "./signup/actions";
import { login } from "./login/actions";
import { signOut } from "./account/actions";
const signupData = () => {
  const data = new FormData();
  Object.entries({
    displayName: "John",
    email: "john@example.com",
    password: "long-password",
    passwordConfirmation: "long-password",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
};
const loginData = () => {
  const data = new FormData();
  data.set("email", "john@example.com");
  data.set("password", "long-password");
  return data;
};
describe("account actions", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns the same neutral signup response on success and provider failure", async () => {
    mocks.signUp
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "already exists" } });
    expect(await signup({}, signupData())).toEqual(
      await signup({}, signupData()),
    );
    expect((await signup({}, signupData())).message).toMatch(
      /check your email/i,
    );
  });
  it("reports generic failed login without exposing provider details", async () => {
    mocks.signIn.mockResolvedValue({
      error: { message: "email and secret leaked" },
    });
    expect(await login({}, loginData())).toEqual({
      message: "Invalid email or password.",
    });
  });
  it("redirects successful login and sign out", async () => {
    mocks.signIn.mockResolvedValue({ error: null });
    await expect(login({}, loginData())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/account");
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
