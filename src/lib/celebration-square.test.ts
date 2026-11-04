import { describe, expect, it } from "vitest";
import { celebrationSquareCrop } from "./celebration-square";
import { lightsaberHeadTransforms } from "./lightsaber-compositor";
import { catDanceHeadTransforms } from "./cat-dance-compositor";

describe("square celebration framing", () => {
  for (const template of ["lightsaber", "cat-dance"] as const) {
    it.each([0.55, 0.72, 1, 1.3])(
      `keeps the entire ${template} head in a square at aspect %s`,
      (aspect) => {
        const poses = (
          template === "lightsaber"
            ? lightsaberHeadTransforms
            : catDanceHeadTransforms
        )(aspect);
        for (const pose of poses) {
          const crop = celebrationSquareCrop(template, pose);
          expect(crop.size).toBe(1080);
          expect(crop.x).toBeGreaterThanOrEqual(0);
          expect(crop.y).toBeGreaterThanOrEqual(0);
          expect(crop.x + crop.size).toBeLessThanOrEqual(
            template === "lightsaber" ? 1440 : 1080,
          );
          expect(crop.y + crop.size).toBeLessThanOrEqual(
            template === "lightsaber" ? 1080 : 1920,
          );
          for (const x of [-pose.width / 2, pose.width / 2]) {
            for (const y of [-pose.height, 0]) {
              const px =
                pose.cx +
                x * Math.cos(pose.rotation) -
                y * Math.sin(pose.rotation);
              const py =
                pose.chinY +
                x * Math.sin(pose.rotation) +
                y * Math.cos(pose.rotation);
              expect(px).toBeGreaterThanOrEqual(crop.x - 0.001);
              expect(px).toBeLessThanOrEqual(crop.x + crop.size + 0.001);
              expect(py).toBeGreaterThanOrEqual(crop.y - 0.001);
              expect(py).toBeLessThanOrEqual(crop.y + crop.size + 0.001);
            }
          }
        }
      },
    );
  }
});
