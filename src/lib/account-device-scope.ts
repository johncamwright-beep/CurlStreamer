const identityKey = "curlstreamer-device-account";
// Device preferences (mic sync, volume, camera hardware) intentionally survive.
// Credentials, selected games and coaching drafts must not cross account boundaries.
export function synchronizeDeviceAccount(
  storage: Storage,
  drafts: Storage,
  userId: string | null,
  explicitLogout = false,
) {
  const previous = storage.getItem(identityKey);
  const next = userId ?? "signed-out";
  if (
    !explicitLogout &&
    (previous === next || (previous === null && userId === null))
  )
    return;
  for (const target of [storage, drafts]) {
    const keys: string[] = [];
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (
        key &&
        (/^curlcast-(?:current-game|access-|organizer-access-|participant-access-|camera-|scorer-)/.test(
          key,
        ) ||
          /curlcoach|shot-tracker/i.test(key))
      )
        keys.push(key);
    }
    keys.forEach((key) => target.removeItem(key));
  }
  storage.setItem(identityKey, next);
  globalThis.dispatchEvent?.(
    new CustomEvent("curlcast-current-game", { detail: null }),
  );
}
