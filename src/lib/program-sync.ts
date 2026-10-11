/** A late microphone cannot be played before capture: hold the cameras instead. */
export function programSyncDelays(adjustmentMs: number | undefined) {
  const adjustment = Number.isFinite(adjustmentMs)
    ? Math.max(-5000, Math.min(5000, adjustmentMs!))
    : 0;
  return {
    microphoneDelayMs: Math.max(0, adjustment),
    cameraDelayMs: Math.max(0, -adjustment),
  };
}
