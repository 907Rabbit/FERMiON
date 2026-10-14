import type { V1JPreflightDiagnosticJournal } from "./model-choice-action-initiation-smoke.js";

const SAFE_TRACE_FIELDS = [
  "runOneAttemptId",
  "embeddedRunId",
  "sessionIdSha256",
  "promptSubmissionIndex",
  "modelLoopIterationIndex",
  "provider",
  "model",
  "configuredAttemptTimeoutMs",
  "timeoutConfigurationSource",
  "elapsedMs",
  "settlementKind",
  "promptCallOutcome",
  "messageCount",
  "providerRequestHookInvocations",
  "requestObserverInvocations",
  "fetchWrapperInvocations",
  "providerDispatchAttempts",
  "preDispatchCallbackExpected",
  "preDispatchCallbackRegistered",
  "preDispatchCallbackInvoked",
  "providerSelectionSource",
  "providerCallStatus",
  "providerCallSkipReason",
  "timeoutSource",
  "timeoutFired",
  "abortRequested",
  "abortObserved",
  "abortSignalAborted",
  "abortReasonClass",
  "assistantContentSha256",
  "assistantContentBytes",
  "assistantToolCallCount",
  "assistantFinalReason",
  "assistantErrorClass",
  "assistantErrorCode",
  "sourceStage",
] as const;

/** Writes only lifecycle metadata; message and provider payload content never crosses this boundary. */
export function recordV1JPromptAwaitDiagnostic(
  journal: Pick<V1JPreflightDiagnosticJournal, "record"> | undefined,
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!journal) {
    return;
  }
  const safeDetails = Object.fromEntries(
    SAFE_TRACE_FIELDS.flatMap((key) => (key in details ? [[key, details[key]]] : [])),
  );
  journal.record(event, safeDetails);
}
