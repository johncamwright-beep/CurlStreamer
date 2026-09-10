import { describe, expect, it } from "vitest";
import {
  StudioAudioInput,
  type StudioAudioContext,
} from "./studio-audio-input";

class FakeNode {
  connections: Array<{
    destination: FakeNode;
    output?: number;
    input?: number;
  }> = [];
  disconnectCalls = 0;
  connect(destination: FakeNode, output?: number, input?: number) {
    this.connections.push({ destination, output, input });
    return destination;
  }
  disconnect() {
    this.disconnectCalls++;
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 4;
  constructor(private readonly samples: number[]) {
    super();
  }
  getFloatTimeDomainData(target: Float32Array) {
    target.set(this.samples);
  }
}

class FakeContext implements StudioAudioContext {
  state: AudioContextState = "suspended";
  analysers: FakeAnalyser[] = [];
  gains: Array<FakeNode & { gain: { value: number } }> = [];
  source = new FakeNode();
  splitter = new FakeNode();
  merger = new FakeNode();
  destination = Object.assign(new FakeNode(), {
    stream: { id: "mono" } as MediaStream,
  });
  closed = false;
  async resume() {
    this.state = "running";
  }
  createMediaStreamSource() {
    return this.source;
  }
  createChannelSplitter() {
    return this.splitter;
  }
  createChannelMerger() {
    return this.merger;
  }
  createAnalyser() {
    const analyser = new FakeAnalyser([0, 0.5, -1, 0.5]);
    this.analysers.push(analyser);
    return analyser;
  }
  createGain() {
    const gain = Object.assign(new FakeNode(), { gain: { value: 0 } });
    this.gains.push(gain);
    return gain;
  }
  createMediaStreamDestination() {
    return this.destination;
  }
  async close() {
    this.closed = true;
  }
}

function stream(channelCount?: number) {
  const track = {
    onended: null as null | (() => void),
    stop: () => {
      track.stopped = true;
    },
    stopped: false,
    getSettings: () => ({ channelCount }),
  };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
    track,
  } as unknown as MediaStream & { track: typeof track };
}

describe("StudioAudioInput", () => {
  it("enumerates audio inputs and requests the selected device with four-channel-safe constraints", async () => {
    const received: MediaStreamConstraints[] = [];
    const inputStream = stream(2);
    const context = new FakeContext();
    const input = new StudioAudioInput({
      mediaDevices: {
        enumerateDevices: async () =>
          [
            { kind: "audioinput", deviceId: "mic", groupId: "g", label: "DJI" },
            {
              kind: "videoinput",
              deviceId: "cam",
              groupId: "g",
              label: "Camera",
            },
          ] as MediaDeviceInfo[],
        getUserMedia: async (constraints) => {
          received.push(constraints!);
          return inputStream;
        },
      },
      createAudioContext: () => context,
    });

    await expect(input.listDevices()).resolves.toEqual([
      { deviceId: "mic", groupId: "g", label: "DJI" },
    ]);
    await input.start("mic");
    expect(received).toEqual([
      {
        video: false,
        audio: {
          deviceId: { exact: "mic" },
          channelCount: { ideal: 4 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      },
    ]);
    expect(input.getState().actualChannelCount).toBe(2);
    expect(context.gains.map((gain) => gain.gain.value)).toEqual([0.5, 0.5]);
    expect(input.monoMediaStream).toEqual(context.destination.stream);
  });

  it("uses actual samples for meters and does not claim four channels when settings omit a count", async () => {
    const context = new FakeContext();
    const input = new StudioAudioInput({
      mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia: async () => stream(),
      },
      createAudioContext: () => context,
    });
    await input.start("mic");
    expect(input.getState().actualChannelCount).toBeNull();
    expect(input.readMeters()).toEqual([
      { rms: Math.sqrt(1.5 / 1024), peak: 1, muted: false },
    ]);
    input.setChannelLevel(0, 0.5);
    input.setChannelMuted(0, true);
    expect(context.gains[0].gain.value).toBe(0);
  });

  it("stops tracks and disconnects graph nodes when the device ends or is reset", async () => {
    const inputStream = stream(2);
    const context = new FakeContext();
    const input = new StudioAudioInput({
      mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia: async () => inputStream,
      },
      createAudioContext: () => context,
    });
    await input.start("mic");
    inputStream.track.onended?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inputStream.track.stopped).toBe(true);
    expect(context.closed).toBe(true);
    expect(context.gains.every((gain) => gain.disconnectCalls > 0)).toBe(true);
    expect(context.source.disconnectCalls).toBeGreaterThan(0);
    expect(input.monoMediaStream).toBeNull();
  });

  it("surfaces permission failures without creating a graph", async () => {
    const context = new FakeContext();
    const input = new StudioAudioInput({
      mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
      createAudioContext: () => context,
    });
    await expect(input.start("mic")).rejects.toThrow("Denied");
    expect(input.getState().deviceId).toBeNull();
    expect(context.closed).toBe(false);
  });

  it("requires a running AudioContext and rejects unsafe channel counts", async () => {
    const blockedContext = new FakeContext();
    blockedContext.resume = async () => {};
    const blocked = new StudioAudioInput({
      mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia: async () => stream(2),
      },
      createAudioContext: () => blockedContext,
    });
    await expect(blocked.start("mic")).rejects.toThrow("could not be started");
    expect(blockedContext.closed).toBe(true);

    const excessive = new StudioAudioInput({
      mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia: async () => stream(33),
      },
      createAudioContext: () => new FakeContext(),
    });
    await expect(excessive.start("mic")).rejects.toThrow(
      "more than 32 channels",
    );
  });
});
