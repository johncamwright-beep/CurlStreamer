"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DashboardRefreshQueue,
  dashboardCompletionChannel,
  dashboardCompletionEvent,
  dashboardCompletionStorage,
  isCompletionNotice,
} from "@/lib/dashboard-refresh";

export function DashboardRefresh({
  organizationId,
}: {
  organizationId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const state = useRef({ pathname, pending });
  state.current = { pathname, pending };
  const queue = useRef<DashboardRefreshQueue | undefined>(undefined);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    const refresh = new DashboardRefreshQueue(
      () => startTransition(() => router.refresh()),
      () =>
        !document.hidden &&
        state.current.pathname === "/dashboard" &&
        !state.current.pending,
    );
    queue.current = refresh;
    const request = () => refresh.request();
    const onNotice = (event: Event) => {
      if (isCompletionNotice((event as CustomEvent).detail)) request();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== dashboardCompletionStorage || !event.newValue) return;
      try {
        if (isCompletionNotice(JSON.parse(event.newValue))) request();
      } catch {
        /* Ignore unrelated or malformed browser storage. */
      }
    };
    window.addEventListener("focus", request);
    window.addEventListener("pageshow", request);
    document.addEventListener("visibilitychange", request);
    window.addEventListener(dashboardCompletionEvent, onNotice);
    window.addEventListener("storage", onStorage);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(dashboardCompletionChannel);
      channel.onmessage = (event) => {
        if (isCompletionNotice(event.data)) request();
      };
    } catch {
      /* Return/focus and storage notices remain available. */
    }
    request();
    return () => {
      refresh.dispose();
      window.removeEventListener("focus", request);
      window.removeEventListener("pageshow", request);
      document.removeEventListener("visibilitychange", request);
      window.removeEventListener(dashboardCompletionEvent, onNotice);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [router, organizationId]);

  useEffect(() => {
    if (pathname === "/dashboard" && previousPathname.current !== pathname)
      queue.current?.request();
    else queue.current?.resume();
    previousPathname.current = pathname;
  }, [pathname, pending]);
  return null;
}
