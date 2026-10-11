import { performance } from "node:perf_hooks";

export const POST_RESPONSE_HEARTBEAT_MS = 30_000;
export const POST_RESPONSE_HARD_TIMEOUT_MS = 10 * 60_000;
export const POST_RESPONSE_EVENT_LOOP_DELAY_THRESHOLD_MS = 90_000;

export const POST_RESPONSE_CHECKPOINTS = [
  "provider-response-normalization-entered",
  "provider-response-normalization-complete",
  "assistant-message-dispatch-entered",
  "assistant-message-dispatch-complete",
  "tool-call-extraction-entered",
  "tool-call-extraction-complete",
  "tool-execution-dispatch-entered",
  "tool-execution-dispatch-complete",
  "tool-result-processing-entered",
  "tool-result-processing-complete",
  "terminal-observation-entered",
  "terminal-observation-complete",
  "tool-call-correlation-entered",
  "tool-call-correlation-complete",
] as const;

export type PostResponseCheckpointStage = (typeof POST_RESPONSE_CHECKPOINTS)[number];

export type PostResponseCheckpoint = {
  stage: PostResponseCheckpointStage;
  observedAt?: string;
  elapsedMs?: number;
  executionId?: string;
  toolCallId?: string;
  toolName?: string;
};

export type PostResponseSnapshot = {
  kind:
    | "provider-response"
    | "normalized-assistant-message"
    | "before-execution"
    | "execution-correlation";
  contentTypes: readonly string[];
  toolCallCount: number;
  toolCallIds: readonly string[];
  toolNames: readonly string[];
  executionIds?: readonly string[];
  correlationPairs?: readonly string[];
};

export type PostResponseCounterName =
  | "message-end-callback"
  | "tool-call-observation"
  | "execution-dispatch"
  | "execution-completion"
  | "terminal-callback";

export type PostResponseCounter = {
  name: PostResponseCounterName;
};

export type PostResponseHeartbeat = {
  stage: "post-provider-response";
  substage: string;
  elapsedMs: number;
  expectedElapsedMs: number;
  eventLoopDelayMs: number;
  eventLoopDelayDetected: boolean;
};

export class PostResponseTimeoutError extends Error {
  readonly timeoutStage = "post-provider-response" as const;
  readonly timeoutMs: number;
  readonly lastSuccessfulCheckpoint: string | null;

  constructor(input: { timeoutMs: number; lastSuccessfulCheckpoint: string | null }) {
    super(
      `post-provider-response processing exceeded ${input.timeoutMs}ms after ${
        input.lastSuccessfulCheckpoint ?? "no checkpoint"
      }`,
    );
    this.name = "PostResponseTimeoutError";
    this.timeoutMs = input.timeoutMs;
    this.lastSuccessfulCheckpoint = input.lastSuccessfulCheckpoint;
  }
}

export type PostResponseLivenessOptions = {
  heartbeatMs?: number;
  hardTimeoutMs?: number;
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  onCheckpoint?: (checkpoint: PostResponseCheckpoint) => void;
  onHeartbeat?: (heartbeat: PostResponseHeartbeat) => void;
  onTimeout?: (error: PostResponseTimeoutError) => void;
};

export type PostResponseLiveness = {
  signal: AbortSignal;
  timeoutPromise: Promise<never>;
  arm: () => void;
  complete: () => void;
  checkpoint: (checkpoint: PostResponseCheckpoint) => void;
  readLastSuccessfulCheckpoint: () => string | null;
  readTimeout: () => PostResponseTimeoutError | undefined;
};

/** Diagnostic-only liveness guard. It installs no timers until the provider response boundary. */
export function createPostResponseLiveness(
  options: PostResponseLivenessOptions = {},
): PostResponseLiveness {
  const heartbeatMs = options.heartbeatMs ?? POST_RESPONSE_HEARTBEAT_MS;
  const hardTimeoutMs = options.hardTimeoutMs ?? POST_RESPONSE_HARD_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());
  const setIntervalFn = options.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
  const setTimeoutFn = options.setTimeout ?? globalThis.setTimeout;
  const clearTimeoutFn = options.clearTimeout ?? globalThis.clearTimeout;
  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let startedAt: number | undefined;
  let heartbeatNumber = 0;
  let currentSubstage = "provider-response-received";
  let lastSuccessfulCheckpoint: string | null = null;
  let timeoutError: PostResponseTimeoutError | undefined;
  let rejectTimeout!: (error: PostResponseTimeoutError) => void;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  void timeoutPromise.catch(() => undefined);

  const clearTimers = () => {
    if (heartbeat !== undefined) {
      clearIntervalFn(heartbeat);
      heartbeat = undefined;
    }
    if (timeout !== undefined) {
      clearTimeoutFn(timeout);
      timeout = undefined;
    }
  };

  const emitHeartbeat = () => {
    heartbeatNumber += 1;
    const elapsedMs = Math.max(0, Math.round(now() - (startedAt ?? now())));
    const expectedElapsedMs = heartbeatNumber * heartbeatMs;
    const eventLoopDelayMs = Math.max(0, elapsedMs - expectedElapsedMs);
    options.onHeartbeat?.({
      stage: "post-provider-response",
      substage: currentSubstage,
      elapsedMs,
      expectedElapsedMs,
      eventLoopDelayMs,
      eventLoopDelayDetected: eventLoopDelayMs >= POST_RESPONSE_EVENT_LOOP_DELAY_THRESHOLD_MS,
    });
  };

  const arm = () => {
    if (startedAt !== undefined || timeoutError) {
      return;
    }
    startedAt = now();
    heartbeat = setIntervalFn(emitHeartbeat, heartbeatMs);
    timeout = setTimeoutFn(() => {
      timeoutError = new PostResponseTimeoutError({
        timeoutMs: hardTimeoutMs,
        lastSuccessfulCheckpoint,
      });
      clearTimers();
      options.onTimeout?.(timeoutError);
      abortController.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, hardTimeoutMs);
    heartbeat.unref?.();
    timeout.unref?.();
  };

  return {
    signal: abortController.signal,
    timeoutPromise,
    arm,
    complete: clearTimers,
    checkpoint: (checkpoint) => {
      currentSubstage = checkpoint.stage;
      lastSuccessfulCheckpoint = checkpoint.stage;
      options.onCheckpoint?.(checkpoint);
    },
    readLastSuccessfulCheckpoint: () => lastSuccessfulCheckpoint,
    readTimeout: () => timeoutError,
  };
}

export function emitPostResponseHeartbeat(heartbeat: PostResponseHeartbeat): void {
  console.log(
    `[V1I heartbeat] stage=${heartbeat.stage} substage=${heartbeat.substage} elapsed_ms=${heartbeat.elapsedMs}`,
  );
}
