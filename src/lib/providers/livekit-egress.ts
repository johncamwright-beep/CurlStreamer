import "server-only";

import {
  EgressClient,
  EgressStatus,
  EncodingOptionsPreset,
  Output,
  StartEgressRequest,
  StreamOutput,
  StreamProtocol,
  WebSource,
} from "livekit-server-sdk";

export const LIVEKIT_EGRESS_CLIENT_OPTIONS = {
  // The SDK documents this value in seconds.
  requestTimeout: 8,
  // Non-idempotent Start recovery belongs to our durable discovery flow.
  failover: false,
} as const;

function liveKitEgressClient() {
  const host = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!host || !key || !secret)
    throw new Error("livekit_configuration_unavailable");
  return new EgressClient(host, key, secret, LIVEKIT_EGRESS_CLIENT_OPTIONS);
}

function broadcastRenderUrl(gameId: string, sessionKey: string) {
  const value = process.env.APP_BASE_URL;
  if (!value) throw new Error("broadcast_render_origin_unavailable");
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== value ||
    origin.username ||
    origin.password
  )
    throw new Error("broadcast_render_origin_unavailable");
  const url = new URL(`/broadcast/${gameId}`, `${origin.origin}/`);
  url.searchParams.set("broadcastSession", sessionKey);
  return url.toString();
}

function sourceUrl(
  info: Awaited<ReturnType<EgressClient["listEgress"]>>[number],
) {
  if (info.request.case !== "egress") return;
  const source = info.request.value.source;
  return source.case === "web" ? source.value.url : undefined;
}

export async function findLiveKitEgress(
  gameId: string,
  sessionKey: string,
  providedClient?: EgressClient,
) {
  const client = providedClient ?? liveKitEgressClient();
  const renderUrl = broadcastRenderUrl(gameId, sessionKey);
  return (await client.listEgress()).find(
    (item) => sourceUrl(item) === renderUrl,
  );
}

export async function findOrStartLiveKitEgress(
  values: { gameId: string; sessionKey: string; rtmpUrl: string },
  client = liveKitEgressClient(),
  allowStart = true,
) {
  const renderUrl = broadcastRenderUrl(values.gameId, values.sessionKey);
  const active = await findLiveKitEgress(
    values.gameId,
    values.sessionKey,
    client,
  );
  if (active) {
    if (
      ![EgressStatus.EGRESS_STARTING, EgressStatus.EGRESS_ACTIVE].includes(
        active.status,
      )
    )
      throw new Error("livekit_egress_terminal");
    return { id: active.egressId, status: active.status };
  }
  if (!allowStart) throw new Error("broadcast_operation_uncertain");
  const info = await client.startEgress(
    new StartEgressRequest({
      source: {
        case: "web",
        value: new WebSource({ url: renderUrl }),
      },
      encoding: {
        case: "preset",
        value: EncodingOptionsPreset.H264_1080P_30,
      },
      outputs: [
        new Output({
          config: {
            case: "stream",
            value: new StreamOutput({
              protocol: StreamProtocol.RTMP,
              urls: [values.rtmpUrl],
            }),
          },
        }),
      ],
    }),
  );
  return { id: info.egressId, status: info.status };
}

export async function stopLiveKitEgress(
  egressId: string | undefined,
  providedClient?: EgressClient,
) {
  if (!egressId) return;
  const client = providedClient ?? liveKitEgressClient();
  const listed = await client.listEgress({ egressId });
  const info = listed[0];
  if (
    !info ||
    [
      EgressStatus.EGRESS_COMPLETE,
      EgressStatus.EGRESS_FAILED,
      EgressStatus.EGRESS_ABORTED,
    ].includes(info.status)
  )
    return;
  await client.stopEgress(egressId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = (await client.listEgress({ egressId }))[0];
    if (
      !current ||
      [
        EgressStatus.EGRESS_COMPLETE,
        EgressStatus.EGRESS_FAILED,
        EgressStatus.EGRESS_ABORTED,
      ].includes(current.status)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("livekit_stop_unconfirmed");
}

export async function getLiveKitEgressStatus(
  egressId: string,
  providedClient?: EgressClient,
) {
  const client = providedClient ?? liveKitEgressClient();
  return (await client.listEgress({ egressId }))[0]?.status;
}
