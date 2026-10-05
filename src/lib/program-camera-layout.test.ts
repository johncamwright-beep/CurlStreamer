import { describe, expect, it } from "vitest";
import {
  cameraAspect,
  programCameraLayout,
  retainedCameraAspect,
} from "./program-camera-layout";

describe("full-frame program geometry", () => {
  it("accepts only decoded positive dimensions", () => {
    expect(cameraAspect(1920, 1080)).toBe(16 / 9);
    expect(cameraAspect(0, 1080)).toBeUndefined();
    expect(cameraAspect(Infinity, 1080)).toBeUndefined();
  });
  it.each([
    [9 / 16, 9 / 16],
    [16 / 9, 16 / 9],
    [9 / 16, 16 / 9],
    [16 / 9, 9 / 16],
    [4 / 3, 16 / 9],
    [16 / 9],
    [9 / 16],
    [],
  ])("bounds every frame for aspects %j", (...aspects) => {
    const layout = programCameraLayout(aspects);
    for (const cell of layout.cells) {
      expect(parseFloat(cell.left)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(cell.top)).toBeGreaterThanOrEqual(0);
      expect(
        parseFloat(cell.left) + parseFloat(cell.width),
      ).toBeLessThanOrEqual(100.00001);
      expect(
        parseFloat(cell.top) + parseFloat(cell.height),
      ).toBeLessThanOrEqual(100.00001);
    }
  });
  it("stacks widescreen frames and keeps portrait frames in columns", () => {
    expect(programCameraLayout([16 / 9, 16 / 9]).mode).toBe("stacked");
    expect(programCameraLayout([9 / 16, 16 / 9]).mode).toBe("columns");
    expect(programCameraLayout([9 / 16, 9 / 16]).mode).toBe("columns");
    expect(programCameraLayout([16 / 9]).mode).toBe("single");
    expect(programCameraLayout([]).mode).toBe("none");
  });
  it("fills the complete program height with touching widescreen feeds", () => {
    const layout = programCameraLayout([16 / 9, 16 / 9]);
    expect(layout.deckFraction).toBe(0.5);
    expect(layout.cells).toEqual([
      { left: "0%", top: "0%", width: "100%", height: "50%" },
      { left: "0%", top: "50%", width: "100%", height: "50%" },
    ]);
  });
  it("gives portrait feeds the full height and only the width they need", () => {
    const layout = programCameraLayout([9 / 16, 9 / 16]);
    expect(layout.deckFraction).toBe(0.6328125);
    expect(layout.cells).toEqual([
      { left: "0%", top: "0%", width: "50%", height: "100%" },
      { left: "50%", top: "0%", width: "50%", height: "100%" },
    ]);
  });
  it("maximizes mixed feed width while retaining a full-height portrait", () => {
    const layout = programCameraLayout([9 / 16, 16 / 9]);
    expect(layout.deckFraction).toBe(0.7);
    expect(parseFloat(layout.cells[0].height)).toBe(100);
    expect(parseFloat(layout.cells[1].height)).toBeGreaterThan(38);
    expect(parseFloat(layout.cells[1].left)).toBeCloseTo(
      parseFloat(layout.cells[0].width),
    );
  });
});

describe("camera shape across reconnects", () => {
  it.each([9 / 16, 4 / 3, 16 / 9])(
    "preserves measured aspect %s when the same source temporarily loses media",
    (aspect) => {
      expect(
        retainedCameraAspect(
          { aspect, sourceIdentity: "rtsp:4" },
          { sourceIdentity: "rtsp:4" },
        ),
      ).toBe(aspect);
    },
  );
  it("resets dimensions on a generation or source kind switch", () => {
    const previous = { aspect: 9 / 16, sourceIdentity: "rtsp:4" };
    expect(
      retainedCameraAspect(previous, { sourceIdentity: "rtsp:5" }),
    ).toBeUndefined();
    expect(
      retainedCameraAspect(previous, { sourceIdentity: "phone:4" }),
    ).toBeUndefined();
    expect(
      retainedCameraAspect(previous, { sourceIdentity: "tapo:4" }),
    ).toBeUndefined();
  });
  it("accepts updated decoded dimensions from the same camera", () => {
    expect(
      retainedCameraAspect(
        { aspect: 9 / 16, sourceIdentity: "rtsp:4" },
        { aspect: 4 / 3, sourceIdentity: "rtsp:4" },
      ),
    ).toBe(4 / 3);
  });
});
