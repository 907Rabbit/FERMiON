export const V1J_PREFLIGHT_STAGE_NAMES = [
  "schema-preflight",
  "schema-discovery",
  "authorized-tool-surface",
  "provider-schema-materialization",
  "prepared-runtime",
  "provider-bound-capture-hook",
  "prompt-submission",
  "request-observer",
  "provider-bound-callback",
  "preflight-stop",
] as const;

export type V1JPreflightStageName = (typeof V1J_PREFLIGHT_STAGE_NAMES)[number];

export type V1JPreflightStageSummary = {
  stage_name: V1JPreflightStageName;
  entered: boolean;
  completed: boolean;
  elapsed_ms: number | null;
  failure_class: string | null;
};

type MutableStage = {
  enteredAt: number | null;
  completed: boolean;
  elapsedMs: number | null;
  failureClass: string | null;
};

/** Tracks only stage state/timing; callers must keep content and request values out. */
export function createV1JPreflightStageLedger(input: {
  record: (event: string, details: Record<string, unknown>) => void;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const stages = new Map<V1JPreflightStageName, MutableStage>(
    V1J_PREFLIGHT_STAGE_NAMES.map((stage) => [
      stage,
      { enteredAt: null, completed: false, elapsedMs: null, failureClass: null },
    ]),
  );

  const emit = (stage: V1JPreflightStageName, failureClass: string | null = null) => {
    const state = stages.get(stage)!;
    input.record("preflight-stage-accounting", {
      stage_name: stage,
      entered: state.enteredAt !== null,
      completed: state.completed,
      elapsed_ms: state.elapsedMs,
      failure_class: failureClass ?? state.failureClass,
    });
  };

  return {
    enter(stage: V1JPreflightStageName) {
      const state = stages.get(stage)!;
      if (state.enteredAt === null) {
        state.enteredAt = now();
        emit(stage);
      }
    },
    complete(stage: V1JPreflightStageName) {
      const state = stages.get(stage)!;
      if (state.enteredAt === null) {
        state.enteredAt = now();
      }
      state.completed = true;
      state.elapsedMs = Math.max(0, now() - state.enteredAt);
      emit(stage);
    },
    fail(stage: V1JPreflightStageName, error: unknown) {
      const state = stages.get(stage)!;
      if (state.enteredAt === null) {
        state.enteredAt = now();
      }
      state.elapsedMs = Math.max(0, now() - state.enteredAt);
      state.failureClass = error instanceof Error ? error.name : typeof error;
      emit(stage);
    },
    snapshot(): V1JPreflightStageSummary[] {
      return V1J_PREFLIGHT_STAGE_NAMES.map((stage_name) => {
        const state = stages.get(stage_name)!;
        return {
          stage_name,
          entered: state.enteredAt !== null,
          completed: state.completed,
          elapsed_ms: state.elapsedMs,
          failure_class: state.failureClass,
        };
      });
    },
  };
}

export class V1JPreflightStageTimeoutError extends Error {
  constructor(
    readonly stage: string,
    readonly timeoutMs: number,
    readonly lastCompletedStage: string | null,
  ) {
    super(`v1J preflight stage timed out: ${stage}`);
    this.name = "V1JPreflightStageTimeoutError";
  }
}

/** Resolves/rejects on stage transitions, not only at the end of the whole preflight. */
