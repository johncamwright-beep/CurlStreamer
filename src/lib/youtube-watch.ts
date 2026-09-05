import { z } from "zod";

export const youtubeWatchUrlSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value, context) => {
    if (!value) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Enter a valid URL" });
      return z.NEVER;
    }
    const youtube = ["youtube.com", "www.youtube.com"].includes(url.hostname);
    const short = url.hostname === "youtu.be";
    const videoId = short
      ? url.pathname.slice(1).split("/")[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.startsWith("/live/")
          ? url.pathname.split("/")[2]
          : null;
    if (
      url.protocol !== "https:" ||
      (!youtube && !short) ||
      !videoId ||
      !/^[A-Za-z0-9_-]{6,}$/.test(videoId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter a YouTube watch or live link",
      });
      return z.NEVER;
    }
    url.hash = "";
    return url.toString();
  });
