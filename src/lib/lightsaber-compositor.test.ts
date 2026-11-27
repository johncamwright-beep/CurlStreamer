import { describe, it, expect } from "vitest";
import {
  LIGHTSABER_VIDEO,
  lightsaberFrameAt,
  lightsaberHeadTransforms,
} from "./lightsaber-compositor";
import foreground from "./lightsaber-foreground.json";
describe("approved big-head video tracking", () => {
  it("uses every source frame and preserves approved Cameron enlargement anchors", () => {
    const transforms = lightsaberHeadTransforms(1103 / 1317);
    expect(transforms).toHaveLength(185);
    expect(transforms[0]).toMatchObject({ cx: 840, chinY: 318 });
    expect(transforms[0].scale).toBeCloseTo(1.3911111111111112, 8);
    expect(transforms[0].height).toBeCloseTo(313, 5);
    expect(lightsaberFrameAt(0)).toBe(0);
    expect(lightsaberFrameAt(74 / 30)).toBe(74);
    expect(lightsaberFrameAt(6.1666)).toBe(184);
    expect(lightsaberFrameAt(100)).toBe(184);
    expect(LIGHTSABER_VIDEO).toMatchObject({
      width: 1440,
      height: 1080,
      fps: 30,
      frames: 185,
    });
  });
  it.each([0.5, 0.65, 1103 / 1317, 1, 1.3])(
    "keeps every proportionate head inside frame at aspect %s",
    (aspect) => {
      const transforms = lightsaberHeadTransforms(aspect);
      transforms.forEach((t, index) => {
        expect(t.width / t.height).toBeCloseTo(aspect, 8);
        const sn = Math.sin(t.rotation),
          cs = Math.cos(t.rotation);
        const centerX = t.cx + (sn * t.height) / 2,
          centerY = t.chinY - (cs * t.height) / 2;
        const width = Math.abs(t.width * cs) + Math.abs(t.height * sn),
          height = Math.abs(t.width * sn) + Math.abs(t.height * cs);
        expect(centerX - width / 2).toBeGreaterThanOrEqual(4.999);
        expect(centerY - height / 2).toBeGreaterThanOrEqual(4.999);
        expect(centerX + width / 2).toBeLessThanOrEqual(1435.001);
        expect(centerY + height / 2).toBeLessThanOrEqual(1075.001);
        if (index)
          expect(
            Math.abs(t.scale - transforms[index - 1].scale),
          ).toBeLessThanOrEqual(0.045001);
      });
    },
  );
  it("contains only generic bounded foreground patches, including the corrected arm frame", () => {
    expect(foreground.frames).toHaveLength(185);
    expect(foreground.frames[74]).not.toBeNull();
    for (const patch of foreground.frames) {
      if (!patch) continue;
      expect(patch.sheet).toBeLessThan(foreground.sheets.length);
      expect(patch.x + patch.width).toBeLessThanOrEqual(2048);
      expect(patch.y + patch.height).toBeLessThanOrEqual(2048);
      expect(patch.sourceX + patch.width).toBeLessThanOrEqual(1440);
      expect(patch.sourceY + patch.height).toBeLessThanOrEqual(1080);
    }
    expect(() => lightsaberHeadTransforms(0)).toThrow();
  });
});
