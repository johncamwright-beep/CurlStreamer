import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceCard } from "./StudioDeviceCards";
import {
  cameraInputNativeAction,
  cameraInputNativeConnection,
} from "./StudioCameraInputs";
import type { StudioCameraInput } from "./StudioCameraInputs";

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
  cameraInputNativeAction: vi.fn(),
}));

function fixture({
  connectionEnabled = false,
  shown = true,
  videoReceiving = false,
  phase = "idle",
  kind = "tapo",
}: Partial<StudioCameraInput> & {
  shown?: boolean;
  videoReceiving?: boolean;
} = {}) {
  const onVisibility = vi.fn(async () => {});
  const tree = DeviceCard({
    id: "game-1",
    role: "camera-home",
    label: "Camera 1",
    enabled: true,
    claimed: false,
    cameraInput: {
      kind,
      configured: true,
      phase,
      generation: 1,
      connectionEnabled,
    },
    shown,
    connectionStatus: {
      receiverReady: true,
      phoneOnline: false,
      videoReceiving,
    },
    onVisibility,
  });
  type ButtonProps = {
    children?: ReactNode;
    className?: string;
    onClick?: () => Promise<void>;
    "aria-pressed"?: boolean;
  };
  function find(
    node: ReactNode,
    className: string,
  ): ReactElement<ButtonProps> | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const button = find(child, className);
        if (button) return button;
      }
    } else if (React.isValidElement<ButtonProps>(node)) {
      if (node.type === "button" && node.props.className?.includes(className))
        return node;
      return find(node.props.children, className);
    }
    return undefined;
  }
  const connection = find(tree, "studio-device-connection")?.props;
  const visibility = find(tree, "studio-device-visibility")?.props;
  if (!connection?.onClick || !visibility?.onClick)
    throw Error("missing camera controls");
  return { connection, visibility, onVisibility };
}

beforeEach(() => vi.clearAllMocks());

describe("IP source connection and picture actions", () => {
  it("connects a saved native source from an unassigned slot without opening Settings", async () => {
    vi.mocked(cameraInputNativeConnection).mockResolvedValue(true);
    const f = fixture({ kind: "phone" });
    await f.connection.onClick?.();
    expect(cameraInputNativeConnection).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    expect(cameraInputNativeAction).not.toHaveBeenCalled();
    expect(f.onVisibility).not.toHaveBeenCalled();
  });
  it("leaves a hidden camera hidden when connection fails", async () => {
    vi.mocked(cameraInputNativeConnection).mockRejectedValue(
      new Error("offline"),
    );
    const f = fixture({ shown: false });
    await f.connection.onClick?.();
    expect(cameraInputNativeAction).not.toHaveBeenCalled();
    expect(f.onVisibility).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "connects without changing the saved picture visibility (shown=%s)",
    async (shown) => {
      vi.mocked(cameraInputNativeConnection).mockResolvedValue(true);
      const f = fixture({ shown });
      expect(f.connection.children).toBe("Connect");
      await f.connection.onClick?.();
      expect(cameraInputNativeConnection).toHaveBeenCalledWith(
        "game-1",
        "camera-home",
        "connect-camera",
      );
      expect(f.onVisibility).not.toHaveBeenCalled();
    },
  );

  it.each(["connecting", "retrying", "streaming", "failed"])(
    "disconnects without changing picture visibility while %s",
    async (phase) => {
      vi.mocked(cameraInputNativeConnection).mockResolvedValue(false);
      const f = fixture({
        connectionEnabled: true,
        phase,
        videoReceiving: phase === "streaming",
      });
      expect(f.connection.children).toBe("Disconnect");
      await f.connection.onClick?.();
      expect(cameraInputNativeConnection).toHaveBeenCalledWith(
        "game-1",
        "camera-home",
        "disconnect-camera",
      );
      expect(cameraInputNativeAction).not.toHaveBeenCalled();
      expect(f.onVisibility).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "changes only picture visibility for an explicitly connected source (shown=%s)",
    async (shown) => {
      const f = fixture({ connectionEnabled: true, shown });
      expect(f.visibility["aria-pressed"]).toBe(shown);
      await f.visibility.onClick?.();
      expect(f.onVisibility).toHaveBeenCalledTimes(1);
      expect(cameraInputNativeConnection).not.toHaveBeenCalled();
    },
  );
});
