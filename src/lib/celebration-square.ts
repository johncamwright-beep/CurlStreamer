import type { CelebrationTemplateId } from "./player-celebrations";
import type { LightsaberHeadTransform } from "./lightsaber-compositor";

export const CELEBRATION_SQUARE_SIZE = 1080;

/** Crop only celebration footage. Keep the complete tracked head inside the square. */
export function celebrationSquareCrop(
  template: CelebrationTemplateId,
  head: LightsaberHeadTransform,
) {
  const size = CELEBRATION_SQUARE_SIZE;
  const sn = Math.sin(head.rotation),
    cs = Math.cos(head.rotation);
  const corners = [-head.width / 2, head.width / 2].flatMap((x) =>
    [-head.height, 0].map((y) => ({
      x: head.cx + x * cs - y * sn,
      y: head.chinY + x * sn + y * cs,
    })),
  );
  const left = Math.min(...corners.map((p) => p.x));
  const right = Math.max(...corners.map((p) => p.x));
  const top = Math.min(...corners.map((p) => p.y));
  const bottom = Math.max(...corners.map((p) => p.y));
  const fit = (
    preferred: number,
    start: number,
    end: number,
    maximum: number,
  ) =>
    Math.max(
      0,
      Math.min(
        maximum,
        Math.max(end + 10 - size, Math.min(preferred, start - 10)),
      ),
    );
  return template === "lightsaber"
    ? { x: fit(180, left, right, 360), y: 0, size }
    : // The cat clip's actual scene begins at y=316. Move up only when a
      // jumping oversized head needs room above the original scene.
      { x: 0, y: fit(316, top, bottom, 840), size };
}
