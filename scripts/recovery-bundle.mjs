import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, Writable } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_FILES = 10_000;
const MAX_MANIFEST = 10_000_000;
function keyBytes(key) {
  if (!/^[a-f0-9]{64}$/i.test(key ?? ""))
    throw Error(
      "A 64-character hexadecimal backup key is required in CURLSTREAMER_BACKUP_KEY.",
    );
  return Buffer.from(key, "hex");
}
function safeName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 1000 ||
    name
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\:\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw Error("Unsafe backup entry.");
  return name;
}
function seal(bytes, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    cipher.update(bytes),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
function unseal(bytes, key) {
  if (bytes.length < 28) throw Error("Incomplete encrypted backup.");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([
    decipher.update(bytes.subarray(12, -16)),
    decipher.final(),
  ]);
}
async function inventory(root, prefix = "", found = []) {
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = safeName(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (entry.isSymbolicLink())
      throw Error("Symlinks are not permitted in a recovery export.");
    if (entry.isDirectory()) await inventory(root, name, found);
    else if (entry.isFile()) {
      found.push(name);
      if (found.length > MAX_FILES)
        throw Error("Recovery export has too many files.");
    } else throw Error("Only regular files and directories can be backed up.");
  }
  return found.sort();
}
async function encryptFile(source, destination, key) {
  const before = await lstat(source);
  if (!before.isFile()) throw Error("Export file changed during backup.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await writeFile(destination, iv, { flag: "wx", mode: 0o600 });
  await pipeline(
    createReadStream(source),
    meter,
    cipher,
    createWriteStream(destination, { flags: "a" }),
  );
  await writeFile(destination, cipher.getAuthTag(), { flag: "a" });
  const after = await lstat(source);
  if (
    !after.isFile() ||
    before.size !== bytes ||
    after.size !== bytes ||
    before.mtimeMs !== after.mtimeMs
  )
    throw Error("Export changed during backup; create a fresh snapshot.");
  return { bytes, sha256: hash.digest("hex") };
}

/** Operates only on an already-created export directory; never fetches production data. */
export async function packRecovery(source, destination, keyText) {
  const key = keyBytes(keyText);
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (
    !(await lstat(source)).isDirectory() ||
    (await lstat(source)).isSymbolicLink()
  )
    throw Error("Use a regular export directory.");
  const relative = path.relative(source, destination);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw Error("Keep the encrypted bundle outside the export directory.");
  const names = await inventory(source);
  if (!names.length) throw Error("Cannot back up an empty export.");
  // Exclusive directory creation prevents overwriting a previous recovery point.
  await mkdir(destination, { mode: 0o700 });
  const files = [];
  for (const [index, name] of names.entries()) {
    const object = `${index.toString().padStart(6, "0")}.enc`;
    const details = await encryptFile(
      path.join(source, name),
      path.join(destination, object),
      key,
    );
    files.push({ name, object, ...details });
  }
  if (JSON.stringify(names) !== JSON.stringify(await inventory(source)))
    throw Error("Export inventory changed during backup.");
  const manifest = { version: 1, createdAt: new Date().toISOString(), files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length + 28 > MAX_MANIFEST)
    throw Error(
      "Recovery manifest is too large; split the export into smaller bundles.",
    );
  // Written last: a partial copy never has a valid completion manifest.
  await writeFile(
    path.join(destination, "manifest.enc"),
    seal(manifestBytes, key),
    { flag: "wx", mode: 0o600 },
  );
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

async function readManifest(root, key) {
  if (
    !(await lstat(root)).isDirectory() ||
    (await lstat(root)).isSymbolicLink()
  )
    throw Error("Use a regular backup directory.");
  const manifestPath = path.join(root, "manifest.enc");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.size > MAX_MANIFEST)
    throw Error("Invalid backup manifest.");
  const manifest = JSON.parse(
    unseal(await readFile(manifestPath), key).toString("utf8"),
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.files.length > MAX_FILES
  )
    throw Error("Invalid backup manifest.");
  const seen = new Set();
  for (const [index, file] of manifest.files.entries()) {
    safeName(file.name);
    const normalized = file.name.toLowerCase();
    if (
      seen.has(normalized) ||
      file.object !== `${index.toString().padStart(6, "0")}.enc` ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw Error("Invalid backup entry.");
    seen.add(normalized);
  }
  return manifest;
}
async function decryptFile(root, file, key, destination) {
  const source = path.join(root, file.object),
    info = await lstat(source);
  if (!info.isFile() || info.size !== file.bytes + 28)
    throw Error("Backup file missing or incomplete.");
  const { open } = await import("node:fs/promises");
  const handle = await open(source, "r");
  let iv, tag;
  try {
    iv = Buffer.alloc(12);
    tag = Buffer.alloc(16);
    await handle.read(iv, 0, 12, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally {
    await handle.close();
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const sink = destination
    ? createWriteStream(destination, { flags: "wx", mode: 0o600 })
    : new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
  if (file.bytes === 0) {
    decipher.end();
    await pipeline(decipher, meter, sink);
  } else
    await pipeline(
      createReadStream(source, { start: 12, end: info.size - 17 }),
      decipher,
      meter,
      sink,
    );
  if (bytes !== file.bytes || hash.digest("hex") !== file.sha256)
    throw Error("Backup integrity check failed.");
}
export async function verifyRecovery(root, keyText) {
  const key = keyBytes(keyText),
    manifest = await readManifest(root, key);
  for (const file of manifest.files) await decryptFile(root, file, key);
  return {
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  };
}
/** Extract to a brand-new local directory only. Never executes SQL or contacts a database. */
export async function restoreRecovery(root, destination, keyText) {
  const result = await verifyRecovery(root, keyText);
  const key = keyBytes(keyText),
    manifest = await readManifest(root, key);
  await mkdir(destination, { mode: 0o700 });
  for (const file of manifest.files) {
    const target = path.join(destination, file.name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await decryptFile(root, file, key, target);
  }
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const [operation, source, destination] = process.argv.slice(2),
      key = process.env.CURLSTREAMER_BACKUP_KEY;
    if (
      !source ||
      !["pack", "verify", "restore"].includes(operation) ||
      (operation !== "verify" && !destination)
    )
      throw Error(
        "Usage: recovery-bundle.mjs pack|verify|restore source [new-destination]",
      );
    const result =
      operation === "pack"
        ? await packRecovery(source, destination, key)
        : operation === "verify"
          ? await verifyRecovery(source, key)
          : await restoreRecovery(source, destination, key);
    console.log(
      JSON.stringify({ operation, ...result, verified: operation !== "pack" }),
    );
  } catch {
    console.error(
      "Recovery operation failed. Check the key, source integrity and new destination. Incomplete outputs must not be used for recovery.",
    );
    process.exitCode = 1;
  }
}
