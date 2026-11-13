import { expect, it } from "vitest";
import { synchronizeDeviceAccount } from "./account-device-scope";
function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
    clear: () => data.clear(),
  };
}
it("removes previous team credentials and drafts while preserving microphone sync", () => {
  const local = storage(),
    session = storage();
  synchronizeDeviceAccount(local, session, "team-a");
  for (const key of [
    "curlcast-current-game",
    "curlcast-access-game",
    "curlcast-organizer-access-game",
    "curlcast-participant-access-game",
  ])
    local.setItem(key, "private");
  session.setItem("curlcoach-enhanced-draft", "private");
  local.setItem("microphone-sync", "2.2");
  synchronizeDeviceAccount(local, session, "team-b");
  expect(local.getItem("curlcast-current-game")).toBeNull();
  expect(local.getItem("curlcast-participant-access-game")).toBeNull();
  expect(session.length).toBe(0);
  expect(local.getItem("microphone-sync")).toBe("2.2");
});
it("does not disrupt the same account and clears on sign out", () => {
  const local = storage(),
    session = storage();
  synchronizeDeviceAccount(local, session, "a");
  local.setItem("curlcast-access-game", "token");
  synchronizeDeviceAccount(local, session, "a");
  expect(local.getItem("curlcast-access-game")).toBe("token");
  synchronizeDeviceAccount(local, session, null);
  expect(local.getItem("curlcast-access-game")).toBeNull();
});
it("preserves guest camera invitations when there has been no signed-in account", () => {
  const local = storage(),
    session = storage();
  local.setItem("curlcast-participant-access-game", "camera-token");
  synchronizeDeviceAccount(local, session, null);
  expect(local.getItem("curlcast-participant-access-game")).toBe(
    "camera-token",
  );
  synchronizeDeviceAccount(local, session, null, true);
  expect(local.getItem("curlcast-participant-access-game")).toBeNull();
});
