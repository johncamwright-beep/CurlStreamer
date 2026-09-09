// Temporary local operator surface for the pilot; the packaged Studio shell is pending.
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { M4DesktopClient } from "./m4-desktop-client";
import { checkM4NativeHost } from "./m4-native-preflight";
import { startM4ProgramHost } from "./m4-program-host";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }).strict(),
  z
    .object({
      action: z.literal("pair"),
      code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z.object({ action: z.literal("stop") }).strict(),
  z
    .object({
      action: z.literal("start-program"),
      invitation: z.string().min(1).max(512),
    })
    .strict(),
  z.object({ action: z.literal("stop-program") }).strict(),
  z
    .object({
      action: z.literal("start-stream"),
      intentId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal("stop-stream") }).strict(),
]);
const invitationCode = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

function readProgramInvitation(value: string, origin: string, gameId: string) {
  const direct = invitationCode.safeParse(value);
  if (direct.success) return direct.data;
  try {
    const url = new URL(value);
    const match = url.hash.match(/^#code=([A-Za-z0-9_-]{43})$/);
    if (
      url.origin !== origin ||
      url.pathname !== `/studio-m3/${gameId}/program` ||
      url.search ||
      url.username ||
      url.password ||
      !match
    )
      throw new Error();
    return invitationCode.parse(match[1]);
  } catch {
    throw new Error("Invalid program invitation");
  }
}
type ProgramHandle = Omit<
  Awaited<ReturnType<typeof startM4ProgramHost>>,
  "stream" | "previewMapping" | "cameraStatus"
> & {
  previewMapping?: string;
  cameraStatus?: () => Record<string, boolean>;
  stream?: {
    start(desktop: M4DesktopClient, intentId: string): Promise<void>;
    stop(): Promise<void>;
    snapshot(): {
      state: "idle" | "starting" | "armed" | "stopping" | "stopped" | "failed";
      localOutput?: {
        state:
          "unknown" | "idle" | "connecting" | "active" | "stopped" | "failed";
        bytes: number;
      };
      provider?: {
        streamStatus:
          "active" | "created" | "ready" | "inactive" | "error" | "missing";
        healthStatus: "good" | "ok" | "bad" | "noData" | null;
        broadcastStatus: string;
        broadcastLive: boolean;
      };
      liveConfirmed?: boolean;
    };
  };
};
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  let assembled: Buffer | undefined;
  const timer = setTimeout(() => request.destroy(), 5000);
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1024) {
        chunk.fill(0);
        throw new Error();
      }
      chunks.push(chunk);
    }
    assembled = Buffer.concat(chunks);
    return command.parse(JSON.parse(assembled.toString("utf8")));
  } finally {
    clearTimeout(timer);
    assembled?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function createM4OperatorServer(options: {
  gameId: string;
  origin: string;
  paths: { executable: string; plugin: string; runtime: string };
  pairingEnabled?: boolean;
  /** Deliberately fail closed: this must be explicitly enabled by the launcher. */
  streamingEnabled?: boolean;
  check?: () => Promise<void>;
  desktop?: M4DesktopClient;
  program?: {
    realtimeUrl: string;
    realtimeKey: string;
    recorder: string;
    runtime: string;
    recordingRoot: string;
    cacheRoot: string;
    rendererRoot: string;
    streamPlugin?: string;
    start?: (invitation: string, recording: string) => Promise<ProgramHandle>;
  };
}) {
  const desktop =
    options.desktop ?? new M4DesktopClient(options.gameId, options.origin);
  const cookie = randomBytes(32).toString("hex"),
    nonce = randomBytes(16).toString("hex");
  let pc = "unchecked",
    pairing = "unpaired",
    message = "Check this PC to begin.",
    program = options.program ? "idle" : "disabled",
    programMessage = options.program
      ? "Create a one-use program invitation, then start the local recording."
      : "Local program recording is not configured.",
    busy = 0,
    epoch = 0;
  let streaming = options.streamingEnabled === true ? "idle" : "disabled",
    streamingMessage =
      options.streamingEnabled === true
        ? "Start a local output when the program recording is ready."
        : "Streaming is disabled for this pilot.",
    streamEpoch = 0;
  let programHandle: ProgramHandle | undefined;
  let address = "";
  let closing = false;
  let cleanupFailed = false;
  let closePromise: Promise<{ cleanupConfirmed: boolean }> | undefined;
  let pendingProgram: Promise<void> | undefined;
  const observation = z
    .object({
      localOutput: z
        .object({
          state: z.enum([
            "unknown",
            "idle",
            "connecting",
            "active",
            "stopped",
            "failed",
          ]),
          bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        })
        .optional(),
      provider: z
        .object({
          streamStatus: z.enum([
            "active",
            "created",
            "ready",
            "inactive",
            "error",
            "missing",
          ]),
          healthStatus: z.enum(["good", "ok", "bad", "noData"]).nullable(),
          broadcastStatus: z.string().max(100),
          broadcastLive: z.boolean(),
        })
        .optional(),
      liveConfirmed: z.boolean().optional(),
    })
    .passthrough();
  const snapshot = () => {
    const raw = programHandle?.stream?.snapshot();
    const actual = raw?.state;
    const observed = observation.safeParse(raw).success
      ? observation.parse(raw)
      : {};
    const localOutput = observed.localOutput ?? {
      state: "unknown" as const,
      bytes: 0,
    };
    const provider = observed.provider;
    if (options.streamingEnabled === true && actual && actual !== streaming) {
      streaming = actual;
      streamingMessage =
        actual === "armed"
          ? "Streaming request approved. YouTube reception is not confirmed."
          : actual === "failed"
            ? "Local output failed. Recording continues."
            : actual === "stopped"
              ? "Streaming permission released. Recording continues."
              : "Local output is not armed.";
    }
    if (pairing === "paired" && !desktop.snapshot().authorized) {
      pairing = desktop.snapshot().state === "stopped" ? "stopped" : "failed";
      message =
        pairing === "stopped"
          ? "Desktop released. Recording is controlled separately."
          : "Desktop authority ended. Reopen Studio to pair again.";
    }
    const broadcastLive = Boolean(
      observed.liveConfirmed &&
      localOutput.state === "active" &&
      localOutput.bytes > 0 &&
      provider?.streamStatus === "active" &&
      provider.broadcastLive &&
      streaming === "armed" &&
      desktop.snapshot().authorized,
    );
    return {
      pc,
      pairing,
      message,
      busy: busy > 0,
      challenge: desktop.challenge,
      streamingAvailable:
        options.streamingEnabled === true &&
        options.pairingEnabled === true &&
        Boolean(programHandle?.stream),
      streaming,
      streamingMessage:
        streaming === "armed"
          ? broadcastLive
            ? "YouTube reception and live broadcast confirmed. Recording continues."
            : provider?.streamStatus === "active"
              ? "YouTube reception confirmed. Live broadcast is not confirmed."
              : "Streaming request approved. YouTube reception is not confirmed."
          : streamingMessage,
      localOutput: {
        state: localOutput.state,
        bytes: localOutput.state === "active" ? localOutput.bytes : 0,
      },
      youtubeReception:
        provider?.streamStatus === "active" ? "confirmed" : "unknown",
      broadcast: broadcastLive ? "live" : "unknown",
      pairingAvailable: options.pairingEnabled === true,
      programAvailable: Boolean(options.program),
      program,
      programMessage,
      previewMapping:
        program === "recording" ? programHandle?.previewMapping : undefined,
      cameraStatus:
        program === "recording" ? programHandle?.cameraStatus?.() : {},
    };
  };
  const approval = new URL(
    `/studio-m4/${z.uuid().parse(options.gameId)}/pairing`,
    options.origin,
  ).href;
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CurlStreamer Studio pilot</title><style>body{font:18px system-ui;background:#071320;color:#eef6ff;margin:0}main{max-width:680px;margin:auto;padding:32px 20px}section{background:#132236;padding:24px;border-radius:18px;margin:20px 0}button,input,a{min-height:44px;box-sizing:border-box}button{padding:12px 20px;border:0;border-radius:10px;margin:4px;background:#21c7df;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.45;cursor:default}input{display:block;width:100%;padding:12px;margin:10px 0;background:#071320;color:white;border:1px solid #7992ab;border-radius:8px}a{color:#73e4f3;display:inline-flex;align-items:center}p{line-height:1.5}code{display:block;overflow-wrap:anywhere;padding:12px;background:#071320}label{display:block}#status,#programStatus,#streamStatus{min-height:54px}</style><main><h1>CurlStreamer Studio</h1><p>Pilot controls on this PC</p><section><h2>Desktop connection</h2><p id="status" role="status" aria-live="polite"></p><button id="check">Check this PC</button></section><section ${options.pairingEnabled === true ? "" : "hidden"}><h2>Pair with your game</h2><p>Open the approval page and enter this desktop challenge.</p><code id="challenge"></code><a href="${escape(approval)}" target="_blank" rel="noopener noreferrer">Open approval page</a><form id="pair"><label for="code">Approval code</label><input id="code" type="password" autocomplete="off" spellcheck="false"><button id="pairButton">Pair desktop</button></form></section><section ${options.program ? "" : "hidden"}><h2>Local program recording</h2><p id="programStatus" role="status" aria-live="polite"></p><form id="programForm"><label for="programInvitation">Private OBS source link or one-use code</label><input id="programInvitation" type="password" autocomplete="off" spellcheck="false"><button id="programStart">Start program and recording</button></form><button id="programStop">Stop and finalize recording</button></section><section><h2>Streaming</h2><p id="streamStatus" role="status" aria-live="polite"></p><p>YouTube reception must be confirmed separately. Stopping streaming leaves your local recording running.</p><button id="streamStart">Start streaming</button><button id="streamStop">Stop streaming</button><button id="stop">Release desktop</button></section></main><script nonce="${nonce}">const $=id=>document.getElementById(id);async function refresh(){try{const r=await fetch('/state',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();$('status').textContent=s.message;$('programStatus').textContent=s.programMessage;$('streamStatus').textContent=s.streamingMessage;$('challenge').textContent=s.challenge;$('check').disabled=s.busy;$('pairButton').disabled=!s.pairingAvailable||s.busy||s.pc!=='ready'||s.pairing!=='unpaired';$('stop').disabled=s.pairing==='unpaired'||s.pairing==='stopped';$('programStart').disabled=!s.programAvailable||s.busy||!['idle','stopped','failed'].includes(s.program);$('programStop').disabled=!['starting','recording'].includes(s.program);$('streamStart').disabled=!s.streamingAvailable||s.busy||s.pc!=='ready'||s.pairing!=='paired'||s.program!=='recording'||s.streaming!=='idle';$('streamStop').disabled=!['starting','armed','failed'].includes(s.streaming);}catch{$('status').textContent='Studio connection closed. Reopen the local operator window.';}}async function send(value){try{const r=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw Error();}catch{$('status').textContent='Could not complete that action.';}finally{await refresh();}}$('check').onclick=()=>send({action:'check'});$('stop').onclick=()=>send({action:'stop'});$('streamStart').onclick=()=>send({action:'start-stream',intentId:crypto.randomUUID()});$('streamStop').onclick=()=>send({action:'stop-stream'});$('pair').onsubmit=e=>{e.preventDefault();const code=$('code').value.trim();$('code').value='';void send({action:'pair',code});};$('programForm').onsubmit=e=>{e.preventDefault();const invitation=$('programInvitation').value.trim();$('programInvitation').value='';void send({action:'start-program',invitation});};$('programStop').onclick=()=>send({action:'stop-program'});async function poll(){await refresh();setTimeout(poll,2000);}void poll();</script></html>`;
  const operatorHtml = html
    .replace(
      "fetch('/state',{cache:'no-store'})",
      "fetch('/state',{cache:'no-store',signal:AbortSignal.timeout(4000)})",
    )
    .replace(
      "</main><script",
      '<p id="localOutput" role="status" aria-live="polite">Local output: Unknown</p><p id="youtubeReception" role="status" aria-live="polite">YouTube reception: Unknown</p><p id="broadcastStatus" role="status" aria-live="polite">Broadcast: Unknown</p></main><script',
    )
    .replace(
      "$('streamStatus').textContent=s.streamingMessage;",
      "$('streamStatus').textContent=s.streamingMessage;$('localOutput').textContent='Local output: '+(s.localOutput.state==='active'?'Active ('+s.localOutput.bytes+' bytes)':s.localOutput.state==='stopped'?'Stopped':s.localOutput.state==='connecting'?'Connecting':s.localOutput.state==='failed'?'Failed':s.localOutput.state==='idle'?'Idle':'Unknown');$('youtubeReception').textContent='YouTube reception: '+(s.youtubeReception==='confirmed'?'Confirmed':'Unknown');$('broadcastStatus').textContent='Broadcast: '+(s.broadcast==='live'?'Live':'Unknown');",
    )
    .replace(
      "catch{$('status').textContent='Studio connection closed.",
      "catch{$('localOutput').textContent='Local output: Unknown';$('youtubeReception').textContent='YouTube reception: Unknown';$('broadcastStatus').textContent='Broadcast: Unknown';$('status').textContent='Studio connection closed.",
    );
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (closing) {
      reply(503, { error: "Studio is closing" });
      return;
    }
    if (request.headers.host !== new URL(address).host) {
      reply(403, { error: "Request denied" });
      return;
    }
    if (request.method === "GET" && request.url === "/") {
      response.setHeader(
        "Set-Cookie",
        `m4_operator=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(operatorHtml);
      return;
    }
    if (
      !request.headers.cookie
        ?.split(";")
        .some((part) => part.trim() === `m4_operator=${cookie}`)
    ) {
      reply(403, { error: "Request denied" });
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      reply(200, snapshot());
      return;
    }
    if (
      request.method !== "POST" ||
      request.url !== "/command" ||
      request.headers.origin !== address ||
      request.headers["content-type"] !== "application/json"
    ) {
      reply(403, { error: "Request denied" });
      return;
    }
    try {
      const input = await body(request);
      if (busy && input.action !== "stop" && input.action !== "stop-stream") {
        reply(409, { error: "Action in progress" });
        return;
      }
      if (
        input.action === "pair" &&
        (options.pairingEnabled !== true ||
          pc !== "ready" ||
          pairing !== "unpaired")
      ) {
        reply(409, { error: "Check this PC first" });
        return;
      }
      if (
        input.action === "start-program" &&
        (!options.program ||
          pc !== "ready" ||
          !["idle", "stopped", "failed"].includes(program))
      ) {
        reply(409, { error: "Check this PC before starting the program" });
        return;
      }
      if (input.action === "stop-program" && !programHandle) {
        reply(409, { error: "No program recording is active" });
        return;
      }
      if (
        input.action === "start-stream" &&
        (options.streamingEnabled !== true ||
          options.pairingEnabled !== true ||
          pc !== "ready" ||
          pairing !== "paired" ||
          !desktop.snapshot().authorized ||
          program !== "recording" ||
          !programHandle?.stream ||
          streaming !== "idle" ||
          programHandle.stream.snapshot().state !== "idle")
      ) {
        reply(409, { error: "Streaming is not ready" });
        return;
      }
      if (input.action === "stop-stream" && !programHandle?.stream) {
        reply(409, { error: "No stream is active" });
        return;
      }
      const attempt = ++epoch;
      let programSettled: (() => void) | undefined;
      if (input.action === "start-program") {
        pendingProgram = new Promise<void>((resolve) => {
          programSettled = resolve;
        });
      }
      ++busy;
      try {
        if (input.action === "check") {
          pc = "checking";
          message = "Checking this PC…";
          await (options.check ?? (() => checkM4NativeHost(options.paths)))();
          if (attempt === epoch) {
            pc = "ready";
            message =
              options.streamingEnabled === true
                ? "This PC passed the connection check. Streaming is ready only after pairing and program recording."
                : "This PC passed the connection check. Streaming remains disabled.";
          }
        } else if (input.action === "pair") {
          pairing = "pairing";
          message = "Pairing desktop…";
          await desktop.exchange(input.code);
          if (attempt === epoch) {
            pairing = "paired";
            message = "Desktop paired. No broadcast is running.";
          }
        } else if (input.action === "start-program") {
          const configuration = options.program!;
          const invitation = readProgramInvitation(
            input.invitation,
            options.origin,
            options.gameId,
          );
          program = "starting";
          programMessage = "Starting the private program and recording…";
          await mkdir(configuration.recordingRoot, { recursive: true });
          const recording = join(
            configuration.recordingRoot,
            `${new Date().toISOString().replace(/[:.]/g, "-")}.mkv`,
          );
          const handle = await (
            configuration.start ??
            ((invitation: string, destination: string) =>
              startM4ProgramHost({
                gameId: options.gameId,
                origin: options.origin,
                invitation,
                realtimeUrl: configuration.realtimeUrl,
                realtimeKey: configuration.realtimeKey,
                executable: configuration.recorder,
                runtime: configuration.runtime,
                recording: destination,
                previewOnly: true,
                cacheRoot: configuration.cacheRoot,
                rendererRoot: configuration.rendererRoot,
                streamPlugin: configuration.streamPlugin,
              }))
          )(invitation, recording);
          if (closing) {
            try {
              await handle.stop();
              if (!(await handle.closed).finalized) cleanupFailed = true;
            } catch {
              cleanupFailed = true;
            }
            throw new Error();
          }
          programHandle = handle;
          program = "recording";
          programMessage = "Program connected. Local recording is active.";
          void handle.closed.then((result) => {
            if (!result.finalized) cleanupFailed = true;
            if (programHandle !== handle) return;
            if (handle.stream && streaming !== "failed") {
              streaming = result.finalized ? "stopped" : "failed";
              streamingMessage = result.finalized
                ? "Local output and recording ended."
                : "Program ended unexpectedly. Local output is unavailable.";
            }
            programHandle = undefined;
            program = result.finalized ? "stopped" : "failed";
            programMessage = result.finalized
              ? "Recording finalized."
              : "Program recording stopped unexpectedly.";
          });
        } else if (input.action === "start-stream") {
          const handle = programHandle!;
          const stream = handle.stream!;
          const streamAttempt = ++streamEpoch;
          streaming = "starting";
          streamingMessage = "Authorizing local desktop output…";
          await stream.start(desktop, input.intentId);
          if (streamAttempt === streamEpoch && programHandle === handle) {
            streaming = "armed";
            streamingMessage =
              "Streaming request approved. YouTube reception is not confirmed.";
          }
        } else if (input.action === "stop-stream") {
          const handle = programHandle;
          const streamAttempt = ++streamEpoch;
          streaming = "stopping";
          streamingMessage = "Stopping local output…";
          await handle?.stream?.stop();
          if (streamAttempt === streamEpoch) {
            streaming = "stopped";
            streamingMessage =
              "Streaming permission released. Recording continues.";
          }
        } else if (input.action === "stop-program") {
          const handle = programHandle!;
          program = "stopping";
          programMessage = "Finalizing the local recording…";
          if (handle.stream) {
            ++streamEpoch;
            streaming = "stopping";
            streamingMessage = "Stopping local output…";
            try {
              await handle.stream.stop();
              streaming = "stopped";
              streamingMessage =
                "Streaming permission released. Recording is finalizing.";
            } catch {
              streaming = "failed";
              streamingMessage =
                "Stream stop was not confirmed. Recording is finalizing.";
            }
          }
          await handle.stop();
          const result = await handle.closed;
          if (!result.finalized) throw new Error();
          if (programHandle === handle) programHandle = undefined;
          program = "stopped";
          programMessage = "Recording finalized.";
        } else {
          const handle = programHandle;
          if (handle?.stream) {
            ++streamEpoch;
            streaming = "stopping";
            streamingMessage = "Stopping local output…";
            try {
              await handle.stream.stop();
              streaming = "stopped";
              streamingMessage =
                "Streaming permission released. Recording continues.";
            } catch {
              streaming = "failed";
              streamingMessage =
                "Stream stop was not confirmed. Recording continues.";
            }
          }
          pairing = "stopping";
          message = "Releasing desktop…";
          await desktop.stop();
          pairing = "stopped";
          message = "Desktop released.";
        }
      } catch {
        if (
          attempt === epoch ||
          input.action === "start-program" ||
          input.action === "stop-program"
        ) {
          if (input.action === "check") {
            pc = "failed";
            message =
              "Could not verify this PC. Check the Studio installation.";
          } else if (
            input.action === "start-stream" ||
            input.action === "stop-stream"
          ) {
            streaming = "failed";
            streamingMessage =
              "Local output could not be changed. Recording continues.";
          } else if (
            input.action === "start-program" ||
            input.action === "stop-program"
          ) {
            program = "failed";
            programMessage =
              "Local program recording failed. Create a fresh invitation and try again.";
          } else {
            pairing = "failed";
            message =
              "Desktop action failed. Reopen Studio before pairing again.";
          }
        }
        if (input.action === "pair")
          await desktop.stop().catch(() => undefined);
      } finally {
        programSettled?.();
        --busy;
      }
      reply(200, snapshot());
    } catch {
      reply(400, { error: "Invalid command" });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const bound = server.address();
  if (!bound || typeof bound === "string")
    throw new Error("m4_operator_unavailable");
  address = `http://127.0.0.1:${bound.port}`;
  const heartbeat = setInterval(() => {
    if (
      pairing !== "paired" ||
      busy ||
      ["starting", "armed", "stopping"].includes(streaming)
    )
      return;
    const attempt = epoch;
    ++busy;
    void desktop
      .heartbeat()
      .then((result) => {
        if (attempt === epoch && !result.authorized) {
          pairing = "failed";
          message = "Desktop authority ended. Reopen Studio to pair again.";
        }
      })
      .catch(() => {
        if (attempt === epoch) {
          pairing = "failed";
          message = "Desktop connection ended. Reopen Studio to pair again.";
        }
      })
      .finally(() => {
        --busy;
      });
  }, 5000);
  return {
    address,
    close() {
      if (closePromise) return closePromise;
      clearInterval(heartbeat);
      closing = true;
      ++epoch;
      ++streamEpoch;
      closePromise = (async () => {
        const handle = programHandle;
        await handle?.stream?.stop().catch(() => {
          cleanupFailed = true;
        });
        try {
          await handle?.stop();
          if (handle && !(await handle.closed).finalized) cleanupFailed = true;
        } catch {
          cleanupFailed = true;
        }
        await pendingProgram;
        await desktop.stop().catch(() => {
          // An untouched desktop has no server session to release.
          if (pairing !== "unpaired") cleanupFailed = true;
        });
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return { cleanupConfirmed: !cleanupFailed };
      })();
      return closePromise;
    },
  };
}
