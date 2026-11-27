/** Browser-only photo processing. Models and WASM are served from our origin. */
export type HeadshotAdjustment = {
  x: number;
  y: number;
  size: number;
  rotation: number;
};
export type PreparedHeadshot = {
  original: HTMLCanvasElement;
  cutout: HTMLCanvasElement | null;
  adjustment: HeadshotAdjustment;
  message: string;
};
function canvas(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  return result;
}
export async function prepareHeadshot(file: File): Promise<PreparedHeadshot> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw Error("Choose a PNG, JPEG or WebP photo under 12 MB.");
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  if (image.width * image.height > 40_000_000) {
    image.close();
    throw Error("Choose a photo smaller than 40 megapixels.");
  }
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const original = canvas(
    Math.round(image.width * scale),
    Math.round(image.height * scale),
  );
  original
    .getContext("2d")!
    .drawImage(image, 0, 0, original.width, original.height);
  image.close();
  const fallback: PreparedHeadshot = {
    original,
    cutout: null,
    adjustment: { x: 0.5, y: 0.4, size: 0.7, rotation: 0 },
    message:
      "Automatic preparation unavailable. Adjust the manual oval crop below.",
  };
  let detector: import("@mediapipe/tasks-vision").FaceDetector | undefined;
  let segmenter: import("@mediapipe/tasks-vision").ImageSegmenter | undefined;
  try {
    const { FilesetResolver, FaceDetector, ImageSegmenter } =
      await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks("/celebration-models");
    detector = await FaceDetector.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: "/celebration-models/blaze_face_short_range.tflite",
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.6,
    });
    const faces = detector.detect(original).detections;
    if (faces.length !== 1 || !faces[0].boundingBox) {
      fallback.message =
        faces.length > 1
          ? "Multiple faces found. Choose a single-player photo or adjust a manual oval crop."
          : "No clear face found. Adjust the manual oval crop or choose a front-facing photo.";
      return fallback;
    }
    const face = faces[0];
    const box = face.boundingBox!;
    const eyeA = face.keypoints[0],
      eyeB = face.keypoints[1];
    const roll =
      eyeA && eyeB
        ? (Math.atan2(
            (eyeB.y - eyeA.y) * original.height,
            Math.abs(eyeB.x - eyeA.x) * original.width,
          ) *
            180) /
          Math.PI
        : 0;
    fallback.adjustment = {
      x: (box.originX + box.width / 2) / original.width,
      y: (box.originY + box.height * 0.4) / original.height,
      size:
        Math.max(box.width * 1.4, box.height * 1.55) /
        Math.min(original.width, original.height),
      rotation: Math.max(-45, Math.min(45, -roll)),
    };
    segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: "/celebration-models/selfie_multiclass_256x256.tflite",
      },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    const result = segmenter.segment(original);
    try {
      const masks = result.confidenceMasks;
      if (!masks || masks.length !== 6) throw Error("No head mask");
      const hair = masks[1].getAsFloat32Array(),
        skin = masks[3].getAsFloat32Array(),
        accessories = masks[5].getAsFloat32Array();
      const mask = canvas(masks[0].width, masks[0].height);
      const ctx = mask.getContext("2d")!;
      const pixels = ctx.createImageData(mask.width, mask.height);
      let coverage = 0;
      for (let i = 0; i < hair.length; i++) {
        const alpha = Math.max(
          0,
          Math.min(1, (hair[i] + skin[i] + accessories[i] - 0.25) / 0.5),
        );
        pixels.data[i * 4 + 3] = Math.round(alpha * 255);
        coverage += alpha;
      }
      if (coverage < 20) throw Error("No usable head mask");
      ctx.putImageData(pixels, 0, 0);
      const cutout = canvas(original.width, original.height);
      const output = cutout.getContext("2d")!;
      output.drawImage(original, 0, 0);
      output.globalCompositeOperation = "destination-in";
      output.drawImage(mask, 0, 0, original.width, original.height);
      return {
        ...fallback,
        cutout,
        message: "Head cutout ready.",
      };
    } finally {
      result.close();
    }
  } catch {
    return fallback;
  } finally {
    detector?.close();
    segmenter?.close();
  }
}
export function renderHeadshot(
  prepared: PreparedHeadshot,
  adjustment: HeadshotAdjustment,
  manual: boolean,
): HTMLCanvasElement {
  const output = canvas(512, 512);
  const ctx = output.getContext("2d")!;
  const source = manual
    ? prepared.original
    : (prepared.cutout ?? prepared.original);
  // Explicit head crop is separate from portrait camera/sponsor rendering.
  if (manual || !prepared.cutout) {
    ctx.beginPath();
    ctx.ellipse(256, 256, 213, 248, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.translate(256, 256);
  ctx.rotate((adjustment.rotation * Math.PI) / 180);
  const scale =
    470 /
    (Math.max(0.1, adjustment.size) * Math.min(source.width, source.height));
  ctx.scale(scale, scale);
  ctx.drawImage(
    source,
    -adjustment.x * source.width,
    -adjustment.y * source.height,
  );
  return output;
}
export async function headshotPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("Photo export failed."))),
      "image/png",
    ),
  );
}
