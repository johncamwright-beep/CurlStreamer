export interface M4RendererHeartbeat {
  action: "renderer-heartbeat";
  instance: string;
  frames: number;
  visibility: "visible" | "hidden";
}

/** Public document epoch; the HttpOnly cookie remains the transport authority. */
export function m4RendererInstance() {
  return document.querySelector<HTMLMetaElement>(
    'meta[name="m4-renderer-instance"]',
  )?.content;
}

/** Paint progress has its own lifetime, independent of cameras and game reads. */
export function startM4RendererHeartbeat(
  send: (body: M4RendererHeartbeat, signal: AbortSignal) => Promise<unknown>,
) {
  const instance =
    document.querySelector<HTMLMetaElement>('meta[name="m4-renderer-instance"]')
      ?.content ?? crypto.randomUUID();
  const marker = document.createElement("div");
  marker.setAttribute("aria-hidden", "true");
  marker.style.cssText =
    "position:fixed;right:0;bottom:0;width:12px;height:12px;z-index:2147483647;pointer-events:none";
  marker.style.backgroundColor = "rgb(8, 8, 8)";
  document.body.appendChild(marker);
  let markerAt: number | undefined;
  let markerBright = false;
  let frames = 0;
  let stopped = false;
  let frame: number;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let attempt: AbortController | undefined;
  const advance = (at: number) => {
    if (stopped) return;
    markerAt ??= at;
    if (at - markerAt >= 500) {
      markerAt = at;
      markerBright = !markerBright;
      marker.style.backgroundColor = markerBright
        ? "rgb(40, 40, 40)"
        : "rgb(8, 8, 8)";
    }
    frames = Math.min(Number.MAX_SAFE_INTEGER, frames + 1);
    frame = requestAnimationFrame(advance);
  };
  frame = requestAnimationFrame(advance);
  const poll = async () => {
    attempt = new AbortController();
    deadline = setTimeout(() => attempt?.abort(), 2000);
    try {
      await send(
        {
          action: "renderer-heartbeat",
          instance,
          frames,
          visibility:
            document.visibilityState === "visible" ? "visible" : "hidden",
        },
        attempt.signal,
      );
    } catch {
      // A lost heartbeat cannot stop the program or its next health report.
    } finally {
      clearTimeout(deadline);
      deadline = undefined;
      attempt = undefined;
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    }
  };
  void poll();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    marker.remove();
    clearTimeout(timer);
    clearTimeout(deadline);
    attempt?.abort();
  };
}
