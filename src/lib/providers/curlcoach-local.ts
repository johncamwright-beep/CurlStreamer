import "server-only";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  append,
  emptyState,
  stateSchema,
  type Command,
  type State,
} from "@/lib/curlcoach/model";
import { labEnabled } from "@/lib/curlcoach/access";

function paths(initial = emptyState()) {
  if (!labEnabled()) throw new Error("CurlCoach local lab unavailable");
  const root = resolve(process.cwd(), ".curlcoach-local");
  const directory = resolve(
    root,
    process.env.CURLCOACH_LAB_STORAGE ?? "practice",
  );
  if (!directory.startsWith(root + sep))
    throw new Error(
      "Storage must be inside this worktree's local lab directory",
    );
  const name =
    initial.gameId === "curlcoach-synthetic-game" &&
    initial.organizationId === "curlcoach-synthetic-org"
      ? "shot-events"
      : createHash("sha256")
          .update(`${initial.organizationId}:${initial.gameId}`)
          .digest("hex");
  return {
    directory,
    file: join(directory, `${name}.json`),
    lock: join(directory, `${name}.lock`),
  };
}
export function readCoachState(initial = emptyState()): State {
  const { file } = paths(initial);
  try {
    const state = stateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    if (
      state.organizationId !== initial.organizationId ||
      state.gameId !== initial.gameId
    )
      throw new Error("Stored scope mismatch");
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initial;
    throw error;
  }
}
export function writeCoachEvent(
  command: Command,
  initial = emptyState(),
  actor = "synthetic-coach",
) {
  const { directory, file, lock } = paths(initial);
  mkdirSync(directory, { recursive: true });
  const handle = openSync(lock, "wx");
  try {
    const state = append(readCoachState(initial), command, actor);
    writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return state;
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}
