import {
  gameAccessToken,
  previewSubscribeAccessToken,
} from "@/lib/access-session";

type Fetch = typeof fetch;

export async function fetchGameWithSelectedAccess(
  id: string,
  view: "broadcast" | "join" | undefined,
  invitation: string | null | undefined,
  storage: Pick<Storage, "getItem">,
  fetcher: Fetch = fetch,
) {
  const token =
    invitation ??
    (view === "broadcast"
      ? previewSubscribeAccessToken(storage, id)
      : gameAccessToken(storage, id));
  const url = `/api/games/${id}${view ? `?view=${view}` : ""}`;
  const response = await fetcher(url, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (view !== "broadcast" || ![401, 403].includes(response.status))
    return response;
  return fetcher(url, { cache: "no-store", credentials: "omit" });
}

export async function fetchLiveKitSubscriberCredentials(
  gameId: string,
  storage: Pick<Storage, "getItem">,
  fetcher: Fetch = fetch,
) {
  const token = previewSubscribeAccessToken(storage, gameId);
  let response = await fetcher(
    `/api/games/${gameId}/livekit-token?capability=preview-subscribe`,
    {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    },
  );
  if ([401, 403].includes(response.status))
    response = await fetcher(
      `/api/games/${gameId}/livekit-token?capability=public-viewer`,
      { method: "POST", credentials: "omit" },
    );
  return response;
}
