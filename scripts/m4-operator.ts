// Prebundle into the private pilot setup directory before running.
import { createM4OperatorServer } from "../src/lib/providers/m4-operator-server";
const [origin, gameId, executable, plugin, runtime, ...extra] =
  process.argv.slice(2);
if (!origin || !gameId || !executable || !plugin || !runtime || extra.length) {
  console.error(
    "Usage: Studio pilot <HTTPS app origin> <game UUID> <native host> <default plugin> <OBS runtime>",
  );
  process.exitCode = 1;
} else {
  try {
    const programValues = [
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      process.env.CURLCAST_M4_RECORDER_HOST,
      process.env.CURLCAST_M4_RECORDING_ROOT,
      process.env.CURLCAST_M4_CACHE_ROOT,
      process.env.CURLCAST_M4_RENDERER_ROOT,
      process.env.CURLCAST_M4_STREAM_PLUGIN,
    ];
    if (
      programValues.slice(0, 6).some(Boolean) &&
      !programValues.slice(0, 6).every(Boolean)
    )
      throw new Error("Incomplete local program configuration");
    const program = programValues.slice(0, 6).every(Boolean)
      ? {
          realtimeUrl: programValues[0]!,
          realtimeKey: programValues[1]!,
          recorder: programValues[2]!,
          runtime,
          recordingRoot: programValues[3]!,
          cacheRoot: programValues[4]!,
          rendererRoot: programValues[5]!,
          streamPlugin: programValues[6],
        }
      : undefined;
    const pairingEnabled = process.env.CURLCAST_M4_PAIRING_ENABLED === "1";
    const streamingEnabled =
      process.env.CURLCAST_M4_STREAMING_ENABLED === "1" &&
      pairingEnabled &&
      Boolean(program?.streamPlugin);
    const operator = await createM4OperatorServer({
      origin,
      gameId,
      paths: { executable, plugin, runtime },
      program,
      pairingEnabled,
      streamingEnabled,
    });
    console.log(`Studio pilot controls: ${operator.address}`);
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      void operator.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch {
    console.error("Studio pilot could not start.");
    process.exitCode = 1;
  }
}
