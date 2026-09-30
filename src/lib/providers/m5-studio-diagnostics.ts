// Local, bounded lifecycle evidence. Never accept error messages, URLs, bodies,
// keys, device identifiers or arbitrary metadata into this journal.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const entry = z
  .object({
    at: z.iso.datetime(),
    event: z.enum([
      "controller_start",
      "controller_ready",
      "shutdown_requested",
      "shutdown_confirmed",
      "shutdown_unconfirmed",
      "start_failed",
      "fatal_exception",
      "fatal_rejection",
      "native_started",
      "native_exited",
      "native_spawn_failed",
    ]),
    reason: z
      .enum([
        "operator_close",
        "stdin_closed",
        "sigint",
        "sigterm",
        "startup_failed",
      ])
      .optional(),
    failure: z
      .enum([
        "EPIPE",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOENT",
        "ERR_STREAM_DESTROYED",
        "ERR_HTTP_HEADERS_SENT",
        "unknown",
      ])
      .optional(),
    exitCode: z
      .number()
      .int()
      .min(-2147483648)
      .max(4294967295)
      .nullable()
      .optional(),
  })
  .strict();
export type StudioDiagnostic = (
  event: z.infer<typeof entry>["event"],
  details?: Omit<z.infer<typeof entry>, "at" | "event">,
) => void;

export function studioFailureCode(
  cause: unknown,
): z.infer<typeof entry>["failure"] {
  try {
    const code = (cause as { code?: unknown })?.code;
    return entry.shape.failure.unwrap().parse(code);
  } catch {
    return "unknown";
  }
}

export function createStudioDiagnostics(directory: string): StudioDiagnostic {
  const path = join(directory, "controller-diagnostics.json");
  let rows: z.infer<typeof entry>[] = [];
  try {
    const saved = readFileSync(path);
    if (saved.length <= 65536)
      rows = z
        .array(entry)
        .max(64)
        .parse(JSON.parse(saved.toString("utf8")));
  } catch {
    /* Missing, invalid or oversized journals are not trusted. */
  }
  return (event, details = {}) => {
    try {
      const row = entry.parse({
        at: new Date().toISOString(),
        event,
        ...details,
      });
      rows = [...rows.slice(-63), row];
      writeFileSync(path, JSON.stringify(rows));
    } catch {
      /* Diagnostics must not change the runtime's failure behavior. */
    }
  };
}
