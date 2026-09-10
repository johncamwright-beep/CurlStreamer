/** Select a retained phone microphone before asking the browser for another.
 * A live published track wins so polling cannot replace a working sender. */
export function selectPhoneAudioTrack(
  published: MediaStreamTrack | undefined,
  warm: MediaStreamTrack | undefined,
) {
  if (published?.readyState === "live")
    return { track: published, alreadyPublished: true };
  if (warm?.readyState === "live")
    return { track: warm, alreadyPublished: false };
  return { track: undefined, alreadyPublished: false };
}
