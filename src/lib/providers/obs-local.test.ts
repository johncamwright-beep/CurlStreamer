import { describe, expect, it } from "vitest";
import {
  ObsLocal,
  obsAddress,
  programAddress,
  obsAuthentication,
  type ObsSocket,
} from "./obs-local";
class Socket extends EventTarget {
  sent: { op: number; d: Record<string, unknown> }[] = [];
  closed = false;
  response: (
    type: string,
    data: Record<string, unknown>,
  ) => Record<string, unknown> = (type) =>
    ({
      GetVersion: { obsVersion: "test" },
      GetStats: {},
      GetVideoSettings: {
        baseWidth: 1920,
        baseHeight: 1080,
        outputWidth: 1920,
        outputHeight: 1080,
        fpsNumerator: 30,
        fpsDenominator: 1,
      },
      GetProfileList: { currentProfileName: "CurlStreamer M3" },
      GetSceneCollectionList: { currentSceneCollectionName: "CurlStreamer M3" },
      GetRecordStatus: { outputActive: false },
      GetStreamStatus: { outputActive: false },
      GetProfileParameter: { parameterValue: "Advanced" },
      GetInputKindList: { inputKinds: ["browser_source"] },
    })[type] ?? {};
  emit(op: number, d: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ op, d }) }),
    );
  }
  send(raw: string) {
    const p = JSON.parse(raw);
    this.sent.push(p);
    if (p.op === 1)
      queueMicrotask(() => this.emit(2, { negotiatedRpcVersion: 1 }));
    if (p.op === 6)
      queueMicrotask(() =>
        this.emit(7, {
          requestId: p.d.requestId,
          requestStatus: { result: true, code: 100 },
          responseData: this.response(p.d.requestType, p.d.requestData),
        }),
      );
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.dispatchEvent(new Event("close"));
    }
  }
}
async function setup(timeout = 100) {
  const socket = new Socket();
  const client = new ObsLocal(() => socket as ObsSocket, timeout);
  const connected = client.connect("ws://127.0.0.1:4455", "private-password");
  socket.emit(0, { authentication: { salt: "salt", challenge: "challenge" } });
  await connected;
  return { socket, client };
}
const url =
  "https://example.test/studio-m3/00000000-0000-4000-8000-000000000001/program#code=abcdefghijklmnopqrstuvwxyz123456";
describe("local OBS proof adapter", () => {
  it("rejects remote addresses, credentials and unrelated bearer URL forms", () => {
    for (const address of [
      "ws://example.com:4455",
      "ws://192.168.8.2:4455",
      "ws://localhost:4455",
      "ws://user:pass@127.0.0.1:4455",
      "ws://127.0.0.1:4455/path",
    ])
      expect(() => obsAddress(address)).toThrow();
    expect(obsAddress("ws://[::1]:4455")).toBe("ws://[::1]:4455/");
    expect(programAddress(url)).toBe(url);
    for (const address of [
      url.replace("https:", "http:"),
      url.replace("#code=", "#token="),
      url + "&token=secret",
      url.replace("/program", "/camera"),
    ])
      expect(() => programAddress(address)).toThrow();
  });
  it("requires authenticated Hello and does not send a raw password", async () => {
    const { client, socket } = await setup();
    expect(socket.sent[0].d.authentication).toBe(
      obsAuthentication("private-password", "salt", "challenge"),
    );
    expect(JSON.stringify(socket.sent)).not.toContain("private-password");
    client.close();
    const bad = new Socket();
    const adapter = new ObsLocal(() => bad as ObsSocket);
    const attempt = adapter.connect("ws://127.0.0.1:4455", "secret");
    bad.emit(0, {});
    await expect(attempt).rejects.toThrow("protocol or authentication");
    expect(bad.sent).toHaveLength(0);
  });
  it("does not touch an existing unrelated profile", async () => {
    const { client, socket } = await setup();
    const original = socket.response;
    socket.response = (type, data) =>
      type === "GetProfileList"
        ? { currentProfileName: "My recording" }
        : original(type, data);
    await expect(client.prepare(url)).rejects.toThrow("dedicated");
    expect(
      socket.sent
        .filter((p) => p.op === 6)
        .every((p) => String(p.d.requestType).startsWith("Get")),
    ).toBe(true);
    client.close();
  });
  it("creates only a new scene and a persistent 1080p browser source, without selecting or streaming", async () => {
    const { client, socket } = await setup();
    const result = await client.prepare(url);
    expect(result.sceneName).toMatch(/^CurlStreamer M3 /);
    const mutations = socket.sent.filter(
      (p) => p.op === 6 && !String(p.d.requestType).startsWith("Get"),
    );
    expect(mutations.map((p) => p.d.requestType)).toEqual([
      "CreateScene",
      "CreateInput",
    ]);
    expect(mutations[1].d.requestData).toMatchObject({
      inputKind: "browser_source",
      inputSettings: {
        width: 1920,
        height: 1080,
        fps: 30,
        shutdown: false,
        restart_when_active: false,
      },
    });
    client.close();
  });
  it("refuses software recording and active output", async () => {
    const { client, socket } = await setup();
    await expect(
      client.start("CurlStreamer M3 " + crypto.randomUUID()),
    ).rejects.toThrow("hardware");
    const original = socket.response;
    socket.response = (type, data) =>
      type === "GetStreamStatus"
        ? { outputActive: true }
        : original(type, data);
    await expect(client.prepare(url)).rejects.toThrow("active");
    expect(socket.sent.some((p) => p.d.requestType === "StartRecord")).toBe(
      false,
    );
    client.close();
  });
  it("auth timeout is bounded and a disconnect rejects pending calls", async () => {
    const socket = new Socket();
    const client = new ObsLocal(() => socket as ObsSocket, 5);
    await expect(
      client.connect("ws://127.0.0.1:4455", "password"),
    ).rejects.toThrow("timed out");
    const second = await setup();
    second.socket.send = () => {};
    const inspection = second.client.inspect();
    second.socket.close();
    await expect(inspection).rejects.toThrow("disconnected");
  });
  it("records only an owned scene and prevents stopping an unrelated scene", async () => {
    const { client, socket } = await setup();
    const name = "CurlStreamer M3 " + crypto.randomUUID();
    const original = socket.response;
    let currentScene = name;
    socket.response = (type, data) => {
      if (type === "GetProfileParameter" && data.parameterName === "RecType")
        return { parameterValue: "Standard" };
      if (type === "GetProfileParameter" && data.parameterName === "RecFormat2")
        return { parameterValue: "mkv" };
      if (
        type === "GetProfileParameter" &&
        data.parameterName === "RecRescaleFilter"
      )
        return { parameterValue: "0" };
      if (type === "GetProfileParameter" && data.parameterName === "RecEncoder")
        return { parameterValue: "obs_nvenc_h264_tex" };
      if (type === "GetSceneItemList")
        return {
          sceneItems: [
            { sourceName: name + " Program", inputKind: "browser_source" },
          ],
        };
      if (type === "GetSceneList")
        return { currentProgramSceneName: currentScene };
      if (type === "StopRecord")
        return { outputPath: "C:/recordings/local.mkv" };
      return original(type, data);
    };
    await expect(client.start(name)).resolves.toEqual({ recording: true });
    expect(
      socket.sent
        .filter((p) => p.op === 6 && !String(p.d.requestType).startsWith("Get"))
        .map((p) => p.d.requestType),
    ).toEqual(["SetCurrentProgramScene", "StartRecord"]);
    currentScene = "Other scene";
    await expect(client.stop(name)).rejects.toThrow("differs");
    expect(socket.sent.some((p) => p.d.requestType === "StopRecord")).toBe(
      false,
    );
    currentScene = name;
    await expect(client.stop(name)).resolves.toEqual({
      recording: false,
      outputPath: "C:/recordings/local.mkv",
    });
    client.close();
  });
  it("previews only an owned scene while idle and never starts recording", async () => {
    const { client, socket } = await setup();
    const name = "CurlStreamer M3 " + crypto.randomUUID();
    const original = socket.response;
    let owned = true;
    socket.response = (type, data) => {
      if (type === "GetSceneItemList")
        return {
          sceneItems: [
            {
              sourceName: owned ? name + " Program" : "Unrelated",
              inputKind: "browser_source",
            },
          ],
        };
      return original(type, data);
    };
    await expect(client.preview(name)).resolves.toEqual({
      sceneName: name,
      recording: false,
    });
    owned = false;
    await expect(client.preview(name)).rejects.toThrow("identity mismatch");
    expect(
      socket.sent
        .filter((p) => p.op === 6 && !String(p.d.requestType).startsWith("Get"))
        .map((p) => p.d.requestType),
    ).toEqual(["SetCurrentProgramScene"]);
    client.close();
  });
  it("redacts server error comments containing private source data", async () => {
    const { client, socket } = await setup();
    socket.send = (raw) => {
      const message = JSON.parse(raw);
      queueMicrotask(() =>
        socket.emit(7, {
          requestId: message.d.requestId,
          requestStatus: { result: false, code: 600, comment: url },
        }),
      );
    };
    await expect(client.inspect()).rejects.toThrow(
      "OBS request rejected (600)",
    );
    client.close();
  });
  it("waits for delayed encoder shutdown instead of treating the stop acknowledgment as completion", async () => {
    const { client, socket } = await setup(1000);
    const name = "CurlStreamer M3 " + crypto.randomUUID();
    const original = socket.response;
    let stopRequested = false;
    let polls = 0;
    socket.response = (type, data) => {
      if (type === "GetSceneItemList")
        return {
          sceneItems: [
            { sourceName: name + " Program", inputKind: "browser_source" },
          ],
        };
      if (type === "GetSceneList") return { currentProgramSceneName: name };
      if (type === "StopRecord") {
        stopRequested = true;
        return { outputPath: "C:/recordings/flushed.mkv" };
      }
      if (type === "GetRecordStatus")
        return { outputActive: !stopRequested || ++polls < 3 };
      return original(type, data);
    };
    const result = await client.stop(name);
    expect(polls).toBe(3);
    expect(result).toEqual({
      recording: false,
      outputPath: "C:/recordings/flushed.mkv",
    });
    expect(
      socket.sent.filter((p) => p.d.requestType === "StopRecord"),
    ).toHaveLength(1);
    client.close();
  });
  it("reports an uncertain stop when output remains active after the deadline", async () => {
    const { client, socket } = await setup(30);
    const name = "CurlStreamer M3 " + crypto.randomUUID();
    const original = socket.response;
    socket.response = (type, data) => {
      if (type === "GetSceneItemList")
        return {
          sceneItems: [
            { sourceName: name + " Program", inputKind: "browser_source" },
          ],
        };
      if (type === "GetSceneList") return { currentProgramSceneName: name };
      if (type === "GetRecordStatus") return { outputActive: true };
      return original(type, data);
    };
    await expect(client.stop(name)).rejects.toThrow("stop is unconfirmed");
    expect(
      socket.sent.filter((p) => p.d.requestType === "StopRecord"),
    ).toHaveLength(1);
    client.close();
  });
});
