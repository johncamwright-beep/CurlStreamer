import { describe, expect, it, vi } from "vitest";
import { CameraPageOwner, cameraPageOwnerKey } from "./camera-page-owner";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
    removeItem: vi.fn((key: string) => void values.delete(key)),
  };
  const target = new EventTarget();
  const key = cameraPageOwnerKey("game", "camera-home");
  const firstLost = vi.fn(),
    secondLost = vi.fn();
  const first = new CameraPageOwner({
    key,
    storage,
    target,
    ownerId: "first-page",
    onLost: firstLost,
  });
  const second = new CameraPageOwner({
    key,
    storage,
    target,
    ownerId: "second-page",
    onLost: secondLost,
  });
  function change(changedKey: string | null = key) {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: changedKey });
    target.dispatchEvent(event);
  }
  return {
    values,
    storage,
    target,
    key,
    first,
    second,
    firstLost,
    secondLost,
    change,
  };
}

describe("local camera page ownership", () => {
  it("lets the latest deliberate Connect replace the previous page", () => {
    const f = fixture();
    expect(f.first.acquire()).toBe(true);
    expect(f.second.held()).toBe(false);
    expect(f.second.acquire()).toBe(true);
    f.change();
    expect(f.firstLost).toHaveBeenCalledOnce();
    expect(f.first.held()).toBe(false);
    expect(f.second.held()).toBe(true);
    f.change();
    expect(f.firstLost).toHaveBeenCalledOnce();
  });

  it("does not let an old release or close clear the new owner", () => {
    const f = fixture();
    f.first.acquire();
    f.second.acquire();
    f.first.release();
    f.first.close();
    expect(f.values.get(f.key)).toBe("second-page");
    expect(f.second.held()).toBe(true);
    f.second.release();
    expect(f.values.get(f.key)).toBe("second-page");
    expect(f.second.held()).toBe(false);
    expect(f.secondLost).not.toHaveBeenCalled();
    expect(f.storage.removeItem).not.toHaveBeenCalled();
  });

  it("retires locally without reading or mutating shared storage", () => {
    const f = fixture();
    f.first.acquire();
    f.storage.getItem.mockClear();
    f.storage.setItem.mockClear();
    f.first.release();
    f.first.close();
    expect(f.first.held()).toBe(false);
    expect(f.storage.getItem).not.toHaveBeenCalled();
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.storage.removeItem).not.toHaveBeenCalled();
    expect(f.values.get(f.key)).toBe("first-page");
    expect(f.second.acquire()).toBe(true);
    expect(f.values.get(f.key)).toBe("second-page");
    expect(f.second.held()).toBe(true);
  });

  it("preserves ownership through retry checks without claiming again", () => {
    const f = fixture();
    f.first.acquire();
    expect(f.first.held()).toBe(true);
    expect(f.first.held()).toBe(true);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
    f.second.acquire();
    // No storage event is required for a request/retry to notice replacement.
    expect(f.first.held()).toBe(false);
    expect(f.firstLost).toHaveBeenCalledOnce();
    expect(f.first.held()).toBe(false);
    expect(f.values.get(f.key)).toBe("second-page");
  });

  it("stops the owner when storage is cleared and ignores other keys", () => {
    const f = fixture();
    f.first.acquire();
    f.values.clear();
    f.change("another-camera");
    expect(f.firstLost).not.toHaveBeenCalled();
    f.change(null);
    expect(f.firstLost).toHaveBeenCalledOnce();
    expect(f.first.held()).toBe(false);
  });

  it("reads the latest marker instead of trusting a delayed storage event", () => {
    const f = fixture();
    f.first.acquire();
    f.second.acquire();
    f.first.acquire();
    f.change();
    expect(f.first.held()).toBe(true);
    expect(f.firstLost).not.toHaveBeenCalled();
    expect(f.secondLost).toHaveBeenCalledOnce();
  });

  it("fails closed when storage cannot be written or read", () => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce(() => {
      throw Error("storage unavailable");
    });
    expect(f.first.acquire()).toBe(false);
    expect(f.first.held()).toBe(false);
    f.first.acquire();
    f.storage.getItem.mockImplementationOnce(() => {
      throw Error("storage unavailable");
    });
    expect(f.first.held()).toBe(false);
    expect(f.firstLost).toHaveBeenCalledOnce();
  });

  it("removes its listener on close and cannot reclaim after close", () => {
    const f = fixture();
    const remove = vi.spyOn(f.target, "removeEventListener");
    f.first.acquire();
    f.first.close();
    f.first.close();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.first.acquire()).toBe(false);
    expect(f.first.held()).toBe(false);
    f.change(null);
    expect(f.firstLost).not.toHaveBeenCalled();
  });

  it("scopes markers to both game and camera role without separator collisions", () => {
    expect(cameraPageOwnerKey("game", "camera-home")).not.toBe(
      cameraPageOwnerKey("game", "camera-away"),
    );
    expect(cameraPageOwnerKey("first", "camera-home")).not.toBe(
      cameraPageOwnerKey("second", "camera-home"),
    );
    expect(cameraPageOwnerKey("a:b", "c")).not.toBe(
      cameraPageOwnerKey("a", "b:c"),
    );
  });
});
