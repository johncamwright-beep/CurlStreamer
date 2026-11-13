import { expect, it } from "vitest";
import { youtubeLifecycle } from "./youtube-lifecycle";
it.each([
  ["created", "active", "setup-required"],
  ["ready", "active", "go-live"],
  ["testing", "active", "go-live"],
  ["testStarting", "active", "starting"],
  ["liveStarting", "active", "starting"],
  ["live", "active", "live"],
  ["live", "inactive", "reconnecting"],
  ["complete", "active", "ended"],
  ["revoked", "active", "removed"],
  ["new-state", "active", "unknown"],
  ["ready", "created", "waiting-video"],
  ["ready", "ready", "waiting-video"],
  ["ready", "inactive", "waiting-video"],
  ["ready", "error", "stream-error"],
])("handles %s / %s as %s", (broadcast, stream, phase) => {
  expect(youtubeLifecycle(broadcast, stream)).toBe(phase);
});
