"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

export function LiveKitCameraFeed({
  gameId,
  role,
}: {
  gameId: string;
  role: "camera-home" | "camera-away";
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "disconnected">(
    "connecting",
  );
  useEffect(() => {
    const room = new Room({ adaptiveStream: true });
    let mounted = true;
    const attach = (
      track: RemoteTrack,
      _publication: unknown,
      participant: { identity: string },
    ) => {
      if (
        track.kind === Track.Kind.Video &&
        participant.identity.startsWith(`${role}-`) &&
        video.current
      ) {
        track.attach(video.current);
        setStatus("live");
      }
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach();
      if (mounted) setStatus("disconnected");
    });
    room.on(RoomEvent.Disconnected, () => mounted && setStatus("disconnected"));
    void (async () => {
      try {
        const access = localStorage.getItem(`curlcast-access-${gameId}`);
        const response = await fetch(`/api/games/${gameId}/livekit-token`, {
          method: "POST",
          headers: access ? { authorization: `Bearer ${access}` } : {},
        });
        if (!response.ok) throw new Error("Live video access unavailable");
        const credentials = (await response.json()) as {
          url: string;
          token: string;
        };
        await room.connect(credentials.url, credentials.token);
      } catch {
        if (mounted) setStatus("disconnected");
      }
    })();
    return () => {
      mounted = false;
      room.disconnect();
    };
  }, [gameId, role]);
  return (
    <>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className="safe-video h-full w-full"
      />
      {status !== "live" && (
        <div className="absolute inset-0 grid place-content-center bg-slate-950/80 text-center">
          <strong className="text-2xl">
            {status === "connecting"
              ? "Connecting to camera…"
              : "Camera disconnected"}
          </strong>
          <span className="text-slate-300">The broadcast stays live</span>
        </div>
      )}
    </>
  );
}
