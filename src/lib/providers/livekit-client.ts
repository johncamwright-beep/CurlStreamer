import {
  LocalVideoTrack,
  Track,
  type LocalParticipant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";

export type CameraRole = "camera-home" | "camera-away";

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
  await new Promise<void>((resolve) =>
    video.addEventListener("loadedmetadata", () => resolve(), { once: true }),
  );
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
): Promise<PortraitCaptureReport> {
  await waitForVideoMetadata(video);
  let settings = mediaTrack.getSettings();
  let constraintsApplied = false;
  if (
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
            "This browser provides landscape camera frames. Portrait Crop is active; Show full frame is available.",
        }
      : {}),
  };
}

/** Capture exactly once, verify, then give LiveKit that same browser track. */
export async function acquireVerifiedPortraitCamera(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  video: HTMLVideoElement,
  devicePortrait: boolean,
  onTrack?: (track: MediaStreamTrack) => void,
) {
  const stream = await mediaDevices.getUserMedia(portraitMediaConstraints);
  const mediaTrack = stream.getVideoTracks()[0];
  if (!mediaTrack)
    throw new DOMException("No video track returned", "NotFoundError");
  try {
    onTrack?.(mediaTrack);
    video.srcObject = stream;
    const report = await verifyPortraitTrack(mediaTrack, video, devicePortrait);
    return { track: new LocalVideoTrack(mediaTrack), report };
  } catch (cause) {
    mediaTrack.stop();
    throw cause;
  }
}

export function sourcePresentation(width: number, height: number) {
  return width > height
    ? ({
        fit: "cover",
        description: "landscape source · centred Portrait Crop",
      } as const)
    : ({ fit: "contain", description: "portrait source" } as const);
}

export type ZoomRange = { min: number; max: number; step: number };

export function hardwareZoomRange(
  track: MediaStreamTrack,
): ZoomRange | undefined {
  const zoom = (
    track.getCapabilities?.() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number; step?: number };
    }
  ).zoom;
  if (zoom?.min === undefined || zoom.max === undefined || zoom.max <= zoom.min)
    return;
  return { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 };
}

export function clampZoom(value: number, range: ZoomRange) {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return Math.round(clamped / range.step) * range.step;
}

export type RearLens = {
  key: "wide" | "standard";
  label: "Wide" | "Standard";
  deviceId: string;
};

/** Device identifiers stay in memory and never cross the provider boundary. */
export function identifiableRearLenses(devices: MediaDeviceInfo[]): RearLens[] {
  const result: RearLens[] = [];
  for (const device of devices) {
    if (device.kind !== "videoinput") continue;
    const label = device.label.toLowerCase();
    const key = /ultra.?wide|0\.5x/.test(label)
      ? "wide"
      : /back|rear|environment/.test(label) && !/tele|zoom/.test(label)
        ? "standard"
        : undefined;
    if (key && !result.some((lens) => lens.key === key))
      result.push({
        key,
        label: key === "wide" ? "Wide" : "Standard",
        deviceId: device.deviceId,
      });
  }
  return result.sort((a) => (a.key === "wide" ? -1 : 1));
}

export class SingleFlightGate {
  private active = false;

  enter() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  leave() {
    this.active = false;
  }
}

export function isPermissionError(cause: unknown) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause.name === "NotAllowedError" || cause.name === "SecurityError")
  );
}

export function cameraCapabilityError(
  browser: Pick<Navigator, "mediaDevices">,
  secureContext: boolean,
) {
  if (!secureContext)
    return "Camera access requires a secure HTTPS page. Open the secure camera link, then retry.";
  if (!browser.mediaDevices?.getUserMedia)
    return "This browser does not provide camera capture on this page. Update the browser and open the secure camera link directly.";
  return undefined;
}

export function cameraPermissionGuidance(userAgent: string) {
  const ios = /iPad|iPhone|iPod/.test(userAgent);
  if (ios && /CriOS/.test(userAgent))
    return "On iPhone, open Settings > Apps > Chrome > Camera and allow access. Return to Chrome, reload this page if needed, then tap Retry Connection.";
  if (ios)
    return "On iPhone, open Settings > Apps > Safari > Camera and allow access (or use Safari Page Settings). Return here, then tap Retry Connection.";
  if (/Android/.test(userAgent) && /Chrome\//.test(userAgent))
    return "In Chrome, open this site's Page info > Permissions > Camera and allow it. If blocked by Android, use Settings > Apps > Chrome > Permissions > Camera. Return here, then tap Retry Connection.";
  return "Allow Camera in this browser's site permissions and in system privacy settings. Return here, reload if needed, then tap Retry Connection.";
}

export function participantCameraRole(
  participant: Pick<RemoteParticipant, "metadata">,
): CameraRole | undefined {
  if (!participant.metadata) return undefined;
  try {
    const value = JSON.parse(participant.metadata) as { cameraRole?: unknown };
    return value.cameraRole === "camera-home" ||
      value.cameraRole === "camera-away"
      ? value.cameraRole
      : undefined;
  } catch {
    return undefined;
  }
}

export function isRoleCameraPublication(
  role: CameraRole,
  participant: Pick<RemoteParticipant, "metadata">,
  publication: Pick<RemoteTrackPublication, "source" | "kind">,
) {
  return (
    participantCameraRole(participant) === role &&
    publication.source === Track.Source.Camera &&
    publication.kind === Track.Kind.Video
  );
}

export function publishedCameraTracks(
  participant: Pick<RemoteParticipant, "getTrackPublications">,
) {
  return participant
    .getTrackPublications()
    .filter(
      (publication): publication is RemoteTrackPublication =>
        publication.source === Track.Source.Camera &&
        publication.kind === Track.Kind.Video &&
        publication.track !== undefined,
    )
    .map((publication) => publication.track as RemoteTrack);
}

export async function disposeCameraResources(
  participant: Pick<LocalParticipant, "unpublishTrack"> | undefined,
  track: LocalVideoTrack | undefined,
) {
  if (!track) return;
  try {
    await participant?.unpublishTrack(track);
  } finally {
    track.detach();
    track.stop();
  }
}
