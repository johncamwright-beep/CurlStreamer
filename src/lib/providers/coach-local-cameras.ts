import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createM4IpCameraManager } from "./m4-ip-camera";

/** Standalone local proof: existing protected settings stay on private process pipes. */
export async function startCoachLocalCameras(runtime: string) {
  const manager = createM4IpCameraManager({
    runtimePath: runtime,
    helperPath: resolve(runtime, "../../../native/m4_ip_camera.exe"),
  });
  try {
    const result = await promisify(execFile)(
      `${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe`,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        await readFile(resolve("scripts/coach-camera-settings.ps1"), "utf8"),
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 32768 },
    );
    const inputs = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    for (const role of ["camera-home", "camera-away"] as const) {
      if (inputs[role]?.kind === "tapo" || inputs[role]?.kind === "rtsp") {
        manager.configure(role, inputs[role]);
        manager.connect(role);
      }
    }
    await manager.start();
    return manager;
  } catch {
    await manager.close();
    throw Error("Could not load the saved local camera settings");
  }
}
