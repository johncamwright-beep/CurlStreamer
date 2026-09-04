import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameInvitations, invitationRoles } from "./GameInvitations";
import { readFileSync } from "node:fs";

describe("Game invitations", () => {
  it("shows an accessible recovery state instead of a blank QR or dead link", () => {
    const markup = renderToStaticMarkup(
      <GameInvitations id="legacy-game" enabled claims={{}} />,
    );
    expect(markup).toContain("Invitation unavailable.");
    expect(markup).toContain("Retry invitation");
    expect(markup).toContain("Invite devices");
    expect(markup).not.toContain("Individual invitation links");
    expect(markup).not.toContain('href="#"');
  });

  it("offers all existing claim roles and keeps participant pages app-navigation free", () => {
    expect(invitationRoles.map(([role]) => role)).toEqual([
      "camera-home",
      "camera-away",
      "scorer",
    ]);
    const join = readFileSync(
      new URL("../app/join/[id]/page.tsx", import.meta.url),
      "utf8",
    );
    const camera = readFileSync(
      new URL("../app/camera/[id]/[role]/page.tsx", import.meta.url),
      "utf8",
    );
    expect(join).not.toContain("AppNavigation");
    expect(camera).not.toContain("AppNavigation");
  });
});
