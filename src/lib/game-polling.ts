import type { RefreshLifecycle } from "./game-refresh-gate";

/** Reduce idle database traffic without slowing a live program or camera. */
export function gamePollDelay({
  lifecycle,
  error,
  hidden,
  keepLiveWhenHidden,
  noticeConnected = false,
}: {
  lifecycle?: RefreshLifecycle;
  error: string;
  hidden: boolean;
  keepLiveWhenHidden: boolean;
  noticeConnected?: boolean;
}) {
  if (lifecycle && lifecycle !== "active") return 30_000;
  if (error) return 10_000;
  if (hidden && !keepLiveWhenHidden) return 15_000;
  return noticeConnected ? 10_000 : 2_000;
}
