import { z } from "zod";
import { organizerAccessToken } from "@/lib/access-session";
import { studioSessionBridge } from "@/lib/studio-session";

const maxClipSize = 40 * 1024 * 1024;
const method = "shot-flag-clip-v1";
const localNetworkError =
  "Could not reach Studio video. Keep this game open in Studio and connect to the same Wi-Fi.";
const timingSchema = z.object({
  capturedAt: z.iso.datetime({ offset: true }),
  duration: z.number().positive().max(125),
  minimum: z.number().nonnegative().max(125),
});
const clipHeaderSchema = timingSchema.extend({
  size: z.number().int().positive().max(maxClipSize),
});
const nativeReceiptSchema = z.object({
  gameId: z.uuid(),
  nonce: z.uuid(),
  ok: z.boolean(),
  clipId: z.uuid().optional(),
  capturedAt: z.string().optional(),
  duration: z.number().optional(),
  minimum: z.number().optional(),
  error: z.string().max(300).optional(),
});
const participantSchema = z.object({
  role: z.enum(["studio", "coach"]),
  gameId: z.uuid(),
  expiresAt: z.number().int().positive(),
});
const grantSchema = z.object({
  url: z.url().refine((value) => value.startsWith("wss://")),
  token: z.string().min(1).max(8192),
});
type Clip = z.infer<typeof timingSchema> & { video: Blob };

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}

async function signalRoom(
  gameId: string,
  role: "studio" | "coach",
  signal: AbortSignal,
) {
  const token =
    role === "studio" ? organizerAccessToken(localStorage, gameId) : undefined;
  const response = await fetch("/api/curlcoach/clip-relay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ gameId, role }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw Error(localNetworkError);
  const { url, token: roomToken } = grantSchema.parse(await response.json());
  const { Room, RoomEvent } = await import("livekit-client");
  signal.throwIfAborted();
  const room = new Room();
  try {
    await abortable(
      room.connect(url, roomToken, { autoSubscribe: false }),
      signal,
    );
    return { room, RoomEvent };
  } catch (error) {
    await room.disconnect();
    throw error;
  }
}

// Signal over the authorized room, then exchange bytes over a separate DTLS
// connection. This peer has no STUN/TURN service or media tracks.
function lanDescription(sdp: string) {
  if (!sdp || sdp.length > 12000) throw Error(localNetworkError);
  const lines = sdp.split(/\r?\n/);
  if (
    lines.filter((line) => line.startsWith("m=")).length !== 1 ||
    !lines.some((line) =>
      /^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(line),
    )
  )
    throw Error(localNetworkError);
  return lines
    .filter((line) => {
      if (!line.startsWith("a=candidate:")) return true;
      const fields = line.split(/\s+/);
      const address = fields[4] ?? "";
      return (
        fields[7] === "host" &&
        /^(?:[a-z0-9-]+\.local$|(?:10|127)\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|(?:fc|fd|fe[89ab])[0-9a-f]*:|::1$)/i.test(
          address,
        )
      );
    })
    .join("\r\n");
}

async function localDescription(
  peer: RTCPeerConnection,
  kind: "offer" | "answer",
  signal: AbortSignal,
) {
  const candidates = new Set<string>();
  const gather = ({ candidate }: RTCPeerConnectionIceEvent) => {
    if (candidate?.candidate) candidates.add(`a=${candidate.candidate}`);
  };
  peer.addEventListener("icecandidate", gather);
  try {
    await peer.setLocalDescription(
      kind === "offer" ? await peer.createOffer() : await peer.createAnswer(),
    );
    if (!signal.aborted && peer.iceGatheringState !== "complete") {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          peer.removeEventListener("icegatheringstatechange", change);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const change = () => {
          if (peer.iceGatheringState === "complete") finish();
        };
        const timer = setTimeout(finish, 3500);
        peer.addEventListener("icegatheringstatechange", change);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
    signal.throwIfAborted();
    const sdp = peer.localDescription?.sdp ?? "";
    const lines = sdp.trimEnd().split(/\r?\n/);
    // Some engines report mDNS addresses as events without updating the SDP.
    const extra = [...candidates].filter((line) => !lines.includes(line));
    const end = lines.indexOf("a=end-of-candidates");
    lines.splice(end < 0 ? lines.length : end, 0, ...extra);
    return lanDescription([...lines, ""].join("\r\n"));
  } finally {
    peer.removeEventListener("icecandidate", gather);
  }
}

function participantMetadata(metadata: string | undefined) {
  try {
    const result = participantSchema.safeParse(JSON.parse(metadata ?? ""));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function receiveClip(channel: RTCDataChannel, signal: AbortSignal) {
  channel.binaryType = "arraybuffer";
  return abortable(
    new Promise<Clip>((resolve, reject) => {
      let header: z.infer<typeof clipHeaderSchema> | undefined;
      let size = 0;
      const parts: ArrayBuffer[] = [];
      channel.onclose = channel.onerror = () =>
        reject(Error(localNetworkError));
      channel.onmessage = ({ data }) => {
        try {
          if (data === "unavailable")
            throw Error(
              "Studio could not capture recent video. Try again when the cameras are ready.",
            );
          if (data === "done" && header && size === header.size) {
            resolve({
              ...header,
              video: new Blob(parts, { type: "video/mp4" }),
            });
            return;
          }
          if (!header && typeof data === "string" && data.length <= 512) {
            header = clipHeaderSchema.parse(JSON.parse(data));
            if (header.minimum > header.duration)
              throw Error(localNetworkError);
          } else if (
            header &&
            data instanceof ArrayBuffer &&
            data.byteLength > 0 &&
            data.byteLength <= 16 * 1024 &&
            size + data.byteLength <= header.size
          ) {
            size += data.byteLength;
            parts.push(data);
          } else throw Error(localNetworkError);
        } catch (error) {
          channel.close();
          reject(error);
        }
      };
    }),
    signal,
  );
}

export async function captureShotFlagClip(
  gameId: string,
  cancellation: AbortSignal,
): Promise<Clip> {
  if (typeof RTCPeerConnection === "undefined")
    throw Error(
      "This browser cannot open a direct connection to Studio video.",
    );
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(75_000)]);
  const { room } = await signalRoom(gameId, "coach", signal);
  const peer = new RTCPeerConnection({ iceServers: [] });
  try {
    const identity = `studio-${gameId}`;
    const studio = participantMetadata(
      room.remoteParticipants.get(identity)?.metadata,
    );
    if (studio?.role !== "studio" || studio.gameId !== gameId)
      throw Error(localNetworkError);
    const channel = peer.createDataChannel(method);
    const clip = receiveClip(channel, signal);
    void clip.catch(() => undefined);
    const offer = await localDescription(peer, "offer", signal);
    const answer = await abortable(
      room.localParticipant.performRpc({
        destinationIdentity: identity,
        method,
        payload: offer,
        responseTimeout: 12_000,
      }),
      signal,
    );
    await peer.setRemoteDescription({
      type: "answer",
      sdp: lanDescription(answer),
    });
    return await clip;
  } finally {
    peer.close();
    await room.disconnect();
  }
}

async function captureNativeClip(gameId: string, signal: AbortSignal) {
  const bridge = studioSessionBridge();
  if (!bridge) throw Error(localNetworkError);
  const nonce = crypto.randomUUID();
  const captureSignal = AbortSignal.any([signal, AbortSignal.timeout(22_000)]);
  const reply = await new Promise<z.infer<typeof nativeReceiptSchema>>(
    (resolve, reject) => {
      const clean = () => {
        window.removeEventListener("studio-coach-capture-result", receive);
        captureSignal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        clean();
        reject(captureSignal.reason);
      };
      const receive = (event: Event) => {
        const parsed = nativeReceiptSchema.safeParse(
          (event as CustomEvent).detail,
        );
        if (
          !parsed.success ||
          parsed.data.gameId !== gameId ||
          parsed.data.nonce !== nonce
        )
          return;
        clean();
        resolve(parsed.data);
      };
      if (captureSignal.aborted) return cancel();
      window.addEventListener("studio-coach-capture-result", receive);
      captureSignal.addEventListener("abort", cancel, { once: true });
      try {
        bridge.postMessage({ type: "studio-coach-capture", gameId, nonce });
      } catch (error) {
        clean();
        reject(error);
      }
    },
  );
  if (!reply.ok || !reply.clipId) throw Error(reply.error ?? localNetworkError);
  const timing = timingSchema.parse(reply);
  const response = await fetch(
    `/__studio-coach-clip/${gameId}/${reply.clipId}`,
    {
      mode: "same-origin",
      cache: "no-store",
      signal: captureSignal,
    },
  );
  const size = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > maxClipSize ||
    response.headers.get("content-type") !== "video/mp4"
  )
    throw Error(localNetworkError);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== size) throw Error(localNetworkError);
  return { timing, bytes };
}

async function sendClip(
  channel: RTCDataChannel,
  gameId: string,
  signal: AbortSignal,
) {
  const { timing, bytes } = await captureNativeClip(gameId, signal);
  channel.bufferedAmountLowThreshold = 128 * 1024;
  channel.send(JSON.stringify({ ...timing, size: bytes.byteLength }));
  for (let offset = 0; offset < bytes.byteLength; offset += 16 * 1024) {
    signal.throwIfAborted();
    if (channel.bufferedAmount > 256 * 1024) {
      await new Promise<void>((resolve, reject) => {
        const clean = () => {
          channel.removeEventListener("bufferedamountlow", drained);
          channel.removeEventListener("close", cancelled);
          signal.removeEventListener("abort", cancelled);
        };
        const drained = () => {
          clean();
          resolve();
        };
        const cancelled = () => {
          clean();
          reject(Error(localNetworkError));
        };
        channel.addEventListener("bufferedamountlow", drained, { once: true });
        channel.addEventListener("close", cancelled, { once: true });
        signal.addEventListener("abort", cancelled, { once: true });
      });
    }
    channel.send(bytes.slice(offset, offset + 16 * 1024));
  }
  channel.send("done");
}

/** Serve a single recent-video request at a time while its Studio game is open. */
export async function serveShotFlagClips(gameId: string, signal: AbortSignal) {
  const { room, RoomEvent } = await signalRoom(
    gameId,
    "studio",
    AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
  );
  let activePeer: RTCPeerConnection | undefined;
  room.registerRpcMethod(method, async ({ callerIdentity, payload }) => {
    const caller = participantMetadata(
      room.remoteParticipants.get(callerIdentity)?.metadata,
    );
    if (
      activePeer ||
      caller?.role !== "coach" ||
      caller.gameId !== gameId ||
      caller.expiresAt <= Date.now()
    )
      throw Error(localNetworkError);
    const offer = lanDescription(payload);
    const peer = new RTCPeerConnection({ iceServers: [] });
    activePeer = peer;
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(
        Math.max(0, Math.min(75_000, caller.expiresAt - Date.now())),
      ),
    ]);
    let activeChannel: RTCDataChannel | undefined;
    let drainDeadline: ReturnType<typeof setTimeout> | undefined;
    const clean = () => {
      clearTimeout(drainDeadline);
      deadline.removeEventListener("abort", clean);
      peer.close();
      if (activePeer === peer) activePeer = undefined;
    };
    deadline.addEventListener("abort", clean, { once: true });
    peer.onconnectionstatechange = () => {
      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "closed"
      )
        clean();
    };
    peer.ondatachannel = ({ channel }) => {
      if (activeChannel || channel.label !== method) return channel.close();
      activeChannel = channel;
      channel.onclose = clean;
      const send = () => {
        if (deadline.aborted || caller.expiresAt <= Date.now()) return clean();
        void sendClip(channel, gameId, deadline)
          .catch(() => {
            if (channel.readyState === "open") channel.send("unavailable");
          })
          .catch(clean)
          .finally(() => {
            if (activePeer === peer) drainDeadline = setTimeout(clean, 5000);
          });
      };
      if (channel.readyState === "open") send();
      else channel.onopen = send;
    };
    try {
      await peer.setRemoteDescription({ type: "offer", sdp: offer });
      return await localDescription(peer, "answer", deadline);
    } catch (error) {
      clean();
      throw error;
    }
  });
  try {
    await abortable(
      new Promise<void>((resolve) =>
        room.once(RoomEvent.Disconnected, () => resolve()),
      ),
      signal,
    );
  } finally {
    activePeer?.close();
    await room.disconnect();
  }
}
