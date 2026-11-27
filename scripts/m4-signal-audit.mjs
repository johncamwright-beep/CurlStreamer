// Read-only disposable-pilot observer. Run with node --env-file=.env.local.
// Never log a payload, credential, topic, SDP, or candidate address.
import { createClient } from "@supabase/supabase-js";

const [gameId] = process.argv.slice(2);
if (
  process.env.CURLCAST_M1_DIRECT_SPIKE !== "disposable" ||
  !/^[a-f0-9-]{36}$/i.test(gameId ?? "")
)
  throw Error("Disposable pilot and game UUID required.");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const observed = new Map();
const started = Date.now();
function candidateSummary(signal) {
  if (!["offer", "answer"].includes(signal?.type)) return undefined;
  if (typeof signal.sdp !== "string" || signal.sdp.length > 32768)
    return { invalid: true };
  const summary = { host: 0, privateIpv4: 0, mdns: 0, ipv6: 0, other: 0 };
  for (const line of signal.sdp.split(/\r?\n/)) {
    if (!line.startsWith("a=candidate:")) continue;
    const fields = line.split(/\s+/);
    if (fields[7] !== "host") continue;
    summary.host++;
    const address = fields[4] ?? "";
    const parts = address.split(".").map(Number);
    if (
      /^\d+\.\d+\.\d+\.\d+$/.test(address) &&
      parts.every((part) => part >= 0 && part <= 255) &&
      (parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168))
    )
      summary.privateIpv4++;
    else if (/\.local\.?$/i.test(address)) summary.mdns++;
    else if (address.includes(":")) summary.ipv6++;
    else summary.other++;
  }
  return summary;
}
try {
  while (Date.now() - started < 180000) {
    const { data, error } = await db
      .from("m2_studio_sessions")
      .select(
        "camera_role,id,generation,negotiation_id,receiver_seen_at,camera_seen_at,signal_count",
      )
      .eq("game_id", gameId);
    if (error) throw Error("Session read failed.");
    for (const row of data) {
      if (!["camera-home", "camera-away"].includes(row.camera_role)) continue;
      const identity = `${row.id}:${row.generation}:${row.negotiation_id}`;
      const previous = observed.get(row.camera_role);
      if (!row.negotiation_id || previous?.identity === identity) continue;
      if (previous)
        await Promise.all(previous.channels.map((c) => db.removeChannel(c)));
      console.log(
        JSON.stringify({
          camera: row.camera_role,
          generation: row.generation,
          event: "observing-negotiation",
          receiverAgeMs: Date.now() - Date.parse(row.receiver_seen_at),
          cameraAgeMs: Date.now() - Date.parse(row.camera_seen_at),
          signalCount: row.signal_count,
        }),
      );
      const channels = ["camera", "receiver"].map((side) => {
        const channel = db.channel(
          `m2:${row.camera_role}:${identity}:${side}`,
          { config: { private: true } },
        );
        channel
          .on("broadcast", { event: "m2-signal" }, ({ payload }) => {
            const type = payload?.signal?.type;
            if (!["ready", "offer", "answer", "ice"].includes(type)) return;
            console.log(
              JSON.stringify({
                elapsedMs: Date.now() - started,
                camera: row.camera_role,
                to: side,
                type,
                candidates: candidateSummary(payload.signal),
                expiresInMs: Number(payload.expiresAt) - Date.now(),
              }),
            );
          })
          .subscribe((status) => {
            if (
              ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(
                status,
              )
            )
              console.log(
                JSON.stringify({
                  camera: row.camera_role,
                  to: side,
                  subscription: status,
                }),
              );
          });
        return channel;
      });
      observed.set(row.camera_role, { identity, channels });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} catch {
  console.error("Sanitized signal audit stopped.");
  process.exitCode = 1;
} finally {
  await db.removeAllChannels();
  db.realtime.disconnect();
}
