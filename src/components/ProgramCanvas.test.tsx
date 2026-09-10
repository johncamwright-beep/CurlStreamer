import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import { broadcastGame } from "@/lib/game-projection";
import { ProgramCanvas, type ProgramCameraRole } from "./ProgramCanvas";

vi.mock("./LiveKitCameraFeed", () => {
  throw new Error("The direct program must not import LiveKit");
});

// Next supplies the automatic JSX runtime; this unit runner uses classic JSX.
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("provider-neutral program composition", () => {
  it("renders direct feeds with the saved score and honest local video status", () => {
    const game = gameFixture();
    game.sponsors = [];
    game.cameraFraming = { "camera-home": "fill", "camera-away": "fill" };
    const roles: ProgramCameraRole[] = [];
    const markup = renderToStaticMarkup(
      <ProgramCanvas
        game={broadcastGame(game)}
        renderCamera={(role) => {
          roles.push(role);
          return <video aria-label={role} />;
        }}
      />,
    );
    expect(roles).toEqual(["camera-home", "camera-away"]);
    expect(markup).toContain('data-camera-count="2"');
    expect(markup).toContain('data-testid="broadcast-scoreboard"');
    expect(markup).toContain("Rocks");
    expect(markup).toContain("Stones");
    expect(markup).toContain(">2</strong>");
    expect(markup).toContain(">0</strong>");
    expect(markup).not.toContain("Video only");
    expect(markup).not.toContain("Local program");
    expect(markup).not.toContain("Scorer audio live");
    expect(markup).not.toContain("● LIVE");
    expect(markup).toContain("[&amp;_video]:!object-contain");
    expect(markup).toContain("[&amp;_img]:!object-contain");
  });

  it.each(["home", "away"] as const)(
    "selects the saved %s camera without showing the other feed",
    (layout) => {
      const game = gameFixture();
      game.layout = layout;
      game.sponsors = [];
      const renderCamera = vi.fn((role: ProgramCameraRole) => (
        <video aria-label={role} />
      ));
      const markup = renderToStaticMarkup(
        <ProgramCanvas game={game} renderCamera={renderCamera} />,
      );
      expect(renderCamera).toHaveBeenCalledExactlyOnceWith(`camera-${layout}`);
      expect(markup).toContain('data-camera-count="1"');
    },
  );

  it("reuses the real sponsor frame and permits explicitly supplied output status", () => {
    const game = gameFixture();
    game.sponsors = [
      {
        id: "one",
        name: "One",
        dataUrl: "/sponsors/rock.svg",
        enabled: true,
        rotation: 0,
      },
    ];
    game.sponsorMode.style = "fullscreen";
    const markup = renderToStaticMarkup(
      <ProgramCanvas
        game={game}
        renderCamera={(role) => <video aria-label={role} />}
        statusLabel="Local recording"
        audioStatus="OBS audio configured separately"
      />,
    );
    expect(markup).toContain('data-testid="sponsor-sidebar"');
    expect(markup).toContain("PRESENTED BY");
    expect(markup).not.toContain("Local recording");
    expect(markup).not.toContain("OBS audio configured separately");
  });

  it("hides both pictures while keeping the score and sponsors in the broadcast", () => {
    const game = gameFixture();
    game.layout = "none";
    game.sponsorMode.style = "fullscreen";
    const renderCamera = vi.fn(() => <video />);
    const markup = renderToStaticMarkup(
      <ProgramCanvas game={game} renderCamera={renderCamera} />,
    );
    expect(renderCamera).not.toHaveBeenCalled();
    expect(markup).toContain('data-camera-count="0"');
    expect(markup).toContain('data-testid="broadcast-scoreboard"');
    expect(markup).toContain('data-testid="sponsor-sidebar"');
  });
});
