export type RecoverySummary = { files: number; bytes: number };
export function packRecovery(
  source: string,
  destination: string,
  key: string,
): Promise<RecoverySummary>;
export function verifyRecovery(
  source: string,
  key: string,
): Promise<RecoverySummary>;
export function restoreRecovery(
  source: string,
  destination: string,
  key: string,
): Promise<RecoverySummary>;
