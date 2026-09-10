export type StudioAudioInputDevice = Pick<
  MediaDeviceInfo,
  "deviceId" | "groupId" | "label"
>;

export type AudioMeter = {
  rms: number;
  peak: number;
  muted: boolean;
};

export type StudioAudioInputState = {
  deviceId: string | null;
  /** The value reported by MediaStreamTrack.getSettings(), never a requested value. */
  actualChannelCount: number | null;
  meters: AudioMeter[];
};

type AudioNodeLike = {
  connect(
    destinationNode: AudioNodeLike,
    output?: number,
    input?: number,
  ): AudioNodeLike;
  disconnect(): void;
};

type AudioParamLike = { value: number };

type GainNodeLike = AudioNodeLike & { gain: AudioParamLike };
type AnalyserNodeLike = AudioNodeLike & {
  fftSize: number;
  getFloatTimeDomainData(array: Float32Array): void;
};
type DestinationNodeLike = AudioNodeLike & { stream: MediaStream };

export type StudioAudioContext = {
  state: AudioContextState;
  resume(): Promise<void>;
  createMediaStreamSource(stream: MediaStream): AudioNodeLike;
  createChannelSplitter(numberOfOutputs: number): AudioNodeLike;
  createChannelMerger(numberOfInputs: number): AudioNodeLike;
  createAnalyser(): AnalyserNodeLike;
  createGain(): GainNodeLike;
  createMediaStreamDestination(): DestinationNodeLike;
  close(): Promise<void>;
};

export type StudioAudioInputDependencies = {
  mediaDevices: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;
  createAudioContext: () => StudioAudioContext;
};

type ChannelGraph = {
  analyser: AnalyserNodeLike;
  gain: GainNodeLike;
  muted: boolean;
  level: number;
};

const requestedAudioConstraints = (
  deviceId: string,
): MediaTrackConstraints => ({
  deviceId: { exact: deviceId },
  channelCount: { ideal: 4 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});

/**
 * Browser-only mixer for a user-selected USB input. Calling start() must be
 * done from a user gesture; it is deliberately the only place that asks for
 * microphone permission.
 */
export class StudioAudioInput {
  private readonly dependencies: StudioAudioInputDependencies;
  private stream: MediaStream | null = null;
  private context: StudioAudioContext | null = null;
  private source: AudioNodeLike | null = null;
  private splitter: AudioNodeLike | null = null;
  private merger: AudioNodeLike | null = null;
  private destination: DestinationNodeLike | null = null;
  private channels: ChannelGraph[] = [];
  private selectedDeviceId: string | null = null;
  private channelCount: number | null = null;
  private session = 0;

  constructor(
    dependencies: StudioAudioInputDependencies = defaultDependencies(),
  ) {
    this.dependencies = dependencies;
  }

  async listDevices(): Promise<StudioAudioInputDevice[]> {
    const devices = await this.dependencies.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        deviceId: device.deviceId,
        groupId: device.groupId,
        label: device.label,
      }));
  }

  /** Requests permission and starts a mix for this explicitly selected device. */
  async start(deviceId: string): Promise<StudioAudioInputState> {
    if (!deviceId) throw new Error("An audio input device must be selected.");
    await this.stop();
    const session = ++this.session;
    let stream: MediaStream | null = null;
    let context: StudioAudioContext | null = null;

    try {
      stream = await this.dependencies.mediaDevices.getUserMedia({
        audio: requestedAudioConstraints(deviceId),
        video: false,
      });
      if (session !== this.session) {
        stopTracks(stream);
        return this.getState();
      }

      const track = stream.getAudioTracks()[0];
      if (!track)
        throw new Error("The selected device did not provide an audio track.");
      const reportedCount = track.getSettings().channelCount;
      this.channelCount =
        Number.isInteger(reportedCount) && reportedCount! > 0
          ? reportedCount!
          : null;
      if (this.channelCount && this.channelCount > 32) {
        throw new RangeError(
          "The selected device reported more than 32 channels.",
        );
      }
      const graphChannelCount = this.channelCount ?? 1;
      context = this.dependencies.createAudioContext();
      const audioContext = context;
      await audioContext.resume();
      if (audioContext.state !== "running") {
        throw new Error("Audio processing could not be started.");
      }
      const source = audioContext.createMediaStreamSource(stream);
      const splitter = audioContext.createChannelSplitter(graphChannelCount);
      const merger = audioContext.createChannelMerger(1);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(splitter);

      const channels = Array.from({ length: graphChannelCount }, () => {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        const gain = audioContext.createGain();
        return { analyser, gain, muted: false, level: 1 };
      });
      channels.forEach((channel, index) => {
        splitter.connect(channel.analyser, index);
        splitter.connect(channel.gain, index);
        channel.gain.connect(merger, 0, 0);
      });
      merger.connect(destination);

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.splitter = splitter;
      this.merger = merger;
      this.destination = destination;
      this.channels = channels;
      this.selectedDeviceId = deviceId;
      this.updateMixGains();
      track.onended = () => {
        if (session === this.session) void this.stop();
      };
      return this.getState();
    } catch (error) {
      if (stream) stopTracks(stream);
      if (context && this.context !== context) await context.close();
      await this.stop();
      throw error;
    }
  }

  get monoMediaStream(): MediaStream | null {
    return this.destination?.stream ?? null;
  }

  getState(): StudioAudioInputState {
    return {
      deviceId: this.selectedDeviceId,
      actualChannelCount: this.channelCount,
      meters: this.readMeters(),
    };
  }

  readMeters(): AudioMeter[] {
    return this.channels.map(({ analyser, muted }) => ({
      ...readMeter(analyser),
      muted,
    }));
  }

  setChannelMuted(channel: number, muted: boolean) {
    const target = this.requireChannel(channel);
    target.muted = muted;
    this.updateMixGains();
  }

  setChannelLevel(channel: number, level: number) {
    if (!Number.isFinite(level) || level < 0 || level > 1) {
      throw new RangeError("Channel level must be between 0 and 1.");
    }
    const target = this.requireChannel(channel);
    target.level = level;
    this.updateMixGains();
  }

  async stop(): Promise<void> {
    ++this.session;
    const stream = this.stream;
    const context = this.context;
    const source = this.source;
    const splitter = this.splitter;
    const merger = this.merger;
    const destination = this.destination;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.splitter = null;
    this.merger = null;
    this.destination = null;
    this.channels.forEach((channel) => {
      channel.analyser.disconnect();
      channel.gain.disconnect();
    });
    this.channels = [];
    this.selectedDeviceId = null;
    this.channelCount = null;
    source?.disconnect();
    splitter?.disconnect();
    merger?.disconnect();
    destination?.disconnect();
    stopTracks(stream);
    if (context) await context.close();
  }

  private requireChannel(index: number): ChannelGraph {
    if (!Number.isInteger(index) || !this.channels[index]) {
      throw new RangeError("Audio channel is unavailable.");
    }
    return this.channels[index];
  }

  private updateMixGains() {
    const divisor = this.channels.length || 1;
    this.channels.forEach((channel) => {
      channel.gain.gain.value = channel.muted ? 0 : channel.level / divisor;
    });
  }
}

function readMeter(analyser: AnalyserNodeLike): Omit<AudioMeter, "muted"> {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(sumSquares / samples.length), peak };
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function defaultDependencies(): StudioAudioInputDependencies {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof AudioContext === "undefined"
  ) {
    throw new Error("Studio audio input requires browser media APIs.");
  }
  return {
    mediaDevices: navigator.mediaDevices,
    createAudioContext: () => new AudioContext(),
  };
}
