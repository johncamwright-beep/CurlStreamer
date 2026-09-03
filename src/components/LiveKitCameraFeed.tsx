"use client";
import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import {
  participantCameraRole,
  publishedCameraTracks,
  isRoleCameraPublication,
} from "@/lib/providers/livekit-client";
import { PortraitVideo } from "./PortraitVideo";

export function LiveKitCameraFeed({
  gameId,
  role,
  showPlaceholderGuides = false,
  framing = "fill",
}: {
  gameId: string;
  role: "camera-home" | "camera-away";
  showPlaceholderGuides?: boolean;
  framing?: "fill" | "contain";
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "disconnected">(
    "connecting",
  );
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const [playable, setPlayable] = useState(false);
  useEffect(() => {
    const room = new Room({ adaptiveStream: true });
    let mounted = true;
    const attach = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (
        track.kind === Track.Kind.Video &&
        isRoleCameraPublication(role, participant, publication) &&
        video.current
      ) {
        track.attach(video.current);
      }
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    const unsubscribe = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (!isRoleCameraPublication(role, participant, publication)) return;
      track.detach();
      if (mounted) {
        setPlayable(false);
        setStatus("disconnected");
      }
    };
    const disconnected = () => mounted && setStatus("disconnected");
    const subscriptionFailed = () => {
      if (mounted)
        setError("Subscription error: the camera feed could not be received.");
    };
    room.on(RoomEvent.TrackUnsubscribed, unsubscribe);
    room.on(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
    room.on(RoomEvent.Disconnected, disconnected);
    void (async () => {
      try {
        const access = localStorage.getItem(`curlcast-access-${gameId}`);
        const response = await fetch(`/api/games/${gameId}/livekit-token`, {
          method: "POST",
          headers: access ? { authorization: `Bearer ${access}` } : {},
        });
        if (!response.ok)
          throw new Error(
            `Token error: broadcast access unavailable (${response.status}).`,
          );
        const credentials = (await response.json()) as {
          url: string;
          token: string;
        };
        try {
          await room.connect(credentials.url, credentials.token);
        } catch {
          throw new Error("Connection error: could not join the LiveKit room.");
        }
        for (const participant of room.remoteParticipants.values()) {
          if (participantCameraRole(participant) !== role) continue;
          for (const track of publishedCameraTracks(participant)) {
            const publication = participant.getTrackPublication(track.source);
            if (publication) attach(track, publication, participant);
          }
        }
      } catch (cause) {
        if (mounted) {
          setStatus("disconnected");
          setError(
            cause instanceof Error
              ? cause.message
              : "Connection error: live video is unavailable.",
          );
        }
      }
    })();
    return () => {
      mounted = false;
      room.off(RoomEvent.TrackSubscribed, attach);
      room.off(RoomEvent.TrackUnsubscribed, unsubscribe);
      room.off(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
      room.off(RoomEvent.Disconnected, disconnected);
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.getTrackPublications()) {
          publication.track?.detach();
          (publication as RemoteTrackPublication).setSubscribed(false);
        }
      }
      room.disconnect();
    };
  }, [gameId, role]);
  return (
    <>
      <PortraitVideo
        ref={video}
        autoPlay
        muted
        framing={framing}
        onPlaying={() => {
          setPlayable(true);
          setStatus("live");
        }}
        onEmptied={() => setPlayable(false)}
        onSourceDetails={setSource}
      />
      {!playable && (
        <div className="camera-placeholder absolute inset-0 grid place-content-center bg-slate-950/80 text-center">
          {showPlaceholderGuides && (
            <div
              data-testid="camera-placeholder-guides"
              aria-hidden
              className="absolute inset-0"
            >
              <div className="absolute inset-x-[8%] bottom-[4%] aspect-square rounded-full border-[10px] border-blue-500 bg-white/20">
                <div className="absolute inset-[22%] rounded-full border-[10px] border-white">
                  <div className="absolute inset-[30%] rounded-full bg-red-500" />
                </div>
              </div>
              <div className="absolute left-1/2 top-0 h-full border-l-2 border-dashed border-white/20" />
            </div>
          )}
          <div className="camera-placeholder-status relative flex flex-col">
            <strong className="text-2xl">
              {status === "connecting"
                ? "Connecting to camera…"
                : "Camera disconnected"}
            </strong>
            <span className="text-slate-300">The broadcast stays live</span>
            {error && <span className="mt-2 text-red-200">{error}</span>}
          </div>
        </div>
      )}
    </>
  );
}
