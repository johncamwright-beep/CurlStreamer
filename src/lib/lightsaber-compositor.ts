import keyframes from "./lightsaber-keyframes.json";
export const LIGHTSABER_VIDEO = {
  src: "/celebrations/lightsaber.mp4",
  width: 1440,
  height: 1080,
  fps: 30,
  frames: 185,
  durationMs: 6167,
} as const;
export interface LightsaberHeadTransform {
  cx: number;
  chinY: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
}
const frames = Array.from({ length: LIGHTSABER_VIDEO.frames }, (_, frame) => {
  const index = keyframes.findLastIndex((key) => key.frame <= frame);
  const a = keyframes[Math.max(0, index)],
    b = keyframes[Math.min(index + 1, keyframes.length - 1)];
  const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
  const interpolate = (key: "cx" | "cy" | "width" | "height" | "rotation") =>
    a[key] + (b[key] - a[key]) * t;
  const correction = Math.max(0, 1 - Math.abs(frame - 128) / 8);
  return {
    cx: interpolate("cx"),
    cy: interpolate("cy") + 12 * correction,
    width:
      interpolate("width") *
      (1 + 0.08 * correction) *
      (frame >= 92 && frame <= 100 ? 1.04 : 1),
    height: interpolate("height") * (1 + 0.08 * correction),
    rotation: (interpolate("rotation") * Math.PI) / 180,
  };
});
/** Same bounded growth envelope and fixed chin pivot as the approved render. */
export function lightsaberHeadTransforms(
  aspect: number,
): LightsaberHeadTransform[] {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw Error("Invalid prepared head dimensions");
  const sizes = frames.map((frame) => {
    const height = Math.max(frame.height * 1.25, (frame.width * 1.12) / aspect),
      width = height * aspect;
    const sn = Math.sin(frame.rotation),
      cs = Math.cos(frame.rotation);
    const rotatedWidth = Math.abs(width * cs) + Math.abs(height * sn),
      rotatedHeight = Math.abs(width * sn) + Math.abs(height * cs);
    const dx = (-sn * height) / 2,
      dy = (cs * height) / 2,
      chinY = frame.cy + frame.height / 2;
    const scale = Math.min(
      1.95,
      (frame.cx - 5) / (dx + rotatedWidth / 2),
      (chinY - 5) / (dy + rotatedHeight / 2),
      (1440 - frame.cx - 5) / (rotatedWidth / 2 - dx),
      (1080 - chinY - 5) / Math.max(1, rotatedHeight / 2 - dy),
    );
    return { ...frame, width, height, chinY, scale };
  });
  return sizes.map((size, index) => {
    const scale = Math.min(
      ...sizes.map((other, j) => other.scale + 0.045 * Math.abs(index - j)),
    );
    return {
      cx: size.cx,
      chinY: size.chinY,
      width: size.width * scale,
      height: size.height * scale,
      rotation: size.rotation,
      scale,
    };
  });
}
export function lightsaberFrameAt(mediaTime: number) {
  return Math.max(0, Math.min(184, Math.floor(mediaTime * 30 + 0.001)));
}
