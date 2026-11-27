import { describe, expect, it } from "vitest";
import {
  m4CameraInputSchema,
  rtspCredentialUserInfoLength,
} from "./m4-camera-input";

describe("private RTSP camera input", () => {
  const source = {
    kind: "rtsp",
    host: "192.168.1.20",
    path: "/live/camera?channel=2&key=private-key",
  };
  it("accepts custom paths, query, ports and anonymous defaults", () => {
    expect(m4CameraInputSchema.parse(source)).toMatchObject({
      port: 554,
      username: "",
      password: "",
      rotation: 0,
    });
    for (const port of [1, 8554, 65535])
      expect(m4CameraInputSchema.safeParse({ ...source, port }).success).toBe(
        true,
      );
    expect(
      m4CameraInputSchema.safeParse({
        ...source,
        username: "caméra",
        password: "p@ss#:%",
      }).success,
    ).toBe(true);
  });
  it("matches the native encoded userinfo limit without restricting legacy Tapo", () => {
    expect(rtspCredentialUserInfoLength("é", "@%")).toBe(13);
    expect(
      m4CameraInputSchema.safeParse({
        ...source,
        username: "u",
        password: "p".repeat(125),
      }).success,
    ).toBe(true);
    expect(
      m4CameraInputSchema.safeParse({
        ...source,
        username: "u",
        password: "p".repeat(126),
      }).success,
    ).toBe(false);
    expect(
      m4CameraInputSchema.safeParse({
        ...source,
        username: "é".repeat(128),
        password: "界".repeat(256),
      }).success,
    ).toBe(false);
    expect(
      m4CameraInputSchema.safeParse({
        kind: "tapo",
        host: source.host,
        username: "u".repeat(128),
        password: "p".repeat(256),
      }).success,
    ).toBe(true);
  });
  it("rejects URL authorities, public hosts, controls and invalid paths or ports", () => {
    for (const path of [
      "rtsp://host/live",
      "live",
      "/live#frag",
      "/live\\camera",
      "/a b",
      "/a\n",
      "/a\0",
      "/a\u00a0b",
      "/" + "a".repeat(1024),
    ])
      expect(m4CameraInputSchema.safeParse({ ...source, path }).success).toBe(
        false,
      );
    for (const host of [
      "127.0.0.1",
      "8.8.8.8",
      "camera.local",
      "192.168.1.20:554",
    ])
      expect(m4CameraInputSchema.safeParse({ ...source, host }).success).toBe(
        false,
      );
    for (const port of [0, 65536, 1.5])
      expect(m4CameraInputSchema.safeParse({ ...source, port }).success).toBe(
        false,
      );
  });
});
