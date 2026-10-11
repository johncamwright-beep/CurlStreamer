import { expect, it } from "vitest";
import {
  activePublicEvent,
  publicEventSchema,
  type PublicEvent,
} from "./public-active-event";

const event: PublicEvent = {
  id: "stu",
  name: "Stu Sells",
  start_date: "2026-10-09",
  end_date: "2026-10-11",
  timezone: "America/Toronto",
  result: null,
};
it.each([
  ["2026-10-06T03:59:59Z", false],
  ["2026-10-06T04:00:00Z", true],
  ["2026-10-12T03:59:59Z", true],
  ["2026-10-12T04:00:00Z", false],
])("uses local calendar boundaries at %s", (now, expected) => {
  expect(Boolean(activePublicEvent([event], Date.parse(now)))).toBe(expected);
});
it("ends the spotlight when the final placement is recorded", () => {
  expect(
    activePublicEvent(
      [{ ...event, result: "1st" }],
      Date.parse("2026-10-11T18:00:00Z"),
    ),
  ).toBeUndefined();
});
it("prefers an ongoing event to the next event's lead-in independent of input order", () => {
  const next = {
    ...event,
    id: "next",
    start_date: "2026-10-13",
    end_date: "2026-10-15",
  };
  expect(
    activePublicEvent([next, event], Date.parse("2026-10-11T18:00:00Z"))?.id,
  ).toBe("stu");
  expect(
    activePublicEvent([next, event], Date.parse("2026-10-12T18:00:00Z"))?.id,
  ).toBe("next");
});
it("handles the fall daylight saving boundary as calendar days", () => {
  const autumn = { ...event, start_date: "2026-11-03", end_date: "2026-11-04" };
  expect(
    activePublicEvent([autumn], Date.parse("2026-10-31T04:00:00Z"))?.id,
  ).toBe("stu");
  expect(
    activePublicEvent([autumn], Date.parse("2026-11-05T04:59:59Z"))?.id,
  ).toBe("stu");
  expect(
    activePublicEvent([autumn], Date.parse("2026-11-05T05:00:00Z")),
  ).toBeUndefined();
});
it("rejects invalid calendar dates and timezones at the public boundary", () => {
  expect(
    publicEventSchema.safeParse({ ...event, timezone: "invalid" }).success,
  ).toBe(false);
  expect(
    publicEventSchema.safeParse({ ...event, start_date: "2026-02-30" }).success,
  ).toBe(false);
});
