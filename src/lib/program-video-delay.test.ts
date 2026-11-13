import { describe, expect, it } from "vitest";
import { ProgramVideoDelayQueue } from "./program-video-delay";

const frame = (size = 1) => new Blob([new Uint8Array(size)]);

describe("program video delay queue", () => {
  it("never releases a frame before its full delay and skips overdue frames", () => {
    const queue = new ProgramVideoDelayQueue(2000);
    const first = frame(),
      second = frame(),
      future = frame();
    queue.enqueue(first, 100);
    queue.enqueue(second, 150);
    queue.enqueue(future, 300);
    expect(queue.takeDue(2099)).toBeUndefined();
    expect(queue.takeDue(2200)).toBe(second);
    expect(queue.takeDue(2299)).toBeUndefined();
    expect(queue.takeDue(2300)).toBe(future);
    expect(queue.retainedBytes).toBe(0);
  });

  it("retains the oldest due frame and the newest during sustained pressure", () => {
    const queue = new ProgramVideoDelayQueue(5000, 4, 4);
    const oldest = frame();
    queue.enqueue(oldest, 0);
    let newest = oldest;
    for (let i = 1; i <= 100; i++) {
      newest = frame();
      queue.enqueue(newest, i * 30);
      expect(queue.length).toBeLessThanOrEqual(4);
      expect(queue.retainedBytes).toBeLessThanOrEqual(4);
    }
    expect(queue.takeDue(4999)).toBeUndefined();
    expect(queue.takeDue(5000)).toBe(oldest);
    expect(queue.takeDue(8000)).toBe(newest);
  });

  it("enforces byte limits independently of frame count and clears old media", () => {
    const queue = new ProgramVideoDelayQueue(1000, 192, 8);
    const oldest = frame(4);
    queue.enqueue(oldest, 0);
    queue.enqueue(frame(4), 10);
    queue.enqueue(frame(4), 20);
    queue.enqueue(frame(9), 30);
    expect(queue.length).toBe(2);
    expect(queue.retainedBytes).toBe(8);
    expect(queue.takeDue(1000)).toBe(oldest);
    queue.clear();
    expect(queue.takeDue(100000)).toBeUndefined();
    expect(queue.retainedBytes).toBe(0);
  });
});
