import { describe, expect, it } from "vitest";
import {
  approvedRedirect,
  confirmationUrl,
  loginSchema,
  signupSchema,
} from "./validation";
describe("account authentication validation", () => {
  it("validates signup fields and matching reasonable-length passwords", () => {
    expect(
      signupSchema.safeParse({
        displayName: "John",
        email: "john@example.com",
        password: "long-pass",
        passwordConfirmation: "long-pass",
      }).success,
    ).toBe(true);
    expect(
      signupSchema.safeParse({
        displayName: "",
        email: "bad",
        password: "short",
        passwordConfirmation: "different",
      }).success,
    ).toBe(false);
  });
  it("validates login credentials", () => {
    expect(
      loginSchema.safeParse({ email: "john@example.com", password: "secret" })
        .success,
    ).toBe(true);
    expect(loginSchema.safeParse({ email: "bad", password: "" }).success).toBe(
      false,
    );
  });
  it.each([
    "https://evil.example/",
    "//evil.example/",
    "javascript:alert(1)",
    null,
  ])("rejects an unsafe next destination %s", (next) =>
    expect(approvedRedirect(next)).toBe("/account"),
  );
  it("allows a same-application path", () =>
    expect(approvedRedirect("/account?welcome=1")).toBe("/account?welcome=1"));
  it("uses the canonical production origin", () =>
    expect(
      confirmationUrl({
        NODE_ENV: "production",
        APP_BASE_URL: "https://curlstreamer.vercel.app",
      } as NodeJS.ProcessEnv),
    ).toBe("https://curlstreamer.vercel.app/auth/confirm?next=/account"));
});
