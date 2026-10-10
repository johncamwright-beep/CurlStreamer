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

it("places contained team media beside the matchup and in the upper right", async () => {
  const { default: sharp } = await import("sharp");
  const fixture = async (width: number, height: number, background: string) =>
    `data:image/png;base64,${(
      await sharp({ create: { width, height, channels: 3, background } })
        .png()
        .toBuffer()
    ).toString("base64")}`;
  const png = await renderScheduledThumbnail({
    ...info,
    teamLogo: await fixture(400, 100, "#ff00ff"),
    teamPhoto: await fixture(100, 200, "#00ff00"),
  });
  const { data, info: pixels } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = (red: number, green: number, blue: number) => {
    let left = pixels.width;
    let top = pixels.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < pixels.height; y++) {
      for (let x = 0; x < pixels.width; x++) {
        const offset = (y * pixels.width + x) * pixels.channels;
        if (
          data[offset] === red &&
          data[offset + 1] === green &&
          data[offset + 2] === blue
        ) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return {
      left,
      top,
      right,
      bottom,
      width: right - left + 1,
      height: bottom - top + 1,
    };
  };
  const logo = bounds(255, 0, 255);
  const photo = bounds(0, 255, 0);
  expect(logo.left).toBeGreaterThan(900);
  expect(logo.bottom).toBeLessThan(192);
  expect(logo.width / logo.height).toBeCloseTo(4, 1);
  expect(photo.left).toBeGreaterThan(700);
  expect(photo.top).toBeGreaterThan(192);
  expect(photo.bottom).toBeLessThan(680);
  expect(photo.width / photo.height).toBeCloseTo(0.5, 2);
  expect(photo.height).toBeGreaterThan(400);
  expect(png.byteLength).toBeLessThan(2_000_000);
});

it.each(["teamLogo", "teamPhoto"] as const)(
  "renders when only %s is available",
  async (field) => {
    const { default: sharp } = await import("sharp");
    const image = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const png = await renderScheduledThumbnail({
      ...info,
      eventName: "Single Game",
      [field]: `data:image/png;base64,${image.toString("base64")}`,
    });
    expect(await sharp(png).metadata()).toMatchObject({
      format: "png",
      width: 1280,
      height: 720,
    });
  },
);
