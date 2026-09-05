import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcastGame } from "@/lib/game-projection";
import { gameFixture } from "@/test/game-fixture";

vi.mock("./LiveKitCameraFeed", () => ({
  LiveKitCameraFeed: () => <div>Camera placeholder</div>,
}));
import { BroadcastCanvas } from "./BroadcastCanvas";

describe("anonymous Broadcast projection consumer", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());
  it.each(["split", "home", "away"] as const)(
    "renders the same public program with %s layout and derived Undo score",
    (layout) => {
      const game = gameFixture();
      game.layout = layout;
      game.sponsors = [game.sponsors[0]];
      const full = renderToStaticMarkup(<BroadcastCanvas game={game} />);
      const projected = renderToStaticMarkup(
        <BroadcastCanvas game={broadcastGame(game)} />,
      );
      expect(projected).toBe(full);
      expect(projected).toContain("END 2");
      expect(projected).toContain("Rocks");
      expect(projected).toContain("Stones: Last stone advantage (Hammer)");
      expect(projected).toContain("Audio muted");
    },
  );
});
