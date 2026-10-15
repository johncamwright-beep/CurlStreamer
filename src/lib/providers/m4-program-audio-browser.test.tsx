import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import { broadcastGame } from "../game-projection";
import { nativeCameraAudioIntent } from "../camera-audio";
import type { M4CameraInputSnapshot } from "../m4-camera-input";

vi.mock("@/components/ProgramUsbAudio", () => ({
  ProgramUsbAudio: (props: {
    endpoint?: string;
    enabled?: boolean;
    volume?: number;
    delayMs?: number;
  }) => (
    <span
      data-endpoint={props.endpoint ?? "/usb-audio"}
      data-enabled={props.enabled ?? true}
      data-volume={props.volume ?? 1}
      data-delay={props.delayMs ?? 0}
    />
  ),
}));
vi.mock("@/components/ProgramPhoneAudio", () => ({
  ProgramPhoneAudio: (props: {
    role: string;
    enabled: boolean;
    stream?: MediaStream;
    delayMs?: number;
  }) => (
    <span
      data-phone={props.role}
      data-enabled={props.enabled}
      data-stream={Boolean(props.stream)}
      data-delay={props.delayMs ?? 0}
    />
  ),
}));
import { M4ProgramAudio } from "./m4-program-audio-browser";

describe("native program audio routing", () => {
  it.each(["tapo", "rtsp"] as const)(
    "plays %s intent beside USB while phone stays assignment-bound",
    (kind) => {
      const game = gameFixture();
      game.claims = {};
      game.cameraAudio = {
        "camera-home": {
          enabled: true,
          generation: 0,
          status: "pending",
          updatedAt: 1,
          volume: 0.4,
        },
      };
      const projection = {
        ...broadcastGame(game),
        programAudioDelayMs: 2500,
        nativeCameraAudio: nativeCameraAudioIntent(game),
      };
      const phone: M4CameraInputSnapshot = {
        kind: "phone",
        connectionEnabled: false,
        configured: false,
        phase: "idle",
        generation: 0,
        errorCode: null,
        host: null,
        stream: null,
        rotation: 0,
      };
      const sources: Record<
        "camera-home" | "camera-away",
        M4CameraInputSnapshot
      > = {
        "camera-home": { ...phone, kind, generation: 3 },
        "camera-away": phone,
      };
      const render = () =>
        renderToStaticMarkup(
          <M4ProgramAudio
            game={projection}
            sources={sources}
            phoneStreams={{ "camera-home": {} as MediaStream }}
          />,
        );
      expect(render()).toContain(
        'data-endpoint="/usb-audio" data-enabled="true"',
      );
      expect(render()).toContain(
        'data-endpoint="/usb-audio" data-enabled="true" data-volume="1" data-delay="2500"',
      );
      for (const milliseconds of [undefined, 0]) {
        const markup = renderToStaticMarkup(
          <M4ProgramAudio
            game={{ ...projection, programAudioDelayMs: milliseconds }}
            sources={sources}
            phoneStreams={{}}
          />,
        );
        expect(markup).toContain(
          'data-endpoint="/usb-audio" data-enabled="true" data-volume="1" data-delay="0"',
        );
      }
      expect(render()).toContain(
        'data-endpoint="/ip-camera/camera-home/audio?generation=3&amp;after=0" data-enabled="true" data-volume="0.4"',
      );
      expect(render()).toContain(
        'data-phone="camera-home" data-enabled="false" data-stream="false"',
      );
      projection.nativeCameraAudio["camera-home"]!.enabled = false;
      expect(render()).toContain(
        'data-endpoint="/ip-camera/camera-home/audio?generation=3&amp;after=0" data-enabled="false"',
      );
      sources["camera-home"] = { ...phone, generation: 4 };
      expect(render()).not.toContain("/ip-camera/");
      expect(render()).toContain(
        'data-phone="camera-home" data-enabled="false" data-stream="true"',
      );
    },
  );
  it.each([-5000, -2000, -250, 0, 250, 2000, 5000])(
    "corrects %s milliseconds without shifting camera sound away from its picture",
    (adjustment) => {
      const game = gameFixture();
      const source: M4CameraInputSnapshot = {
        kind: "tapo",
        connectionEnabled: true,
        configured: true,
        phase: "streaming",
        generation: 3,
        errorCode: null,
        host: null,
        stream: null,
        rotation: 0,
      };
      const markup = renderToStaticMarkup(
        <M4ProgramAudio
          game={{ ...broadcastGame(game), programAudioDelayMs: adjustment }}
          sources={{
            "camera-home": source,
            "camera-away": { ...source, kind: "phone" },
          }}
          phoneStreams={{}}
        />,
      );
      expect(markup).toContain(
        `data-endpoint="/usb-audio" data-enabled="true" data-volume="1" data-delay="${Math.max(0, adjustment)}"`,
      );
      expect(markup).toMatch(
        new RegExp(
          `data-endpoint="/ip-camera/camera-home/audio\\?generation=3&amp;after=0"[^>]*data-delay="${Math.max(0, -adjustment)}"`,
        ),
      );
      expect(markup).toMatch(
        new RegExp(
          `data-phone="camera-away"[^>]*data-delay="${Math.max(0, -adjustment)}"`,
        ),
      );
    },
  );
});
