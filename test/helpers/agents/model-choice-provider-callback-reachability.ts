export const V1J_PROVIDER_CALLBACK_STAGES = [
  "provider-capture-hook-resolved",
  "request-observer-enter",
  "request-observer-exit",
  "provider-transform-enter",
  "provider-transform-exit",
  "provider-capture-hook-invoked",
  "provider-capture-hook-return",
  "capture-stop-sentinel-created",
  "capture-stop-sentinel-thrown",
  "createFailureMessage-observed",
] as const;

export type V1JProviderCallbackStage = (typeof V1J_PROVIDER_CALLBACK_STAGES)[number];

export type V1JProviderCallbackReachabilityEvent = {
  stage: V1JProviderCallbackStage;
  entered: boolean;
  completed: boolean;
  invocationCount: number;
  runId: string;
  promptSubmissionIndex: number;
  modelLoopIteration: number;
  providerInstanceId: string | null;
  hookIdentity: string | null;
  failureClass: string | null;
};

export type V1JProviderCallbackReachabilityClassification =
  | "EXPECTED_CAPTURE_SEQUENCE"
  | "OBSERVER_WITHOUT_PROVIDER_TRANSFORM"
  | "PROVIDER_TRANSFORM_FAILED_BEFORE_CAPTURE_HOOK"
  | "CAPTURE_HOOK_RESOLVED_BUT_BYPASSED"
  | "CAPTURE_HOOK_PROVIDER_INSTANCE_MISMATCH"
  | "SYNTHETIC_STOP_BEFORE_PROVIDER_TRANSFORM"
  | "CAPTURE_CALLBACK_MULTIPLICITY_MISMATCH"
  | "INCOMPLETE_PROVIDER_CALLBACK_TRACE";

export function createV1JProviderCallbackReachabilityTrace() {
  const events: V1JProviderCallbackReachabilityEvent[] = [];

  return {
    record(event: V1JProviderCallbackReachabilityEvent): void {
      events.push(event);
    },
    snapshot(): V1JProviderCallbackReachabilityEvent[] {
      return events.map((event) => ({ ...event }));
    },
    classify(providerDispatchAttempts: number): V1JProviderCallbackReachabilityClassification {
      return classifyV1JProviderCallbackReachability(events, providerDispatchAttempts);
    },
  };
}

export function classifyV1JProviderCallbackReachability(
  events: readonly V1JProviderCallbackReachabilityEvent[],
  providerDispatchAttempts: number,
): V1JProviderCallbackReachabilityClassification {
  const has = (stage: V1JProviderCallbackStage) => events.some((event) => event.stage === stage);
  const observerExited = has("request-observer-exit");
  const transformEntered = has("provider-transform-enter");
  const transformExited = has("provider-transform-exit");
  const hookResolved = events.find((event) => event.stage === "provider-capture-hook-resolved");
  const hookInvocations = events.filter(
    (event) => event.stage === "provider-capture-hook-invoked" && event.entered,
  );
  const failedTransform = events
    .toReversed()
    .find((event) => event.stage === "provider-transform-exit" && !event.completed);
  const sentinelThrown = has("capture-stop-sentinel-thrown");
  const failureMessageObserved = has("createFailureMessage-observed");

  if (!transformEntered && sentinelThrown) {
    return "SYNTHETIC_STOP_BEFORE_PROVIDER_TRANSFORM";
  }
  if (has("request-observer-enter") && !transformEntered) {
    return "OBSERVER_WITHOUT_PROVIDER_TRANSFORM";
  }
  if (transformEntered && (!transformExited || failedTransform) && !hookInvocations.length) {
    return "PROVIDER_TRANSFORM_FAILED_BEFORE_CAPTURE_HOOK";
  }
  if (hookResolved?.completed && hookInvocations.length === 0 && observerExited) {
    return "CAPTURE_HOOK_RESOLVED_BUT_BYPASSED";
  }
  const runtimeProviderIdentities = new Set(
    events
      .filter((event) =>
        [
          "request-observer-enter",
          "provider-transform-enter",
          "provider-capture-hook-invoked",
        ].includes(event.stage),
      )
      .map((event) => event.providerInstanceId)
      .filter((identity): identity is string => identity !== null),
  );
  if (
    runtimeProviderIdentities.size > 1 ||
    hookInvocations.some((event) => hookResolved?.hookIdentity !== event.hookIdentity)
  ) {
    return "CAPTURE_HOOK_PROVIDER_INSTANCE_MISMATCH";
  }
  if (hookInvocations.length > 1) {
    return "CAPTURE_CALLBACK_MULTIPLICITY_MISMATCH";
  }
  if (
    observerExited &&
    transformExited &&
    hookInvocations.length === 1 &&
    has("capture-stop-sentinel-created") &&
    sentinelThrown &&
    failureMessageObserved &&
    providerDispatchAttempts === 0
  ) {
    return "EXPECTED_CAPTURE_SEQUENCE";
  }
  return "INCOMPLETE_PROVIDER_CALLBACK_TRACE";
}
