import {
  recordingLink,
  reviewLink,
  reviewStart,
  videoTime,
  youtubeId,
  type VideoReview,
} from "@/lib/curlcoach/review";

export default function ReviewVideo({ video }: { video?: VideoReview }) {
  const recording = recordingLink(video);
  const link = reviewLink(video);
  if (link)
    return (
      <p className="flex flex-wrap items-center gap-x-3">
        <a
          className="inline-flex min-h-11 items-center"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Review video from {videoTime(reviewStart(video)!)}
          {video?.estimated ? " (approximate)" : ""} ↗
        </a>
        {recording && youtubeId(new URL(recording)) && (
          <a
            className="inline-flex min-h-11 items-center"
            href={recording}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open YouTube without timestamp ↗
          </a>
        )}
      </p>
    );
  if (recording)
    return (
      <p>
        <a href={recording} target="_blank" rel="noopener noreferrer">
          Open game recording ↗
        </a>
        {" · Shot timing is unavailable."}
      </p>
    );
  return <p>No recording is linked to this game yet.</p>;
}
