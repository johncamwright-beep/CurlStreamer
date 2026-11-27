import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DeviceCard } from "./StudioDeviceCards";
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("Studio camera source tiles", () => {
  const eye = (shown: boolean) =>
    `aria-label="Show Camera 1 in broadcast" aria-pressed="${shown}"`;

  it.each([
    undefined,
    {
      kind: "phone" as const,
      configured: false,
      phase: "idle" as const,
      generation: 1,
    },
  ])(
    "offers Connect and one Settings control for an unassigned phone source",
    (cameraInput) => {
      const markup = renderToStaticMarkup(
        <DeviceCard
          id="new-game"
          role="camera-home"
          label="Camera 1"
          enabled
          claimed={false}
          cameraInput={cameraInput}
          shown
          onVisibility={async () => undefined}
          connectionStatus={{
            receiverReady: true,
            phoneOnline: false,
            videoReceiving: false,
          }}
        />,
      );
      expect(markup.match(/>Settings<\/button>/g)).toHaveLength(1);
      expect(markup).toContain(">Connect</button>");
      expect(markup).toContain(eye(true));
    },
  );
  function tile(
    receiving: boolean,
    kind: "tapo" | "rtsp" = "tapo",
    phase: "idle" | "connecting" | "retrying" | "streaming" = "connecting",
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
  it("shows Connect and the separate eye while an IP source is off", () => {
    const markup = tile(false, "tapo", "connecting", false);
    expect(markup).toContain("Ready to connect");
    expect(markup).toContain(">Connect</button>");
    expect(markup).not.toContain(">Disconnect</button>");
    expect(markup).toContain(eye(true));
  });
  it("offers Disconnect independently of broadcast visibility when media is ready", () => {
    const shown = tile(true, "tapo", "streaming", true);
    expect(shown).toContain(eye(true));
    expect(shown).toContain(">Disconnect</button>");
    const hidden = tile(true, "rtsp", "streaming", true, false);
    expect(hidden).toContain(eye(false));
    expect(hidden).toContain("Video ready · Hidden");
    expect(hidden).toContain(">Disconnect</button>");
  });
  it("shows the update message and visibility control for legacy IP cameras", () => {
    const markup = tile(false, "tapo", "idle", undefined, false);
    expect(markup).toContain("Update Windows Studio");
    expect(markup).toContain(eye(false));
    expect(markup).not.toContain("studio-device-connection");
  });
  it("does not claim streaming when capture is active but program frames are stale", () => {
    expect(tile(false, "tapo", "streaming", true)).toContain(
      "Connected · Waiting for preview",
    );
    expect(tile(false, "tapo", "streaming", true)).not.toContain(
      "Receiving video",
    );
    expect(tile(true, "tapo", "streaming", true)).toContain("Receiving video");
  });
  it.each(["connecting", "retrying"] as const)(
    "offers native settings and Disconnect while %s",
    (phase) => {
      const markup = tile(false, "tapo", phase, true);
      expect(markup).toContain(">Settings</button>");
      expect(markup).toContain(">Disconnect</button>");
      expect(markup).not.toContain("Receiving video");
    },
  );
  it("omits phone invitations and retains the Tapo microphone without a phone claim", () => {
    const markup = tile(false);
    expect(markup).not.toContain("QR");
    expect(markup).toContain("Turn mic on");
    expect(markup).toContain("Mic volume");
    expect(markup).not.toContain("Release camera");
  });
  it("keeps generic IP connection and audio controls separate from phone pairing", () => {
    const markup = tile(false, "rtsp", "connecting", true);
    expect(markup).toContain("IP camera");
    expect(markup).toContain(">Disconnect</button>");
    expect(markup).toContain("Turn mic on");
    expect(markup).not.toContain("QR");
    expect(markup).not.toContain("Tapo");
  });
});
