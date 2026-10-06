import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceCard } from "./StudioDeviceCards";
import { cameraInputNativeConnection } from "./StudioCameraInputs";

// Exercise the returned button handlers in Node; DOM layout is covered by E2E.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("./StudioCameraInputs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./StudioCameraInputs")>()),
  cameraInputNativeConnection: vi.fn(),
}));

function primary(
  connectionEnabled: boolean,
  shown: boolean,
  onVisibility = vi.fn(async () => {}),
) {
  const tree = DeviceCard({
    id: "game-1",
    role: "camera-home",
    label: "Camera 1",
    enabled: true,
    claimed: false,
    cameraInput: {
      kind: "tapo",
      configured: true,
      phase: "idle",
      generation: 1,
      connectionEnabled,
    },
    shown,
    onVisibility,
  });
  type ButtonProps = {
    children?: ReactNode;
    className?: string;
    onClick?: () => Promise<void>;
  };
  function find(node: ReactNode): ReactElement<ButtonProps> | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const button = find(child);
        if (button) return button;
      }
    } else if (React.isValidElement<ButtonProps>(node)) {
      if (
        node.type === "button" &&
        node.props.className?.includes("studio-device-visibility")
      )
        return node;
      return find(node.props.children);
    }
    return undefined;
  }
  const button = find(tree);
  if (!button?.props.onClick) throw Error("missing source visibility button");
  return { click: button.props.onClick, onVisibility };
}

beforeEach(() => vi.clearAllMocks());

describe("IP source connection and picture actions", () => {
  it("connects an OFF source without hiding an already shown picture", async () => {
    vi.mocked(cameraInputNativeConnection).mockResolvedValue(true);
    const f = primary(false, true);
    await f.click();
    expect(cameraInputNativeConnection).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    expect(f.onVisibility).not.toHaveBeenCalled();
  });

  it("shows a hidden OFF source only after native connection intent is confirmed", async () => {
    let acknowledge!: (enabled: boolean) => void;
    vi.mocked(cameraInputNativeConnection).mockReturnValue(
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
    );
    const f = primary(false, false);
    const pending = f.click();
    expect(f.onVisibility).not.toHaveBeenCalled();
    acknowledge(true);
    await pending;
    expect(f.onVisibility).toHaveBeenCalledTimes(1);
  });

  it("leaves a hidden OFF source hidden when Studio rejects the connection", async () => {
    vi.mocked(cameraInputNativeConnection).mockRejectedValue(
      Error("Camera is unavailable."),
    );
    const f = primary(false, false);
    await f.click();
    expect(f.onVisibility).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "changes only picture visibility for an explicitly connected source (shown=%s)",
    async (shown) => {
      const f = primary(true, shown);
      await f.click();
      expect(f.onVisibility).toHaveBeenCalledTimes(1);
      expect(cameraInputNativeConnection).not.toHaveBeenCalled();
    },
  );
});
