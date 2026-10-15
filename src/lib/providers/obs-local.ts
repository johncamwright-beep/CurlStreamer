// Node-only pilot adapter. Never import this module into a browser component.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const M3_PROFILE = "CurlStreamer M3";
const sceneSchema = z.string().regex(/^CurlStreamer M3 [0-9a-f-]{36}$/);
export function obsAddress(value: string) {
  const url = new URL(value);
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("OBS must use a literal loopback WebSocket address");
  return url.href;
}
export function programAddress(value: string) {
  const url = new URL(value.trim());
  const code = new URLSearchParams(url.hash.slice(1));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/studio-m3\/[0-9a-f-]{36}\/program$/.test(url.pathname) ||
    !z.string().uuid().safeParse(url.pathname.split("/")[2]).success ||
    [...code.keys()].length !== 1 ||
    !/^[A-Za-z0-9_-]{20,256}$/.test(code.get("code") ?? "")
  )
    throw new Error("Expected a private M3 HTTPS program invitation");
  return url.href;
}
export function obsAuthentication(
  password: string,
  salt: string,
  challenge: string,
) {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("base64");
  return hash(hash(password + salt) + challenge);
}
export type ObsSocket = Pick<WebSocket, "send" | "close" | "addEventListener">;
type Data = Record<string, unknown>;
const packet = z.object({
  op: z.number(),
  d: z.record(z.string(), z.unknown()),
});
const allowed = new Set([
  "GetVersion",
  "GetStats",
  "GetVideoSettings",
  "GetProfileList",
  "GetSceneCollectionList",
  "GetRecordStatus",
  "GetStreamStatus",
  "GetProfileParameter",
  "GetInputKindList",
  "GetSceneList",
  "GetSceneItemList",
  "CreateScene",
  "CreateInput",
  "SetCurrentProgramScene",
  "StartRecord",
  "StopRecord",
  "OpenVideoMixProjector",
  "GetSourceScreenshot",
]);
export class ObsLocal {
  private socket?: ObsSocket;
  private ready = false;
  private pending = new Map<
    string,
    {
      resolve: (data: Data) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly factory: (url: string) => ObsSocket = (url) =>
      new WebSocket(url),
    private readonly timeout = 5000,
  ) {}
  async connect(address: string, password: string) {
    if (this.socket) throw new Error("OBS client already used");
    if (!password) throw new Error("OBS password is required");
    const socket = (this.socket = this.factory(obsAddress(address)));
    await new Promise<void>((resolve, reject) => {
      let identified = false;
      let hello = false;
      const timer = setTimeout(
        () => fail("OBS authentication timed out"),
        this.timeout,
      );
      const fail = (reason: string) => {
        clearTimeout(timer);
        reject(new Error(reason));
        this.close();
      };
      socket.addEventListener("error", () => fail("OBS connection failed"));
      socket.addEventListener("close", () => {
        this.ready = false;
        this.rejectPending();
        if (!identified) fail("OBS authentication or connection rejected");
      });
      socket.addEventListener("message", (event) => {
        try {
          const { op, d } = packet.parse(JSON.parse(String(event.data)));
          if (op === 0 && !hello && !identified) {
            hello = true;
            const auth = z
              .object({ salt: z.string().min(1), challenge: z.string().min(1) })
              .parse(d.authentication);
            socket.send(
              JSON.stringify({
                op: 1,
                d: {
                  rpcVersion: 1,
                  eventSubscriptions: 0,
                  authentication: obsAuthentication(
                    password,
                    auth.salt,
                    auth.challenge,
                  ),
                },
              }),
            );
          } else if (
            op === 2 &&
            hello &&
            !identified &&
            d.negotiatedRpcVersion === 1
          ) {
            identified = true;
            this.ready = true;
            clearTimeout(timer);
            resolve();
          } else if (op === 7 && identified) {
            const response = z
              .object({
                requestId: z.string(),
                requestStatus: z.object({
                  result: z.boolean(),
                  code: z.number(),
                }),
                responseData: z.record(z.string(), z.unknown()).optional(),
              })
              .parse(d);
            const request = this.pending.get(response.requestId);
            if (!request) return;
            clearTimeout(request.timer);
            this.pending.delete(response.requestId);
            if (response.requestStatus.result)
              request.resolve(response.responseData ?? {});
            else
              request.reject(
                new Error(
                  `OBS request rejected (${response.requestStatus.code})`,
                ),
              );
          }
        } catch {
          fail("OBS protocol or authentication data invalid");
        }
      });
    });
  }
  private rejectPending() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("OBS disconnected"));
    }
    this.pending.clear();
  }
  close() {
    this.ready = false;
    const socket = this.socket;
    this.socket = undefined;
    this.rejectPending();
    socket?.close();
  }
  private request(
    requestType: string,
    requestData: Data = {},
    timeout = this.timeout,
  ) {
    if (!this.ready || !this.socket || !allowed.has(requestType))
      return Promise.reject(new Error("OBS request unavailable"));
    return new Promise<Data>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("OBS request timed out"));
      }, timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.socket!.send(
          JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }),
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("OBS send failed"));
      }
    });
  }
  async inspect() {
    const [
      version,
      stats,
      video,
      profile,
      collection,
      record,
      stream,
      mode,
      encoder,
      kinds,
      recordingType,
      recordingFormat,
      rescale,
    ] = await Promise.all([
      this.request("GetVersion"),
      this.request("GetStats"),
      this.request("GetVideoSettings"),
      this.request("GetProfileList"),
      this.request("GetSceneCollectionList"),
      this.request("GetRecordStatus"),
      this.request("GetStreamStatus"),
      this.request("GetProfileParameter", {
        parameterCategory: "Output",
        parameterName: "Mode",
      }),
      this.request("GetProfileParameter", {
        parameterCategory: "AdvOut",
        parameterName: "RecEncoder",
      }),
      this.request("GetInputKindList"),
      ...["RecType", "RecFormat2", "RecRescaleFilter"].map((parameterName) =>
        this.request("GetProfileParameter", {
          parameterCategory: "AdvOut",
          parameterName,
        }),
      ),
    ]);
    const parameter = (data: Data) =>
      data.parameterValue ?? data.defaultParameterValue;
    const encoderId =
      typeof encoder.parameterValue === "string" ? encoder.parameterValue : "";
    return {
      version: version.obsVersion,
      websocketVersion: version.obsWebSocketVersion,
      isolated:
        profile.currentProfileName === M3_PROFILE &&
        collection.currentSceneCollectionName === M3_PROFILE,
      videoReady:
        video.baseWidth === 1920 &&
        video.baseHeight === 1080 &&
        video.outputWidth === 1920 &&
        video.outputHeight === 1080 &&
        Number(video.fpsNumerator) / Number(video.fpsDenominator) === 30,
      browserSourceAvailable:
        Array.isArray(kinds.inputKinds) &&
        kinds.inputKinds.includes("browser_source"),
      hardwareH264Selected:
        mode.parameterValue === "Advanced" &&
        parameter(recordingType) === "Standard" &&
        [
          "obs_nvenc_h264_tex",
          "jim_nvenc",
          "h264_texture_amf",
          "h264_fallback_amf",
          "obs_qsv11",
          "obs_qsv11_v2",
        ].includes(encoderId),
      recordingFormatReady:
        parameter(recordingType) === "Standard" &&
        parameter(recordingFormat) === "mkv" &&
        parameter(rescale) === "0",
      // A configured encoder is not proof that it can initialize or sustain recording.
      recording: z.boolean().parse(record.outputActive),
      streaming: z.boolean().parse(stream.outputActive),
      cpuUsage: stats.cpuUsage,
      memoryUsageMb: stats.memoryUsage,
      activeFps: stats.activeFps,
      renderSkippedFrames: stats.renderSkippedFrames,
      renderTotalFrames: stats.renderTotalFrames,
      outputSkippedFrames: stats.outputSkippedFrames,
      outputTotalFrames: stats.outputTotalFrames,
      availableDiskSpaceMb: stats.availableDiskSpace,
      recordingBytes: record.outputBytes,
      recordingDurationMs: record.outputDuration,
    };
  }
  private async guard(idle = true) {
    const health = await this.inspect();
    if (!health.isolated)
      throw new Error(
        "Select the dedicated CurlStreamer M3 profile and scene collection in OBS",
      );
    if (health.streaming || (idle && health.recording))
      throw new Error("OBS output is already active");
    return health;
  }
  async prepare(programUrl: string) {
    const url = programAddress(programUrl);
    const health = await this.guard();
    if (!health.videoReady || !health.browserSourceAvailable)
      throw new Error(
        "Configure OBS 1920x1080 at 30fps with Browser Source support first",
      );
    const sceneName = `CurlStreamer M3 ${randomUUID()}`;
    await this.request("CreateScene", { sceneName });
    await this.request("CreateInput", {
      sceneName,
      inputName: `${sceneName} Program`,
      inputKind: "browser_source",
      inputSettings: {
        url,
        width: 1920,
        height: 1080,
        fps: 30,
        fps_custom: true,
        shutdown: false,
        restart_when_active: false,
      },
      sceneItemEnabled: true,
    });
    return { sceneName };
  }
  private async ownedScene(sceneName: string) {
    sceneSchema.parse(sceneName);
    const data = await this.request("GetSceneItemList", { sceneName });
    const items = z
      .array(
        z.object({
          sourceName: z.string(),
          inputKind: z.string().nullable().optional(),
        }),
      )
      .parse(data.sceneItems);
    if (
      items.length !== 1 ||
      items[0].sourceName !== `${sceneName} Program` ||
      items[0].inputKind !== "browser_source"
    )
      throw new Error("M3 scene identity mismatch");
  }
  async preview(sceneName: string) {
    await this.guard();
    await this.ownedScene(sceneName);
    await this.request("SetCurrentProgramScene", { sceneName });
    return { sceneName, recording: false };
  }
  async showProgram(sceneName: string) {
    await this.guard(false);
    await this.ownedScene(sceneName);
    const scenes = await this.request("GetSceneList");
    if (scenes.currentProgramSceneName !== sceneName)
      throw new Error("M3 scene identity mismatch");
    await this.request("OpenVideoMixProjector", {
      videoMixType: "OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM",
      monitorIndex: -1,
    });
    return { projectorOpened: true };
  }
  async snapshot(sceneName: string) {
    await this.guard(false);
    await this.ownedScene(sceneName);
    const data = await this.request("GetSourceScreenshot", {
      sourceName: sceneName,
      imageFormat: "png",
      imageWidth: 1920,
      imageHeight: 1080,
    });
    return z
      .string()
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
      .parse(data.imageData);
  }
  async start(sceneName: string) {
    const health = await this.guard();
    if (
      !health.videoReady ||
      !health.hardwareH264Selected ||
      !health.recordingFormatReady
    )
      throw new Error(
        "Configure 1080p30, Standard MKV without rescaling, and a dedicated hardware H264 recording encoder first",
      );
    await this.ownedScene(sceneName);
    await this.request("SetCurrentProgramScene", { sceneName });
    await this.request("StartRecord");
    return { recording: true };
  }
  async stop(sceneName: string) {
    await this.guard(false);
    await this.ownedScene(sceneName);
    const scenes = await this.request("GetSceneList");
    if (scenes.currentProgramSceneName !== sceneName)
      throw new Error("Active scene differs; stop manually in OBS");
    const data = await this.request("StopRecord");
    // StopRecord acknowledges the request before encoder/muxer shutdown finishes.
    // Never report stopped until OBS reports the recording output inactive.
    const deadline = Date.now() + this.timeout;
    try {
      while (Date.now() < deadline) {
        const status = await this.request(
          "GetRecordStatus",
          {},
          Math.max(1, deadline - Date.now()),
        );
        if (status.outputActive === false)
          return {
            recording: false,
            outputPath:
              typeof data.outputPath === "string" ? data.outputPath : undefined,
          };
        if (status.outputActive !== true) break;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(100, Math.max(1, deadline - Date.now())),
          ),
        );
      }
    } catch {
      // A lost response is an uncertain stop, not evidence that output ended.
    }
    throw new Error(
      "OBS recording stop is unconfirmed; inspect OBS before retrying",
    );
  }
}
