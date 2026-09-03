type AccessClaims = { purpose?: unknown; gameId?: unknown; role?: unknown };

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

export function hasOrganizerAccess(
  storage: Pick<Storage, "getItem">,
  id: string,
) {
  return [
    storage.getItem(`curlcast-organizer-access-${id}`),
    storage.getItem(`curlcast-access-${id}`),
  ].some((token) => {
    const value = claims(token);
    return value?.purpose === "organizer" && value.gameId === id;
  });
}

export function hasScoringAccess(
  storage: Pick<Storage, "getItem">,
  id: string,
) {
  return [
    storage.getItem(`curlcast-organizer-access-${id}`),
    storage.getItem(`curlcast-participant-access-${id}`),
    storage.getItem(`curlcast-access-${id}`),
  ].some((token) => {
    const value = claims(token);
    return (
      value?.gameId === id &&
      (value.purpose === "organizer" ||
        (value.purpose === "participant" && value.role === "scorer"))
    );
  });
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
