import React, { type ReactNode } from "react";
/** Three compact launchers; tool panels remain outside the operator's working view. */
export function StudioToolsRow({
  cameraSettings,
  replay,
  celebrations,
}: {
  cameraSettings: ReactNode;
  replay: ReactNode;
  celebrations: ReactNode;
}) {
  return (
    <div
      className="studio-tools-row"
      role="group"
      aria-label="Studio tools"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3,minmax(0,1fr))",
        gap: 8,
      }}
    >
      {cameraSettings}
      {replay}
      {celebrations}
    </div>
  );
}
