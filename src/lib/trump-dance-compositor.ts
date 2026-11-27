import keyframes from "./trump-dance-keyframes.json";
import type { LightsaberHeadTransform } from "./lightsaber-compositor";

/** Original portrait frame fits at 576x1024 inside a 1080 square with animated sides. */
export const TRUMP_DANCE_VIDEO = {
  src: "/celebrations/trump-dance.mp4",
  width: 1080,
  height: 1080,
  fps: 30,
  frames: 290,
  durationMs: 9667,
} as const;

export function trumpDanceHeadTransforms(
  aspect: number,
): LightsaberHeadTransform[] {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw Error("Invalid prepared head dimensions");
  return Array.from({ length: TRUMP_DANCE_VIDEO.frames }, (_, frame) => {
    const index = Math.max(
      0,
      keyframes.findLastIndex((key) => key.frame <= frame),
    );
    const a = keyframes[index],
      b = keyframes[Math.min(index + 1, keyframes.length - 1)];
    const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
    const value = (key: "cx" | "chinY" | "width" | "height" | "rotation") =>
      a[key] + (b[key] - a[key]) * t;
    const cx = 252 + value("cx") * 1.6,
      chinY = 28 + value("chinY") * 1.6;
    const rotation = (value("rotation") * Math.PI) / 180;
    let height = Math.max(
      value("height") * 1.6 * 1.65,
      (value("width") * 1.6 * 1.5) / aspect,
    );
    let width = height * aspect;
    const corners = [-width / 2, width / 2].flatMap((x) =>
      [-height, 0].map((y) => ({
        x: x * Math.cos(rotation) - y * Math.sin(rotation),
        y: x * Math.sin(rotation) + y * Math.cos(rotation),
      })),
    );
    const scale = Math.min(
      1,
      ...corners.flatMap((p) => [
        p.x < 0 ? (cx - 8) / -p.x : p.x > 0 ? (1072 - cx) / p.x : 1,
        p.y < 0 ? (chinY - 8) / -p.y : p.y > 0 ? (1072 - chinY) / p.y : 1,
      ]),
    );
    width *= scale;
    height *= scale;
    return { cx, chinY, width, height, rotation, scale };
  });
}
export function trumpDanceFrameAt(mediaTime: number) {
  return Number.isFinite(mediaTime)
    ? Math.max(0, Math.min(289, Math.floor(mediaTime * 30 + 0.001)))
    : 0;
}
