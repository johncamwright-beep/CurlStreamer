import type { Layout } from "./types";

export function cameraIsShown(layout: Layout, camera: "home" | "away") {
  return layout === "split" || layout === camera;
}

export function toggleCameraLayout(
  layout: Layout,
  camera: "home" | "away",
): Layout {
  const home =
    camera === "home"
      ? !cameraIsShown(layout, "home")
      : cameraIsShown(layout, "home");
  const away =
    camera === "away"
      ? !cameraIsShown(layout, "away")
      : cameraIsShown(layout, "away");
  return home && away ? "split" : home ? "home" : away ? "away" : "none";
}
