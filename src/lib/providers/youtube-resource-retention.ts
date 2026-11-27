import "server-only";
import { z } from "zod";
import { youtubeGoogleRequest } from "./youtube";

export const youtubeResourceSchema = z.object({
  kind: z.enum(["broadcast", "stream"]),
  id: z.string().min(1).max(128),
});
const itemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1).max(128),
      snippet: z.object({ channelId: z.string().min(1).max(128) }),
    }),
  ),
});

/** Refresh the existence/ownership of retained API identifiers without altering YouTube resources. */
export async function verifyRetainedYouTubeResources(
  accessToken: string,
  channelId: string,
  resources: z.infer<typeof youtubeResourceSchema>[],
  fetcher: typeof fetch = fetch,
) {
  const missingBroadcasts: string[] = [],
    missingStreams: string[] = [];
  for (const kind of ["broadcast", "stream"] as const) {
    const ids = [
      ...new Set(
        resources.filter((item) => item.kind === kind).map((item) => item.id),
      ),
    ];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const url = new URL(
        `https://www.googleapis.com/youtube/v3/${kind === "broadcast" ? "liveBroadcasts" : "liveStreams"}`,
      );
      url.search = new URLSearchParams({
        part: "id,snippet",
        id: batch.join(","),
        maxResults: "50",
      }).toString();
      const response = itemsSchema.parse(
        await youtubeGoogleRequest(
          url.toString(),
          { headers: { authorization: `Bearer ${accessToken}` } },
          fetcher,
          true,
        ),
      );
      const owned = new Set(
        response.items
          .filter((item) => item.snippet.channelId === channelId)
          .map((item) => item.id),
      );
      (kind === "broadcast" ? missingBroadcasts : missingStreams).push(
        ...batch.filter((id) => !owned.has(id)),
      );
    }
  }
  return { missingBroadcasts, missingStreams };
}
