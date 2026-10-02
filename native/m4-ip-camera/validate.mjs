// Real local RTSP/TCP + H264 + PCMU fixture. No camera or stored credential needed.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
const [helper, runtime] = process.argv.slice(2).map((value) => resolve(value));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path"),
);
env.Path = runtime + ";" + (process.env.Path ?? process.env.PATH ?? "");
const fixture = spawnSync(
  join(dirname(helper), "m4_ip_camera_fixture.exe"),
  [],
  { env, cwd: runtime, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(fixture.status, 0, "synthetic H264 encoder");
const packets = [];
for (let offset = 0; offset < fixture.stdout.length;) {
  const n = fixture.stdout.readUInt32LE(offset);
  packets.push(fixture.stdout.subarray(offset + 4, offset + 4 + n));
  offset += 4 + n;
}
const nals = (packet) => {
  const markers = [];
  for (let i = 0; i < packet.length - 3; i++) {
    if (packet[i] === 0 && packet[i + 1] === 0 && packet[i + 2] === 1)
      markers.push([i, i + 3]);
    else if (
      packet[i] === 0 &&
      packet[i + 1] === 0 &&
      packet[i + 2] === 0 &&
      packet[i + 3] === 1
    ) {
      markers.push([i, i + 4]);
      i++;
    }
  }
  return markers.map(([start, body], i) =>
    packet.subarray(body, markers[i + 1]?.[0] ?? packet.length),
  );
};
const first = nals(packets[0]);
const sps = first.find((n) => (n[0] & 31) === 7),
  pps = first.find((n) => (n[0] & 31) === 8);
assert(sps && pps);
const sdp = `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Synthetic fixture\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\na=control:*\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1;sprop-parameter-sets=${sps.toString("base64")},${pps.toString("base64")}\r\na=control:trackID=0\r\nm=audio 0 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000/1\r\na=control:trackID=1\r\n`;
let reject = false;
const sockets = new Set();
const server = createServer((socket) => {
  sockets.add(socket);
  let pending = Buffer.alloc(0),
    timer,
    seq = 0,
    aseq = 0,
    index = 0;
  const rtp = (channel, payload, type, timestamp, marker, sequence) => {
    const h = Buffer.alloc(16);
    h[0] = 36;
    h[1] = channel;
    h.writeUInt16BE(12 + payload.length, 2);
    h[4] = 128;
    h[5] = type | (marker ? 128 : 0);
    h.writeUInt16BE(sequence & 65535, 6);
    h.writeUInt32BE(timestamp >>> 0, 8);
    h.writeUInt32BE(channel ? 654 : 123, 12);
    socket.write(Buffer.concat([h, payload]));
  };
  socket.on("data", (data) => {
    pending = Buffer.concat([pending, data]);
    while (pending.length) {
      if (pending[0] === 36) {
        if (pending.length < 4) return;
        const n = pending.readUInt16BE(2) + 4;
        if (pending.length < n) return;
        pending = pending.subarray(n);
        continue;
      }
      const end = pending.indexOf("\r\n\r\n");
      if (end < 0) return;
      const req = pending.subarray(0, end + 4).toString();
      pending = pending.subarray(end + 4);
      const method = req.split(" ")[0],
        cseq = req.match(/CSeq:\s*(\d+)/i)?.[1];
      if (reject) {
        socket.write(
          `RTSP/1.0 401 Unauthorized\r\nCSeq: ${cseq}\r\nWWW-Authenticate: Basic realm="fixture"\r\n\r\n`,
        );
        continue;
      }
      let body = "",
        headers = "Session: 12345678\r\n";
      if (method === "OPTIONS")
        headers += "Public: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN\r\n";
      if (method === "DESCRIBE") {
        body = sdp;
        headers += `Content-Type: application/sdp\r\nContent-Base: rtsp://127.0.0.1:${server.address().port}/stream1/\r\n`;
      }
      if (method === "SETUP")
        headers += `Transport: RTP/AVP/TCP;unicast;interleaved=${req.includes("trackID=1") ? "2-3" : "0-1"}\r\n`;
      socket.write(
        `RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\n${headers}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
      if (method === "PLAY" && !timer)
        timer = setInterval(() => {
          const current = nals(packets[index % packets.length]);
          for (let j = 0; j < current.length; j++) {
            const nal = current[j];
            const mark = j === current.length - 1;
            if (nal.length <= 1100) rtp(0, nal, 96, index * 4500, mark, seq++);
            else
              for (let off = 1; off < nal.length; off += 1098) {
                const last = off + 1098 >= nal.length;
                const fu = Buffer.from([
                  (nal[0] & 224) | 28,
                  (nal[0] & 31) | (off === 1 ? 128 : 0) | (last ? 64 : 0),
                ]);
                rtp(
                  0,
                  Buffer.concat([fu, nal.subarray(off, off + 1098)]),
                  96,
                  index * 4500,
                  mark && last,
                  seq++,
                );
              }
          }
          rtp(2, Buffer.alloc(1600, 0x8f), 0, index * 1600, true, aseq++);
          index++;
        }, 50);
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    clearInterval(timer);
    sockets.delete(socket);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
async function run(rotation, authFailure = false) {
  reject = authFailure;
  const child = spawn(helper, [runtime], {
    env,
    cwd: runtime,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let bytes = Buffer.alloc(0),
    err = Buffer.alloc(0),
    records = [];
  child.stderr.on("data", (b) => (err = Buffer.concat([err, b])));
  child.stdout.on("data", (b) => {
    bytes = Buffer.concat([bytes, b]);
    while (bytes.length >= 8) {
      const n = bytes.readUInt32LE(4);
      assert(n <= 4 * 1024 * 1024);
      if (bytes.length < 8 + n) return;
      records.push({
        type: bytes.subarray(0, 4).toString(),
        body: Buffer.from(bytes.subarray(8, 8 + n)),
      });
      bytes = bytes.subarray(8 + n);
    }
  });
  const ended = new Promise((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal })),
  );
  child.stdin.write(
    JSON.stringify({
      version: 1,
      host: "127.0.0.1",
      port: server.address().port,
      username: "fixture-user",
      password: "fixture-password",
      stream: "stream1",
      rotation,
    }) + "\n",
  );
  const started = Date.now();
  while (
    Date.now() - started < 7000 &&
    !records.some((r) =>
      authFailure
        ? r.type === "STAT" && r.body.includes("auth_failed")
        : r.type === "JPEG" && records.some((p) => p.type === "PCMA"),
    )
  )
    await new Promise((r) => setTimeout(r, 50));
  const stop = Date.now();
  child.stdin.end();
  const timeout = setTimeout(() => child.kill(), 5000);
  await ended;
  clearTimeout(timeout);
  assert(Date.now() - stop < 5000, "EOF cleanup within five seconds");
  assert.equal(err.length, 0, "no library diagnostics");
  if (authFailure)
    assert(
      records.some((r) => r.type === "STAT" && r.body.includes("auth_failed")),
      "sanitized authorization status",
    );
  else {
    const jpeg = records.find((r) => r.type === "JPEG")?.body;
    assert(jpeg, "real decoded H264 produces JPEG");
    assert(jpeg[0] === 255 && jpeg[1] === 216);
    let dimensions;
    for (let i = 2; i < jpeg.length - 9;) {
      if (jpeg[i] !== 255) {
        i++;
        continue;
      }
      const marker = jpeg[i + 1],
        n = jpeg.readUInt16BE(i + 2);
      if (marker === 192) {
        dimensions = [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + n;
    }
    assert.deepEqual(
      dimensions,
      rotation === 90 || rotation === 270 ? [128, 192] : [192, 128],
    );
    const { data, info } = await sharp(jpeg)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = (x, y) =>
      data[
        Math.floor(info.height * y) * info.width + Math.floor(info.width * x)
      ];
    const forward =
      rotation === 0
        ? sample(0.75, 0.5) - sample(0.25, 0.5)
        : rotation === 90
          ? sample(0.5, 0.75) - sample(0.5, 0.25)
          : rotation === 180
            ? sample(0.25, 0.5) - sample(0.75, 0.5)
            : sample(0.5, 0.25) - sample(0.5, 0.75);
    assert(
      forward > 100,
      "rotation transforms actual pixels in the correct direction",
    );
    assert(
      records.some(
        (r) =>
          r.type === "PCMA" && r.body.length > 0 && r.body.length % 2 === 0,
      ),
      "real PCMU audio resampled to PCM",
    );
    assert(
      records
        .filter((r) => r.type === "PCMA")
        .every((r) => r.body.length <= 9600),
      "audio records stay within the manager's 100ms bound",
    );
    assert(records.filter((r) => r.type === "JPEG").length >= 1);
  }
  assert(
    !Buffer.concat(records.map((r) => r.body)).includes("fixture-password"),
    "password excluded from output",
  );
  console.log(
    `PASS RTSP ${authFailure ? "authorization failure" : `H264+audio rotation ${rotation}`} and EOF cleanup`,
  );
}
async function invalidOrSilent(line) {
  const child = spawn(helper, [runtime], {
    env,
    cwd: runtime,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (b) => output.push(b));
  child.stderr.on("data", (b) => assert.equal(b.length, 0));
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const kill = setTimeout(() => child.kill(), 5000);
  if (line !== undefined) child.stdin.write(line + "\n");
  const started = Date.now();
  await ended;
  clearTimeout(kill);
  assert(Date.now() - started < 4900, "bounded startup");
  assert(Buffer.concat(output).includes("unavailable"));
  assert(!Buffer.concat(output).includes("secret-password"));
  console.log(
    `PASS ${line === undefined ? "incomplete startup timeout" : "invalid config rejection"}`,
  );
}
try {
  for (const angle of [0, 90, 180, 270]) await run(angle);
  await run(0, true);
  await invalidOrSilent(
    JSON.stringify({
      version: 1,
      host: "8.8.8.8",
      port: 554,
      username: "fixture-user",
      password: "secret-password",
      stream: "stream1",
      rotation: 0,
    }),
  );
  await invalidOrSilent();
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}
