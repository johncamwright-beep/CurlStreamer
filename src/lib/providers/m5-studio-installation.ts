import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.origin === value;
});
export const studioConfiguration = z
  .object({
    version: z.literal(1),
    website: origin,
    realtimeUrl: origin,
    // Publishable keys only: privileged and legacy JWT keys are never packaged.
    realtimeKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
    streamingEnabled: z.boolean().default(false),
  })
  .strict();

export const studioFiles = {
  node: "node/node.exe",
  controller: "app/studio.mjs",
  configuration: "studio.json",
  host: "native/m4_studio_host.exe",
  recorder: "native/m4_studio_recorder.exe",
  defaultPlugin: "native/default/curlstreamer-m4-memory.dll",
  streamPlugin: "native/production/curlstreamer-m4-memory.dll",
  rendererScript: "renderer/m4-program-renderer.js",
  rendererStyle: "renderer/m4-program-renderer.css",
} as const;

const manifestSchema = z
  .object({
    version: z.literal(1),
    release: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/),
    obsVersion: z.literal("32.2.2"),
    nodeVersion: z.string().regex(/^v(22|24)\.\d+\.\d+$/),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(/^[A-Za-z0-9_. /-]+$/)
              .max(240),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(20000),
  })
  .strict();

export function readStudioGame(value: string, website: string) {
  const url = new URL(value.trim());
  const match = url.pathname.match(/^\/games\/([^/]+)\/?$/);
  if (
    url.origin !== website ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  )
    throw new Error("Paste the game page link from the configured website.");
  return z.uuid().parse(match[1]);
}

/** Hashes detect incomplete/corrupt installs; publisher authenticity requires signing. */
export async function readStudioInstallation(directory: string) {
  const root = await realpath(directory);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")),
  );
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (
      file.path
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            part.endsWith(".") ||
            part.endsWith(" "),
        ) ||
      seen.has(file.path.toLowerCase())
    )
      throw new Error("Invalid installation manifest.");
    seen.add(file.path.toLowerCase());
    const path = resolve(root, file.path);
    const inside = relative(root, await realpath(path));
    if (
      isAbsolute(inside) ||
      inside === ".." ||
      inside.startsWith(`..${sep}`) ||
      !(await lstat(path)).isFile()
    )
      throw new Error("Invalid installation component.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest("hex") !== file.sha256)
      throw new Error("Studio files are damaged. Reinstall Studio.");
  }
  for (const path of [...Object.values(studioFiles), "obs/bin/64bit/obs.dll"])
    if (!seen.has(path.toLowerCase()))
      throw new Error("Studio installation is incomplete.");
  const configuration = studioConfiguration.parse(
    JSON.parse(
      await readFile(resolve(root, studioFiles.configuration), "utf8"),
    ),
  );
  return { root, manifest, configuration };
}
