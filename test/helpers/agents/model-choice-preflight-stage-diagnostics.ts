export const V1J_PREFLIGHT_STAGE_NAMES = [
  "schema-preflight",
  "schema-discovery",
  "authorized-tool-surface",
  "provider-schema-materialization",
  "capture-hook-installation",
  "prepared-runtime",
  "prompt-preflight",
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
  await_target_class: string | null;
  timeout_owner: string | null;
  failure_class: string | null;
};

type MutableStage = {
  enteredAt: number | null;
  completed: boolean;
  elapsedMs: number | null;
  awaitTargetClass: string | null;
  timeoutOwner: string | null;
  failureClass: string | null;
};

export type V1JPreflightStageMetadata = {
  awaitTargetClass?: string | null;
  timeoutOwner?: string | null;
};

export const V1J_PREFLIGHT_STAGE_METADATA: Readonly<
  Record<V1JPreflightStageName, V1JPreflightStageMetadata>
> = {
  "schema-preflight": {
    awaitTargetClass: "captureV1JPreflightSurface",
    timeoutOwner: "runV1JPreflightWithHeartbeat",
  },
  "schema-discovery": {
    awaitTargetClass: "assertLiveModelAvailable",
    timeoutOwner: "runV1JPreflightWithHeartbeat",
  },
  "authorized-tool-surface": {
    awaitTargetClass: "runEmbeddedAgent tool preparation",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "provider-schema-materialization": {
    awaitTargetClass: "provider message conversion",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "capture-hook-installation": {
    awaitTargetClass: null,
    timeoutOwner: "none; synchronous runOne hook assignment",
  },
  "prepared-runtime": {
    awaitTargetClass: "prepared-runtime acquisition",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "prompt-submission": {
    awaitTargetClass: "AgentSession.prompt",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "prompt-preflight": {
    awaitTargetClass: "runOne client-preparation completion",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "request-observer": {
    awaitTargetClass: "runOne diagnostics onProviderRequest",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "provider-bound-callback": {
    awaitTargetClass: "onProviderRequestBeforeDispatch",
    timeoutOwner: "v1J provider-capture preflight stage timeout",
  },
  "preflight-stop": {
    awaitTargetClass: null,
    timeoutOwner: "none; synchronous capture-stop sentinel",
  },
};

export type V1JCaptureHookLivenessClassification =
  | "HOOK_INSTALLATION_NOT_ENTERED"
  | "HOOK_INSTALLATION_ENTERED_NOT_COMPLETED"
  | "HOOK_INSTALLED_PROMPT_NOT_SUBMITTED"
  | "PROMPT_SUBMITTED_CAPTURE_NOT_REACHED"
  | "CAPTURE_REACHED";

export function classifyV1JCaptureHookLiveness(
  stages: readonly V1JPreflightStageSummary[],
): V1JCaptureHookLivenessClassification {
  const stage = (name: V1JPreflightStageName) =>
    stages.find((candidate) => candidate.stage_name === name);
  const hook = stage("capture-hook-installation");
  const prompt = stage("prompt-submission");
  const capture = stage("provider-bound-callback");

  if (capture?.entered) {
    return "CAPTURE_REACHED";
  }
  if (prompt?.entered) {
    return "PROMPT_SUBMITTED_CAPTURE_NOT_REACHED";
  }
  if (!hook?.entered) {
    return "HOOK_INSTALLATION_NOT_ENTERED";
  }
  if (!hook.completed) {
    return "HOOK_INSTALLATION_ENTERED_NOT_COMPLETED";
  }
  return "HOOK_INSTALLED_PROMPT_NOT_SUBMITTED";
}

/** Tracks only stage state/timing; callers must keep content and request values out. */
export function createV1JPreflightStageLedger(input: {
  record: (event: string, details: Record<string, unknown>) => void;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const stages = new Map<V1JPreflightStageName, MutableStage>(
    V1J_PREFLIGHT_STAGE_NAMES.map((stage) => [
      stage,
      {
        enteredAt: null,
        completed: false,
        elapsedMs: null,
        awaitTargetClass: V1J_PREFLIGHT_STAGE_METADATA[stage].awaitTargetClass ?? null,
        timeoutOwner: V1J_PREFLIGHT_STAGE_METADATA[stage].timeoutOwner ?? null,
        failureClass: null,
      },
    ]),
  );

  const emit = (stage: V1JPreflightStageName, failureClass: string | null = null) => {
    const state = stages.get(stage)!;
    input.record("preflight-stage-accounting", {
      stage_name: stage,
      entered: state.enteredAt !== null,
      completed: state.completed,
      elapsed_ms: state.elapsedMs,
      await_target_class: state.awaitTargetClass,
      timeout_owner: state.timeoutOwner,
      failure_class: failureClass ?? state.failureClass,
    });
  };

  return {
    enter(stage: V1JPreflightStageName, metadata: V1JPreflightStageMetadata = {}) {
      const state = stages.get(stage)!;
      if (state.enteredAt === null) {
        state.enteredAt = now();
      }
      state.awaitTargetClass = metadata.awaitTargetClass ?? state.awaitTargetClass;
      state.timeoutOwner = metadata.timeoutOwner ?? state.timeoutOwner;
      emit(stage);
    },
    complete(stage: V1JPreflightStageName, metadata: V1JPreflightStageMetadata = {}) {
      const state = stages.get(stage)!;
      if (state.enteredAt === null) {
        state.enteredAt = now();
      }
      state.awaitTargetClass = metadata.awaitTargetClass ?? state.awaitTargetClass;
      state.timeoutOwner = metadata.timeoutOwner ?? state.timeoutOwner;
      state.completed = true;
      state.elapsedMs = Math.max(0, now() - state.enteredAt);
      emit(stage);
    },
    fail(stage: V1JPreflightStageName, error: unknown, metadata: V1JPreflightStageMetadata = {}) {
      const state = stages.get(stage)!;
      state.awaitTargetClass = metadata.awaitTargetClass ?? state.awaitTargetClass;
      state.timeoutOwner =
        error instanceof V1JPreflightStageTimeoutError
          ? error.timeoutOwner
          : (metadata.timeoutOwner ?? state.timeoutOwner);
      state.elapsedMs =
        state.enteredAt === null
          ? error instanceof V1JPreflightStageTimeoutError
            ? error.elapsedMs
            : null
          : Math.max(0, now() - state.enteredAt);
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
          await_target_class: state.awaitTargetClass,
          timeout_owner: state.timeoutOwner,
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
    readonly elapsedMs: number,
    readonly lastCompletedStage: string | null,
    readonly timeoutOwner: string,
  ) {
    super(`v1J preflight stage timed out: ${stage}`);
    this.name = "V1JPreflightStageTimeoutError";
  }
}

/** Resolves/rejects on stage transitions, not only at the end of the whole preflight. */
