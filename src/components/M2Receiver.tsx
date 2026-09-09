"use client";
import { useCallback, useState } from "react";
import { M2CameraSlot } from "./M2CameraSlot";

export function M2Receiver({ id }: { id: string }) {
  const [ready, setReady] = useState({
    "camera-home": false,
    "camera-away": false,
  });
  const [run, setRun] = useState(0);
  const onReady = useCallback(
    (role: "camera-home" | "camera-away", value: boolean) => {
      setReady((previous) =>
        previous[role] === value ? previous : { ...previous, [role]: value },
      );
    },
    [],
  );
  return (
    <main className="mx-auto max-w-screen-2xl p-4">
      <h1 className="text-3xl font-bold">M2 · Two-camera receiver</h1>
      <p className="my-4">
        Register each camera slot, create its invitation, and connect its
        receiver after the camera starts. Each slot reconnects independently.
        Keep both devices on the router’s main Wi-Fi and this PC on Ethernet.
      </p>
      <button
        className="btn-primary min-h-11"
        disabled={!ready["camera-home"] || !ready["camera-away"]}
        onClick={() => setRun((value) => value + 1)}
      >
        Start both 2.5-hour tests
      </button>
      <p className="mt-2 text-slate-300">
        Each slot saves and exports its own results. A failure stops that slot’s
        test; the other keeps running. Both overlapping runs are required for
        acceptance.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <M2CameraSlot
          key={`${id}:home`}
          id={id}
          side="receiver"
          cameraRole="camera-home"
          onReady={onReady}
          testRun={run}
        />
        <M2CameraSlot
          key={`${id}:away`}
          id={id}
          side="receiver"
          cameraRole="camera-away"
          onReady={onReady}
          testRun={run}
        />
      </div>
    </main>
  );
}
