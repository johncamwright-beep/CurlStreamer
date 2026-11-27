import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createStudioDiagnostics,
  studioFailureCode,
  type StudioDiagnostic,
} from "./m5-studio-diagnostics";

it("retains bounded lifecycle and exit evidence across restarts without private error data", () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-diagnostics-"));
  try {
    const log = createStudioDiagnostics(directory);
    for (let i = 0; i < 70; i++) log("controller_start");
    log("native_exited", { exitCode: -1073741819 });
    createStudioDiagnostics(directory)("fatal_rejection", {
      failure: studioFailureCode(new Error("rtmp-key=secret")),
    });
    const text = readFileSync(
      join(directory, "controller-diagnostics.json"),
      "utf8",
    );
    const rows = JSON.parse(text);
    expect(rows).toHaveLength(64);
    expect(rows.at(-2)).toMatchObject({
      event: "native_exited",
      exitCode: -1073741819,
    });
    expect(rows.at(-1)).toMatchObject({
      event: "fatal_rejection",
      failure: "unknown",
    });
    expect(text).not.toContain("secret");
    (log as StudioDiagnostic)("fatal_exception", {
      failure: "private-token",
    } as never);
    expect(
      readFileSync(join(directory, "controller-diagnostics.json"), "utf8"),
    ).toBe(text);
    expect(studioFailureCode({ code: "EPIPE", message: "private" })).toBe(
      "EPIPE",
    );
    expect(
      studioFailureCode({
        get code() {
          throw Error("secret");
        },
      }),
    ).toBe("unknown");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("discards corrupt or unexpected saved metadata and tolerates unwritable diagnostics", () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-diagnostics-"));
  try {
    writeFileSync(
      join(directory, "controller-diagnostics.json"),
      '[{"token":"secret"}]',
    );
    createStudioDiagnostics(directory)("controller_start");
    expect(
      readFileSync(join(directory, "controller-diagnostics.json"), "utf8"),
    ).not.toContain("secret");
    expect(() =>
      createStudioDiagnostics(join(directory, "missing"))("controller_ready"),
    ).not.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
