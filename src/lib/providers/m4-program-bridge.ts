import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createM4SponsorAssets } from "./m4-sponsor-assets";
import { createM4UsbAudioQueue } from "./m4-usb-audio";
import type { M4ProgramClient } from "./m4-program-client";
import {
  cameraRoleSchema,
  signalSchema,
  signalEnvelopeSchema,
  studioTicketSchema,
  type CameraRole,
} from "../m2-studio-protocol";

const command = z
  .object({
    action: z.enum(["check", "signal", "stop"]),
    cameraRole: cameraRoleSchema,
    sessionId: z.uuid().optional(),
    negotiationId: z.uuid().optional(),
    signal: signalSchema.optional(),
  })
  .strict();

/** Private local API and managed renderer bootstrap. The owning Node process
 * passes only the root loopback URL to its freshly launched recorder. The first
 * navigation receives a process-lifetime HttpOnly capability. This is not
 * browser process attestation; it prevents credentials from entering URLs,
 * page JavaScript and OBS profile data.
 */
export async function createM4ProgramBridge(
  client: Pick<M4ProgramClient, "readGame" | "action" | "close"> & {
    sponsorOrganizationId?: () => string | undefined;
  },
  realtime?: {
    connect(role: CameraRole): Promise<unknown>;
    drain(role: CameraRole): Promise<unknown>;
    close(): Promise<void>;
  },
  rendererAssets?: {
    directory: string;
    sponsorStorageOrigin?: string;
    sponsorCacheDirectory?: string;
  },
) {
  const key = randomBytes(32).toString("base64url");
  const cameraFrames = new Map<
    CameraRole,
    { frames: number; advancedAt: number }
  >();
  const phoneAudio = new Map<
    CameraRole,
    { peak: number; rms: number; receiving: boolean; observedAt: number }
  >();
  const rendererCookie = randomBytes(32).toString("base64url");
  const usbAudio = createM4UsbAudioQueue();
  let usbRenderer = {
    contextState: "unavailable",
    scheduledFrames: 0,
    peak: 0,
    rms: 0,
    observedAt: 0,
  };
  const expected = Buffer.from(`Bearer ${key}`);
  const expectedRendererCookie = Buffer.from(`m4_program=${rendererCookie}`);
  let address = "",
    closed = false,
    rendererClaimed = false;
  const rendererHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CurlStreamer program</title><link rel="stylesheet" href="/m4-program-renderer.css"></head><body><div id="root"></div><script src="/m4-program-renderer.js" defer></script></body></html>`;
  const builtinSponsors = new Map([
    [
      "/sponsors/community.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" rx="60" fill="#0e7490"/><circle cx="190" cy="200" r="100" fill="#fff"/><circle cx="190" cy="200" r="70" fill="#dc2626"/><circle cx="190" cy="200" r="30" fill="#2563eb"/><text x="330" y="180" fill="white" font-family="sans-serif" font-size="64" font-weight="bold">COMMUNITY</text><text x="330" y="250" fill="white" font-family="sans-serif" font-size="64" font-weight="bold">ICE</text></svg>',
    ],
    [
      "/sponsors/rock.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" rx="60" fill="#f8fafc"/><path d="M120 245h220l-35 75H155z" fill="#64748b"/><path d="M180 245c0-120 100-120 100 0" fill="none" stroke="#dc2626" stroke-width="35"/><text x="390" y="190" fill="#0f172a" font-family="sans-serif" font-size="72" font-weight="bold">ROCK</text><text x="390" y="270" fill="#0f172a" font-family="sans-serif" font-size="72" font-weight="bold">SOLID</text></svg>',
    ],
  ]);
  let sponsorAssets: ReturnType<typeof createM4SponsorAssets> | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const reply = (status: number, value: unknown) => {
      if (response.destroyed) return;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const hostAllowed = request.headers.host === new URL(address).host;
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const cookie = Buffer.from(
      request.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("m4_program=")) ?? "",
    );
    const ownerAllowed =
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected);
    const rendererAllowed =
      cookie.length === expectedRendererCookie.length &&
      timingSafeEqual(cookie, expectedRendererCookie);
    const sameContext =
      request.headers.origin === address ||
      (request.method === "GET" &&
        !request.headers.origin &&
        request.headers["sec-fetch-site"] === "same-origin");
    const allowed =
      !closed &&
      hostAllowed &&
      sameContext &&
      (ownerAllowed || rendererAllowed);
    supplied.fill(0);
    cookie.fill(0);
    // The managed recorder receives only this root URL over its inherited
    // startup frame. The first local navigation atomically receives an
    // HttpOnly capability; no secret is placed in the URL, DOM or JavaScript.
    if (
      !closed &&
      !rendererClaimed &&
      hostAllowed &&
      request.method === "GET" &&
      request.url === "/" &&
      !request.headers.origin
    ) {
      rendererClaimed = true;
      response.setHeader(
        "set-cookie",
        `m4_program=${rendererCookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(rendererHtml);
      return;
    }
    if (!allowed) {
      reply(403, { error: "Program request denied" });
      return;
    }
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(rendererHtml);
      return;
    }
    if (request.method === "GET" && request.url === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      (request.url === "/m4-program-renderer.js" ||
        request.url === "/m4-program-renderer.css" ||
        request.url === "/branding/curlstreamer-logo.png" ||
        request.url === "/branding/team-benning.png")
    ) {
      try {
        const file =
          request.url === "/branding/curlstreamer-logo.png" ||
          request.url === "/branding/team-benning.png"
            ? request.url.slice(1)
            : request.url.endsWith(".js")
              ? "m4-program-renderer.js"
              : "m4-program-renderer.css";
        const value = await readFile(
          join(
            rendererAssets?.directory ?? join(process.cwd(), "public"),
            file,
          ),
        );
        if (value.length > 1024 * 1024) throw new Error();
        response.writeHead(200, {
          "content-type": file.endsWith(".jpg")
            ? "image/jpeg"
            : file.endsWith(".png")
              ? "image/png"
              : file.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/css; charset=utf-8",
        });
        response.end(value);
      } catch {
        reply(404, { error: "Program asset unavailable" });
      }
      return;
    }
    if (request.method === "GET" && builtinSponsors.has(request.url ?? "")) {
      response.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
      });
      response.end(builtinSponsors.get(request.url!)!);
      return;
    }
    if (
      request.method === "GET" &&
      request.url?.startsWith("/sponsors/upload/")
    ) {
      const asset = sponsorAssets?.get(request.url);
      if (!asset) return reply(404, { error: "Program asset unavailable" });
      response.writeHead(200, {
        "content-type": asset.mime,
        "content-length": asset.bytes.length,
      });
      response.end(asset.bytes);
      return;
    }
    if (request.method === "GET" && request.url === "/program") {
      try {
        const game = await client.readGame();
        if (closed) return reply(409, { error: "Program closed" });
        const organizationId = client.sponsorOrganizationId?.();
        if (rendererAssets?.sponsorStorageOrigin && organizationId) {
          sponsorAssets ??= createM4SponsorAssets({
            storageOrigin: rendererAssets.sponsorStorageOrigin,
            organizationId,
            cacheDirectory: rendererAssets.sponsorCacheDirectory,
          });
        }
        const sponsors = sponsorAssets
          ? await sponsorAssets.sync(game.sponsors)
          : game.sponsors.filter((sponsor) =>
              builtinSponsors.has(sponsor.dataUrl),
            );
        if (closed) return reply(409, { error: "Program closed" });
        reply(200, {
          game: {
            ...game,
            sponsors,
          },
        });
      } catch {
        reply(409, { error: "Program unavailable" });
      }
      return;
    }
    if (request.method === "GET" && request.url === "/usb-audio") {
      // This is intentionally renderer-cookie-only. The owner capability is
      // for Node-to-bridge control and must never be usable as an audio sink.
      if (!rendererAllowed)
        return reply(403, { error: "Program request denied" });
      const { generation, pcm } = usbAudio.drain();
      response.setHeader("x-m4-usb-audio-generation", String(generation));
      if (!pcm.length) {
        response.writeHead(204);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": pcm.length,
      });
      response.end(pcm, () => pcm.fill(0));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/events/")) {
      const role = cameraRoleSchema.safeParse(
        request.url.slice("/events/".length),
      );
      if (!realtime || !role.success) {
        reply(403, { error: "Program request denied" });
        return;
      }
      try {
        const events = z
          .array(signalEnvelopeSchema)
          .max(128)
          .parse(await realtime.drain(role.data));
        if (closed || events.some((event) => event.cameraRole !== role.data))
          throw Error();
        reply(200, { events });
      } catch {
        reply(409, { error: "Camera events unavailable" });
      }
      return;
    }
    if (
      request.method !== "POST" ||
      request.url !== "/camera" ||
      request.headers["content-type"] !== "application/json"
    ) {
      reply(403, { error: "Program request denied" });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => request.destroy(), 5000);
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 40000) throw Error();
        chunks.push(chunk);
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const observation = z
        .object({
          action: z.literal("observe"),
          cameraRole: cameraRoleSchema,
          frames: z.number().int().nonnegative(),
          verified: z.boolean(),
        })
        .strict()
        .safeParse(parsed);
      if (observation.success && rendererAllowed) {
        const { cameraRole, frames, verified } = observation.data;
        const previous = cameraFrames.get(cameraRole);
        cameraFrames.set(cameraRole, {
          frames,
          advancedAt:
            verified && frames > (previous?.frames ?? 0)
              ? Date.now()
              : verified
                ? (previous?.advancedAt ?? 0)
                : 0,
        });
        reply(200, { ok: true });
        return;
      }
      const audioObservation = z
        .object({
          action: z.literal("audio-observe"),
          cameraRole: cameraRoleSchema,
          peak: z.number().finite().min(0).max(1),
          rms: z.number().finite().min(0).max(1),
          receiving: z.boolean(),
        })
        .strict()
        .safeParse(parsed);
      if (audioObservation.success && rendererAllowed) {
        const { cameraRole, peak, rms, receiving } = audioObservation.data;
        phoneAudio.set(cameraRole, {
          peak,
          rms,
          receiving,
          observedAt: Date.now(),
        });
        reply(200, { ok: true });
        return;
      }
      const usbObservation = z
        .object({
          action: z.literal("usb-audio-observe"),
          contextState: z.enum(["running", "suspended", "closed"]),
          scheduledFrames: z.number().int().nonnegative().max(480000),
          peak: z.number().finite().min(0).max(1),
          rms: z.number().finite().min(0).max(1),
        })
        .strict()
        .safeParse(parsed);
      if (usbObservation.success && rendererAllowed) {
        usbRenderer = { ...usbObservation.data, observedAt: Date.now() };
        reply(200, { ok: true });
        return;
      }
      const connect = z
        .object({ action: z.literal("connect"), cameraRole: cameraRoleSchema })
        .strict()
        .safeParse(parsed);
      clearTimeout(timer);
      if (closed) throw Error();
      let value: unknown;
      if (connect.success) {
        if (!realtime) throw Error();
        value = studioTicketSchema
          .omit({ token: true, topic: true })
          .parse(await realtime.connect(connect.data.cameraRole));
        if (
          (value as { cameraRole: CameraRole }).cameraRole !==
          connect.data.cameraRole
        )
          throw Error();
      } else value = await client.action(command.parse(parsed));
      if (closed) throw Error();
      reply(200, value);
    } catch {
      reply(409, { error: "Program unavailable" });
    } finally {
      clearTimeout(timer);
      for (const chunk of chunks) chunk.fill(0);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const bound = server.address();
  if (!bound || typeof bound === "string")
    throw Error("m4_program_unavailable");
  address = `http://127.0.0.1:${bound.port}`;
  let closing: Promise<void> | undefined;
  return {
    address,
    cameraStatus: () =>
      Object.fromEntries(
        (["camera-home", "camera-away"] as const).map((role) => [
          role,
          !closed &&
            Date.now() - (cameraFrames.get(role)?.advancedAt ?? 0) < 5000,
        ]),
      ),
    audioStatus: () =>
      Object.fromEntries(
        (["camera-home", "camera-away"] as const).map((role) => {
          const value = phoneAudio.get(role);
          const fresh =
            !closed &&
            value !== undefined &&
            Date.now() - value.observedAt < 6000;
          return [
            role,
            fresh
              ? {
                  peak: value.peak,
                  rms: value.rms,
                  receiving: value.receiving,
                }
              : { peak: 0, rms: 0, receiving: false },
          ];
        }),
      ),
    usbAudioStatus: () => {
      const queue = usbAudio.snapshot();
      const fresh = !closed && Date.now() - usbRenderer.observedAt < 6000;
      return {
        ...queue,
        renderer: fresh
          ? {
              contextState: usbRenderer.contextState,
              scheduledFrames: usbRenderer.scheduledFrames,
              peak: usbRenderer.peak,
              rms: usbRenderer.rms,
            }
          : {
              contextState: "unavailable",
              scheduledFrames: 0,
              peak: 0,
              rms: 0,
            },
      };
    },
    pushUsbAudio: (pcm: Buffer) => {
      if (closed) throw new Error("m4_program_unavailable");
      usbAudio.push(pcm);
    },
    rendererUrl: address + "/",
    // Owner-only transport capability. Never log or put in a URL/config file.
    authorization: `Bearer ${key}`,
    close: () =>
      (closing ??= (async () => {
        closed = true;
        usbAudio.reset();
        expected.fill(0);
        expectedRendererCookie.fill(0);
        client.close();
        sponsorAssets?.close();
        server.closeAllConnections();
        await realtime?.close().catch(() => undefined);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      })()),
  };
}
