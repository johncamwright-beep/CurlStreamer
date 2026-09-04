import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const nextBin = join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const children = new Set<ChildProcessWithoutNullStreams>();

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(expiresAt: number) {
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({
    sub: "middleware-http-user",
    exp: expiresAt,
    aud: "authenticated",
  })}.signature`;
}

async function openPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function startNext(environment: NodeJS.ProcessEnv) {
  const port = await openPort();
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "pipe",
    },
  );
  children.add(child);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Next.js did not start:\n${output}`)),
      30_000,
    );
    const check = () => {
      if (/ready in/i.test(output)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Next.js exited ${code}:\n${output}`));
    });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    output: () => output,
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      children.delete(child);
    },
  };
}

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode === null) child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      children.delete(child);
    }),
  );
});

describe.sequential("registered middleware over HTTP", () => {
  it("runs with valid configuration, refreshes cookies, and preserves public and protected routes", async () => {
    const refreshedAt = Math.floor(Date.now() / 1000) + 3600;
    let refreshRequests = 0;
    let userRequests = 0;
    const auth = createServer(async (request, response) => {
      if (request.url?.startsWith("/auth/v1/token")) {
        refreshRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: jwt(refreshedAt),
            refresh_token: "new-refresh-token",
            expires_in: 3600,
            expires_at: refreshedAt,
            token_type: "bearer",
            user: {
              id: "middleware-http-user",
              aud: "authenticated",
              role: "authenticated",
              email: "middleware@example.test",
              email_confirmed_at: new Date().toISOString(),
              app_metadata: {},
              user_metadata: {},
              created_at: new Date().toISOString(),
            },
          }),
        );
        return;
      }
      if (request.url === "/auth/v1/user") {
        userRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: "middleware-http-user",
            aud: "authenticated",
            role: "authenticated",
            email: "middleware@example.test",
            email_confirmed_at: new Date().toISOString(),
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          }),
        );
        return;
      }
      response.writeHead(404).end();
    });
    auth.listen(0, "127.0.0.1");
    await once(auth, "listening");
    const address = auth.address();
    if (!address || typeof address === "string")
      throw new Error("No auth port");

    const next = await startNext({
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "middleware-http-public-key",
    });
    try {
      const publicResponse = await fetch(`${next.origin}/login`);
      expect(publicResponse.status).toBe(200);

      const protectedResponse = await fetch(`${next.origin}/dashboard`, {
        redirect: "manual",
      });
      expect(protectedResponse.status).toBe(307);
      expect(protectedResponse.headers.get("location")).toBe("/login");

      const expiredAt = Math.floor(Date.now() / 1000) - 60;
      const session = {
        access_token: jwt(expiredAt),
        refresh_token: "old-refresh-token",
        expires_in: 3600,
        expires_at: expiredAt,
        token_type: "bearer",
        user: {
          id: "middleware-http-user",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      };
      const cookie = `sb-127-auth-token=base64-${base64url(session)}`;
      const refreshed = await fetch(`${next.origin}/login`, {
        headers: { cookie },
      });
      expect(refreshed.status).toBe(200);
      const setCookie = refreshed.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("sb-127-auth-token=");
      const encoded = setCookie.match(/sb-127-auth-token=base64-([^;]+)/)?.[1];
      expect(encoded).toBeTruthy();
      expect(
        JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8")),
      ).toMatchObject({ refresh_token: "new-refresh-token" });
      expect(refreshRequests).toBe(1);
      expect(userRequests).toBeGreaterThanOrEqual(1);
    } finally {
      await next.stop();
      await new Promise<void>((resolve, reject) =>
        auth.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 60_000);

  it("fails intelligibly when required public configuration is missing", async () => {
    const environment = { ...process.env };
    delete environment.NEXT_PUBLIC_SUPABASE_URL;
    delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const next = await startNext(environment);
    try {
      const response = await fetch(`${next.origin}/login`);
      expect(response.status).toBe(500);
      await expect
        .poll(next.output, { timeout: 15_000 })
        .toContain("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
    } finally {
      await next.stop();
    }
  }, 60_000);
});
