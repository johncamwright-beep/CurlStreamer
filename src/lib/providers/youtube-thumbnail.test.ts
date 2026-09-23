import { expect, it, vi } from "vitest";
import {
  renderScheduledThumbnail,
  uploadScheduledThumbnail,
} from "./youtube-thumbnail";

const info = {
  homeName: "Team Benning",
  awayName: "Team Camm",
  eventName: "Shorty Jenkins Classic · Game 1",
  scheduledStart: "2026-09-17T20:00:00Z",
  timezone: "America/Toronto",
};
it("renders a bounded 1280 by 720 PNG and uploads binary media", async () => {
  const png = await renderScheduledThumbnail(info);
  const data = Buffer.from(png);
  expect(data.subarray(1, 4).toString()).toBe("PNG");
  expect(data.readUInt32BE(16)).toBe(1280);
  expect(data.readUInt32BE(20)).toBe(720);
  expect(data.length).toBeLessThan(2_000_000);
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [{}] }), { status: 200 }),
    );
  await uploadScheduledThumbnail("fixture-access", "video123", info, fetcher);
  expect(fetcher.mock.calls[0][0]).toContain(
    "videoId=video123&uploadType=media",
  );
  const init = fetcher.mock.calls[0][1];
  expect(init.headers["content-type"]).toBe("image/png");
  expect(init.body).toBeInstanceOf(Blob);
});
