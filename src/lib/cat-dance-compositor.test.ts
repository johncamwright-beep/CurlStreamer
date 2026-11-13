import { describe, expect, it } from "vitest";
import {
  CAT_DANCE_VIDEO,
  catDanceFrameAt,
  catDanceHeadTransforms,
} from "./cat-dance-compositor";

describe("cat dance compositor", () => {
  it("retains the complete portrait source and its authoritative duration", () => {
    expect(CAT_DANCE_VIDEO).toMatchObject({
      width: 1080,
      height: 1920,
      frames: 291,
      fps: 30,
      durationMs: 9700,
      src: "/celebrations/cat-dance.mp4",
    });
    expect(catDanceFrameAt(-1)).toBe(0);
    expect(catDanceFrameAt(0.5)).toBe(15);
    expect(catDanceFrameAt(9.7)).toBe(290);
    expect(catDanceFrameAt(100)).toBe(290);
    expect(catDanceFrameAt(NaN)).toBe(0);
  });

  it.each([0.55, 0.72, 1, 1.3])(
    "keeps a %s aspect cutout unwarped and within the canvas during every jump",
    (aspect) => {
      const transforms = catDanceHeadTransforms(aspect);
      expect(transforms).toHaveLength(291);
      for (const pose of transforms) {
        expect(pose.width / pose.height).toBeCloseTo(aspect, 10);
        expect(pose.cx - pose.width / 2).toBeGreaterThanOrEqual(9.999);
        expect(pose.cx + pose.width / 2).toBeLessThanOrEqual(1070.001);
        expect(pose.chinY - pose.height).toBeGreaterThanOrEqual(9.999);
        expect(pose.scale).toBeGreaterThan(0);
        expect(pose.scale).toBeLessThanOrEqual(1);
      }
      expect(transforms[0]).toMatchObject({ cx: 420, chinY: 580 });
      expect(transforms[160].cx).toBe(224);
      expect(transforms[290]).toMatchObject({ cx: 290, chinY: 776 });
    },
  );

  it.each([0, -1, NaN, Infinity])(
    "rejects invalid head aspect %s",
    (aspect) => {
      expect(() => catDanceHeadTransforms(aspect)).toThrow(
        "Invalid prepared head dimensions",
      );
    },
  );
});
