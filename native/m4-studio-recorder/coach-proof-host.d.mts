export function startNativeCoachProof(
  host: string,
  runtime: string,
  ffmpeg: string,
  evidenceRoot: string,
): Promise<{
  capture(): Promise<{ video: string; duration: number; capturedAt: string }>;
  close(): void;
  evidence: string;
}>;
