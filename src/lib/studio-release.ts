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
  availability: "unpublished",
  channel: "pilot",
  version: "0.4.0-pilot.1",
  platform: "Windows",
  architecture: "x64",
};

export function formatBytes(sizeBytes: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
  }).format(sizeBytes / 1_000_000);
}
