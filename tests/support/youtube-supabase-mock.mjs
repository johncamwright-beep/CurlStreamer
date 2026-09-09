import { createServer } from "node:http";
import { dashboardResponse } from "./dashboard-fixtures.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const user = {
  id: userId,
  email: "admin@youtube.test",
  email_confirmed_at: "2026-09-05T00:00:00.000Z",
  user_metadata: { display_name: "Test Administrator" },
  app_metadata: {},
  aud: "authenticated",
  role: "authenticated",
  created_at: "2026-09-05T00:00:00.000Z",
};
const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url"),
  "playwright-signature",
].join(".");

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:3101");
  if (request.method === "OPTIONS") return send(response, 204, {});
  const dashboard = dashboardResponse(url);
  if (dashboard !== null) return send(response, 200, dashboard);
  if (url.pathname === "/auth/v1/token" && request.method === "POST")
    return send(response, 200, {
      access_token: jwt,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "playwright-refresh",
      user,
    });
  if (url.pathname === "/auth/v1/user")
    return send(response, 200, {
      ...user,
    });
  if (url.pathname === "/rest/v1/user_profiles") {
    if (request.method === "POST")
      return send(response, 200, [{ display_name: "Test Administrator" }]);
    const profile = { display_name: "Test Administrator", status: "active" };
    return send(
      response,
      200,
      String(request.headers.accept).includes("object+json")
        ? profile
        : [profile],
    );
  }
  if (url.pathname === "/rest/v1/audit_events") return send(response, 201, {});
  if (url.pathname === "/rest/v1/team_memberships")
    return send(response, 200, [
      {
        organization_id: organizationId,
        role: "owner",
        organizations: { name: "Test Curling Club" },
      },
    ]);
  if (url.pathname === "/rest/v1/rpc/get_youtube_connection")
    return send(response, 200, [
      {
        channel_id: "UC_TEST_CHANNEL",
        channel_title: "Test Club TV",
        connection_status: "connected",
        connection_version: 4,
        connected_at: "2026-09-05T00:00:00.000Z",
        tested_at: "2026-09-05T00:05:00.000Z",
        last_error_code: null,
        can_manage: true,
      },
    ]);
  if (url.pathname === "/rest/v1/rpc/disconnect_youtube_connection")
    return send(response, 200, 5);
  return send(response, 404, { message: "Unmocked Supabase test request" });
});

server.listen(3101, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
