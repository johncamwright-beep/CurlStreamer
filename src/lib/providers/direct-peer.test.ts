import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectPeer, reduceDirectStats } from "./direct-peer";
import {
  hostCandidate,
  signalAllowed,
  studioRequestSchema,
  signalEnvelopeSchema,
} from "@/lib/studio-protocol";
const host = "candidate:1 1 udp 2122260223 192.168.8.2 12345 typ host";
function stats(local = "host", remote = "host", extra: object[] = []) {
  return new Map([
    [
      "transport",
      { id: "transport", type: "transport", selectedCandidatePairId: "pair" },
    ],
    [
      "pair",
      {
        id: "pair",
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "local",
        remoteCandidateId: "remote",
        bytesReceived: 500,
        bytesSent: 100,
      },
    ],
    [
      "local",
      {
        id: "local",
        type: "local-candidate",
        candidateType: local,
        address: "192.168.8.2",
      },
    ],
    [
      "remote",
      {
        id: "remote",
        type: "remote-candidate",
        candidateType: remote,
        address: "192.168.8.3",
      },
    ],
    ...extra.map((value, index) => ["extra" + index, value]),
  ] as [string, object][]) as unknown as RTCStatsReport;
}
describe("M1 direct media boundary", () => {
  it("verifies legacy ip stats only with the same exact private endpoint proof", () => {
    const report = stats("host", "prflx") as unknown as Map<
      string,
      Record<string, unknown>
    >;
    for (const key of ["local", "remote"]) {
      const candidate = report.get(key)!;
      candidate.ip = candidate.address;
      delete candidate.address;
      Object.assign(candidate, { port: 12345, protocol: "udp" });
    }
    const proof = {
      local: new Set<string>(),
      remote: new Set(["udp:192.168.8.3:12345"]),
    };
    const verified = reduceDirectStats(report as RTCStatsReport, proof);
    expect(verified).toMatchObject({ direct: true, path: "peer-reflexive" });
    expect(JSON.stringify(verified)).not.toContain("192.168");
    expect(reduceDirectStats(report as RTCStatsReport).direct).toBe(false);
    report.get("remote")!.port = 12346;
    expect(reduceDirectStats(report as RTCStatsReport, proof).direct).toBe(
      false,
    );
    report.get("remote")!.port = 12345;
    for (const address of ["", null, "8.8.8.8", "peer.local"]) {
      report.get("remote")!.address = address;
      expect(reduceDirectStats(report as RTCStatsReport, proof).direct).toBe(
        false,
      );
    }
    delete report.get("remote")!.address;
    report.get("remote")!.ip = undefined;
    expect(reduceDirectStats(report as RTCStatsReport, proof)).toMatchObject({
      direct: false,
      remoteEndpointIssue: "address-unavailable",
    });
  });
  it.each([
    [undefined, 12345, "udp", "address-unavailable"],
    ["", 12345, "udp", "address-unavailable"],
    ["private-device.local", 12345, "udp", "mdns-address"],
    ["fd00::1", 12345, "udp", "ipv6-address"],
    ["8.8.8.8", 12345, "udp", "non-private-ipv4"],
    ["invalid:literal", 12345, "udp", "invalid-address"],
    ["192.168.8.3", undefined, "udp", "port-unavailable-or-invalid"],
    ["192.168.8.3", 12345, undefined, "protocol-unavailable-or-unsupported"],
    ["192.168.8.3", 12345, "udp", "host-endpoint-not-matched"],
  ])(
    "explains unproven endpoints without leaking their values (%s)",
    (address, port, protocol, issue) => {
      const report = stats("host", "prflx") as unknown as Map<
        string,
        Record<string, unknown>
      >;
      Object.assign(report.get("remote")!, { address, port, protocol });
      const result = reduceDirectStats(report as RTCStatsReport);
      expect(result).toMatchObject({
        direct: false,
        path: "rejected",
        remoteEndpointIssue: issue,
      });
      const exported = JSON.stringify(result);
      if (typeof address === "string" && address)
        expect(exported).not.toContain(address);
      expect(exported).not.toContain("12345");
    },
  );
  it("accepts peer-reflexive only with exact private host endpoint evidence", () => {
    const report = stats("host", "prflx") as unknown as Map<
      string,
      Record<string, unknown>
    >;
    for (const id of ["local", "remote"])
      Object.assign(report.get(id)!, { port: 12345, protocol: "udp" });
    const proof = {
      local: new Set<string>(),
      remote: new Set(["udp:192.168.8.3:12345"]),
    };
    expect(reduceDirectStats(report as RTCStatsReport, proof)).toMatchObject({
      direct: true,
      path: "peer-reflexive",
      relayBytes: 0,
    });
    expect(
      JSON.stringify(reduceDirectStats(report as RTCStatsReport, proof)),
    ).not.toContain("192.168");
    expect(reduceDirectStats(report as RTCStatsReport).direct).toBe(false);
    report.get("remote")!.port = 12346;
    expect(reduceDirectStats(report as RTCStatsReport, proof).direct).toBe(
      false,
    );
    report.get("remote")!.port = 12345;
    report.get("remote")!.address = "8.8.8.8";
    proof.remote.add("udp:8.8.8.8:12345");
    expect(reduceDirectStats(report as RTCStatsReport, proof).direct).toBe(
      false,
    );
    report.get("remote")!.address = "peer.local";
    expect(reduceDirectStats(report as RTCStatsReport, proof).direct).toBe(
      false,
    );
    report.get("remote")!.address = "192.168.8.3";
    report.get("remote")!.candidateType = "relay";
    expect(reduceDirectStats(report as RTCStatsReport, proof)).toMatchObject({
      direct: false,
      path: "rejected",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function transport() {
    vi.useFakeTimers();
    const pc = {
      addTransceiver: vi.fn(),
      close: vi.fn(),
      connectionState: "connected" as RTCPeerConnectionState,
      onconnectionstatechange: () => {},
    };
    const onFailure = vi.fn();
    const peer = new DirectPeer({
      side: "receiver",
      createPeer: () => pc as unknown as RTCPeerConnection,
      send: vi.fn(),
      onVideo: vi.fn(),
      onFailure,
    });
    const state = (value: RTCPeerConnectionState) => {
      pc.connectionState = value;
      pc.onconnectionstatechange();
    };
    return { pc, peer, onFailure, state };
  }
  it("survives a temporary disconnect and cancels the recovery deadline", () => {
    const { pc, peer, onFailure, state } = transport();
    state("disconnected");
    vi.advanceTimersByTime(4_000);
    expect(pc.close).not.toHaveBeenCalled();
    state("connected");
    vi.advanceTimersByTime(10_000);
    expect(onFailure).not.toHaveBeenCalled();
    peer.close();
  });
  it("bounds recovery even when repeated disconnect events arrive", () => {
    const { pc, onFailure, state } = transport();
    state("disconnected");
    vi.advanceTimersByTime(4_000);
    state("disconnected");
    vi.advanceTimersByTime(1_000);
    expect(pc.close).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      "WebRTC transport did not recover within 5 seconds. Reconnect both pages.",
    );
  });
  it("fails immediately on terminal failure and cancels pending recovery on close", () => {
    const first = transport();
    first.state("disconnected");
    first.state("failed");
    expect(first.onFailure).toHaveBeenCalledWith(
      "WebRTC transport failed. Reconnect both pages.",
    );
    vi.advanceTimersByTime(10_000);
    expect(first.onFailure).toHaveBeenCalledOnce();
    const second = transport();
    second.state("disconnected");
    second.peer.close();
    vi.advanceTimersByTime(10_000);
    expect(second.onFailure).not.toHaveBeenCalled();
    expect(second.pc.close).toHaveBeenCalledOnce();
  });
  it("requires the selected succeeded host pair and strips address data", () => {
    expect(reduceDirectStats(stats())).toMatchObject({
      direct: true,
      path: "host",
      bytesReceived: 500,
      relayBytes: 0,
    });
    expect(JSON.stringify(reduceDirectStats(stats()))).not.toContain("192.168");
    expect(reduceDirectStats(new Map() as RTCStatsReport)).toMatchObject({
      direct: false,
      path: "pending",
    });
    expect(reduceDirectStats(stats("host", "srflx")).path).toBe("rejected");
    expect(reduceDirectStats(stats("relay")).relayBytes).toBe(600);
  });
  it("rejects a previous relay pair even after switching to a host path", () => {
    expect(
      reduceDirectStats(
        stats("host", "host", [
          {
            id: "old",
            type: "candidate-pair",
            localCandidateId: "relay",
            bytesSent: 42,
          },
          { id: "relay", type: "local-candidate", candidateType: "relay" },
        ]),
      ),
    ).toMatchObject({ direct: false, relayBytes: 42, path: "rejected" });
  });
  it("keeps incomplete startup statistics pending without approving media", () => {
    const report = stats() as unknown as Map<string, Record<string, unknown>>;
    report.get("pair")!.state = "in-progress";
    expect(reduceDirectStats(report as RTCStatsReport)).toMatchObject({
      direct: false,
      path: "pending",
    });
    report.get("pair")!.state = "succeeded";
    report.delete("remote");
    expect(reduceDirectStats(report as RTCStatsReport)).toMatchObject({
      direct: false,
      path: "pending",
    });
    report.get("local")!.candidateType = "relay";
    expect(reduceDirectStats(report as RTCStatsReport).path).toBe("rejected");
  });
  it("does not mistake a nominated backup pair for the selected path", () => {
    const report = new Map([
      [
        "backup",
        {
          type: "candidate-pair",
          nominated: true,
          state: "succeeded",
          localCandidateId: "l",
          remoteCandidateId: "r",
        },
      ],
      ["l", { id: "l", candidateType: "host" }],
      ["r", { id: "r", candidateType: "host" }],
    ]);
    expect(reduceDirectStats(report as RTCStatsReport).direct).toBe(false);
  });
  it("rejects relays, malformed candidates, embedded relay SDP and role inversions", () => {
    expect(hostCandidate(host)).toBe(true);
    for (const candidate of [
      host.replace("typ host", "typ relay"),
      host.replace("typ host", "typ srflx"),
      "bad typ host",
    ])
      expect(hostCandidate(candidate)).toBe(false);
    expect(
      signalAllowed("receiver", { type: "offer", sdp: "v=0\r\na=" + host }),
    ).toBe(true);
    expect(
      signalAllowed("receiver", {
        type: "offer",
        sdp: "v=0\r\na=" + host.replace("typ host", "typ relay"),
      }),
    ).toBe(false);
    expect(signalAllowed("camera", { type: "offer", sdp: "v=0" })).toBe(false);
    expect(signalAllowed("receiver", { type: "ready" })).toBe(false);
    expect(
      studioRequestSchema.safeParse({
        action: "ticket",
        side: "camera",
        token: "unrequested",
      }).success,
    ).toBe(false);
    expect(signalEnvelopeSchema.safeParse({}).success).toBe(false);
  });
  it("queues ICE, retransmits an unanswered offer, and withholds video until verification", async () => {
    vi.stubGlobal(
      "MediaStream",
      class {
        getTracks() {
          return [];
        }
      },
    );
    const pc = {
      addTransceiver: vi.fn(),
      addIceCandidate: vi.fn(),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0" }),
      iceGatheringState: "complete",
      localDescription: { type: "offer", sdp: "v=0\r\na=" + host },
      setLocalDescription: vi.fn(),
      setRemoteDescription: vi.fn(async () => {
        pc.remoteDescription = {};
      }),
      remoteDescription: null as object | null,
      getStats: vi.fn().mockResolvedValue(stats()),
      close: vi.fn(),
      ontrack: null as unknown as (event: unknown) => void,
    };
    const createPeer = vi
        .fn<(config: RTCConfiguration) => RTCPeerConnection>()
        .mockReturnValue(pc as unknown as RTCPeerConnection),
      onVideo = vi.fn(),
      send = vi.fn();
    const peer = new DirectPeer({
      side: "receiver",
      createPeer,
      send,
      onVideo,
      onFailure: vi.fn(),
    });
    expect(createPeer.mock.calls[0][0]).toMatchObject({ iceServers: [] });
    await peer.receive({
      type: "ice",
      candidate: { candidate: host, sdpMid: "0", sdpMLineIndex: 0 },
    });
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    await peer.receive({ type: "ready" });
    await peer.receive({ type: "ready" });
    expect(pc.createOffer).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    await peer.receive({ type: "answer", sdp: "v=0" });
    await peer.receive({ type: "ready" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    pc.ontrack({ track: {} });
    expect(onVideo).not.toHaveBeenCalled();
    const metrics = await peer.inspect();
    expect(metrics.handshake).toEqual({
      readyReceived: 3,
      offersReceived: 0,
      answersReceived: 1,
      offersSent: 2,
      answersSent: 0,
    });
    expect(onVideo).toHaveBeenCalledOnce();
    await peer.inspect();
    expect(onVideo).toHaveBeenCalledOnce();
    pc.getStats.mockResolvedValue(stats("relay"));
    await peer.inspect();
    expect(pc.close).toHaveBeenCalled();
  });
  it.each(["camera", "receiver"] as const)(
    "handles duplicate descriptions on the %s without renegotiating and rejects conflicting replacements",
    async (side) => {
      const type = side === "camera" ? "offer" : "answer";
      const pc = {
        addTransceiver: vi.fn(),
        setRemoteDescription: vi.fn(),
        createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "v=0" }),
        setLocalDescription: vi.fn(),
        localDescription: { type: "answer", sdp: "v=0\r\na=" + host },
        iceGatheringState: "complete",
        close: vi.fn(),
      };
      const send = vi.fn(),
        onFailure = vi.fn();
      const peer = new DirectPeer({
        side,
        createPeer: () => pc as unknown as RTCPeerConnection,
        send,
        onFailure,
        onVideo: vi.fn(),
      });
      const signal = { type, sdp: "v=0\r\na=" + host } as const;
      await Promise.all([peer.receive(signal), peer.receive(signal)]);
      expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
      expect(pc.createAnswer).toHaveBeenCalledTimes(side === "camera" ? 1 : 0);
      expect(send).toHaveBeenCalledTimes(side === "camera" ? 2 : 0);
      expect(onFailure).not.toHaveBeenCalled();
      if (side === "camera")
        expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
      await peer.receive({ ...signal, sdp: signal.sdp + "\r\na=mid:changed" });
      expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledExactlyOnceWith(
        "WebRTC could not apply the offer, answer, or ICE candidate.",
      );
      expect(pc.close).toHaveBeenCalledOnce();
    },
  );
  it("does not publish an offer that finishes after the peer was replaced", async () => {
    let resolveOffer!: (offer: RTCSessionDescriptionInit) => void;
    const pc = {
      addTransceiver: vi.fn(),
      createOffer: vi.fn(
        () =>
          new Promise<RTCSessionDescriptionInit>((resolve) => {
            resolveOffer = resolve;
          }),
      ),
      setLocalDescription: vi.fn(),
      close: vi.fn(),
    };
    const send = vi.fn();
    const peer = new DirectPeer({
      side: "receiver",
      createPeer: () => pc as unknown as RTCPeerConnection,
      send,
      onVideo: vi.fn(),
      onFailure: vi.fn(),
    });
    const receiving = peer.receive({ type: "ready" });
    await vi.waitFor(() => expect(pc.createOffer).toHaveBeenCalledOnce());
    peer.close();
    resolveOffer({ type: "offer", sdp: "v=0" });
    await receiving;
    expect(pc.setLocalDescription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  function gatheringPeer() {
    vi.useFakeTimers();
    const pc = Object.assign(new EventTarget(), {
      addTransceiver: vi.fn(),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0" }),
      setLocalDescription: vi.fn(),
      localDescription: { type: "offer", sdp: "v=0\r\na=" + host },
      iceGatheringState: "gathering",
      close: vi.fn(),
    });
    const send = vi.fn(),
      onFailure = vi.fn();
    const peer = new DirectPeer({
      side: "receiver",
      createPeer: () => pc as unknown as RTCPeerConnection,
      send,
      onFailure,
      onVideo: vi.fn(),
    });
    return { pc, send, onFailure, peer };
  }
  it("sends the completed candidate SDP once, after gathering finishes", async () => {
    const { pc, send, peer } = gatheringPeer();
    const receiving = peer.receive({ type: "ready" });
    await vi.advanceTimersByTimeAsync(100);
    expect(send).not.toHaveBeenCalled();
    pc.iceGatheringState = "complete";
    pc.dispatchEvent(new Event("icegatheringstatechange"));
    await receiving;
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "offer",
      sdp: pc.localDescription.sdp,
    });
    expect(vi.getTimerCount()).toBe(0);
    peer.close();
  });
  it.each(["timeout", "close"])(
    "settles gathering on %s without publishing late SDP",
    async (mode) => {
      const { pc, send, onFailure, peer } = gatheringPeer();
      const receiving = peer.receive({ type: "ready" });
      await vi.advanceTimersByTimeAsync(0);
      if (mode === "close") peer.close();
      else await vi.advanceTimersByTimeAsync(8_000);
      await receiving;
      pc.iceGatheringState = "complete";
      pc.dispatchEvent(new Event("icegatheringstatechange"));
      expect(send).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(onFailure).toHaveBeenCalledTimes(mode === "close" ? 0 : 1);
      if (mode === "timeout")
        expect(onFailure).toHaveBeenCalledWith(
          "Local network candidate gathering timed out. Reconnect both pages.",
        );
    },
  );
  it.each(["relay", "srflx"])(
    "rejects %s candidates present only in completed SDP",
    async (type) => {
      const { pc, peer, send, onFailure } = gatheringPeer();
      pc.iceGatheringState = "complete";
      pc.localDescription.sdp =
        "v=0\r\na=" + host.replace("typ host", "typ " + type);
      await peer.receive({ type: "ready" });
      expect(send).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        "Completed local description failed host-only validation.",
      );
    },
  );
});
