import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceCard } from "./StudioDeviceCards";

describe("Studio camera source tiles", () => {
  function tile(receiving: boolean, kind: "tapo" | "rtsp" = "tapo") {
    return renderToStaticMarkup(
      <DeviceCard
        id="game-1"
        role="camera-home"
        label="Camera 1"
        enabled
        claimed={false}
        onAudio={async () => undefined}
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
          phase: "connecting",
          generation: 1,
        }}
      />,
    );
  }
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
