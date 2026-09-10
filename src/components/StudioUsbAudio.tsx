"use client";

import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  StudioAudioInput,
  type AudioMeter,
  type StudioAudioInputDevice,
  type StudioAudioInputState,
} from "@/lib/studio-audio-input";

type StudioUsbAudioProps = {
  /** Allows browser-audio fakes in component tests without changing UI behaviour. */
  createInput?: () => StudioAudioInput;
};

const idleState: StudioAudioInputState = {
  deviceId: null,
  actualChannelCount: null,
  meters: [],
};

function defaultCreateInput() {
  return new StudioAudioInput();
}

export function StudioUsbAudio({
  createInput = defaultCreateInput,
}: StudioUsbAudioProps) {
  const inputRef = useRef<StudioAudioInput | null>(null);
  const operationRef = useRef(0);
  const mountedRef = useRef(false);
  const [devices, setDevices] = useState<StudioAudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [inputState, setInputState] =
    useState<StudioAudioInputState>(idleState);
  const [checking, setChecking] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCurrent = useCallback(async () => {
    const input = inputRef.current;
    inputRef.current = null;
    if (input) await input.stop();
  }, []);

  const refreshDevices = useCallback(async () => {
    const input = inputRef.current ?? createInput();
    try {
      const nextDevices = await input.listDevices();
      if (!mountedRef.current) return;
      setDevices(nextDevices);
      if (
        selectedDeviceId &&
        !nextDevices.some((device) => device.deviceId === selectedDeviceId)
      ) {
        await stopCurrent();
        setChecking(false);
        setInputState(idleState);
        setSelectedDeviceId("");
      }
    } catch (cause) {
      if (mountedRef.current) setError(errorMessage(cause));
    }
  }, [createInput, selectedDeviceId, stopCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    const onDeviceChange = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
    return () => {
      mountedRef.current = false;
      operationRef.current++;
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
      void stopCurrent();
    };
  }, [refreshDevices, stopCurrent]);

  useEffect(() => {
    if (!checking || !inputRef.current) return;
    let frame = 0;
    const updateMeters = () => {
      const input = inputRef.current;
      if (input && mountedRef.current) setInputState(input.getState());
      frame = requestAnimationFrame(updateMeters);
    };
    frame = requestAnimationFrame(updateMeters);
    return () => cancelAnimationFrame(frame);
  }, [checking]);

  async function startCheck() {
    if (!selectedDeviceId || checking) return;
    const operation = ++operationRef.current;
    setError(null);
    setChecking(true);
    setInputState(idleState);
    const input = createInput();
    inputRef.current = input;
    try {
      const nextState = await input.start(selectedDeviceId);
      if (!mountedRef.current || operation !== operationRef.current) {
        await input.stop();
        return;
      }
      setInputState(nextState);
    } catch (cause) {
      if (!mountedRef.current || operation !== operationRef.current) return;
      inputRef.current = null;
      setChecking(false);
      setError(errorMessage(cause));
    }
  }

  async function findMicrophones() {
    if (discovering) return;
    const operation = ++operationRef.current;
    setError(null);
    setDiscovering(true);
    let discoveryStream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot request microphone access.");
      }
      discoveryStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      discoveryStream.getTracks().forEach((track) => track.stop());
      await refreshDevices();
    } catch (cause) {
      if (mountedRef.current && operation === operationRef.current) {
        setError(errorMessage(cause));
      }
    } finally {
      discoveryStream?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current && operation === operationRef.current) {
        setDiscovering(false);
      }
    }
  }

  async function stopCheck() {
    operationRef.current++;
    setChecking(false);
    setInputState(idleState);
    await stopCurrent();
  }

  async function changeDevice(deviceId: string) {
    operationRef.current++;
    setSelectedDeviceId(deviceId);
    setError(null);
    setChecking(false);
    setInputState(idleState);
    await stopCurrent();
  }

  function setMuted(channel: number, muted: boolean) {
    const input = inputRef.current;
    if (!input) return;
    input.setChannelMuted(channel, muted);
    setInputState(input.getState());
  }

  return (
    <section
      aria-labelledby="usb-audio-title"
      className="space-y-3 rounded border border-slate-700 p-3"
    >
      <div>
        <h3 id="usb-audio-title" className="font-semibold text-white">
          USB microphone input check
        </h3>
        <p className="text-sm text-slate-300">
          Input check · not sent to YouTube yet
        </p>
      </div>
      <label
        className="block text-sm text-slate-200"
        htmlFor="usb-audio-device"
      >
        USB audio device
      </label>
      <select
        id="usb-audio-device"
        className="min-h-11 w-full rounded bg-slate-900 p-2 text-white"
        value={selectedDeviceId}
        onChange={(event) => void changeDevice(event.target.value)}
      >
        <option value="">Select a USB microphone</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Audio input ${device.deviceId}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="min-h-11 rounded border border-slate-500 px-3 text-white disabled:opacity-50"
        onClick={() => void findMicrophones()}
        disabled={discovering || checking}
      >
        Find microphones
      </button>
      <p className="text-sm text-slate-300">
        Discovery requests microphone access only to reveal available inputs; it
        is not sent to YouTube.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="min-h-11 rounded bg-blue-600 px-3 text-white disabled:opacity-50"
          onClick={() => void startCheck()}
          disabled={!selectedDeviceId || checking}
        >
          Check USB microphones
        </button>
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3 text-white disabled:opacity-50"
          onClick={() => void stopCheck()}
          disabled={!checking}
        >
          Stop input check
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <ChannelStatus
        channelCount={inputState.actualChannelCount}
        meters={inputState.meters}
        onMute={setMuted}
      />
    </section>
  );
}

function ChannelStatus({
  channelCount,
  meters,
  onMute,
}: {
  channelCount: number | null;
  meters: AudioMeter[];
  onMute: (channel: number, muted: boolean) => void;
}) {
  if (!meters.length) return null;
  const detail =
    channelCount === 4
      ? "Four input channels detected."
      : channelCount === null
        ? "Q mode USB: the browser did not report a channel count. One diagnostic meter is shown; four channels are not assumed."
        : `Q mode USB: this device reported ${channelCount} channel${channelCount === 1 ? "" : "s"}; expected four. Only detected meters are shown.`;
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm text-amber-200">{detail}</p>
      {meters.map((meter, index) => (
        <div
          key={index}
          className="flex items-center gap-2 text-sm text-slate-100"
        >
          <span className="w-20">Channel {index + 1}</span>
          <meter
            className="h-3 flex-1"
            min={0}
            max={1}
            value={meter.peak}
            aria-label={`Channel ${index + 1} peak level`}
          />
          <span
            className="w-28 text-right tabular-nums"
            aria-label={`Channel ${index + 1} rms and peak`}
          >
            {meter.rms.toFixed(2)} / {meter.peak.toFixed(2)}
          </span>
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => onMute(index, !meter.muted)}
            aria-pressed={meter.muted}
          >
            {meter.muted ? "Unmute" : "Mute"}
          </button>
        </div>
      ))}
    </div>
  );
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "USB microphone input check failed.";
}
