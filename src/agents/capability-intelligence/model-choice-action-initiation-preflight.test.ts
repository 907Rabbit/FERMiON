import { describe, expect, it } from "vitest";
import {
  evaluateV1JPreflightStop,
  summarizeV1JPreflightObservations,
  type V1JPreflightCounters,
  type V1JPreflightRequestObservation,
} from "../../../test/helpers/agents/model-choice-action-initiation-smoke.js";

const observation: V1JPreflightRequestObservation = {
  arm: "C",
  armInstructionSha256: "a".repeat(64),
  modelId: "qwen/qwen3.5-9b",
  modelConfigSha256: "b".repeat(64),
  requestUrlSha256: "c".repeat(64),
  requestBodySha256: "d".repeat(64),
  systemPromptSha256: "e".repeat(64),
  authorizedToolCount: 15,
  authorizedToolNameSha256: "f".repeat(64),
  authorizedToolSchemaSha256: "1".repeat(64),
  providerToolCount: 15,
  providerToolNameSha256: "2".repeat(64),
  providerToolSchemaSha256: "3".repeat(64),
};

function preflightCounters(count: number): V1JPreflightCounters {
  return {
    requestObserverInvocations: count,
    providerRequestHookInvocations: count,
    fetchWrapperInvocations: 0,
    providerCallbackInvocations: 0,
    providerDispatchAttempts: 0,
    modelRequestCounter: 0,
    schemaCaptureStarts: 0,
    schemaCaptureCompletes: 0,
    preflightStopSignalRaised: count,
    preflightStopSignalCaught: 1,
    preflightCompleted: 0,
  };
}

function evaluatePreflight(
  observations: readonly V1JPreflightRequestObservation[],
  overrides: Partial<V1JPreflightCounters> = {},
) {
  const count = observations.length;
  const result = evaluateV1JPreflightStop({
    counters: { ...preflightCounters(count), ...overrides },
    requestObserverCount: count,
    capturedRequestCount: count,
    delegatedRequestCount: 0,
    providerDispatchAttempts: overrides.providerDispatchAttempts ?? 0,
    observations,
  });
  return { ...result, passed: Object.values(result.predicates).every(Boolean) };
}

describe("v1J repeated Arm C preflight observations", () => {
  it("accepts one observation or repeated canonically identical observations without dispatch", () => {
    expect(evaluatePreflight([observation]).passed).toBe(true);

    const repeated = evaluatePreflight([observation, observation, observation, observation]);
    expect(repeated.passed).toBe(true);
    expect(repeated.observationSummary).toMatchObject({
      rawCallbackCount: 4,
      uniqueCanonicalObservations: 1,
      duplicateEquivalentCallbacks: 3,
      allCapturedObservationsEquivalent: true,
      canonicalObservation: observation,
    });
    expect(repeated.predicates.providerCallbackCountIsZero).toBe(true);
    expect(repeated.predicates.dispatchAttemptsIsZero).toBe(true);
    expect(repeated.predicates.modelRequestCountIsZero).toBe(true);
  });

  it("fails closed on schema, model/config, dispatch, or missing-observation drift", () => {
    expect(
      evaluatePreflight([
        observation,
        observation,
        observation,
        { ...observation, providerToolSchemaSha256: "4".repeat(64) },
      ]).passed,
    ).toBe(false);
    expect(
      evaluatePreflight([
        observation,
        observation,
        { ...observation, modelConfigSha256: "5".repeat(64) },
        observation,
      ]).passed,
    ).toBe(false);
    expect(evaluatePreflight([observation], { providerCallbackInvocations: 1 }).passed).toBe(false);
    expect(evaluatePreflight([observation], { providerDispatchAttempts: 1 }).passed).toBe(false);
    expect(evaluatePreflight([]).passed).toBe(false);
    expect(summarizeV1JPreflightObservations([]).canonicalObservation).toBeNull();
  });
});
