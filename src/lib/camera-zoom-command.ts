export type CameraZoomCommand = {
  id: string;
  value: number;
  requestedAt: number;
};

/** Reject retained commands from a previous capture; only current director intent may move hardware. */
export function shouldApplyCameraZoomCommand(
  command: CameraZoomCommand | undefined,
  captureStartedAt: number,
  now = Date.now(),
) {
  return Boolean(
    command &&
    command.requestedAt >= captureStartedAt &&
    command.requestedAt <= now &&
    now - command.requestedAt <= 30_000,
  );
}
