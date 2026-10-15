import "server-only";
import sharp from "sharp";

export const MAX_STORED_IMAGE_BYTES = 300_000;
const MAX_PIXELS = 40_000_000;

/** Decode and re-encode untrusted uploads; never store the original metadata. */
export async function normalizeUploadImage(bytes: Uint8Array) {
  const source = sharp(bytes, {
    limitInputPixels: MAX_PIXELS,
    failOn: "warning",
  });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
    throw new Error("Upload a single, valid image.");

  // Preserve the entire image, including portrait cameras/sponsor artwork and
  // transparent logos. Resize without cropping or enlarging small originals.
  for (const side of [1600, 1200, 900, 640, 480, 320]) {
    for (const quality of [85, 70, 55]) {
      const resized = source.clone().rotate().resize({
        width: side,
        height: side,
        fit: "inside",
        withoutEnlargement: true,
      });
      const output = metadata.hasAlpha
        ? await resized.webp({ quality, alphaQuality: 90 }).toBuffer()
        : await resized.jpeg({ quality, mozjpeg: true }).toBuffer();
      if (output.length < MAX_STORED_IMAGE_BYTES)
        return {
          bytes: new Uint8Array(output),
          mime: metadata.hasAlpha ? "image/webp" : "image/jpeg",
          extension: metadata.hasAlpha ? "webp" : "jpg",
        };
    }
  }
  throw new Error("This image could not be reduced below 300 kB.");
}
