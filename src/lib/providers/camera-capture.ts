export const portraitMediaConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 720 },
    height: { ideal: 1280 },
    aspectRatio: { ideal: 9 / 16 },
    frameRate: { ideal: 30 },
  },
};

export type PortraitCaptureReport = {
  captureMode?: "portrait-constraints" | "native" | "native-hd";
  trackWidth?: number;
  trackHeight?: number;
  videoWidth: number;
  videoHeight: number;
  devicePortrait: boolean;
  portrait: boolean;
  constraintsApplied: boolean;
  warning?: string;
};

export function deviceIsPortrait(
  orientation: Pick<ScreenOrientation, "type"> | undefined,
  viewportWidth: number,
  viewportHeight: number,
) {
  if (orientation?.type.startsWith("portrait")) return true;
  if (orientation?.type.startsWith("landscape")) return false;
  return viewportHeight >= viewportWidth;
}

function isPortrait(width?: number, height?: number) {
  return width !== undefined && height !== undefined && height > width;
}

export function supportedPortraitConstraints(
  capabilities: MediaTrackCapabilities,
): MediaTrackConstraints | undefined {
  const width = capabilities.width;
  const height = capabilities.height;
  if (
    width?.min === undefined ||
    width.max === undefined ||
    height?.min === undefined ||
    height.max === undefined ||
    width.min > 720 ||
    height.max < 1280
  )
    return;
  const constraints: MediaTrackConstraints = {
    width: { ideal: 720, max: Math.min(720, width.max) },
    height: { ideal: 1280, min: Math.max(1280, height.min) },
    frameRate: { ideal: 30 },
  };
  const ratio = capabilities.aspectRatio;
  if (
    ratio?.min !== undefined &&
    ratio.max !== undefined &&
    ratio.min <= 9 / 16 &&
    ratio.max >= 9 / 16
  )
    constraints.aspectRatio = { exact: 9 / 16 };
  return constraints;
}

export async function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= 1 && video.videoWidth) return;
  await new Promise<void>((resolve, reject) => {
    const loaded = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", loaded);
      resolve();
    };
    const timer = setTimeout(() => {
      video.removeEventListener("loadedmetadata", loaded);
      reject(new DOMException("Camera metadata timed out", "TimeoutError"));
    }, 10_000);
    video.addEventListener("loadedmetadata", loaded, { once: true });
  });
}

async function waitForNextVideoFrame(video: HTMLVideoElement) {
  if (video.requestVideoFrameCallback) {
    await new Promise<void>((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );
  } else {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
}

/** Verify the raw browser track before it is wrapped or published. */
export async function verifyPortraitTrack(
  mediaTrack: MediaStreamTrack,
  video: HTMLVideoElement,
  devicePortrait: boolean,
  adjustConstraints = true,
): Promise<PortraitCaptureReport> {
  await waitForVideoMetadata(video);
  let settings = mediaTrack.getSettings();
  let constraintsApplied = false;
  if (
    adjustConstraints &&
    devicePortrait &&
    (!isPortrait(settings.width, settings.height) ||
      !isPortrait(video.videoWidth, video.videoHeight))
  ) {
    const portraitConstraints = supportedPortraitConstraints(
      typeof mediaTrack.getCapabilities === "function"
        ? mediaTrack.getCapabilities()
        : {},
    );
    if (portraitConstraints) {
      try {
        await mediaTrack.applyConstraints(portraitConstraints);
        constraintsApplied = true;
        await waitForNextVideoFrame(video);
        settings = mediaTrack.getSettings();
      } catch {
        // A capability range can still be rejected by a particular camera mode.
        // Keep the original uncropped track and report it accurately below.
      }
    }
  }
  const portrait =
    isPortrait(settings.width, settings.height) &&
    isPortrait(video.videoWidth, video.videoHeight);
  return {
    trackWidth: settings.width,
    trackHeight: settings.height,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    devicePortrait,
    portrait,
    constraintsApplied,
    ...(!portrait
      ? {
          warning:
            "This browser provides landscape camera frames. The complete frame remains visible.",
        }
      : {}),
  };
}

/** Capture once and return the provider-neutral browser track. */
export async function acquireRawPortraitCamera(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  video: HTMLVideoElement,
  devicePortrait: boolean,
  onTrack?: (track: MediaStreamTrack) => void,
  mode:
    "portrait-constraints" | "native" | "native-hd" = "portrait-constraints",
) {
  const stream = await mediaDevices.getUserMedia(
    mode !== "portrait-constraints"
      ? {
          audio: false,
          video: {
            ...(mode === "native-hd" ? { width: { ideal: 1280 } } : {}),
            facingMode: { ideal: "environment" },
            frameRate: { ideal: 30 },
          },
        }
      : portraitMediaConstraints,
  );
  const mediaTrack = stream.getVideoTracks()[0];
  if (!mediaTrack) {
    (stream.getTracks?.() ?? []).forEach((track) => track.stop());
    throw new DOMException("No video track returned", "NotFoundError");
  }
  try {
    onTrack?.(mediaTrack);
    video.srcObject = stream;
    const report = await verifyPortraitTrack(
      mediaTrack,
      video,
      devicePortrait,
      mode === "portrait-constraints",
    );
    report.captureMode = mode;
    return { track: mediaTrack, report };
  } catch (cause) {
    mediaTrack.stop();
    throw cause;
  }
}
