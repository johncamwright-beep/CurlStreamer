type AccessClaims = {
  purpose?: unknown;
  gameId?: unknown;
  role?: unknown;
  exp?: unknown;
};

function claims(token: string | null): AccessClaims | undefined {
  if (!token) return undefined;
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return undefined;
    return JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return undefined;
  }
}

function currentClaims(token: string | null) {
  const value = claims(token);
  if (value && (typeof value.exp !== "number" || value.exp > Date.now() / 1000))
    return value;
}

function firstToken(
  tokens: Array<string | null>,
  accepts: (value: AccessClaims) => boolean,
) {
  return tokens.find((token) => {
    const value = currentClaims(token);
    return Boolean(value && accepts(value));
  });
}

export function gameAccessToken(storage: Pick<Storage, "getItem">, id: string) {
  return firstToken(
    [
      storage.getItem(`curlcast-access-${id}`),
      storage.getItem(`curlcast-organizer-access-${id}`),
      storage.getItem(`curlcast-participant-access-${id}`),
    ],
    (value) =>
      value.gameId === id &&
      (value.purpose === "organizer" || value.purpose === "participant"),
  );
}

export function cameraPublishAccessToken(
  storage: Pick<Storage, "getItem">,
  id: string,
  role: "camera-home" | "camera-away",
) {
  return firstToken(
    [
      storage.getItem(`curlcast-participant-access-${id}`),
      storage.getItem(`curlcast-access-${id}`),
    ],
    (value) =>
      value.gameId === id &&
      value.purpose === "participant" &&
      value.role === role,
  );
}

export function previewSubscribeAccessToken(
  storage: Pick<Storage, "getItem">,
  id: string,
) {
  return firstToken(
    [
      storage.getItem(`curlcast-organizer-access-${id}`),
      storage.getItem(`curlcast-participant-access-${id}`),
      storage.getItem(`curlcast-access-${id}`),
    ],
    (value) =>
      value.gameId === id &&
      (value.purpose === "organizer" ||
        (value.purpose === "participant" && value.role === "scorer")),
  );
}

export function hasOrganizerAccess(
  storage: Pick<Storage, "getItem">,
  id: string,
) {
  return Boolean(organizerAccessToken(storage, id));
}

export function organizerAccessToken(
  storage: Pick<Storage, "getItem">,
  id: string,
) {
  return firstToken(
    [
      storage.getItem(`curlcast-organizer-access-${id}`),
      storage.getItem(`curlcast-access-${id}`),
    ],
    (value) => value.purpose === "organizer" && value.gameId === id,
  );
}

export function hasScoringAccess(
  storage: Pick<Storage, "getItem">,
  id: string,
) {
  return Boolean(previewSubscribeAccessToken(storage, id));
}

export function canManageCompletion(
  accountRole: string,
  hasOrganizerToken: boolean,
) {
  return hasOrganizerToken || ["owner", "team_admin"].includes(accountRole);
}

export function preserveAndStoreParticipantAccess(
  storage: Pick<Storage, "getItem" | "setItem">,
  id: string,
  token: string,
) {
  const current = storage.getItem(`curlcast-access-${id}`);
  const value = claims(current);
  if (value?.purpose === "organizer" && value.gameId === id) {
    storage.setItem(`curlcast-organizer-access-${id}`, current!);
    storage.setItem(`curlcast-participant-access-${id}`, token);
    return;
  }
  storage.setItem(`curlcast-access-${id}`, token);
}
