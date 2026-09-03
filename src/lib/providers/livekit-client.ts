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
    cause instanceof DOMException &&
    (cause.name === "NotAllowedError" || cause.name === "SecurityError")
  );
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
