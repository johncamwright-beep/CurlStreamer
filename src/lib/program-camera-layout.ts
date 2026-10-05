/** Frame geometry stays in the renderer; no source metadata enters game state. */
export const portraitCameraAspect = 9 / 16;
export const landscapeCameraAspect = 16 / 9;

export function cameraAspect(width: number, height: number) {
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? width / height
    : undefined;
}

export function programCameraLayout(aspects: number[]) {
  const ratios = aspects.map((value) =>
    Number.isFinite(value) && value > 0 ? value : portraitCameraAspect,
  );
  const mode = !ratios.length
    ? "none"
    : ratios.length === 1
      ? "single"
      : ratios.every((ratio) => ratio > 1)
        ? "stacked"
        : "columns";
  const canvasAspect = 16 / 9;
  // Keep at least 30% for the score/sponsor rail; cameras use the full height
  // wherever their complete frames fit. No outer inset or inter-camera gap.
  const deckFraction = !ratios.length
    ? 0
    : mode === "stacked"
      ? Math.min(0.7, Math.max(...ratios) / 2 / canvasAspect)
      : ratios.every((ratio) => ratio <= 1)
        ? Math.min(
            0.7,
            ratios.reduce((sum, ratio) => sum + ratio, 0) / canvasAspect,
          )
        : 0.7;
  const width = canvasAspect * deckFraction;
  let offset = 0;
  const cells = ratios.map((ratio, index) => {
    const cellHeight = mode === "stacked" ? 1 / 2 : 1;
    const cellWidth =
      mode === "columns"
        ? ratios.every((r) => r <= 1)
          ? (width * ratio) / ratios.reduce((sum, r) => sum + r, 0)
          : ratio <= 1
            ? Math.min(ratio, width / 2)
            : width -
              Math.min(
                ratios.find((r) => r <= 1)!,
                width / 2,
              )
        : width;
    const height = Math.min(cellHeight, cellWidth / ratio);
    const frameWidth = height * ratio;
    const left =
      mode === "columns"
        ? offset + (cellWidth - frameWidth) / 2
        : (width - frameWidth) / 2;
    const top =
      mode === "stacked"
        ? index * cellHeight + (cellHeight - height) / 2
        : (1 - height) / 2;
    offset += cellWidth;
    return {
      left: `${(left / width) * 100}%`,
      top: `${top * 100}%`,
      width: `${(frameWidth / width) * 100}%`,
      height: `${height * 100}%`,
    };
  });
  return { mode, deckFraction, cells };
}

/** A retry can drop media without changing which configured camera owns the slot. */
export function retainedCameraAspect(
  previous: { aspect?: number; sourceIdentity?: string },
  incoming: { aspect?: number; sourceIdentity?: string },
) {
  return (
    incoming.aspect ??
    (incoming.sourceIdentity !== undefined &&
    incoming.sourceIdentity === previous.sourceIdentity
      ? previous.aspect
      : undefined)
  );
}
