import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { readM4StudioBootstrap } from "./m4-studio-bootstrap";
import { M4NativePipeClient } from "./m4-native-pipe";

/** No pairing, target or ARM. Exercises the native channel with unarmed STOP. */
export async function checkM4NativeHost(paths: {
  executable: string;
  plugin: string;
  runtime: string;
}) {
  const fail = () => new Error("m4_native_preflight_unavailable");
  if (
    process.platform !== "win32" ||
    !process.env.SystemRoot ||
    Object.values(paths).some(
      (value) => !/^[A-Za-z]:[\\/]/.test(value) || value.includes("\0"),
    )
  )
    throw fail();
  let child;
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
        cwd: dirname(paths.executable),
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: `${paths.runtime};${process.env.SystemRoot}\\System32`,
          NODE_ENV: "production",
        },
      },
    );
  } catch {
    throw fail();
  }
  let exited = false;
  const complete = new Promise<void>((resolve) => {
    child.once("error", () => resolve());
    child.once("exit", () => {
      exited = true;
      resolve();
    });
  });
  let capability: Buffer | undefined;
  let native: M4NativePipeClient | undefined;
  let failed = false;
  try {
    const bootstrap = await readM4StudioBootstrap(child.stdout);
    capability = bootstrap.capability;
    native = await M4NativePipeClient.connect(bootstrap.pipe, capability);
    capability.fill(0);
    await native.stop();
  } catch {
    failed = true;
  } finally {
    capability?.fill(0);
    native?.disconnect();
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
