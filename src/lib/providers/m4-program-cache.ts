// Node-only recovery of private CEF runs after their native process group exits.
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

const owner = z
  .object({
    schema: z.literal("m4-cef-owner-v1"),
    pid: z.number().int().positive().max(0xffffffff),
    jobBound: z.literal(true),
  })
  .strict();
const runName = /^curlstreamer-m4-cef-[a-f0-9]{32}$/;
function alive(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? false
      : undefined;
  }
}
async function plainTree(directory: string) {
  const pending = [directory];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++count > 10000 || entry.isSymbolicLink()) return false;
      const child = join(current, entry.name);
      const stat = await lstat(child);
      if (stat.isSymbolicLink()) return false;
      if (stat.isDirectory()) pending.push(child);
      else if (!stat.isFile()) return false;
    }
  }
  return true;
}
/** Unknown owners, old caches, live/reused PIDs and links are retained. Never
 * interprets a failed signal/permission probe as evidence of process death. */
export async function recoverM4ProgramCaches(
  root: string,
  isAlive: (pid: number) => boolean | undefined = alive,
) {
  const totals = { removed: 0, retained: 0 };
  const absolute = resolve(root);
  if (
    process.platform !== "win32" ||
    !/^[A-Za-z]:[\\/]/.test(absolute) ||
    dirname(absolute) === absolute
  )
    throw new Error("m4_cache_recovery_unavailable");
  if (
    (await lstat(absolute)).isSymbolicLink() ||
    (await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()
  )
    throw new Error("m4_cache_recovery_unavailable");
  for (const name of (await readdir(absolute)).filter((name) =>
    runName.test(name),
  )) {
    const directory = resolve(absolute, name);
    try {
      if (dirname(directory) !== absolute || !runName.test(basename(directory)))
        throw new Error();
      const stat = await lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(directory)).toLowerCase() !== directory.toLowerCase()
      )
        throw new Error();
      const marker = join(directory, ".m4-owner.json");
      const markerStat = await lstat(marker);
      if (
        !markerStat.isFile() ||
        markerStat.isSymbolicLink() ||
        markerStat.size > 1024
      )
        throw new Error();
      const file = await open(marker, "r");
      let identity: z.infer<typeof owner>;
      const bytes = Buffer.alloc(1025);
      try {
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 1024) throw new Error();
        identity = owner.parse(
          JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")),
        );
      } finally {
        await file.close();
        bytes.fill(0);
      }
      if (
        isAlive(identity.pid) !== false ||
        !(await plainTree(directory)) ||
        isAlive(identity.pid) !== false
      )
        throw new Error();
      // Native creates each run once and confines all descendants to its
      // kill-on-close job. No live owner can adopt an existing cache directory.
      await rm(directory, { recursive: true, force: false, maxRetries: 2 });
      ++totals.removed;
    } catch {
      ++totals.retained;
    }
  }
  return totals;
}
