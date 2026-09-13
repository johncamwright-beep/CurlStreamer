import { describe, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";
import { runM4StudioHost } from "./m4-studio-host";

const executable = process.env.CURLCAST_TEST_STUDIO_HOST;
const plugin = process.env.CURLCAST_TEST_DEFAULT_PLUGIN;
const runtime = process.env.CURLCAST_TEST_OBS_RUNTIME;
describe("Studio startup failure cleanup", () => {
  it.each(["relative", "C:\\m4-missing-native-test\\missing.exe"])(
    "releases pairing after invalid or unavailable host %s",
    async (path) => {
      const desktop = new M4DesktopClient(
        "11111111-1111-4111-8111-111111111111",
        "https://pilot.invalid",
      );
      vi.spyOn(desktop, "snapshot").mockReturnValue({
        state: "active",
        authorized: true,
      });
      const stop = vi
        .spyOn(desktop, "stop")
        .mockResolvedValue({ state: "stopped", authorized: false });
      await expect(
        runM4StudioHost(
          desktop,
          "33333333-3333-4333-8333-333333333333",
          {
            executable: path,
            plugin: "C:\\missing.dll",
            runtime: "C:\\missing-runtime",
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow("m4_studio_host_unavailable");
      expect(stop).toHaveBeenCalledTimes(1);
    },
  );
});
describe.skipIf(
  !executable || !plugin || !runtime || process.platform !== "win32",
)("real native child, default-deny service (simulated server)", () => {
  it("keeps pairing in the Node parent, delivers once, and releases authority after native denial", async () => {
    const epoch = Date.now();
    const row = {
      sessionId: "22222222-2222-4222-8222-222222222222",
      generation: 1,
      expiresAt: new Date(epoch + 14400000).toISOString(),
      leaseExpiresAt: new Date(epoch + 30000).toISOString(),
    };
    const intentId = "33333333-3333-4333-8333-333333333333";
    let deliveries = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const endpoint = String(url);
      let value: unknown;
      if (endpoint.endsWith("/exchange"))
        value = { ...row, bearer: "b".repeat(43) };
      else if (endpoint.endsWith("/output-intent"))
        value = {
          intentId,
          sessionId: row.sessionId,
          generation: 1,
          phase: "reserved",
          deliveryRecorded: false,
        };
      else if (endpoint.endsWith("/target")) {
        ++deliveries;
        value = {
          ...row,
          intentId,
          target: {
            serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
            streamKey: "synthetic_key_default_denial",
          },
        };
      } else {
        expect(JSON.parse(String(init?.body)).action).toBe("stop");
        value = { ...row, desiredAction: "stop" };
      }
      return new Response(JSON.stringify(value), {
        headers: { date: new Date(epoch).toUTCString() },
      });
    });
    const desktop = new M4DesktopClient(
      "11111111-1111-4111-8111-111111111111",
      "https://pilot.invalid",
      { fetcher },
    );
    await desktop.exchange("c".repeat(43));
    await expect(
      runM4StudioHost(
        desktop,
        intentId,
        { executable: executable!, plugin: plugin!, runtime: runtime! },
        new AbortController().signal,
      ),
    ).rejects.toThrow("m4_studio_host_unavailable");
    expect(deliveries).toBe(1);
    expect(desktop.snapshot().state).toBe("stopped");
    expect(fetcher).toHaveBeenCalledTimes(4);
  }, 10000);
});
