import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceCard } from "./StudioDeviceCards";

describe("Studio camera source tiles", () => {
  function tile(
    receiving: boolean,
    kind: "tapo" | "rtsp" = "tapo",
    phase: "idle" | "connecting" | "streaming" = "connecting",
    connectionEnabled?: boolean,
    shown = true,
  ) {
    return renderToStaticMarkup(
      <DeviceCard
        id="game-1"
        role="camera-home"
        label="Camera 1"
        enabled
        claimed={false}
        onAudio={async () => undefined}
        onVisibility={async () => undefined}
        shown={shown}
        connectionStatus={{
          videoReceiving: receiving,
          receiverReady: true,
          phoneOnline: false,
        }}
        cameraInput={{
          kind,
          host: kind === "tapo" ? "192.168.1.2" : null,
          stream: kind === "tapo" ? "stream1" : null,
          rotation: 90,
          configured: true,
          phase,
          generation: 1,
          connectionEnabled,
        }}
      />,
    );
  }
  it("shows Connect with no pressed visibility or recovery control while an IP source is OFF", () => {
    const markup = tile(false, "tapo", "connecting", false);
    expect(markup).toContain("Ready to connect");
    expect(markup).toContain(">Connect</button>");
    expect(markup).not.toContain("Reconnect camera");
    expect(markup).not.toContain("Hide from broadcast");
    expect(markup).not.toContain("Show in broadcast");
    expect(markup).not.toContain('aria-pressed="true"');
  });
  it("offers Hide and Show for a connected source independently of media readiness", () => {
    const shown = tile(false, "tapo", "connecting", true);
    expect(shown).toContain("Hide from broadcast");
    expect(shown).toContain('aria-pressed="true"');
    expect(shown).toContain("Reconnect camera");
    const hidden = tile(true, "rtsp", "streaming", true, false);
    expect(hidden).toContain("Show in broadcast");
    expect(hidden).not.toContain('aria-pressed="true"');
    expect(hidden).not.toContain("Reconnect camera");
  });
  it("keeps legacy configured IP cameras on Hide/Show when older Studio omits connection intent", () => {
    const shown = tile(false, "tapo", "idle");
    expect(shown).toContain("Hide from broadcast");
    expect(shown).toContain('aria-pressed="true"');
    expect(shown).not.toContain(">Connect</button>");
    const hidden = tile(false, "tapo", "idle", undefined, false);
    expect(hidden).toContain("Show in broadcast");
    expect(hidden).not.toContain(">Connect</button>");
    expect(hidden).not.toContain('aria-pressed="true"');
    expect(tile(false, "tapo", "idle", false)).toContain(">Connect</button>");
  });
  it("does not claim streaming when capture is active but program frames are stale", () => {
    expect(tile(false, "tapo", "streaming")).toContain(
      "Tapo connected · Waiting for program video",
    );
    expect(tile(false, "tapo", "streaming")).not.toContain("Tapo · streaming");
    expect(tile(true, "tapo", "streaming")).toContain("Receiving video");
  });
  it("shows native settings and recovery only when video is unavailable", () => {
    expect(tile(false)).toContain("Settings");
    expect(tile(false)).toContain("Reconnect camera");
    expect(tile(true)).toContain("Receiving video");
    expect(tile(true)).not.toContain("Reconnect camera");
  });
  it("omits phone invitations and retains the Tapo microphone without a phone claim", () => {
    const markup = tile(false);
    expect(markup).not.toContain("QR");
    expect(markup).toContain("Turn mic on");
    expect(markup).toContain("Mic volume");
    expect(markup).not.toContain("Release camera");
  });
  it("keeps generic IP recovery and audio controls separate from phone pairing", () => {
    const markup = tile(false, "rtsp");
    expect(markup).toContain("IP camera");
    expect(markup).toContain("Reconnect camera");
    expect(markup).toContain("Turn mic on");
    expect(markup).not.toContain("QR");
    expect(markup).not.toContain("Tapo");
    expect(tile(true, "rtsp")).not.toContain("Reconnect camera");
  });
});
