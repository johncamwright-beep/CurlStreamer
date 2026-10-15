import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  packRecovery,
  verifyRecovery,
  restoreRecovery,
} from "./recovery-bundle.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      !path
        .resolve(root)
        .startsWith(path.join(tmpdir(), "curlstreamer-recovery-test-"))
    )
      throw Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "curlstreamer-recovery-test-"),
  );
  roots.push(root);
  const source = path.join(root, "export"),
    bundle = path.join(root, "encrypted"),
    restore = path.join(root, "restored");
  await mkdir(path.join(source, "media", "team"), { recursive: true });
  await writeFile(
    path.join(source, "database.sql"),
    "-- Synthetic recovery fixture; no production records\nselect 1;\n",
  );
  const photo = randomBytes(300_000);
  await writeFile(path.join(source, "media", "team", "photo.jpg"), photo);
  await writeFile(path.join(source, "empty.txt"), "");
  return {
    root,
    source,
    bundle,
    restore,
    photo,
    key: randomBytes(32).toString("hex"),
  };
}
describe("encrypted recovery bundles", () => {
  it("round-trips database exports, media and empty files into an isolated directory", async () => {
    const f = await fixture();
    const packed = await packRecovery(f.source, f.bundle, f.key);
    expect(packed.files).toBe(3);
    expect(await verifyRecovery(f.bundle, f.key)).toEqual(packed);
    expect(await restoreRecovery(f.bundle, f.restore, f.key)).toEqual(packed);
    expect(
      await readFile(path.join(f.restore, "media/team/photo.jpg")),
    ).toEqual(f.photo);
    expect(await readFile(path.join(f.restore, "database.sql"))).toEqual(
      await readFile(path.join(f.source, "database.sql")),
    );
    expect(
      (await readFile(path.join(f.bundle, "manifest.enc"))).includes(
        Buffer.from("photo.jpg"),
      ),
    ).toBe(false);
  });
  it("rejects a wrong key and corrupted ciphertext before creating a restore directory", async () => {
    const f = await fixture();
    await packRecovery(f.source, f.bundle, f.key);
    await expect(
      verifyRecovery(f.bundle, randomBytes(32).toString("hex")),
    ).rejects.toThrow();
    const filename = path.join(f.bundle, "000001.enc");
    const bytes = await readFile(filename);
    bytes[12] ^= 1;
    await writeFile(filename, bytes);
    await expect(restoreRecovery(f.bundle, f.restore, f.key)).rejects.toThrow();
    await expect(
      readFile(path.join(f.restore, "database.sql")),
    ).rejects.toThrow();
  });
  it("never overwrites a backup or an existing restore destination", async () => {
    const f = await fixture();
    await packRecovery(f.source, f.bundle, f.key);
    await expect(packRecovery(f.source, f.bundle, f.key)).rejects.toThrow();
    await mkdir(f.restore);
    await writeFile(path.join(f.restore, "keep.txt"), "keep");
    await expect(restoreRecovery(f.bundle, f.restore, f.key)).rejects.toThrow();
    expect(await readFile(path.join(f.restore, "keep.txt"), "utf8")).toBe(
      "keep",
    );
  });
  it("rejects incomplete bundles and destination-inside-source mistakes", async () => {
    const f = await fixture();
    await expect(
      packRecovery(f.source, path.join(f.source, "backup"), f.key),
    ).rejects.toThrow();
    await mkdir(f.bundle);
    await writeFile(path.join(f.bundle, "000000.enc"), "partial");
    await expect(verifyRecovery(f.bundle, f.key)).rejects.toThrow();
    await expect(
      packRecovery(f.source, f.restore, "short key"),
    ).rejects.toThrow();
  });
});
