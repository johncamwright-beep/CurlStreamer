import { createServer, type IncomingMessage } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { replayRange } from "./studio-replay-range";

/** Opt-in LAN proof only. No Studio controls, cloud requests, or production shot writes. */
export async function startCoachLocalProof(options: {
  host: string;
  port: number;
  video?: string;
  capture?: () => Promise<{
    video: string;
    duration: number;
    capturedAt: string;
  }>;
  code: string;
  duration: number;
  lifetimeMs?: number;
}) {
  const config = z
    .object({
      host: z.ipv4(),
      port: z.number().int().min(0).max(65535),
      video: z.string().min(1).optional(),
      code: z.string().regex(/^\d{6}$/),
      duration: z.number().positive().max(120),
      lifetimeMs: z.number().positive().optional(),
    })
    .parse(options);
  if (!/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(config.host))
    throw Error("Choose a private LAN address");
  if (!config.video && !options.capture)
    throw Error("A recording source is required");
  const snapshots = new Map<
    string,
    { video: string; duration: number; capturedAt: string; owner: string }
  >();
  const current = new Map<string, string>();
  let capturing = false;
  const html = await readFile(
    resolve("src/lib/providers/coach-local-proof.html"),
    "utf8",
  );
  const sessions = new Set<string>(),
    attempts = new Map<string, number>();
  let address = "",
    selection: unknown = null;
  let paired = 0,
    mediaRequests = 0,
    bytesServed = 0;
  async function body(req: IncomingMessage) {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 4096) throw Error("Too large");
    }
    return JSON.parse(text);
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== new URL(address).host) {
      reply(403, { error: "Wrong host" });
      return;
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (
      req.method === "POST" &&
      (req.headers.origin !== address ||
        !req.headers["content-type"]?.startsWith("application/json"))
    ) {
      reply(403, { error: "Open the local page first" });
      return;
    }
    try {
      if (req.method === "POST" && req.url === "/pair") {
        const ip = req.socket.remoteAddress ?? "unknown";
        if ((attempts.get(ip) ?? 0) >= 10) {
          reply(429, {
            error: "Too many attempts. Restart the proof to try again.",
          });
          return;
        }
        const input = z
          .object({ code: z.string().regex(/^\d{6}$/) })
          .parse(await body(req));
        if (
          !timingSafeEqual(Buffer.from(input.code), Buffer.from(config.code))
        ) {
          attempts.set(ip, (attempts.get(ip) ?? 0) + 1);
          reply(403, { error: "Check the pairing code" });
          return;
        }
        if (sessions.size >= 8) {
          reply(429, { error: "Pairing limit reached" });
          return;
        }
        const session = randomBytes(24).toString("hex");
        sessions.add(session);
        paired++;
        res.setHeader(
          "Set-Cookie",
          `coach_proof=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`,
        );
        reply(200, {
          duration: config.duration,
          rolling: Boolean(options.capture),
        });
        return;
      }
      const cookie = req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("coach_proof="))
        ?.slice(12);
      if (!cookie || !sessions.has(cookie)) {
        reply(401, { error: "Pair this phone first" });
        return;
      }
      if (req.method === "POST" && req.url === "/capture" && options.capture) {
        if (capturing || snapshots.size >= 32) {
          reply(429, {
            error: capturing
              ? "Another capture is finishing. Try again shortly."
              : "Proof capture limit reached. Restart the proof.",
          });
          return;
        }
        capturing = true;
        try {
          const clip = await options.capture();
          if (
            !Number.isFinite(clip.duration) ||
            clip.duration <= 0 ||
            clip.duration > 120.1
          )
            throw Error("Invalid clip");
          const id = randomBytes(16).toString("hex");
          snapshots.set(id, { ...clip, owner: cookie });
          current.set(cookie, id);
          reply(200, {
            duration: clip.duration,
            url: "/video?id=" + id,
            capturedAt: clip.capturedAt,
          });
        } finally {
          capturing = false;
        }
        return;
      }
      const requestedId = new URL(req.url ?? "/", address).searchParams.get(
        "id",
      );
      const clip = requestedId ? snapshots.get(requestedId) : undefined;
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        (req.url === "/video" || req.url?.startsWith("/video?"))
      ) {
        if (
          (options.capture && (!clip || clip.owner !== cookie)) ||
          (!clip && !config.video)
        ) {
          reply(404, { error: "Capture recent video first" });
          return;
        }
        const videoPath = clip?.video ?? config.video!;
        const size = (await stat(videoPath)).size;
        const range = replayRange(req.headers.range, size);
        if (!range) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          res.end();
          return;
        }
        const length = range.end - range.start + 1;
        res.writeHead(range.partial ? 206 : 200, {
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Content-Length": length,
          ...(range.partial
            ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
            : {}),
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        mediaRequests++;
        const stream = createReadStream(videoPath, {
          start: range.start,
          end: range.end,
        });
        stream.on("data", (chunk) => {
          bytesServed += chunk.length;
        });
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
        return;
      }
      if (req.method === "POST" && req.url === "/selection") {
        const selectedClip = snapshots.get(current.get(cookie) ?? "");
        if (options.capture && !selectedClip) {
          reply(400, { error: "Capture recent video first" });
          return;
        }
        selection = z
          .object({
            startSeconds: z
              .number()
              .min(0)
              .max(selectedClip?.duration ?? config.duration),
            audience: z.enum(["player", "team"]),
            notes: z.string().max(2000),
          })
          .strict()
          .parse(await body(req));
        reply(200, {
          saved: true,
          selection,
          capturedAt: selectedClip?.capturedAt,
          proofOnly: true,
        });
        return;
      }
      reply(404, { error: "Not found" });
    } catch {
      if (!res.headersSent) reply(400, { error: "Check the entered values" });
      else res.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const port = (server.address() as { port: number }).port;
  address = `http://${config.host}:${port}`;
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    sessions.clear();
  };
  const timer = setTimeout(close, config.lifetimeMs ?? 7200000);
  timer.unref();
  return {
    address,
    close,
    stats: () => ({ paired, mediaRequests, bytesServed, selection }),
  };
}
