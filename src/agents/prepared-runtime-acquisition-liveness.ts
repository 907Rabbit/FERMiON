import { performance } from "node:perf_hooks";

export const PREPARED_RUNTIME_ACQUISITION_HEARTBEAT_MS = 30_000;
export const PREPARED_RUNTIME_ACQUISITION_HARD_TIMEOUT_MS = 10 * 60_000;
export const PREPARED_RUNTIME_ACQUISITION_EVENT_LOOP_DELAY_THRESHOLD_MS = 90_000;

export const PREPARED_RUNTIME_ACQUISITION_CHECKPOINTS = [
  "prepared-runtime-acquisition-requested",
  "prepared-runtime-cache-check-entered",
  "prepared-runtime-cache-check-complete",
  "prepared-runtime-build-entered",
  "prepared-runtime-build-complete",
  "prepared-runtime-plugin-prep-entered",
  "prepared-runtime-plugin-prep-complete",
] as const;

export type PreparedRuntimeAcquisitionCheckpoint =
  (typeof PREPARED_RUNTIME_ACQUISITION_CHECKPOINTS)[number];

export type PreparedRuntimeAcquisitionHeartbeat = {
  stage: "prepared-runtime-acquisition";
  elapsedMs: number;
  expectedElapsedMs: number;
  eventLoopDelayMs: number;
  eventLoopDelayDetected: boolean;
};

export type PreparedRuntimeAcquisitionObserver = {
  onCheckpoint?: (stage: PreparedRuntimeAcquisitionCheckpoint) => void;
};

export class PreparedRuntimeAcquisitionTimeoutError extends Error {
  readonly timeoutStage = "prepared-runtime-acquisition" as const;
  readonly timeoutMs: number;
  readonly lastSuccessfulCheckpoint: string | null;

  constructor(input: { timeoutMs: number; lastSuccessfulCheckpoint: string | null }) {
    super(
      `prepared runtime acquisition exceeded ${input.timeoutMs}ms after ${
        input.lastSuccessfulCheckpoint ?? "no checkpoint"
      }`,
    );
    this.name = "PreparedRuntimeAcquisitionTimeoutError";
    this.timeoutMs = input.timeoutMs;
    this.lastSuccessfulCheckpoint = input.lastSuccessfulCheckpoint;
  }
}

export type PreparedRuntimeAcquisitionLivenessOptions = {
  heartbeatMs?: number;
  hardTimeoutMs?: number;
  onCheckpoint?: (stage: PreparedRuntimeAcquisitionCheckpoint) => void;
  onHeartbeat?: (heartbeat: PreparedRuntimeAcquisitionHeartbeat) => void;
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};

/**
 * Keeps the experiment harness alive while the lifecycle-owned runtime is pending. No caller
 * gets this timer unless it explicitly supplies the experiment observer.
 */
export async function withPreparedRuntimeAcquisitionLiveness<T>(
  operation: (observer?: PreparedRuntimeAcquisitionObserver) => Promise<T>,
  options?: PreparedRuntimeAcquisitionLivenessOptions,
): Promise<T> {
  if (!options) {
    return await operation();
  }
  const heartbeatMs = options.heartbeatMs ?? PREPARED_RUNTIME_ACQUISITION_HEARTBEAT_MS;
  const hardTimeoutMs = options.hardTimeoutMs ?? PREPARED_RUNTIME_ACQUISITION_HARD_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());
  const setIntervalFn = options.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
  const setTimeoutFn = options.setTimeout ?? globalThis.setTimeout;
  const clearTimeoutFn = options.clearTimeout ?? globalThis.clearTimeout;
  const startedAt = now();
  let heartbeatNumber = 0;
  let lastSuccessfulCheckpoint: string | null = null;
  const observer: PreparedRuntimeAcquisitionObserver = {
    onCheckpoint: (stage) => {
      lastSuccessfulCheckpoint = stage;
      options.onCheckpoint?.(stage);
    },
  };
  const heartbeat = () => {
    heartbeatNumber += 1;
    const elapsedMs = Math.max(0, Math.round(now() - startedAt));
    const expectedElapsedMs = heartbeatNumber * heartbeatMs;
    const eventLoopDelayMs = Math.max(0, elapsedMs - expectedElapsedMs);
    options.onHeartbeat?.({
      stage: "prepared-runtime-acquisition",
      elapsedMs,
      expectedElapsedMs,
      eventLoopDelayMs,
      eventLoopDelayDetected:
        eventLoopDelayMs >= PREPARED_RUNTIME_ACQUISITION_EVENT_LOOP_DELAY_THRESHOLD_MS,
    });
  };
  const interval = setIntervalFn(heartbeat, heartbeatMs);
  let rejectTimeout!: (error: PreparedRuntimeAcquisitionTimeoutError) => void;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  void timeoutPromise.catch(() => undefined);
  const timeout = setTimeoutFn(() => {
    rejectTimeout(
      new PreparedRuntimeAcquisitionTimeoutError({
        timeoutMs: hardTimeoutMs,
        lastSuccessfulCheckpoint,
      }),
    );
  }, hardTimeoutMs);
  interval.unref?.();
  timeout.unref?.();
  let pending: Promise<T>;
  try {
    pending = operation(observer);
  } catch (error) {
    clearIntervalFn(interval);
    clearTimeoutFn(timeout);
    throw error;
  }
  try {
    return await Promise.race([pending, timeoutPromise]);
  } finally {
    clearIntervalFn(interval);
    clearTimeoutFn(timeout);
  }
}

export function emitPreparedRuntimeAcquisitionHeartbeat(
  heartbeat: PreparedRuntimeAcquisitionHeartbeat,
): void {
  console.log(`[V1I heartbeat] stage=${heartbeat.stage} elapsed_ms=${heartbeat.elapsedMs}`);
}
