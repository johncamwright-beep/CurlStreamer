import { describe, expect, it } from "vitest";
import {
  firstValidYoutubeWatchUrl,
  youtubeWatchUrlSchema,
} from "./youtube-watch";

describe("YouTube watch links", () => {
  it("uses the first valid saved watch URL and skips empty or unsafe older fields", () => {
    const url = "https://youtu.be/abcdefghijk";
    expect(
      firstValidYoutubeWatchUrl(
        undefined,
        null,
        " ",
        "javascript:alert(1)",
        url,
      ),
    ).toBe(url);
    expect(
      firstValidYoutubeWatchUrl(
        "https://example.com/watch?v=abcdefghijk",
        "not a URL",
      ),
    ).toBeNull();
    expect(
      firstValidYoutubeWatchUrl(
        url,
        "https://www.youtube.com/watch?v=other-video",
      ),
    ).toBe(url);
  });
  it.each([
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://youtube.com/live/abcdefghijk",
    "https://youtu.be/abcdefghijk?t=12",
  ])("accepts %s", (value) => {
    expect(youtubeWatchUrlSchema.parse(value)).toBe(value);
  });

  it("stores an empty optional link as null", () => {
    expect(youtubeWatchUrlSchema.parse("  ")).toBeNull();
  });

  it.each([
    "http://youtu.be/abcdefghijk",
    "https://example.com/watch?v=abcdefghijk",
    "https://youtube.com/channel/abcdefghijk",
    "javascript:alert(1)",
  ])("rejects %s", (value) => {
    expect(youtubeWatchUrlSchema.safeParse(value).success).toBe(false);
  });
});
