import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("./[id]/[role]/page.tsx", import.meta.url),
  "utf8",
);

describe("camera connection lifecycle", () => {
  it("starts the one camera acquisition before token fetching and LiveKit", () => {
    const acquisition = page.indexOf("acquireVerifiedPortraitCamera(");
    expect(acquisition).toBeGreaterThan(0);
    expect(
      page.indexOf("/api/games/${id}/livekit-token?capability=camera-publish"),
    ).toBeGreaterThan(acquisition);
    expect(page.indexOf("await nextRoom.connect")).toBeGreaterThan(acquisition);
    expect(page.match(/acquireVerifiedPortraitCamera\(/g)).toHaveLength(1);
    expect(page).not.toContain("createLocalTracks");
  });

  it("uses only the matching preserved camera participant credential", () => {
    expect(page).toContain("cameraPublishAccessToken(localStorage, id, role)");
    expect(page).not.toContain("localStorage.getItem(`curlcast-access-${id}`)");
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
      'await act({ type: "camera-health", role, phase: "live" })',
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
    expect(page).toContain('phase: "disconnected"');
    expect(
      page.match(/thisAttempt !== attempt\.current/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("cleans up and requires manual reconnect after organizer removal", () => {
    expect(page).toContain("reason === 4");
    expect(page).toContain("Disconnected by organizer.");
    expect(page).toContain("Reconnect manually when you are ready.");
    expect(page).not.toContain("RoomEvent.Disconnected, connect");
  });

  it("replaces Connect with rescan guidance after an assignment is released", () => {
    expect(page).toContain('failure?.code === "camera_assignment_released"');
    expect(page).toContain("This camera assignment has been released.");
    expect(page).toContain(
      "Scan the game QR code to connect this device again.",
    );
    expect(page).toContain("assignmentReleased ? (");
  });
});
