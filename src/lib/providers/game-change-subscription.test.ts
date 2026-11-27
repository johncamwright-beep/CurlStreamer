import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  on: vi.fn(),
  subscribe: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const channel = { on: mock.on, subscribe: mock.subscribe };
    mock.on.mockReturnValue(channel);
    return { channel: () => channel, removeChannel: mock.remove };
  },
}));
import { subscribeGameChanges } from "./game-change-subscription";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("coalesces bursts with a trailing refresh and closes pending notices", () => {
  vi.useFakeTimers();
  const changed = vi.fn(),
    connected = vi.fn();
  const close = subscribeGameChanges(
    {
      url: "https://example.supabase.co",
      key: "public-key",
      topic: "game-change-" + "a".repeat(64),
    },
    changed,
    connected,
  );
  const notice = mock.on.mock.calls[0][2],
    status = mock.subscribe.mock.calls[0][0];
  status("SUBSCRIBED");
  expect(connected).toHaveBeenLastCalledWith(true);
  notice();
  notice();
  notice();
  expect(changed).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(changed).toHaveBeenCalledTimes(2);
  status("CHANNEL_ERROR");
  expect(connected).toHaveBeenLastCalledWith(false);
  notice();
  close();
  vi.advanceTimersByTime(1000);
  notice();
  status("SUBSCRIBED");
  expect(changed).toHaveBeenCalledTimes(2);
  expect(connected).toHaveBeenLastCalledWith(false);
  expect(mock.remove).toHaveBeenCalledTimes(1);
});
