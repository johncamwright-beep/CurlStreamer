import "server-only";

export interface StreamingProvider {
  start(gameId: string): Promise<{ sessionId: string }>;
  stop(sessionId: string): Promise<void>;
}
export class MockStreamingProvider implements StreamingProvider {
  async start(gameId: string) {
    return { sessionId: `mock-${gameId}` };
  }
  async stop() {}
}
export class YouTubeRtmpProvider implements StreamingProvider {
  async start(): Promise<{ sessionId: string }> {
    if (!process.env.YOUTUBE_RTMP_URL || !process.env.YOUTUBE_STREAM_KEY)
      throw new Error("YouTube RTMP is not configured");
    throw new Error("LiveKit egress is scaffolded for Milestone 8");
  }
  async stop(): Promise<void> {
    throw new Error("LiveKit egress is scaffolded for Milestone 8");
  }
}
