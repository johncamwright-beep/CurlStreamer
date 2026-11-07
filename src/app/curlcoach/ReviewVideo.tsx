import {
  reviewLink,
  reviewStart,
  supportedVideo,
  videoTime,
  type VideoReview,
} from "@/lib/curlcoach/review";

export default function ReviewVideo({ video }: { video?: VideoReview }) {
  const link = reviewLink(video);
  if (link)
    return (
      <p>
        <a href={link} target="_blank" rel="noopener noreferrer">
          Review video from {videoTime(reviewStart(video)!)}
          {video?.estimated ? " (approximate)" : ""} ↗
        </a>
        {video?.estimated && (
          <span> · Check the nearby play; recording timing may differ.</span>
        )}
      </p>
    );
  if (video && supportedVideo(video.url))
    return (
      <p>
        <a href={video.url} target="_blank" rel="noopener noreferrer">
          Open game recording ↗
        </a>
        {" · Shot timing is unavailable."}
      </p>
    );
  return <p>No recording is linked to this game yet.</p>;
}
