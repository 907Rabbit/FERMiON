import { describe, expect, it } from "vitest";
import {
  correlateToolCallsAndExecutions,
  type CorrelationExecution,
  type CorrelationToolCall,
} from "./model-choice-experiment-correlation.js";

const call = (
  toolCallId: string,
  toolName = "git_status",
  modelTurnIndex = 0,
): CorrelationToolCall => ({
  toolCallId,
  toolName,
  modelTurnIndex,
});

const execution = (
  executionId: string,
  toolCallId: string | undefined,
  toolName = "git_status",
  modelTurnIndex = 0,
): CorrelationExecution => ({
  executionId,
  toolCallId,
  toolName,
  modelTurnIndex,
  success: true,
});

describe("v1I tool-call execution correlation", () => {
  it("correlates one provider call to one execution", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [execution("exec-1", "call-1")],
    });

    expect(result).toMatchObject({
      status: "PROVABLE",
      toolCallCount: 1,
      executionCount: 1,
      matchedToolCalls: 1,
      unmatchedToolCalls: 0,
      unmatchedExecutions: 0,
      oneToOneCount: 1,
      oneToManyCount: 0,
      duplicateExecutionClass: "NONE",
    });
  });

  it("deduplicates two observations of the same execution", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [execution("exec-1", "call-1"), execution("exec-1", "call-1")],
    });

    expect(result.executionCount).toBe(1);
    expect(result.duplicateExecutionClass).toBe("DUPLICATE_OBSERVATION");
    expect(result.status).toBe("PROVABLE");
  });

  it("retains two executions when one provider call is redispatched", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [execution("exec-1", "call-1"), execution("exec-2", "call-1")],
    });

    expect(result.executionCount).toBe(2);
    expect(result.oneToManyCount).toBe(1);
    expect(result.duplicateExecutionClass).toBe("RETRY_REDISPATCH");
  });

  it("distinguishes provider calls with the same tool name", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1"), call("call-2")],
      executions: [execution("exec-1", "call-1"), execution("exec-2", "call-2")],
    });

    expect(result.duplicateExecutionClass).toBe("DISTINCT_PROVIDER_TOOL_CALLS");
    expect(result.oneToOneCount).toBe(2);
  });

  it("distinguishes repeated calls across model turns", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1", "git_status", 0), call("call-2", "git_status", 1)],
      executions: [
        execution("exec-1", "call-1", "git_status", 0),
        execution("exec-2", "call-2", "git_status", 1),
      ],
    });

    expect(result.duplicateExecutionClass).toBe("MULTI_TURN_REPEAT");
  });

  it("reports an execution with no originating provider call", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [execution("exec-1", "missing-call")],
    });

    expect(result.unmatchedExecutions).toBe(1);
    expect(result.duplicateExecutionClass).toBe("UNMATCHED_EXECUTION");
    expect(result.status).toBe("UNPROVABLE");
  });

  it("reports a provider call with no execution", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [],
    });

    expect(result.unmatchedToolCalls).toBe(1);
    expect(result.status).toBe("PROVABLE");
  });

  it("keeps distinct executions in formal counts while deduplicating observations", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [
        execution("exec-1", "call-1"),
        execution("exec-1", "call-1"),
        execution("exec-2", "call-1"),
      ],
    });

    expect(result.executionCount).toBe(2);
    expect(result.executions.map((entry) => entry.executionId)).toEqual(["exec-1", "exec-2"]);
    expect(result.oneToManyCount).toBe(1);
  });

  it("fails closed when execution identity is unavailable", () => {
    const result = correlateToolCallsAndExecutions({
      toolCalls: [call("call-1")],
      executions: [{ toolCallId: "call-1", toolName: "git_status", success: true }],
    });

    expect(result.status).toBe("UNPROVABLE");
  });
});
