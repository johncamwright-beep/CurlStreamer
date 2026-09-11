import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  headers: vi.fn(
    async () => new Headers({ origin: "https://curlstreamer.vercel.app" }),
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signIn,
      signInWithOAuth: mocks.signInWithOAuth,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth/validation", async (original) => ({
  ...(await original<typeof import("@/lib/auth/validation")>()),
  confirmationUrl: () =>
    "https://curlstreamer.vercel.app/auth/confirm?next=/account",
}));
import { signup } from "./signup/actions";
import { login } from "./login/actions";
import { signOut } from "./account/actions";
import { signInWithGoogle } from "./auth/actions";
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
  afterEach(() => vi.unstubAllEnvs());
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
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("honors safe login returns and rejects external destinations", async () => {
    mocks.signIn.mockResolvedValue({ error: null });
    const safe = loginData();
    safe.set("next", "/games/new?from=login");
    await expect(login({}, safe)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/games/new?from=login");

    const unsafe = loginData();
    unsafe.set("next", "//attacker.example/path");
    await expect(login({}, unsafe)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/dashboard");
  });
  it("starts Google OAuth through the canonical onboarding callback", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
    vi.stubEnv("APP_BASE_URL", "https://curlstreamer.vercel.app");
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/oauth" },
      error: null,
    });
    const data = new FormData();
    data.set("next", "//attacker.example");
    await expect(signInWithGoogle({}, data)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          "https://curlstreamer.vercel.app/auth/confirm?next=%2Fonboarding",
        scopes: "openid email profile",
      },
    });
    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "https://accounts.google.com/oauth",
    );
  });
  it("does not expose provider failures from Google OAuth", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
    vi.stubEnv("APP_BASE_URL", "https://curlstreamer.vercel.app");
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: "provider secret" },
    });
    await expect(signInWithGoogle({}, new FormData())).resolves.toEqual({
      message: "Google sign-in couldn't be started. Please try again.",
    });
    expect(mocks.signInWithOAuth).toHaveBeenCalled();
  });
  it("does not begin PKCE on a non-canonical browser origin", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
    vi.stubEnv("APP_BASE_URL", "https://curlstreamer.vercel.app");
    mocks.headers.mockResolvedValueOnce(
      new Headers({ origin: "https://preview.curlstreamer.app" }),
    );
    await expect(signInWithGoogle({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "https://curlstreamer.vercel.app/login?next=%2Fonboarding",
    );
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
  it("does not begin Google OAuth from Windows Studio", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
    vi.stubEnv("APP_BASE_URL", "https://curlstreamer.vercel.app");
    mocks.headers.mockResolvedValueOnce(
      new Headers({
        origin: "https://curlstreamer.vercel.app",
        "user-agent": "CurlStreamerStudio/0.3",
      }),
    );
    await expect(signInWithGoogle({}, new FormData())).resolves.toEqual({
      message:
        "Google sign-in is available on the website. Use email and password in Windows Studio.",
    });
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});
