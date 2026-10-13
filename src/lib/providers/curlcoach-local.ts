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
  currentShots,
  setLineup,
  type LineupCommand,
  emptyState,
  stateSchema,
  type Command,
  type State,
} from "@/lib/curlcoach/model";
import { labEnabled } from "@/lib/curlcoach/access";
import {
  documentWriteSchema,
  supplementConflicts,
  type DocumentWrite,
  type EnhancedDocument,
} from "./shot-tracker-enhanced";
import {
  standardConflicts,
  validateShotReferences,
  type Supplement,
} from "@/lib/curlcoach/enhanced-catalog";

function paths(initial = emptyState()) {
  if (!labEnabled()) throw new Error("Shot Tracker local lab unavailable");
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
    const stored = JSON.parse(readFileSync(file, "utf8"));
    const state = stateSchema.parse(stored.state ?? stored);
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
    writeFileSync(
      `${file}.tmp`,
      JSON.stringify({ ...readEnvelope(initial), state }),
      { mode: 0o600 },
    );
    renameSync(`${file}.tmp`, file);
    return state;
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}

export function writeCoachLineup(
  command: LineupCommand,
  initial = emptyState(),
  actor = "synthetic-coach",
) {
  const { directory, file, lock } = paths(initial);
  mkdirSync(directory, { recursive: true });
  const handle = openSync(lock, "wx");
  try {
    const state = setLineup(readCoachState(initial), command, actor);
    writeFileSync(
      `${file}.tmp`,
      JSON.stringify({ ...readEnvelope(initial), state }),
      { mode: 0o600 },
    );
    renameSync(`${file}.tmp`, file);
    return state;
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}

type LocalEnvelope = {
  state: State;
  documents: (EnhancedDocument & {
    input: DocumentWrite;
    actor: string;
    command?: Command;
    resultState?: State;
  })[];
};
function readEnvelope(initial: State): LocalEnvelope {
  const { file } = paths(initial);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw.state ? raw : { state: stateSchema.parse(raw), documents: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { state: initial, documents: [] };
    throw error;
  }
}
export function readLocalEnhanced(initial: State, actor = "synthetic-coach") {
  const envelope = readEnvelope(initial);
  const latest = new Map<string, EnhancedDocument>();
  for (const d of envelope.documents.filter((d) => d.actor === actor))
    latest.set(`${d.kind}:${d.shotId ?? ""}`, {
      kind: d.kind,
      shotId: d.shotId,
      revision: d.revision,
      sourceRevision: d.sourceRevision,
      value: d.value,
      at: d.at,
      conflicts: supplementConflicts(d, envelope.state),
    });
  return [...latest.values()];
}
/** Lab uses one atomic rename for both layers, never two independent files. */
export function writeLocalEnhanced(
  initial: State,
  input: DocumentWrite,
  actor = "synthetic-coach",
  command?: Command,
) {
  const write = documentWriteSchema.parse(input);
  const { directory, file, lock } = paths(initial);
  mkdirSync(directory, { recursive: true });
  const handle = openSync(lock, "wx");
  try {
    const envelope = readEnvelope(initial);
    const previous = envelope.documents.find(
      (d) => d.input.requestId === write.requestId,
    );
    if (previous) {
      if (
        previous.actor !== actor ||
        JSON.stringify(previous.input) !== JSON.stringify(write) ||
        JSON.stringify(previous.command) !== JSON.stringify(command)
      )
        throw new Error("Request ID already used");
      return { ...previous, state: previous.resultState ?? null };
    }
    const latest = envelope.documents
      .filter(
        (d) =>
          d.actor === actor &&
          d.kind === write.kind &&
          d.shotId === write.shotId,
      )
      .at(-1);
    if ((latest?.revision ?? 0) !== write.expectedRevision)
      throw new Error("Enhanced revision conflict");
    if (command) {
      if (
        command.requestId !== write.requestId ||
        command.shotId !== write.shotId ||
        write.kind !== "supplement" ||
        !command.shot ||
        envelope.state.events.some((e) => e.requestId === command.requestId)
      )
        throw new Error("Invalid combined request");
      envelope.state = append(envelope.state, command, actor);
    }
    if (write.kind === "supplement") {
      const source = envelope.state.events
        .filter((e) => e.shotId === write.shotId)
        .at(-1);
      if (!source?.shot || source.revision !== write.sourceRevision)
        throw new Error("Source shot revision conflict");
      validateShotReferences(
        write.value as Supplement,
        write.shotId!,
        currentShots(envelope.state.events),
      );
      if (
        latest &&
        supplementConflicts(latest, envelope.state).some((c) =>
          c.startsWith("source "),
        ) &&
        !String(
          (write.value as Supplement).values.sourceReconciliation ?? "",
        ).trim()
      )
        throw new Error("Explicit source identity reconciliation required");
      if (standardConflicts(write.value as Supplement, source.shot).length)
        throw new Error("Review Standard observations before assessing them.");
    }
    const value =
      write.kind === "supplement"
        ? {
            ...(write.value as Supplement),
            retrospective:
              !command ||
              envelope.state.events.some(
                (e) =>
                  e.shotId === write.shotId &&
                  e.revision < write.sourceRevision,
              ),
          }
        : write.value;
    const doc = {
      kind: write.kind,
      shotId: write.shotId,
      value,
      revision: write.expectedRevision + 1,
      sourceRevision: write.sourceRevision,
      at: new Date().toISOString(),
      input: write,
      actor,
      command,
      resultState: command ? envelope.state : undefined,
    };
    envelope.documents.push(doc);
    writeFileSync(`${file}.tmp`, JSON.stringify(envelope), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return { ...doc, state: command ? envelope.state : null };
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}
