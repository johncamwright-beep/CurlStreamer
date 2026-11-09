export function startNativeCoachProof(
  host: string,
  runtime: string,
  ffmpeg: string,
  evidenceRoot: string,
  cameraFrame?: (role: "camera-home" | "camera-away") => Buffer | undefined,
): Promise<{
  capture(): Promise<{ video: string; duration: number; capturedAt: string }>;
  close(): void;
  evidence: string;
}>;
