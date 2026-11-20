import { z } from "zod";
import { isIanaTimezone } from "./team-hierarchy";

export const publicEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  timezone: z.string().refine(isIanaTimezone),
  result: z.string().nullable(),
});
export type PublicEvent = z.infer<typeof publicEventSchema>;

/** Calendar days in the event's timezone, including its entire final day. */
export function activePublicEvent(events: PublicEvent[], now: number) {
  return (
    events
      .filter((event) => {
        if (event.result || event.end_date < event.start_date) return false;
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: event.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(now));
        const opens = new Date(`${event.start_date}T00:00:00Z`);
        opens.setUTCDate(opens.getUTCDate() - 3);
        return (
          today >= opens.toISOString().slice(0, 10) && today <= event.end_date
        );
      })
      // An event already underway takes priority over the next event's lead-in.
      .sort(
        (a, b) =>
          a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id),
      )[0]
  );
}
