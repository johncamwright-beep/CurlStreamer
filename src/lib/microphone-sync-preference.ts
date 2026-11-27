export const microphoneSyncPreferenceKey = "curlstreamer-microphone-sync-ms-v1";
export function validMicrophoneSync(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -5000 &&
    value <= 5000
  );
}
export function readMicrophoneSyncPreference(): number | undefined {
  try {
    const raw = localStorage.getItem(microphoneSyncPreferenceKey);
    if (raw === null || !raw.trim()) return undefined;
    const value = Number(raw);
    return validMicrophoneSync(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
export function rememberMicrophoneSync(value: number): boolean {
  if (!validMicrophoneSync(value)) return false;
  try {
    localStorage.setItem(microphoneSyncPreferenceKey, String(value));
    return true;
  } catch {
    return false;
  }
}
