import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const gameChangeNoticeSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:"),
    key: z.string().min(1).max(4096),
    topic: z.string().regex(/^game-change-[a-f0-9]{64}$/),
  })
  .strict();
export type GameChangeNotice = z.infer<typeof gameChangeNoticeSchema>;

/** Notices contain no data and are hints only; never accept state from them. */
export function subscribeGameChanges(
  notice: GameChangeNotice,
  changed: () => void,
  connected: (ready: boolean) => void,
) {
  const db = createClient(notice.url, notice.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let closed = false,
    lastNotice = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const deliver = () => {
    trailing = undefined;
    if (closed) return;
    lastNotice = performance.now();
    changed();
  };
  const channel = db.channel(notice.topic);
  channel
    .on("broadcast", { event: "changed" }, () => {
      // A notice can only request an authorized read, capped at one per second.
      const now = performance.now();
      if (closed) return;
      if (now - lastNotice >= 1000) deliver();
      else if (!trailing)
        trailing = setTimeout(deliver, 1000 - (now - lastNotice));
    })
    .subscribe((status) => {
      if (!closed) connected(status === "SUBSCRIBED");
    });
  return () => {
    closed = true;
    clearTimeout(trailing);
    void db.removeChannel(channel).catch(() => undefined);
  };
}
