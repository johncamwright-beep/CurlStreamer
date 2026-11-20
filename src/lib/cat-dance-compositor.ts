import keyframes from "./cat-dance-keyframes.json";

/** Full original portrait canvas, including its embedded letterboxing and audio. */
export const CAT_DANCE_VIDEO = {
  src: "/celebrations/cat-dance.mp4",
  width: 1080,
  height: 1920,
  fps: 30,
  frames: 291,
  durationMs: 9700,
} as const;

export interface CatDanceHeadTransform {
  cx: number;
  chinY: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

/** Landmarks follow only the main dancing black cat, never the phone image. */
export function catDanceHeadTransforms(
  aspect: number,
): CatDanceHeadTransform[] {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw Error("Invalid prepared head dimensions");
  const sizes = Array.from({ length: CAT_DANCE_VIDEO.frames }, (_, frame) => {
    const index = keyframes.findLastIndex((key) => key.frame <= frame);
    const a = keyframes[Math.max(0, index)],
      b = keyframes[Math.min(index + 1, keyframes.length - 1)];
    const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
    const interpolate = (key: "cx" | "chinY" | "width" | "height") =>
      a[key] + (b[key] - a[key]) * t;
    const cx = interpolate("cx"),
      chinY = interpolate("chinY"),
      height = Math.max(
        interpolate("height") * 1.8,
        (interpolate("width") * 1.8) / aspect,
      ),
      width = height * aspect;
    const scale = Math.min(
      1,
      (cx - 10) / (width / 2),
      (CAT_DANCE_VIDEO.width - cx - 10) / (width / 2),
      (chinY - 10) / height,
    );
    return { cx, chinY, width, height, scale };
  });
  // Approach canvas edges gradually without changing the chin's neck pivot.
  return sizes.map((size, index) => {
    const scale = Math.min(
      ...sizes.map((other, j) => other.scale + 0.025 * Math.abs(index - j)),
    );
    return {
      cx: size.cx,
      chinY: size.chinY,
      width: size.width * scale,
      height: size.height * scale,
      rotation: 0,
      scale,
    };
  });
}

export function catDanceFrameAt(mediaTime: number) {
  if (!Number.isFinite(mediaTime)) return 0;
  return Math.max(
    0,
    Math.min(CAT_DANCE_VIDEO.frames - 1, Math.floor(mediaTime * 30 + 0.001)),
  );
}
