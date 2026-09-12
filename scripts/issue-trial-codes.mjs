import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Generate privately; run the resulting SQL in the operator's Supabase console.
// No credentials are needed and no email is sent by this command.
const count = Number(process.argv[2] ?? 1);
const year = Number(
  process.argv[3] ??
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Toronto",
    }).format(new Date()),
);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 100 ||
  !Number.isInteger(year) ||
  year < 2026 ||
  year > 2100
) {
  throw new Error(
    "Usage: node scripts/issue-trial-codes.mjs [1-100 codes] [expiry year]",
  );
}
const expiry = `${year + 1}-01-01T05:00:00Z`;
if (Date.parse(expiry) <= Date.now())
  throw new Error("Choose an expiry year that has not ended.");
const codes = Array.from(
  { length: count },
  () =>
    "CURL-" +
    randomBytes(16).toString("hex").toUpperCase().match(/.{8}/g).join("-"),
);
const rows = codes.map(
  (code) =>
    `('${createHash("sha256")
      .update(code.replace(/[^A-Z0-9]/g, ""))
      .digest("hex")}', '${expiry}')`,
);
const directory = resolve("work", "trial-codes-" + Date.now());
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, "register.sql"),
  `begin;\ninsert into public.team_trial_codes(code_hash,expires_at) values\n${rows.join(",\n")};\ncommit;\n`,
  { flag: "wx" },
);
await writeFile(
  resolve(directory, "codes.txt"),
  `Trial access through December 31, ${year} (Toronto time).\nCodes become usable only after register.sql is applied. Each code is for one team.\n\n${codes.join("\n")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  `Created ${count} trial code(s) in ${directory}. Apply register.sql before distributing codes.txt privately.`,
);
