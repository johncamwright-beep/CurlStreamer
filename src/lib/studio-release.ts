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
  version: "0.4.0-pilot.1",
  platform: "Windows",
  architecture: "x64",
  installer: {
    fileName: "CurlStreamer-Studio-0.4.0-pilot.1-Setup.exe",
    url: "https://github.com/johncamwright-beep/CurlStreamer/releases/download/studio-v0.4.0-pilot.1/CurlStreamer-Studio-0.4.0-pilot.1-Setup.exe",
    sizeBytes: 159521509,
    sha256: "0fec647e29672b2004648dd0cf596ee1c860e80e6d669575d7c135c3bbc81235",
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
