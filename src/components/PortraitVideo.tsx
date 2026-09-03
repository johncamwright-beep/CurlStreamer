import React, {
  forwardRef,
  useState,
  type ForwardedRef,
  type VideoHTMLAttributes,
} from "react";
import { sourcePresentation } from "@/lib/providers/livekit-client";

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  onSourceDetails?: (details: string) => void;
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
    { className = "", onLoadedMetadata, onSourceDetails, ...props },
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
          setLandscapeSource(presentation.fit === "cover");
          onSourceDetails?.(
            `${element.videoWidth}×${element.videoHeight} · ${presentation.description}`,
          );
          onLoadedMetadata?.(event);
        }}
        data-source-orientation={landscapeSource ? "landscape" : "portrait"}
        className={`portrait-camera-video ${landscapeSource ? "portrait-camera-video--landscape" : ""} ${className}`.trim()}
      />
    );
  },
);
