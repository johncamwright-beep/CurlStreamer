import { describe, it, expect } from "vitest";
import {
  localHealthSchema,
  localTroubleshooting,
  retainTroubleshooting,
  troubleshootingExport,
} from "./studio-troubleshooting";
const game = "00000000-0000-4000-8000-000000000001";
const camera = {
  kind: "tapo",
  host: "192.168.1.2",
  stream: "stream1",
  rotation: 0,
  configured: true,
  connectionEnabled: true,
  phase: "streaming",
  errorCode: null,
  generation: 1,
  zoom: 1,
};
const sample = (at = 2000) =>
  localTroubleshooting(
    localHealthSchema.parse({
      gameId: game,
      capturedAt: at,
      cameras: { "camera-home": camera, "camera-away": camera },
      nativeHealth: null,
    }),
  );
describe("local troubleshooting", () => {
  it("leaves unavailable measurements unknown rather than inventing zero", () => {
    const result = sample();
    expect(result.output.active).toBeNull();
    expect(result.cameras[0].receivedKbps).toBeNull();
    expect(result.cameras[0].transport).toBeNull();
    expect(result.network.interference).toBeNull();
  });
  it("bounds history to ten minutes and ignores old/over-frequent samples", () => {
    let history = [sample()];
    for (let i = 2; i < 1000; i++)
      history = retainTroubleshooting(history, sample(i * 2000));
    expect(history).toHaveLength(300);
    expect(retainTroubleshooting(history, sample())).toBe(history);
    expect(retainTroubleshooting(history, sample(1998001))).toBe(history);
  });
  it("resets history for another game and strips unknown fields from exports", () => {
    const first = sample();
    const next = {
      ...sample(4000),
      gameId: "00000000-0000-4000-8000-000000000002",
      token: "private",
    };
    expect(retainTroubleshooting([first], next)).toEqual([next]);
    const exportText = troubleshootingExport([first, next]);
    expect(exportText).not.toContain("private");
    expect(exportText).not.toContain("192.168");
    expect(JSON.parse(exportText).samples).toHaveLength(1);
  });
});
