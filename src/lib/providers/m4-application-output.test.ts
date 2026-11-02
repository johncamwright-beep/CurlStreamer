import { afterEach, expect, it, vi } from "vitest";
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
    supportsObservations: true,
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
    supportsObservations: true,
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

it("uses the legacy Stop protocol when observations were explicitly not negotiated", async () => {
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.example",
  );
  const cloudStop = vi
    .spyOn(desktop, "stop")
    .mockResolvedValue({ state: "stopped", authorized: false });
  const native = {
    get supportsObservations() {
      return false;
    },
    arm: vi.fn(),
    renew: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    snapshot: () => ({ state: "stopped" as const, deliveryAttempted: true }),
    observe: vi.fn().mockRejectedValue(new Error("not negotiated")),
  };
  await new M4ApplicationOutput(desktop, native).stop();
  expect(native.stop).toHaveBeenCalledOnce();
  expect(cloudStop).toHaveBeenCalledOnce();
  expect(native.observe).not.toHaveBeenCalled();
});
it("does not unlock cloud cleanup when a capable peer has no observation method", async () => {
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.example",
  );
  const cloudStop = vi.spyOn(desktop, "stop");
  const native = {
    supportsObservations: true,
    arm: vi.fn(),
    renew: vi.fn(),
    stop: vi.fn(),
    snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
  };
  await expect(new M4ApplicationOutput(desktop, native).stop()).rejects.toThrow(
    "m4_application_output_unavailable",
  );
  expect(cloudStop).not.toHaveBeenCalled();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("renews locally between cloud checks, retries failures and stops on revocation", async () => {
  vi.useFakeTimers();
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.invalid",
  );
  vi.spyOn(desktop, "snapshot").mockReturnValue({
    state: "active",
    authorized: true,
  });
  const remaining = vi
    .spyOn(desktop, "remainingLeaseMs")
    .mockReturnValue(30000);
  vi.spyOn(desktop, "handoffOutput").mockResolvedValue({
    state: "active",
    authorized: true,
  });
  const heartbeat = vi
    .spyOn(desktop, "heartbeat")
    .mockResolvedValue({
      state: "active",
      authorized: true,
      desiredAction: "wait",
      leaseRenewed: true,
    });
  vi.spyOn(desktop, "stop").mockResolvedValue({
    state: "stopped",
    authorized: false,
  });
  const native = {
    arm: vi.fn(),
    renew: vi.fn(),
    stop: vi.fn(),
    snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
  };
  const output = new M4ApplicationOutput(desktop, native);
  await output.start("intent");
  await output.heartbeat();
  for (let i = 0; i < 2; i++) {
    await vi.advanceTimersByTimeAsync(5000);
    await output.heartbeat();
  }
  expect(heartbeat).toHaveBeenCalledTimes(1);
  expect(native.renew).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(5000);
  heartbeat.mockResolvedValueOnce({
    state: "active",
    authorized: true,
    desiredAction: "wait",
    leaseRenewed: false,
  });
  expect(await output.heartbeat()).toMatchObject({ leaseRenewed: false });
  await vi.advanceTimersByTimeAsync(1000);
  await output.heartbeat();
  expect(heartbeat).toHaveBeenCalledTimes(3);
  remaining.mockReturnValue(19000);
  heartbeat.mockResolvedValueOnce({
    state: "stopping",
    authorized: false,
    desiredAction: "stop",
    leaseRenewed: false,
  });
  await output.heartbeat();
  expect(heartbeat).toHaveBeenCalledTimes(4);
  expect(native.stop).toHaveBeenCalledOnce();
});
