import { describe, expect, it } from "vitest";
import { fitSponsorRectangle, sponsorFrameRectangle } from "./sponsor-fit";

describe("adaptive sponsor fitting", () => {
  const bounds = { width: 600, height: 700 };
  it.each([
    ["very wide", 4000, 500],
    ["landscape", 1600, 900],
    ["square", 1000, 1000],
    ["portrait", 900, 1600],
    ["extremely tall", 300, 3000],
  ])("fits %s artwork without distortion", (_name, width, height) => {
    const fitted = fitSponsorRectangle(
      width,
      height,
      bounds.width,
      bounds.height,
    );
    expect(fitted.width).toBeLessThanOrEqual(bounds.width);
    expect(fitted.height).toBeLessThanOrEqual(bounds.height);
    expect(fitted.width / fitted.height).toBeCloseTo(width / height, 6);
    expect(
      fitted.width === bounds.width || fitted.height === bounds.height,
    ).toBe(true);
  });

  it("uses full width when height fits and shrinks width when height limits", () => {
    expect(fitSponsorRectangle(1600, 900, 600, 700).width).toBe(600);
    const tall = fitSponsorRectangle(900, 1600, 600, 700);
    expect(tall.height).toBe(700);
    expect(tall.width).toBeCloseTo(393.75);
    expect(tall.height).toBeGreaterThan(370);
  });

  it("adds only defined frame padding and label treatment", () => {
    expect(sponsorFrameRectangle({ width: 400, height: 600 }, 14, 26)).toEqual({
      width: 428,
      height: 654,
    });
  });

  it("shrinks an overlay frame horizontally when height is limiting", () => {
    const image = fitSponsorRectangle(500, 2000, 900 - 28, 700 - 28);
    const frame = sponsorFrameRectangle(image, 14);
    expect(image).toEqual({ width: 168, height: 672 });
    expect(frame).toEqual({ width: 196, height: 700 });
    expect(frame.width).toBeLessThanOrEqual(900);
    expect(frame.height).toBeLessThanOrEqual(700);
  });
});
