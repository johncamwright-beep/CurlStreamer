import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("./[id]/[role]/page.tsx", import.meta.url),
  "utf8",
);

describe("camera connection lifecycle", () => {
  it("starts the one camera acquisition before token fetching and LiveKit", () => {
    const acquisition = page.indexOf(
      "acquirePortraitCameraWithPermissionRecovery(",
    );
    expect(acquisition).toBeGreaterThan(0);
    expect(
      page.indexOf("fetch(`/api/games/${id}/livekit-token`"),
    ).toBeGreaterThan(acquisition);
    expect(page.indexOf("await nextRoom.connect")).toBeGreaterThan(acquisition);
    expect(
      page.match(/acquirePortraitCameraWithPermissionRecovery\(/g),
    ).toHaveLength(1);
    expect(page).not.toContain("createLocalTracks");
  });

  it("does not clean up when a browser permission sheet hides the page", () => {
    expect(page).not.toContain('addEventListener("visibilitychange"');
    expect(page).not.toContain('addEventListener("pagehide"');
    expect(page).not.toContain('addEventListener("blur"');
    expect(page).toContain('addEventListener("beforeunload", close)');
    expect(page).toContain("return () => {");
  });

  it("guards repeated taps and only calls a denial an acquisition failure", () => {
    expect(page).toContain("if (!connectionGate.current.enter()) return");
    expect(page).toContain(
      "const denied = !acquired && isPermissionError(cause)",
    );
  });

  it("marks and persists the camera live before starting optional wake lock", () => {
    const persisted = page.indexOf(
      'await act({ type: "connection", role, connected: true })',
    );
    const published = page.indexOf('transition("published")');
    const wakeStart = page.indexOf("wakeLock.current.start()");
    expect(persisted).toBeGreaterThan(0);
    expect(published).toBeGreaterThan(persisted);
    expect(wakeStart).toBeGreaterThan(published);
    expect(page).not.toContain('stage = "wake lock"');
  });

  it("offers idempotent cancellation and blocks stale publication work", () => {
    expect(page).toContain("Disconnect Camera");
    expect(page).toContain("if (cleanupFlight.current)");
    expect(page).toContain(
      "await currentRoom?.localParticipant.unpublishTrack",
    );
    expect(page).toContain("currentTrack?.detach()");
    expect(page).toContain("currentTrack?.stop()");
    expect(page).toContain("currentRoom?.disconnect()");
    expect(page).toContain("await wakeLock.current?.release()");
    expect(page).toContain("connected: false");
    expect(
      page.match(/thisAttempt !== attempt\.current/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });
});
