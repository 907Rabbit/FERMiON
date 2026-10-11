import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREPARED_RUNTIME_ACQUISITION_EVENT_LOOP_DELAY_THRESHOLD_MS,
  PreparedRuntimeAcquisitionTimeoutError,
  withPreparedRuntimeAcquisitionLiveness,
} from "./prepared-runtime-acquisition-liveness.js";

describe("prepared runtime acquisition liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not install diagnostic timers without an experiment observer", async () => {
    vi.useFakeTimers();
    let observer: unknown;
    await expect(
      withPreparedRuntimeAcquisitionLiveness(async (acquisitionObserver) => {
        observer = acquisitionObserver;
        return "ready";
      }),
    ).resolves.toBe("ready");
    expect(observer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits repeated heartbeats and clears them after resolution", async () => {
    vi.useFakeTimers();
    const heartbeats: unknown[] = [];
    let resolveOperation!: (value: string) => void;
    const result = withPreparedRuntimeAcquisitionLiveness(
      async (observer) => {
        observer?.onCheckpoint?.("prepared-runtime-build-entered");
        return await new Promise<string>((resolve) => {
          resolveOperation = resolve;
        });
      },
      {
        heartbeatMs: 100,
        hardTimeoutMs: 1_000,
        onHeartbeat: (heartbeat) => heartbeats.push(heartbeat),
      },
    );

    await vi.advanceTimersByTimeAsync(250);
    expect(heartbeats).toHaveLength(2);
    resolveOperation("ready");
    await expect(result).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the heartbeat after rejection", async () => {
    vi.useFakeTimers();
    const failure = new Error("acquisition failed");
    const result = withPreparedRuntimeAcquisitionLiveness(
      async () => {
        throw failure;
      },
      { heartbeatMs: 100, hardTimeoutMs: 1_000 },
    );

    await expect(result).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports event-loop delay from the expected heartbeat schedule", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const heartbeats: Array<{
      eventLoopDelayMs: number;
      eventLoopDelayDetected: boolean;
    }> = [];
    let resolveOperation!: () => void;
    const result = withPreparedRuntimeAcquisitionLiveness(
      async () =>
        await new Promise<void>((resolve) => {
          resolveOperation = resolve;
        }),
      {
        heartbeatMs: 30_000,
        hardTimeoutMs: 600_000,
        now: () => clock,
        onHeartbeat: (heartbeat) => heartbeats.push(heartbeat),
      },
    );

    clock = 30_000 + PREPARED_RUNTIME_ACQUISITION_EVENT_LOOP_DELAY_THRESHOLD_MS;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeats[0]).toMatchObject({
      eventLoopDelayMs: PREPARED_RUNTIME_ACQUISITION_EVENT_LOOP_DELAY_THRESHOLD_MS,
      eventLoopDelayDetected: true,
    });
    resolveOperation();
    await result;
  });

  it("fails deterministically as an acquisition diagnostic timeout", async () => {
    vi.useFakeTimers();
    const heartbeats: unknown[] = [];
    const result = withPreparedRuntimeAcquisitionLiveness(
      async (observer) => {
        observer?.onCheckpoint?.("prepared-runtime-cache-check-complete");
        return await new Promise<never>(() => {});
      },
      {
        heartbeatMs: 100,
        hardTimeoutMs: 500,
        onHeartbeat: (heartbeat) => heartbeats.push(heartbeat),
      },
    );

    const rejection = expect(result).rejects.toMatchObject<
      Partial<PreparedRuntimeAcquisitionTimeoutError>
    >({
      name: "PreparedRuntimeAcquisitionTimeoutError",
      timeoutStage: "prepared-runtime-acquisition",
      timeoutMs: 500,
      lastSuccessfulCheckpoint: "prepared-runtime-cache-check-complete",
    });
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(heartbeats).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
