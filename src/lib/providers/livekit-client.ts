import {
  Track,
  type LocalParticipant,
  type LocalVideoTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type CreateLocalTracksOptions,
  type VideoCaptureOptions,
} from "livekit-client";

export type CameraRole = "camera-home" | "camera-away";

export const portraitCameraOptions: VideoCaptureOptions = {
  facingMode: "environment",
  resolution: { width: 720, height: 1280, frameRate: 30 },
  frameRate: 30,
};

export const portraitMediaOptions: CreateLocalTracksOptions = {
  audio: false,
  video: portraitCameraOptions,
};

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
