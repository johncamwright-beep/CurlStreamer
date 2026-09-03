import React, {
  forwardRef,
  useState,
  type ForwardedRef,
  type VideoHTMLAttributes,
} from "react";
import { sourcePresentation } from "@/lib/providers/livekit-client";

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  onSourceDetails?: (details: string) => void;
  framing?: "fill" | "contain";
};

function assignRef(
  ref: ForwardedRef<HTMLVideoElement>,
  node: HTMLVideoElement | null,
) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const PortraitVideo = forwardRef<HTMLVideoElement, Props>(
  function PortraitVideo(
    {
      className = "",
      onLoadedMetadata,
      onSourceDetails,
      framing = "fill",
      ...props
    },
    ref,
  ) {
    const [landscapeSource, setLandscapeSource] = useState(false);
    return (
      <video
        {...props}
        ref={(node) => assignRef(ref, node)}
        playsInline
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          const presentation = sourcePresentation(
            element.videoWidth,
            element.videoHeight,
          );
          setLandscapeSource(element.videoWidth > element.videoHeight);
          onSourceDetails?.(
            `${element.videoWidth}×${element.videoHeight} · ${presentation.description}`,
          );
          onLoadedMetadata?.(event);
        }}
        data-source-orientation={landscapeSource ? "landscape" : "portrait"}
        data-framing={framing}
        className={`portrait-camera-video ${className}`.trim()}
      />
    );
  },
);
