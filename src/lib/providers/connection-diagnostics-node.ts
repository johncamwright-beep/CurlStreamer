import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createConnectionDiagnostics } from "./connection-diagnostics";

export function createStudioConnectionDiagnostics(directory: string) {
  const path = join(directory, "connection-diagnostics.json");
  let initial: unknown = [];
  try {
    const saved = readFileSync(path);
    if (saved.length <= 262_144) initial = JSON.parse(saved.toString("utf8"));
  } catch {
    /* No trusted history. */
  }
  return createConnectionDiagnostics(
    "studio",
    randomUUID(),
    (rows) => writeFileSync(path, JSON.stringify(rows)),
    initial,
  ).record;
}
