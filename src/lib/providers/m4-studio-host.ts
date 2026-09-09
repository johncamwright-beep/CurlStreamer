// Windows Studio main process only. Pairing remains in this process's private memory.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { dirname, isAbsolute, join } from "node:path";
import type { M4DesktopClient } from "./m4-desktop-client";
import { runM4StudioOutput } from "./m4-studio-output";

/** Launch a pinned native child only after pairing. The child creates the private
 * named pipe and sends its bootstrap on stdout. Arguments contain public paths
 * and our PID only; no authority credential is transferred between processes.
 * Current native host deliberately uses the default-deny service and cannot stream.
 */
export async function runM4StudioHost(
  desktop: M4DesktopClient,
  intentId: string,
  paths: { executable: string; plugin: string; runtime: string },
  signal: AbortSignal,
) {
  const fail = () => new Error("m4_studio_host_unavailable");
  const rejectStartup = async (): Promise<never> => {
    await desktop.stop().catch(() => undefined);
    throw fail();
  };
  if (
    process.platform !== "win32" ||
    Object.values(paths).some(
      (path) => !/^[A-Za-z]:[\\/]/.test(path) || path.includes("\0"),
    )
  )
    return rejectStartup();
  if (!desktop.snapshot().authorized || signal.aborted) {
    await desktop.stop().catch(() => undefined);
    throw fail();
  }
  const lifetime = new AbortController();
  const root = process.env.SystemRoot;
  if (!root || !isAbsolute(root)) return rejectStartup();
  let child: ChildProcessByStdio<null, Readable, null>;
  try {
    child = spawn(
      paths.executable,
      [
        "--parent-pid",
        String(process.pid),
        "--plugin",
        paths.plugin,
        "--runtime",
        paths.runtime,
      ],
      {
        windowsHide: true,
        shell: false,
        cwd: dirname(paths.executable),
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          SystemRoot: root,
          PATH: `${paths.runtime};${join(root, "System32")}`,
          NODE_ENV: "production",
        },
      },
    );
  } catch {
    return rejectStartup();
  }
  let exited = false;
  const complete = new Promise<void>((resolve) => {
    child.once("error", () => {
      lifetime.abort();
      resolve();
    });
    child.once("exit", () => {
      exited = true;
      lifetime.abort();
      resolve();
    });
  });
  let failed = false;
  try {
    await runM4StudioOutput(
      desktop,
      intentId,
      child.stdout,
      AbortSignal.any([signal, lifetime.signal]),
    );
    if (lifetime.signal.aborted && !signal.aborted) failed = true;
  } catch {
    failed = true;
  } finally {
    // The pipe is closed by runM4StudioOutput before terminating only our child.
    // Native host also monitors this parent independently for abrupt crashes.
    if (!exited) child.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const closed = await Promise.race([
      complete.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 3000);
      }),
    ]);
    clearTimeout(timer);
    if (!closed) failed = true;
  }
  if (failed) throw fail();
}
