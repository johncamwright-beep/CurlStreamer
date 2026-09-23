import type { DirectMetrics } from "./direct-peer";

export const enduranceStorageKey = (game: string) =>
  `curlcast-m1-endurance:${game}`;
export class EnduranceRecorder {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private lastSample = 0;
  private ended = false;
  readonly report = {
    milestone: "M1",
    source: "Timed browser aggregate checkpoints",
    physicalLanProof: "Requires operator confirmation",
    startedAt: Date.now(),
    deadline: Date.now() + 2 * 60 * 60 * 1000,
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
        this.finish("completed", "Two-hour deadline reached");
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
