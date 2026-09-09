import {
  hostCandidate,
  signalAllowed,
  type StudioSignal,
  type StudioSide,
} from "@/lib/studio-protocol";

export type DirectMetrics = {
  diagnosticsVersion?: 2;
  side?: StudioSide;
  direct: boolean;
  path: "pending" | "host" | "peer-reflexive" | "rejected";
  bytesReceived: number;
  bytesSent: number;
  framesDecoded: number;
  framesPerSecond: number;
  packetsLost: number;
  roundTripTime: number;
  relayBytes: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
  pairState?: string;
  connectionState?: RTCPeerConnectionState;
  iceConnectionState?: RTCIceConnectionState;
  signalingState?: RTCSignalingState;
  iceGatheringState?: RTCIceGatheringState;
  handshake?: {
    readyReceived: number;
    offersReceived: number;
    answersReceived: number;
    offersSent: number;
    answersSent: number;
  };
  signaling?: {
    received: number;
    accepted: number;
    expired: number;
    rejected: number;
  };
  timing?: {
    clock: "server" | "device";
    remainingMs?: number;
    roundTripMs?: number;
  };
  localEndpointProven?: boolean;
  remoteEndpointProven?: boolean;
  localPrivateEndpoint?: boolean;
  remotePrivateEndpoint?: boolean;
  localEndpointIssue?: EndpointIssue;
  remoteEndpointIssue?: EndpointIssue;
};
type EndpointIssue =
  | "none"
  | "candidate-missing"
  | "address-unavailable"
  | "mdns-address"
  | "ipv6-address"
  | "invalid-address"
  | "non-private-ipv4"
  | "port-unavailable-or-invalid"
  | "protocol-unavailable-or-unsupported"
  | "host-endpoint-not-matched";

// Older stats implementations expose the same endpoint as `ip`. Do not
// override an explicitly empty, redacted, or invalid modern address.
function candidateAddress(candidate: Record<string, unknown>) {
  return candidate.address === undefined ? candidate.ip : candidate.address;
}
/** Export aggregate metrics only; never export addresses, SDP, or raw stats. */
export function reduceDirectStats(
  stats: RTCStatsReport,
  advertised: { local: ReadonlySet<string>; remote: ReadonlySet<string> } = {
    local: new Set(),
    remote: new Set(),
  },
): DirectMetrics {
  const rows: Record<string, unknown>[] = [];
  stats.forEach((row) =>
    rows.push(
      row.type === "local-candidate" || row.type === "remote-candidate"
        ? { ...row, address: candidateAddress(row) }
        : row,
    ),
  );
  const transport = rows.find(
    (row) =>
      row.type === "transport" &&
      typeof row.selectedCandidatePairId === "string",
  );
  const pair = transport
    ? rows.find((row) => row.id === transport.selectedCandidatePairId)
    : rows.find(
        (row) =>
          row.type === "candidate-pair" &&
          row.selected === true &&
          row.state === "succeeded",
      );
  const local = rows.find((row) => row.id === pair?.localCandidateId);
  const remote = rows.find((row) => row.id === pair?.remoteCandidateId);
  const video = rows.find(
    (row) =>
      row.type === "inbound-rtp" &&
      (row.kind === "video" || row.mediaType === "video"),
  );
  const n = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const peerReflexive = [local, remote].some(
    (c) => c?.candidateType === "prflx",
  );
  const proven = (
    candidate: Record<string, unknown> | undefined,
    side: "local" | "remote",
  ) => {
    if (candidate?.candidateType === "host") return true;
    if (candidate?.candidateType !== "prflx") return false;
    const endpoint = privateEndpoint(
      candidate.address,
      candidate.port,
      candidate.protocol,
    );
    return (
      endpoint !== null &&
      (advertised[side].has(endpoint) ||
        rows.some(
          (row) =>
            row.type === `${side}-candidate` &&
            row.candidateType === "host" &&
            privateEndpoint(row.address, row.port, row.protocol) === endpoint,
        ))
    );
  };
  const direct = Boolean(
    pair &&
    pair.state === "succeeded" &&
    proven(local, "local") &&
    proven(remote, "remote") &&
    (!peerReflexive ||
      (privateEndpoint(local?.address, local?.port, local?.protocol) !== null &&
        privateEndpoint(remote?.address, remote?.port, remote?.protocol) !==
          null)),
  );
  let relayBytes = 0;
  for (const candidatePair of rows.filter(
    (row) => row.type === "candidate-pair",
  )) {
    if (
      rows.some(
        (row) =>
          (row.id === candidatePair.localCandidateId ||
            row.id === candidatePair.remoteCandidateId) &&
          row.candidateType === "relay",
      )
    )
      relayBytes += n(candidatePair.bytesSent) + n(candidatePair.bytesReceived);
  }
  return {
    diagnosticsVersion: 2,
    localEndpointIssue: endpointIssue(local, proven(local, "local")),
    remoteEndpointIssue: endpointIssue(remote, proven(remote, "remote")),
    localEndpointProven: proven(local, "local"),
    remoteEndpointProven: proven(remote, "remote"),
    localPrivateEndpoint:
      privateEndpoint(local?.address, local?.port, local?.protocol) !== null,
    remotePrivateEndpoint:
      privateEndpoint(remote?.address, remote?.port, remote?.protocol) !== null,
    pairState:
      typeof pair?.state === "string" &&
      ["frozen", "waiting", "in-progress", "failed", "succeeded"].includes(
        pair.state,
      )
        ? pair.state
        : "unavailable",
    localCandidateType: candidateType(local?.candidateType),
    remoteCandidateType: candidateType(remote?.candidateType),
    direct: direct && relayBytes === 0,
    path:
      relayBytes > 0 ||
      [local, remote].some(
        (candidate, index) =>
          typeof candidate?.candidateType === "string" &&
          candidate.candidateType !== "host" &&
          !proven(candidate, index === 0 ? "local" : "remote"),
      )
        ? "rejected"
        : direct
          ? peerReflexive
            ? "peer-reflexive"
            : "host"
          : "pending",
    bytesReceived: n(pair?.bytesReceived),
    bytesSent: n(pair?.bytesSent),
    framesDecoded: n(video?.framesDecoded),
    framesPerSecond: n(video?.framesPerSecond),
    packetsLost: n(video?.packetsLost),
    roundTripTime: n(pair?.currentRoundTripTime),
    relayBytes,
  };
}

/** Explain validation failures using fixed labels; never serialize endpoint values. */
function endpointIssue(
  candidate: Record<string, unknown> | undefined,
  proven: boolean,
): EndpointIssue {
  if (!candidate) return "candidate-missing";
  const { address, port, protocol } = candidate;
  if (typeof address !== "string" || address === "")
    return "address-unavailable";
  if (/\.local\.?$/i.test(address)) return "mdns-address";
  if (address.includes(":")) {
    try {
      const parsed = new URL(`http://[${address}]/`);
      if (parsed.hostname.startsWith("[")) return "ipv6-address";
    } catch {
      /* An invalid literal remains unverified. */
    }
    return "invalid-address";
  }
  if (
    !/^\d+\.\d+\.\d+\.\d+$/.test(address) ||
    address.split(".").some((part) => Number(part) > 255)
  )
    return "invalid-address";
  if (privateEndpoint(address, 1, "udp") === null) return "non-private-ipv4";
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return "port-unavailable-or-invalid";
  if (protocol !== "udp" && protocol !== "tcp")
    return "protocol-unavailable-or-unsupported";
  return proven ? "none" : "host-endpoint-not-matched";
}

// Conservative LAN evidence: exact RFC1918 IPv4 address, port and protocol.
// mDNS, missing addresses, public addresses and IPv6 require separate proof.
function privateEndpoint(
  address: unknown,
  port: unknown,
  protocol: unknown,
): string | null {
  if (
    typeof address !== "string" ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(address) ||
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (protocol !== "udp" && protocol !== "tcp")
  )
    return null;
  const parts = address.split(".").map(Number);
  if (
    parts.some((n) => n < 0 || n > 255) ||
    !(
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    )
  )
    return null;
  return `${protocol}:${parts.join(".")}:${port}`;
}

function rememberHost(candidate: string, endpoints: Set<string>) {
  if (!hostCandidate(candidate)) return;
  const fields = candidate.split(/\s+/);
  const endpoint = privateEndpoint(
    fields[4],
    Number(fields[5]),
    fields[2].toLowerCase(),
  );
  if (endpoint && endpoints.size < 128) endpoints.add(endpoint);
}

function candidateType(value: unknown): string {
  return typeof value === "string" &&
    ["host", "prflx", "srflx", "relay"].includes(value)
    ? value
    : "unknown";
}

export class DirectPeer {
  readonly pc: RTCPeerConnection;
  private pending: RTCIceCandidateInit[] = [];
  private offered = false;
  private presented = false;
  private closed = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelGathering: (() => void) | undefined;
  private queue = Promise.resolve();
  private configured: Promise<void> = Promise.resolve();
  private stream: MediaStream | undefined;
  private appliedRemote: { type: "offer" | "answer"; sdp: string } | undefined;
  private advertised = { local: new Set<string>(), remote: new Set<string>() };
  private handshake = {
    readyReceived: 0,
    offersReceived: 0,
    answersReceived: 0,
    offersSent: 0,
    answersSent: 0,
  };
  constructor(
    private options: {
      side: StudioSide;
      track?: MediaStreamTrack;
      send: (signal: StudioSignal) => Promise<void>;
      onVideo: (stream: MediaStream) => void;
      onFailure: (reason: string, metrics?: DirectMetrics) => void;
      createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
    },
  ) {
    this.pc = (
      options.createPeer ?? ((config) => new RTCPeerConnection(config))
    )({
      iceServers: [],
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
    });
    if (options.track) {
      options.track.contentHint = "detail";
      const sender = this.pc.addTrack(
        options.track,
        new MediaStream([options.track]),
      );
      const parameters = sender.getParameters();
      parameters.degradationPreference = "maintain-resolution";
      this.configured = sender
        .setParameters(parameters)
        .catch(() => this.fail("Browser rejected camera encoding settings."));
    } else this.pc.addTransceiver("video", { direction: "recvonly" });
    this.pc.onicecandidate = (event) => {
      if (!event.candidate || this.closed) return;
      if (!hostCandidate(event.candidate.candidate)) {
        this.fail(
          "Browser produced a non-host ICE candidate. Direct-only connection stopped.",
        );
        return;
      }
      rememberHost(event.candidate.candidate, this.advertised.local);
      // Send candidates together in the completed local SDP, not separate broadcasts.
    };
    this.pc.ontrack = (event) => {
      this.stream = new MediaStream([event.track]);
      this.presented = false;
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (this.pc.connectionState === "failed") {
        this.fail("WebRTC transport failed. Reconnect both pages.");
      } else if (this.pc.connectionState === "connected") {
        this.clearDisconnectTimer();
      } else if (
        this.pc.connectionState === "disconnected" &&
        this.disconnectTimer === undefined
      ) {
        // A transient disconnect can recover; repeated events must not extend it.
        this.disconnectTimer = setTimeout(() => {
          this.fail(
            "WebRTC transport did not recover within 5 seconds. Reconnect both pages.",
          );
        }, 5_000);
      }
    };
  }
  receive(signal: StudioSignal) {
    this.queue = this.queue
      .then(async () => {
        await this.configured;
        if (this.closed) return;
        const sender = this.options.side === "camera" ? "receiver" : "camera";
        if (!signalAllowed(sender, signal)) throw Error("Rejected signaling");
        if (signal.type === "path-confirmed") {
          this.receiverConfirmedAt = performance.now();
        } else if (signal.type === "ready") {
          ++this.handshake.readyReceived;
          // Broadcast delivery is ephemeral. The camera repeats readiness until
          // it receives an offer, so repeat the completed local description if
          // the first offer raced its return-channel subscription.
          if (this.offered) {
            if (!this.pc.remoteDescription)
              await this.sendGatheredDescription("offer");
            return;
          }
          this.offered = true;
          const offer = await this.pc.createOffer();
          if (this.closed) return;
          await this.pc.setLocalDescription(offer);
          if (this.closed) return;
          await this.sendGatheredDescription("offer");
        } else if (signal.type === "ice") {
          rememberHost(signal.candidate.candidate, this.advertised.remote);
          if (!this.pc.remoteDescription) {
            if (this.pending.length >= 64) throw Error("Candidate limit");
            this.pending.push(signal.candidate);
          } else await this.pc.addIceCandidate(signal.candidate);
        } else {
          if (signal.type === "offer") ++this.handshake.offersReceived;
          else ++this.handshake.answersReceived;
          // One DirectPeer belongs to one negotiation. Broadcast retries must
          // not renegotiate a connected peer or apply an answer in stable state.
          if (this.appliedRemote) {
            if (
              this.appliedRemote.type !== signal.type ||
              this.appliedRemote.sdp !== signal.sdp
            )
              throw Error("Remote description changed within a negotiation.");
            if (signal.type === "offer")
              await this.sendGatheredDescription("answer");
            return;
          }
          for (const line of signal.sdp.split(/\r?\n/)) {
            if (line.startsWith("a=candidate:"))
              rememberHost(line.slice(2), this.advertised.remote);
          }
          await this.pc.setRemoteDescription(signal);
          if (this.closed) return;
          this.appliedRemote = { type: signal.type, sdp: signal.sdp };
          for (const candidate of this.pending.splice(0)) {
            await this.pc.addIceCandidate(candidate);
            if (this.closed) return;
          }
          if (signal.type === "offer") {
            const answer = await this.pc.createAnswer();
            if (this.closed) return;
            await this.pc.setLocalDescription(answer);
            if (this.closed) return;
            await this.sendGatheredDescription("answer");
          }
        }
      })
      .catch(() =>
        this.fail(
          "WebRTC could not apply the offer, answer, or ICE candidate.",
        ),
      );
    return this.queue;
  }
  private receiverConfirmedAt = -Infinity;
  private lastConfirmationAt = -Infinity;
  private hiddenPathSince: number | undefined;
  async inspect() {
    const report = await this.pc.getStats();
    const metrics = reduceDirectStats(report, this.advertised);
    metrics.side = this.options.side;
    metrics.connectionState = this.pc.connectionState;
    metrics.iceConnectionState = this.pc.iceConnectionState;
    metrics.signalingState = this.pc.signalingState;
    metrics.iceGatheringState = this.pc.iceGatheringState;
    metrics.handshake = { ...this.handshake };
    if (this.closed) return metrics;
    // A camera browser can redact prflx addresses. Its authenticated receiver
    // must independently prove the path; this never relaxes receiver checks.
    const hiddenCameraPath =
      this.options.side === "camera" &&
      metrics.relayBytes === 0 &&
      metrics.pairState === "succeeded" &&
      this.pc.connectionState === "connected" &&
      [metrics.localCandidateType, metrics.remoteCandidateType].every(
        (type) => type === "host" || type === "prflx",
      ) &&
      [metrics.localEndpointIssue, metrics.remoteEndpointIssue].every(
        (issue) =>
          issue === "none" ||
          issue === "address-unavailable" ||
          issue === "mdns-address",
      ) &&
      [metrics.localEndpointIssue, metrics.remoteEndpointIssue].some(
        (issue) => issue === "address-unavailable" || issue === "mdns-address",
      );
    if (hiddenCameraPath && !metrics.direct) {
      this.hiddenPathSince ??= performance.now();
      if (performance.now() - this.receiverConfirmedAt < 5000) {
        metrics.direct = true;
        metrics.path = "peer-reflexive";
      } else if (performance.now() - this.hiddenPathSince < 8000)
        metrics.path = "pending";
    } else this.hiddenPathSince = undefined;
    if (
      metrics.direct &&
      this.options.side === "receiver" &&
      performance.now() - this.lastConfirmationAt >= 2000
    ) {
      this.lastConfirmationAt = performance.now();
      await this.options.send({ type: "path-confirmed" });
    }
    if (metrics.direct)
      report.forEach((row) => {
        if (row.candidateType !== "host") return;
        const side =
          row.type === "local-candidate"
            ? "local"
            : row.type === "remote-candidate"
              ? "remote"
              : null;
        const endpoint = privateEndpoint(
          candidateAddress(row),
          row.port,
          row.protocol,
        );
        if (side && endpoint && this.advertised[side].size < 128)
          this.advertised[side].add(endpoint);
      });
    if (metrics.path === "rejected")
      this.fail(
        `Path check stopped: local=${metrics.localCandidateType} (${metrics.localEndpointIssue}), remote=${metrics.remoteCandidateType} (${metrics.remoteEndpointIssue}), relay bytes=${metrics.relayBytes}.`,
        metrics,
      );
    if (!this.closed && metrics.direct && this.stream && !this.presented) {
      this.presented = true;
      this.options.onVideo(this.stream);
    }
    return metrics;
  }
  private async sendGatheredDescription(type: "offer" | "answer") {
    if (this.closed) return;
    if (this.pc.iceGatheringState !== "complete") {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          this.pc.removeEventListener("icegatheringstatechange", changed);
          this.cancelGathering = undefined;
          if (error) reject(error);
          else resolve();
        };
        const changed = () => {
          if (this.pc.iceGatheringState === "complete") finish();
        };
        const timer = setTimeout(() => {
          this.fail(
            "Local network candidate gathering timed out. Reconnect both pages.",
          );
        }, 8_000);
        this.cancelGathering = () => finish(Error("Connection closed"));
        this.pc.addEventListener("icegatheringstatechange", changed);
        changed();
      });
    }
    if (this.closed) return;
    const sdp = this.pc.localDescription?.sdp;
    const signal = { type, sdp: sdp ?? "" };
    if (
      !sdp ||
      sdp.length > 32768 ||
      !signalAllowed(this.options.side, signal)
    ) {
      this.fail("Completed local description failed host-only validation.");
      return;
    }
    const candidates = sdp
      .split(/\r?\n/)
      .filter((line) => line.startsWith("a=candidate:"));
    if (!candidates.length) {
      this.fail(
        "No local host candidates were gathered. Reconnect both pages.",
      );
      return;
    }
    for (const candidate of candidates)
      rememberHost(candidate.slice(2), this.advertised.local);
    await this.options.send(signal);
    if (type === "offer") ++this.handshake.offersSent;
    else ++this.handshake.answersSent;
  }
  close() {
    this.closed = true;
    this.cancelGathering?.();
    this.clearDisconnectTimer();
    this.pending = [];
    this.appliedRemote = undefined;
    this.advertised.local.clear();
    this.advertised.remote.clear();
    this.pc.close();
    this.stream?.getTracks().forEach((track) => track.stop());
  }
  private clearDisconnectTimer() {
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
  }
  private fail(reason: string, metrics?: DirectMetrics) {
    if (this.closed) return;
    this.close();
    if (metrics) this.options.onFailure(reason, metrics);
    else this.options.onFailure(reason);
  }
}
