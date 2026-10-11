export type CorrelationToolCall = {
  toolCallId: string;
  toolName: string;
  modelTurnIndex: number;
};

export type CorrelationExecution = {
  executionId?: string;
  toolCallId?: string;
  toolName: string;
  modelTurnIndex?: number;
  startedAt?: number;
  completedAt?: number;
  success: boolean;
};

export type CorrelationDuplicateClass =
  | "NONE"
  | "DISTINCT_PROVIDER_TOOL_CALLS"
  | "MULTI_TURN_REPEAT"
  | "RETRY_REDISPATCH"
  | "DUPLICATE_OBSERVATION"
  | "UNMATCHED_EXECUTION"
  | "UNKNOWN";

export type ToolCallExecutionCorrelation = {
  toolCallId: string;
  matchingExecutionIds: string[];
};

export type CorrelationResult = {
  status: "PROVABLE" | "UNPROVABLE";
  toolCallCount: number;
  executionCount: number;
  matchedToolCalls: number;
  unmatchedToolCalls: number;
  unmatchedExecutions: number;
  oneToOneCount: number;
  oneToManyCount: number;
  toolCallCorrelations: ToolCallExecutionCorrelation[];
  executions: CorrelationExecution[];
  duplicateExecutionClass: CorrelationDuplicateClass;
};

export function correlateToolCallsAndExecutions(input: {
  toolCalls: readonly CorrelationToolCall[];
  executions: readonly CorrelationExecution[];
}): CorrelationResult {
  const executionById = new Map<string, CorrelationExecution>();
  const unidentifiedExecutions: CorrelationExecution[] = [];
  let duplicateObservation = false;
  let unprovable = false;
  for (const execution of input.executions) {
    if (!execution.executionId || !execution.toolCallId) {
      unprovable = true;
      unidentifiedExecutions.push(execution);
      continue;
    }
    const existing = executionById.get(execution.executionId);
    if (existing) {
      duplicateObservation = true;
      if (
        existing.toolCallId !== execution.toolCallId ||
        existing.toolName !== execution.toolName ||
        existing.success !== execution.success
      ) {
        unprovable = true;
      }
      continue;
    }
    executionById.set(execution.executionId, execution);
  }

  const executions = [...executionById.values(), ...unidentifiedExecutions];
  const knownToolCallIds = new Set(input.toolCalls.map((call) => call.toolCallId));
  const byToolCall = new Map<string, CorrelationExecution[]>();
  for (const execution of executions) {
    if (!execution.toolCallId || !knownToolCallIds.has(execution.toolCallId)) {
      unprovable = true;
      continue;
    }
    const bucket = byToolCall.get(execution.toolCallId) ?? [];
    bucket.push(execution);
    byToolCall.set(execution.toolCallId, bucket);
  }

  const toolCallCorrelations = input.toolCalls.map((call) => ({
    toolCallId: call.toolCallId,
    matchingExecutionIds: (byToolCall.get(call.toolCallId) ?? [])
      .map((execution) => execution.executionId)
      .filter((id): id is string => id !== undefined),
  }));
  const matchedToolCalls = toolCallCorrelations.filter(
    (correlation) => correlation.matchingExecutionIds.length > 0,
  ).length;
  const unmatchedToolCalls = toolCallCorrelations.length - matchedToolCalls;
  const unmatchedExecutions = executions.filter(
    (execution) => !execution.toolCallId || !knownToolCallIds.has(execution.toolCallId),
  ).length;
  const oneToOneCount = toolCallCorrelations.filter(
    (correlation) => correlation.matchingExecutionIds.length === 1,
  ).length;
  const oneToManyCount = toolCallCorrelations.filter(
    (correlation) => correlation.matchingExecutionIds.length > 1,
  ).length;

  const duplicateExecutionClass = classifyDuplicateExecution({
    toolCalls: input.toolCalls,
    executions,
    duplicateObservation,
    unmatchedExecutions,
    oneToManyCount,
  });
  return {
    status: unprovable ? "UNPROVABLE" : "PROVABLE",
    toolCallCount: input.toolCalls.length,
    executionCount: executions.length,
    matchedToolCalls,
    unmatchedToolCalls,
    unmatchedExecutions,
    oneToOneCount,
    oneToManyCount,
    toolCallCorrelations,
    executions,
    duplicateExecutionClass,
  };
}

function classifyDuplicateExecution(input: {
  toolCalls: readonly CorrelationToolCall[];
  executions: readonly CorrelationExecution[];
  duplicateObservation: boolean;
  unmatchedExecutions: number;
  oneToManyCount: number;
}): CorrelationDuplicateClass {
  if (input.duplicateObservation) {
    return "DUPLICATE_OBSERVATION";
  }
  if (input.unmatchedExecutions > 0) {
    return "UNMATCHED_EXECUTION";
  }
  if (input.oneToManyCount > 0) {
    return "RETRY_REDISPATCH";
  }
  if (input.executions.length === 0) {
    return "NONE";
  }
  const callsByName = new Map<string, CorrelationToolCall[]>();
  for (const call of input.toolCalls) {
    const bucket = callsByName.get(call.toolName) ?? [];
    bucket.push(call);
    callsByName.set(call.toolName, bucket);
  }
  const repeatedNameCalls = [...callsByName.values()].find((calls) => calls.length > 1);
  if (!repeatedNameCalls) {
    return "NONE";
  }
  const turns = new Set(repeatedNameCalls.map((call) => call.modelTurnIndex));
  return turns.size > 1 ? "MULTI_TURN_REPEAT" : "DISTINCT_PROVIDER_TOOL_CALLS";
}
