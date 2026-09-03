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

/** Capture once, then give LiveKit the exact browser track used by preview. */
export async function acquirePortraitCamera(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
) {
  const stream = await mediaDevices.getUserMedia(portraitMediaConstraints);
  const mediaTrack = stream.getVideoTracks()[0];
  if (!mediaTrack)
    throw new DOMException("No video track returned", "NotFoundError");
  return new LocalVideoTrack(mediaTrack);
}

export function sourcePresentation(width: number, height: number) {
  return width > height
    ? ({ fit: "cover", description: "cropped landscape fallback" } as const)
    : ({ fit: "contain", description: "portrait source" } as const);
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
