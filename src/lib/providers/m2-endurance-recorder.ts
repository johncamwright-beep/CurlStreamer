import type { DirectMetrics } from "./direct-peer";

export const enduranceStorageKey = (game: string) =>
  `curlcast-m2-endurance:${game}`;
export class EnduranceRecorder {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private lastSample = 0;
  private ended = false;
  readonly report = {
    milestone: "M2",
    cameraRole: "" as "" | "camera-home" | "camera-away",
    source: "Timed browser aggregate checkpoints",
    physicalLanProof: "Requires operator confirmation",
    startedAt: Date.now(),
    deadline: Date.now() + 2.5 * 60 * 60 * 1000,
    endedAt: null as number | null,
    outcome: "running",
    reason: "",
    persistence: "ok",
    checkpoints: [] as {
      at: number;
      metrics: DirectMetrics | undefined;
      metricsAt?: number;
      visibility?: string;
      online?: boolean;
      frameWidth?: number;
      frameHeight?: number;
    }[],
  };
  constructor(
    private options: {
      save: (report: string) => void;
      metrics: () => DirectMetrics | undefined;
      context?: () => {
        metricsAt?: number;
        visibility?: string;
        online?: boolean;
        frameWidth?: number;
        frameHeight?: number;
      };
      finished: (outcome: string) => void;
    },
  ) {}
  start() {
    this.checkpoint();
    this.timer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastTick > 30_000) {
        this.finish(
          "interrupted",
          "Browser timer suspended for more than 30 seconds",
        );
        return;
      }
      this.lastTick = now;
      if (now >= this.report.deadline) {
        this.finish("completed", "Two-and-a-half-hour deadline reached");
        return;
      }
      if (now - this.lastSample >= 15_000) {
        try {
          this.checkpoint();
        } catch {
          this.finish("failed", "Checkpoint storage unavailable");
        }
      }
    }, 1000);
  }
  private checkpoint() {
    this.lastSample = Date.now();
    this.report.checkpoints.push({
      at: this.lastSample,
      metrics: this.options.metrics(),
      ...this.options.context?.(),
    });
    this.options.save(JSON.stringify(this.report));
  }
  finish(outcome: string, reason: string) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    this.report.endedAt = Date.now();
    this.report.outcome = outcome;
    this.report.reason = reason;
    try {
      this.checkpoint();
    } catch {
      this.report.outcome = "failed";
      this.report.persistence = "final-write-failed";
    }
    this.options.finished(this.report.outcome);
  }
}
