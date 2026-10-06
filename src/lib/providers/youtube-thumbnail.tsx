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
  /** Prepared image data URLs; remote asset retrieval belongs to the caller. */
  teamLogo?: string;
  teamPhoto?: string;
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
  const matchupFontSize =
    Math.max(info.homeName.length, info.awayName.length) > 36 ? 38 : 52;
  const response = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "linear-gradient(125deg, #071522, #103c48)",
        color: "#f8fafc",
        padding: "36px 48px 40px",
        fontFamily: "sans-serif",
        borderBottom: "8px solid #63dce8",
      }}
    >
      <div
        style={{
          display: "flex",
          height: 156,
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <img
            alt="CurlStreamer"
            src={`data:image/png;base64,${logo.toString("base64")}`}
            width={330}
            height={84}
            style={{ objectFit: "contain" }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 19,
              color: "#63dce8",
              letterSpacing: 4,
              marginTop: 20,
            }}
          >
            UPCOMING GAME
          </div>
        </div>
        {info.teamLogo ? (
          <img
            alt="Team logo"
            src={info.teamLogo}
            width={260}
            height={156}
            style={{ objectFit: "contain" }}
          />
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: 36,
          marginTop: 18,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: info.teamPhoto ? 650 : "100%",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: matchupFontSize,
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {info.homeName}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 22,
                color: "#63dce8",
                letterSpacing: 3,
                margin: "14px 0",
              }}
            >
              VS
            </div>
            <div
              style={{
                display: "flex",
                fontSize: matchupFontSize,
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {info.awayName}
            </div>
            {info.eventName !== "Single Game" ? (
              <div
                style={{
                  display: "flex",
                  fontSize: info.eventName.length > 70 ? 22 : 27,
                  lineHeight: 1.25,
                  color: "#d6e3ee",
                  marginTop: 24,
                }}
              >
                {info.eventName}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderTop: "2px solid #3f6673",
              paddingTop: 18,
              marginTop: 20,
              fontSize: 24,
            }}
          >
            <div style={{ display: "flex" }}>{date}</div>
            <div
              style={{
                display: "flex",
                color: "#63dce8",
                fontSize: 40,
                fontWeight: 700,
                marginTop: 8,
              }}
            >
              {time}
            </div>
          </div>
        </div>
        {info.teamPhoto ? (
          <div
            style={{
              display: "flex",
              width: 498,
              height: "100%",
              background: "#081e2b",
              border: "2px solid #3f6673",
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              padding: 14,
            }}
          >
            <img
              alt="Team photo"
              src={info.teamPhoto}
              width={466}
              height={428}
              style={{ objectFit: "contain" }}
            />
          </div>
        ) : null}
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
