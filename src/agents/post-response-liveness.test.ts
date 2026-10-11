import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POST_RESPONSE_EVENT_LOOP_DELAY_THRESHOLD_MS,
  PostResponseTimeoutError,
  createPostResponseLiveness,
} from "./post-response-liveness.js";

describe("post-response liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start timers before the provider response boundary", () => {
    vi.useFakeTimers();
    const liveness = createPostResponseLiveness({ heartbeatMs: 100, hardTimeoutMs: 500 });
    expect(vi.getTimerCount()).toBe(0);
    liveness.arm();
    expect(vi.getTimerCount()).toBe(2);
    liveness.complete();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits heartbeats with the latest post-response substage", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const heartbeats: Array<{ substage: string; elapsedMs: number }> = [];
    const liveness = createPostResponseLiveness({
      heartbeatMs: 100,
      hardTimeoutMs: 1_000,
      now: () => clock,
      onHeartbeat: ({ substage, elapsedMs }) => heartbeats.push({ substage, elapsedMs }),
    });
    liveness.checkpoint({ stage: "tool-call-extraction-complete" });
    liveness.arm();
    clock = 100;
    await vi.advanceTimersByTimeAsync(100);
    clock = 200;
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeats).toEqual([
      { substage: "tool-call-extraction-complete", elapsedMs: 100 },
      { substage: "tool-call-extraction-complete", elapsedMs: 200 },
    ]);
    liveness.complete();
  });

  it("cleans up timers when the protected region completes", async () => {
    vi.useFakeTimers();
    const heartbeats: unknown[] = [];
    const liveness = createPostResponseLiveness({
      heartbeatMs: 100,
      hardTimeoutMs: 500,
      onHeartbeat: (heartbeat) => heartbeats.push(heartbeat),
    });
    liveness.arm();
    liveness.complete();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(heartbeats).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports event-loop delay from heartbeat timing", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const heartbeats: Array<{ eventLoopDelayMs: number; eventLoopDelayDetected: boolean }> = [];
    const liveness = createPostResponseLiveness({
      heartbeatMs: 30_000,
      hardTimeoutMs: 600_000,
      now: () => clock,
      onHeartbeat: ({ eventLoopDelayMs, eventLoopDelayDetected }) =>
        heartbeats.push({ eventLoopDelayMs, eventLoopDelayDetected }),
    });
    liveness.arm();
    clock = 30_000 + POST_RESPONSE_EVENT_LOOP_DELAY_THRESHOLD_MS;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeats[0]).toEqual({
      eventLoopDelayMs: POST_RESPONSE_EVENT_LOOP_DELAY_THRESHOLD_MS,
      eventLoopDelayDetected: true,
    });
    liveness.complete();
  });

  it("fails with a diagnostic timeout and aborts the protected region", async () => {
    vi.useFakeTimers();
    const timeoutErrors: PostResponseTimeoutError[] = [];
    const liveness = createPostResponseLiveness({
      heartbeatMs: 100,
      hardTimeoutMs: 500,
      onTimeout: (error) => timeoutErrors.push(error),
    });
    liveness.checkpoint({ stage: "tool-execution-dispatch-complete", toolCallId: "call-1" });
    liveness.arm();
    const result = expect(liveness.timeoutPromise).rejects.toMatchObject({
      name: "PostResponseTimeoutError",
      timeoutStage: "post-provider-response",
      timeoutMs: 500,
      lastSuccessfulCheckpoint: "tool-execution-dispatch-complete",
    });
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(timeoutErrors).toHaveLength(1);
    expect(liveness.signal.aborted).toBe(true);
    expect(liveness.readTimeout()).toBe(timeoutErrors[0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
