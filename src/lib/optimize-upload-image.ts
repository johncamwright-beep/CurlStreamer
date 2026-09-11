export const MAX_UPLOAD_IMAGE_BYTES = 300_000;
export const MAX_UPLOAD_IMAGE_SIDE = 1600;

export type OptimizeUploadImageOptions = {
  maxBytes?: number;
  maxSide?: number;
  aspectRatio?: number;
};

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

export function uploadImageDimensions(
  width: number,
  height: number,
  maxSide = MAX_UPLOAD_IMAGE_SIDE,
) {
  const scale = Math.min(1, maxSide / width, maxSide / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some browsers support the API but reject a valid file type; use Image.
    }
  }
  if (
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    throw new Error("Image optimization is unavailable in this browser.");

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("could not decode"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name}: the image could not be decoded.`);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
}

/**
 * Converts a browser-decoded image to a metadata-free JPEG sized for upload.
 * Canvas drawing intentionally flattens transparency onto white.
 */
export async function optimizeUploadImage(
  file: File,
  {
    maxBytes = MAX_UPLOAD_IMAGE_BYTES,
    maxSide = MAX_UPLOAD_IMAGE_SIDE,
    aspectRatio,
  }: OptimizeUploadImageOptions = {},
): Promise<File> {
  if (!file.type.startsWith("image/"))
    throw new Error(`${file.name}: choose a PNG, JPEG or WebP image.`);
  if (
    maxBytes <= 0 ||
    maxSide <= 0 ||
    (aspectRatio !== undefined &&
      (!Number.isFinite(aspectRatio) || aspectRatio <= 0))
  )
    throw new Error("Image optimization has invalid limits.");

  const decoded = await decodeImage(file);
  if (!decoded.width || !decoded.height) {
    decoded.close();
    throw new Error(`${file.name}: the image could not be decoded.`);
  }

  const canvas = document.createElement("canvas");
  try {
    const crop = centeredImageCrop(decoded.width, decoded.height, aspectRatio);
    let size = uploadImageDimensions(crop.width, crop.height, maxSide);
    const qualities = [0.88, 0.78, 0.68, 0.58, 0.48];
    for (;;) {
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Image optimization is unavailable in this browser.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(
        decoded.source,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        size.width,
        size.height,
      );

      for (const quality of qualities) {
        const blob = await canvasBlob(canvas, quality);
        if (!blob)
          throw new Error("Image optimization is unavailable in this browser.");
        if (blob.size <= maxBytes) {
          const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
          return new File([blob], `${baseName}.jpg`, {
            type: "image/jpeg",
            lastModified: file.lastModified,
          });
        }
      }

      if (Math.max(size.width, size.height) <= 256) break;
      size = {
        width: Math.max(1, Math.round(size.width * 0.8)),
        height: Math.max(1, Math.round(size.height * 0.8)),
      };
    }
    throw new Error(
      `${file.name}: we could not reduce this image below 300 KB.`,
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    decoded.close();
  }
}

export function centeredImageCrop(
  width: number,
  height: number,
  aspectRatio?: number,
) {
  if (!aspectRatio) return { x: 0, y: 0, width, height };
  const cropWidth = Math.min(width, height * aspectRatio);
  const cropHeight = Math.min(height, width / aspectRatio);
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}
