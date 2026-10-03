// Isolated CEF behavior check. Raw ICE candidates never leave the fixture page.
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const [host, runtime, evidence, expectation = "allowed"] =
  process.argv.slice(2);
assert(host && runtime && evidence);
assert(["allowed", "baseline"].includes(expectation));
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(evidence, "address-"));
const results = {};
const script = `<script>
(async () => {
  const counts = { ipv4: 0, mdns: 0, other: 0, complete: false };
  const peer = new RTCPeerConnection({ iceServers: [] });
  peer.addTransceiver('video', { direction: 'recvonly' });
  const done = new Promise(resolve => {
    peer.onicecandidate = event => {
      if (!event.candidate) { counts.complete = true; resolve(); return; }
      const fields = event.candidate.candidate.split(/\\s+/);
      if (fields[7] !== 'host') return;
      const address = fields[4];
      if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(address)) counts.ipv4++;
      else if (/\\.local$/i.test(address)) counts.mdns++;
      else counts.other++;
    };
    setTimeout(resolve, 3000);
  });
  try {
    await peer.setLocalDescription(await peer.createOffer());
    await done;
    await fetch('/result', { method: 'POST', body: JSON.stringify(counts) });
  } finally { peer.close(); }
})();
</script>`;

function fixture(label, extra = () => "") {
  return createServer(async (req, res) => {
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      res.end(
        `<!doctype html><body style="background:#047857">Isolated CEF address check${extra()}${script}`,
      );
    } else if (req.url === "/result" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 256) {
          res.writeHead(413).end();
          return;
        }
      }
      try {
        const row = JSON.parse(body);
        assert.deepEqual(Object.keys(row).sort(), [
          "complete",
          "ipv4",
          "mdns",
          "other",
        ]);
        assert.equal(typeof row.complete, "boolean");
        for (const key of ["ipv4", "mdns", "other"])
          assert(Number.isInteger(row[key]) && row[key] >= 0 && row[key] < 128);
        results[label] = row;
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    } else res.writeHead(404).end();
  });
}
const other = fixture("otherOrigin");
await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
const main = fixture(
  "programOrigin",
  () => `<iframe src="http://127.0.0.1:${other.address().port}/"></iframe>`,
);
await new Promise((resolve) => main.listen(0, "127.0.0.1", resolve));
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      host,
      [
        runtime,
        join(directory, "program.mkv"),
        join(directory, "cache"),
        `http://127.0.0.1:${main.address().port}/`,
      ],
      {
        windowsHide: true,
        env: { ...process.env, PATH: `${runtime};${process.env.PATH}` },
        stdio: "ignore",
      },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("CEF check deadline exceeded"));
    }, 20000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  assert.equal(code, 0);
  assert(
    results.programOrigin?.complete && results.otherOrigin?.complete,
    "Both fixture pages must gather candidates",
  );
  if (expectation === "allowed")
    assert(
      results.programOrigin.ipv4 > 0,
      "Program origin must expose concrete host candidates",
    );
  else
    assert.equal(
      results.programOrigin.ipv4,
      0,
      "Baseline must reproduce hidden host candidates",
    );
  assert.equal(
    results.otherOrigin.ipv4,
    0,
    "Another loopback port must remain outside the allowance",
  );
  assert(results.otherOrigin.mdns > 0);
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify({ expectation, ...results }, null, 2),
  );
  console.log(JSON.stringify({ expectation, ...results }));
} finally {
  for (const server of [main, other]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
