import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("not-found");
  },
}));
import Page from "./page";
import {
  m4ManagerCanAct,
  m4ManagerFailureMessage,
  m4SessionResolvesUncertainty,
} from "@/components/M4BroadcastManager";

const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("M4 broadcast manager page", () => {
  it("keeps controls gated, avoids automatic POSTs, and gives safe forbidden or uncertain guidance", async () => {
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "");
    const disabled = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id }) }),
    );
    expect(disabled).toContain("Local YouTube control is unavailable");
    expect(disabled).not.toContain("Prepare unlisted broadcast");

    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
    const enabled = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id }) }),
    );
    expect(enabled).toContain("Broadcast manager");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m4ManagerFailureMessage("prepare", true)).toContain(
      "access was refused",
    );
    expect(m4ManagerFailureMessage("prepare")).toContain("Do not retry");
    expect(m4ManagerFailureMessage("stop")).toContain("quarantined");

    const staleIdle = { desiredState: "stopped", status: "idle" } as const;
    const retired = { desiredState: "stopped", status: "stopped" } as const;
    expect(m4ManagerCanAct(staleIdle, true, true)).toBe(false);
    expect(m4SessionResolvesUncertainty(staleIdle)).toBe(false);
    expect(m4SessionResolvesUncertainty(retired)).toBe(true);
  });
});
