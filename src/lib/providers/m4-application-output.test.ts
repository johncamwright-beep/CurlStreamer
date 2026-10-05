import { expect, it, vi } from "vitest";
import { M4ApplicationOutput } from "./m4-application-output";
import { M4DesktopClient } from "./m4-desktop-client";

it("records cloud stop only after independent native stopped observation", async () => {
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.example",
  );
  const cloudStop = vi
    .spyOn(desktop, "stop")
    .mockResolvedValue({ state: "stopped", authorized: false });
  let finishStop!: () => void,
    finishObservation!: (value: {
      state: "stopped";
      authority: 2;
      bytes: number;
      failure: "none";
    }) => void;
  const native = {
    arm: vi.fn(),
    renew: vi.fn(),
    snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
    stop: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    ),
    observe: vi.fn(
      () =>
        new Promise<{
          state: "stopped";
          authority: 2;
          bytes: number;
          failure: "none";
        }>((resolve) => {
          finishObservation = resolve;
        }),
    ),
  };
  const stopping = new M4ApplicationOutput(desktop, native).stop();
  expect(cloudStop).not.toHaveBeenCalled();
  finishStop();
  await Promise.resolve();
  expect(cloudStop).not.toHaveBeenCalled();
  finishObservation({
    state: "stopped",
    authority: 2,
    bytes: 1200,
    failure: "none",
  });
  await stopping;
  expect(cloudStop).toHaveBeenCalledOnce();
});

it("does not unlock provider cleanup after native stop failure", async () => {
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.example",
  );
  const cloudStop = vi.spyOn(desktop, "stop");
  const native = {
    arm: vi.fn(),
    renew: vi.fn(),
    snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
    stop: vi.fn().mockRejectedValue(new Error("native unavailable")),
    observe: vi.fn(),
  };
  await expect(new M4ApplicationOutput(desktop, native).stop()).rejects.toThrow(
    "m4_application_output_unavailable",
  );
  expect(cloudStop).not.toHaveBeenCalled();
});
