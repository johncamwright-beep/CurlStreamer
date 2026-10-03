import "server-only";
import React from "react";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { youtubeGoogleRequest } from "./youtube";

export type ScheduledThumbnail = {
  homeName: string;
  awayName: string;
  eventName: string;
  scheduledStart: string;
  timezone: string;
};

export async function renderScheduledThumbnail(info: ScheduledThumbnail) {
  const logo = await readFile(
    join(process.cwd(), "public/branding/curlstreamer-logo.png"),
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: info.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(info.scheduledStart));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: info.timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(info.scheduledStart));
  const response = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "linear-gradient(125deg, #071522, #103c48)",
        color: "#f8fafc",
        padding: "42px 64px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <img
          src={`data:image/png;base64,${logo.toString("base64")}`}
          width={530}
          height={134}
        />
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "#63dce8",
            letterSpacing: 3,
          }}
        >
          UPCOMING GAME
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 50,
            fontWeight: 700,
            lineHeight: 1.15,
          }}
        >
          {info.homeName}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 25,
            color: "#63dce8",
            margin: "10px 0",
          }}
        >
          VS
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 50,
            fontWeight: 700,
            lineHeight: 1.15,
          }}
        >
          {info.awayName}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#d6e3ee",
            marginTop: 25,
          }}
        >
          {info.eventName === "Single Game" ? "" : info.eventName}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderTop: "2px solid #3f6673",
          paddingTop: 18,
          fontSize: 28,
        }}
      >
        <div style={{ display: "flex" }}>{date}</div>
        <div
          style={{
            display: "flex",
            color: "#63dce8",
            fontSize: 38,
            marginTop: 6,
          }}
        >
          {time}
        </div>
      </div>
    </div>,
    { width: 1280, height: 720 },
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 2_000_000)
    throw new Error("youtube_thumbnail_too_large");
  return bytes;
}

export async function uploadScheduledThumbnail(
  accessToken: string,
  videoId: string,
  info: ScheduledThumbnail,
  fetcher: typeof fetch = fetch,
) {
  const bytes = await renderScheduledThumbnail(info);
  await youtubeGoogleRequest(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "image/png",
      },
      body: new Blob([bytes], { type: "image/png" }),
    },
    fetcher,
    true,
  );
}
