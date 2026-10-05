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
  const deckFraction = !ratios.length
    ? 0
    : mode === "stacked"
      ? 0.51
      : ratios.length === 1 && ratios[0] > 1
        ? 0.7
        : 0.638;
  // The 3% inset preserves the 16:9 canvas ratio. The gap is 0.8% of canvas width.
  const width = (16 / 9 - (0.008 * (16 / 9)) / 0.94) * deckFraction;
  const gap = (0.008 * (16 / 9)) / 0.94;
  let offset = 0;
  const cells = ratios.map((ratio, index) => {
    const cellHeight = mode === "stacked" ? (1 - gap) / 2 : 1;
    const cellWidth =
      mode === "columns"
        ? ratios.every((r) => r <= 1)
          ? (width - gap) / 2
          : ratio <= 1
            ? Math.min(ratio, (width - gap) / 2)
            : width -
              gap -
              Math.min(
                ratios.find((r) => r <= 1)!,
                (width - gap) / 2,
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
        ? index * (cellHeight + gap) + (cellHeight - height) / 2
        : (1 - height) / 2;
    offset += cellWidth + gap;
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
