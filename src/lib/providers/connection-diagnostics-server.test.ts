import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { traceStudioRequest } from "./connection-diagnostics-server";
afterEach(() => vi.restoreAllMocks());
it("correlates a rejected camera request without logging the response or credentials", async () => {
  const logger = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const response = await traceStudioRequest(
    async () =>
      new Response(
        JSON.stringify({
          code: "studio_stale",
          error: "secret-provider-detail",
        }),
        { status: 409 },
      ),
  );
  expect(response.headers.get("x-curlstreamer-trace")).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  expect(logger).toHaveBeenCalledWith(
    "CurlStreamer connection",
    expect.objectContaining({
      code: "studio_stale",
      trace: response.headers.get("x-curlstreamer-trace"),
    }),
  );
  expect(JSON.stringify(logger.mock.calls)).not.toContain("secret");
  expect(await response.json()).toMatchObject({ code: "studio_stale" });
});
it("does not log successful ticket bodies", async () => {
  const logger = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const response = await traceStudioRequest(
    async () => new Response('{"token":"secret"}'),
  );
  expect(logger).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({ token: "secret" });
});
it("identifies YouTube recovery fencing without exposing provider details", async () => {
  const logger = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const response = await traceStudioRequest(
    async () =>
      new Response(
        '{"code":"studio_recovery_pending","target":"private-rtmp-key"}',
        { status: 409 },
      ),
    "youtube",
  );
  expect(logger).toHaveBeenCalledWith(
    "CurlStreamer connection",
    expect.objectContaining({
      layer: "youtube",
      code: "studio_recovery_pending",
      trace: response.headers.get("x-curlstreamer-trace"),
    }),
  );
  expect(JSON.stringify(logger.mock.calls)).not.toContain("private-rtmp-key");
});
