import { expect, test } from "@playwright/test";
import { defaultTeamPageSettings } from "../src/lib/team-page-settings";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated authenticated account fixture",
);

type UploadedImage = { bytes: number; height: number; width: number };

function jpegDimensions(bytes: Buffer) {
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  for (let offset = 2; offset < bytes.length - 8;) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw new Error("Uploaded image did not contain a JPEG frame.");
}

test("news cover and inline uploads are compressed before their network requests", async ({
  page,
}) => {
  const uploads: Record<string, UploadedImage> = {};
  let posts: Record<string, unknown>[] = [];

  await page.route("**/api/account/team", (route) =>
    route.fulfill({
      json: {
        settings: defaultTeamPageSettings("Team Benning"),
        logo: null,
        canEdit: true,
      },
    }),
  );
  await page.route("**/api/account/news/upload", async (route) => {
    const form = await new Request(route.request().url(), {
      method: "POST",
      headers: route.request().headers(),
      body: new Uint8Array(route.request().postDataBuffer()!),
    }).formData();
    const image = form.get("image");
    expect(image).toBeInstanceOf(File);
    const file = image as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBeLessThanOrEqual(300_000);
    const dimensions = jpegDimensions(Buffer.from(await file.arrayBuffer()));
    expect(dimensions.width).toBeLessThanOrEqual(1600);
    expect(dimensions.height).toBeLessThanOrEqual(1600);
    uploads.inline = { bytes: file.size, ...dimensions };
    await route.fulfill({
      json: { url: "https://media.test/news-inline.jpg" },
    });
  });
  await page.route(/\/api\/account\/news(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { posts } });
    const form = await new Request(route.request().url(), {
      method: route.request().method(),
      headers: route.request().headers(),
      body: new Uint8Array(route.request().postDataBuffer()!),
    }).formData();
    const image = form.get("photo");
    expect(image).toBeInstanceOf(File);
    const file = image as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBeLessThanOrEqual(300_000);
    const dimensions = jpegDimensions(Buffer.from(await file.arrayBuffer()));
    expect(dimensions.width).toBeLessThanOrEqual(1600);
    expect(dimensions.height).toBeLessThanOrEqual(1600);
    uploads.cover = { bytes: file.size, ...dimensions };
    posts = [
      {
        id: form.get("id"),
        revision: 1,
        summary: form.get("summary"),
        content: JSON.parse(String(form.get("content"))),
        photo_url: "https://media.test/news-cover.jpg",
        published: form.get("published") === "true",
        created_at: "2026-09-10T12:00:00Z",
        game_id: null,
      },
    ];
    return route.fulfill({ json: { saved: true, post: posts[0] } });
  });

  await page.goto("/login?next=/account");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/account");
  await page.getByRole("button", { name: "News posts", exact: true }).click();
  const news = page.getByRole("region", { name: "Manage team news" });
  await news.getByRole("link", { name: "New post", exact: true }).click();
  await news.getByLabel("Post title").fill("Compressed rink photos");
  const editor = news.getByLabel("News text", { exact: true });
  await editor.fill("Both uploads should stay compact.");

  const sourceBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
      const value = (pixel / 4) >>> 0;
      pixels.data[pixel] = (value * 17) & 255;
      pixels.data[pixel + 1] = (value * 43) & 255;
      pixels.data[pixel + 2] = (value * 97) & 255;
      pixels.data[pixel + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  });
  const source = {
    name: "large-rink.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(sourceBase64, "base64"),
  };
  expect(source.buffer.length).toBeGreaterThan(300_000);

  await news.getByLabel("Cover photo (optional)").setInputFiles(source);
  await expect(
    news.getByRole("button", { name: "Save and publish" }),
  ).toBeEnabled();
  await news
    .getByRole("button", { name: "Insert image in post", exact: true })
    .click();
  await news.getByLabel("Photo description").fill("Rink during a curl");
  await news.getByLabel("Inline photo").setInputFiles(source);
  await expect(editor.locator("img")).toHaveAttribute(
    "src",
    "https://media.test/news-inline.jpg",
  );
  await news.getByRole("button", { name: "Save and publish" }).click();
  await expect(
    news.getByRole("link", { name: /Compressed rink photos/ }),
  ).toBeVisible();
  expect(uploads.cover).toBeDefined();
  expect(uploads.inline).toBeDefined();
});
