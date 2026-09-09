// Local TLS/RTMP peer rejects publish with the exact received synthetic key.
// Never write raw protocol, key, server text, child stderr or OBS logs to disk.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import tls from "node:tls";

const [host, plugin, runtime, ffmpeg, evidenceRoot, outputs, certificates] =
  process.argv.slice(2);
assert.ok(
  host &&
    plugin &&
    runtime &&
    ffmpeg &&
    evidenceRoot &&
    outputs &&
    certificates,
);
const evidence = join(evidenceRoot, randomUUID());
await mkdir(evidence, { recursive: true });
const canary = "m4-canary-loopback";
let published = false,
  echoed = false,
  protocolFailed = false,
  handshakes = 0;
const sockets = new Set();
const amfString = (value) => {
  const text = Buffer.from(value);
  const header = Buffer.alloc(3);
  header[0] = 2;
  header.writeUInt16BE(text.length, 1);
  return Buffer.concat([header, text]);
};
const amfNumber = (value) => {
  const out = Buffer.alloc(9);
  out.writeDoubleBE(value, 1);
  return out;
};
const amfNull = Buffer.from([5]);
function amfObject(value) {
  const parts = [Buffer.from([3])];
  for (const [key, item] of Object.entries(value)) {
    const name = Buffer.from(key);
    const size = Buffer.alloc(2);
    size.writeUInt16BE(name.length);
    parts.push(
      size,
      name,
      typeof item === "number" ? amfNumber(item) : amfString(item),
    );
  }
  return Buffer.concat([...parts, Buffer.from([0, 0, 9])]);
}
function commandParts(body) {
  let offset = 0;
  function read() {
    const type = body[offset++];
    if (type === 0) {
      const value = body.readDoubleBE(offset);
      offset += 8;
      return value;
    }
    if (type === 1) return Boolean(body[offset++]);
    if (type === 2) {
      const size = body.readUInt16BE(offset);
      offset += 2;
      const value = body.toString("utf8", offset, offset + size);
      offset += size;
      return value;
    }
    if (type === 5 || type === 6) return null;
    if (type === 3 || type === 8) {
      if (type === 8) offset += 4;
      for (;;) {
        const size = body.readUInt16BE(offset);
        offset += 2;
        if (!size && body[offset] === 9) {
          ++offset;
          return null;
        }
        offset += size;
        read();
      }
    }
    throw new Error("unsupported AMF fixture value");
  }
  const values = [];
  while (offset < body.length) values.push(read());
  return values;
}
function peer(socket) {
  ++handshakes;
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
  let data = Buffer.alloc(0),
    handshake = 0,
    chunkSize = 128;
  const channels = new Map();
  const send = (body, stream = 0) => {
    const parts = [],
      header = Buffer.alloc(12);
    header[0] = 3;
    header.writeUIntBE(body.length, 4, 3);
    header[7] = 20;
    header.writeUInt32LE(stream, 8);
    for (let at = 0; at < body.length; at += 128)
      parts.push(
        at ? Buffer.from([0xc3]) : header,
        body.subarray(at, at + 128),
      );
    socket.write(Buffer.concat(parts));
  };
  function message(type, body) {
    if (type === 1) {
      chunkSize = body.readUInt32BE() & 0x7fffffff;
      assert.ok(chunkSize > 0 && chunkSize <= 65536);
      return;
    }
    if (type !== 20) return;
    const [name, transaction, , key] = commandParts(body);
    if (name === "connect")
      send(
        Buffer.concat([
          amfString("_result"),
          amfNumber(transaction),
          amfObject({ fmsVer: "FMS/3,5,7,7009", capabilities: 31 }),
          amfObject({
            level: "status",
            code: "NetConnection.Connect.Success",
            description: "Local validation",
            objectEncoding: 0,
          }),
        ]),
      );
    else if (name === "createStream")
      send(
        Buffer.concat([
          amfString("_result"),
          amfNumber(transaction),
          amfNull,
          amfNumber(1),
        ]),
      );
    else if (name === "releaseStream" || name === "FCPublish")
      send(
        Buffer.concat([
          amfString("_result"),
          amfNumber(transaction),
          amfNull,
          amfNull,
        ]),
      );
    else if (name === "publish") {
      assert.equal(key, canary);
      published = true;
      send(
        Buffer.concat([
          amfString("onStatus"),
          amfNumber(0),
          amfNull,
          amfObject({
            level: "error",
            code: "NetStream.Publish.BadName",
            description: `Rejected key ${key}; echo=${key}`,
          }),
        ]),
        1,
      );
      echoed = true;
    }
  }
  socket.on("data", (chunk) => {
    try {
      data = Buffer.concat([data, chunk]);
      assert.ok(data.length <= 1024 * 1024);
      if (!handshake) {
        if (data.length < 1537) return;
        assert.equal(data[0], 3);
        socket.write(
          Buffer.concat([
            Buffer.from([3]),
            randomBytes(1536),
            data.subarray(1, 1537),
          ]),
        );
        data = data.subarray(1537);
        handshake = 1;
      }
      if (handshake === 1) {
        if (data.length < 1536) return;
        data = data.subarray(1536);
        handshake = 2;
      }
      while (data.length) {
        const format = data[0] >> 6,
          channel = data[0] & 63;
        assert.ok(channel >= 2);
        let size = [12, 8, 4, 1][format];
        if (data.length < size) return;
        const previous = channels.get(channel);
        assert.ok(format === 0 || previous);
        let current = previous;
        if (format < 2)
          current = {
            type: data[7],
            length: data.readUIntBE(4, 3),
            body: Buffer.alloc(0),
            extended: data.readUIntBE(1, 3) === 0xffffff,
          };
        else if (format === 2)
          current = {
            ...previous,
            body: Buffer.alloc(0),
            extended: data.readUIntBE(1, 3) === 0xffffff,
          };
        else if (previous.body.length === previous.length)
          current = { ...previous, body: Buffer.alloc(0) };
        if (current.extended) size += 4;
        const take = Math.min(chunkSize, current.length - current.body.length);
        if (data.length < size + take) return;
        current.body = Buffer.concat([
          current.body,
          data.subarray(size, size + take),
        ]);
        data = data.subarray(size + take);
        channels.set(channel, current);
        if (current.body.length === current.length)
          message(current.type, current.body);
      }
    } catch {
      protocolFailed = true;
      socket.destroy();
    }
  });
}
const server = tls.createServer(
  {
    key: await readFile(join(certificates, "localhost-key.pem")),
    cert: await readFile(join(certificates, "localhost.pem")),
    minVersion: "TLSv1.2",
  },
  peer,
);
server.on("tlsClientError", () => {
  protocolFailed = true;
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(19360, "127.0.0.1", resolve);
});
async function exit(child, timeout) {
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
}
try {
  const child = spawn(host, [plugin, runtime, "hostile", outputs], {
    cwd: evidence,
    windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, PATH: runtime },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [],
    stderr = [];
  child.stdout.on("data", (data) => stdout.push(data));
  child.stderr.on("data", (data) => stderr.push(data));
  const code = await exit(child, 20000);
  for (const capture of [Buffer.concat(stdout), Buffer.concat(stderr)]) {
    assert.equal(
      capture.includes(canary),
      false,
      "server-echo key cannot reach process output",
    );
    capture.fill(0);
  }
  assert.equal(code, 0, "guarded native host passed");
  assert.equal(protocolFailed, false);
  assert.equal(handshakes, 1);
  assert.equal(published, true);
  assert.equal(echoed, true);
  const decode = spawn(
    ffmpeg,
    [
      "-v",
      "error",
      "-xerror",
      "-i",
      join(evidence, "independent.mkv"),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  assert.equal(await exit(decode, 10000), 0);
  for (const file of await readdir(evidence)) {
    if (file.endsWith(".mkv")) continue;
    assert.equal(
      (await readFile(join(evidence, file))).includes(canary),
      false,
      "persisted diagnostics contain no echoed key",
    );
  }
  const counts = JSON.parse(
    await readFile(join(evidence, "log-counts.json"), "utf8"),
  );
  assert.ok(counts.error > 0);
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        tlsHandshakeAccepted: true,
        actualPublishReceived: true,
        serverEchoedSyntheticKey: true,
        rejectedBeforeMedia: true,
        countOnlyLogs: true,
        processOutputClean: true,
        persistedArtifactsClean: true,
        independentMkvDecoded: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS hostile TLS/RTMP publish rejection: actual key echoed; logs/output clean; independent MKV decoded",
  );
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}
