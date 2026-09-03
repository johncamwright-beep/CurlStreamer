import React, { forwardRef, type VideoHTMLAttributes } from "react";

export const PortraitVideo = forwardRef<
  HTMLVideoElement,
  VideoHTMLAttributes<HTMLVideoElement>
>(function PortraitVideo({ className = "", ...props }, ref) {
  return (
    <video
      {...props}
      ref={ref}
      playsInline
      className={`portrait-camera-video ${className}`.trim()}
    />
  );
});
