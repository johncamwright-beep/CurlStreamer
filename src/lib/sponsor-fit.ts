export type SponsorRectangle = { width: number; height: number };

/** Fits intrinsic artwork into fixed-canvas bounds without cropping or distortion. */
export function fitSponsorRectangle(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): SponsorRectangle {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    maxWidth <= 0 ||
    maxHeight <= 0
  )
    return { width: 0, height: 0 };
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

export function sponsorFrameRectangle(
  image: SponsorRectangle,
  padding: number,
  labelHeight = 0,
): SponsorRectangle {
  return {
    width: image.width + padding * 2,
    height: image.height + padding * 2 + labelHeight,
  };
}
