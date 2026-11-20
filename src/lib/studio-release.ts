export type StudioInstallerAsset = {
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
};

export type StudioReleaseDescriptor =
  | {
      availability: "unpublished";
      channel: "pilot";
      version: string;
      platform: "Windows";
      architecture: "x64";
    }
  | {
      availability: "published";
      channel: "pilot";
      version: string;
      platform: "Windows";
      architecture: "x64";
      installer: StudioInstallerAsset;
    };

// Set availability to "published" only after the GitHub Release asset and its
// verified metadata are available. Keeping the installer field absent prevents
// the site from exposing a guessed or stale download URL during the pilot.
export const studioRelease: StudioReleaseDescriptor = {
  availability: "published",
  channel: "pilot",
  version: "0.4.0-pilot.2",
  platform: "Windows",
  architecture: "x64",
  installer: {
    fileName: "CurlStreamer-Studio-0.4.0-pilot.2-Setup.exe",
    url: "https://github.com/johncamwright-beep/CurlStreamer/releases/download/studio-v0.4.0-pilot.2/CurlStreamer-Studio-0.4.0-pilot.2-Setup.exe",
    sizeBytes: 159554608,
    sha256: "46647865b9f98c15ec1e66c1041dbe72949c91ea34668a4aaa60798f0814ca0f",
  },
};

export function formatBytes(sizeBytes: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
  }).format(sizeBytes / 1_000_000);
}
