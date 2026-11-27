// Safe to import in phone/renderer code. Never carries an upstream body or URL.
export class StudioTransportUnavailable extends Error {
  constructor() {
    super("studio_transport_unavailable");
  }
}
export function isTemporaryStudioStatus(status: number) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}
