import { describe, expect, it } from "vitest";
import { ANYTIME_LAMBDA_CAP, ANYTIME_UPPER_ALPHA } from "./confidence-sequence.js";
import { V1F2_EARLY_FAILURE_IDENTITY } from "./early-failure-policy.js";
import {
  createShadowEvidenceBatch,
  type ShadowEvidenceBatch,
} from "./shadow-evidence-collector.js";
import {
  earlyFailureCheckpoint,
  evidenceCollectionDecision,
  sameOrderedGateState,
} from "./shadow-evidence-progress.js";
import {
  createShadowContainmentEvent,
  SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS,
  type ShadowContainmentEvent,
} from "./shadow-traffic.js";

function execution(inTop8: boolean, index: number): ShadowContainmentEvent {
  const event = createShadowContainmentEvent({
    mode: "simulated-filter",
    runId: `run-${index}`,
    turnId: `turn-${index}`,
    authorizedCount: 1,
    rankedTop8: inTop8 ? ["read"] : ["write"],
    selectedTool: "read",
    executionStarted: true,
    success: true,
    role: "unknown",
    roleSource: "unknown",
    authorizedNames: ["read"],
  });
  if (!event) {
    throw new Error("expected an execution");
  }
  return event;
}

function batchOf(batchId: string, events: readonly ShadowContainmentEvent[]): ShadowEvidenceBatch {
  const batch = createShadowEvidenceBatch(batchId);
  const first = events[0];
  return {
    ...batch,
    version: first
      ? {
          schemaVersion: first.schemaVersion,
          rankerVersion: first.rankerVersion,
          qualificationPolicyVersion: first.qualificationPolicyVersion,
        }
      : null,
    runs: events.map((event) => ({
      caseId: "order-case",
      runId: event.runId,
      events: [event],
    })),
  };
}

describe("v1F-2 early-failure identity", () => {
  it("locks the family-wise union bound at 0.10", () => {
    expect(V1F2_EARLY_FAILURE_IDENTITY).toEqual({
      method: "predictable-plugin-empirical-bernstein",
      alphaC8: 0.05,
      alphaCreq8: 0.05,
      familyWiseUnionBound: 0.1,
      lambdaCap: 0.5,
      runningIntersection: true,
      c8Floor: 50,
      creq8Floor: 20,
      c8Gate: 0.98,
      creq8Gate: 0.99,
    });
    expect(V1F2_EARLY_FAILURE_IDENTITY.familyWiseUnionBound).toBe(
      V1F2_EARLY_FAILURE_IDENTITY.alphaC8 + V1F2_EARLY_FAILURE_IDENTITY.alphaCreq8,
    );
    expect(ANYTIME_UPPER_ALPHA).toBe(V1F2_EARLY_FAILURE_IDENTITY.alphaC8);
    expect(ANYTIME_UPPER_ALPHA).toBe(V1F2_EARLY_FAILURE_IDENTITY.alphaCreq8);
    expect(ANYTIME_LAMBDA_CAP).toBe(V1F2_EARLY_FAILURE_IDENTITY.lambdaCap);
    expect(SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.executedContainment).toBe(
      V1F2_EARLY_FAILURE_IDENTITY.c8Gate,
    );
    expect(SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.requiredContainment).toBe(
      V1F2_EARLY_FAILURE_IDENTITY.creq8Gate,
    );
  });

  it("keeps the ordered sequence, so the same counts do not share a bound", () => {
    const successesFirst = [
      ...Array.from({ length: 400 }, (_, index) => execution(true, index)),
      ...Array.from({ length: 20 }, (_, index) => execution(false, 400 + index)),
    ];
    const failuresFirst = [
      ...Array.from({ length: 20 }, (_, index) => execution(false, index)),
      ...Array.from({ length: 400 }, (_, index) => execution(true, 20 + index)),
    ];
    const kept = earlyFailureCheckpoint(successesFirst);
    const reversed = earlyFailureCheckpoint(failuresFirst);
    expect(kept.c8.n).toBe(420);
    expect(reversed.c8.n).toBe(420);
    expect(kept.c8.observations.reduce<number>((sum, value) => sum + value, 0)).toBe(400);
    expect(reversed.c8.observations.reduce<number>((sum, value) => sum + value, 0)).toBe(400);
    expect(kept.c8.upperIntersection).toBeGreaterThanOrEqual(0.98);
    expect(reversed.c8.upperIntersection).toBeLessThan(0.98);
    expect(sameOrderedGateState(kept.c8, reversed.c8)).toBe(false);
    expect(sameOrderedGateState(kept.c8, earlyFailureCheckpoint(successesFirst).c8)).toBe(true);
    expect(kept.identity).toEqual(V1F2_EARLY_FAILURE_IDENTITY);
    const replayCase = {
      id: "order-case",
      prompt: "order",
      domain: "coding" as const,
      requiredTools: ["read"],
      roleSource: "benchmark" as const,
    };
    const offline = { offlineRequiredRecallPassed: true, offlineNdcgPassed: true };
    expect(
      evidenceCollectionDecision({
        batch: batchOf("successes-first", successesFirst),
        cases: [replayCase],
        ...offline,
      }),
    ).toEqual({ stop: false, reason: "continue" });
    expect(
      evidenceCollectionDecision({
        batch: batchOf("failures-first", failuresFirst),
        cases: [replayCase],
        ...offline,
      }),
    ).toEqual({ stop: true, reason: "measured-failure", basis: "C8-below-gate" });
  });
});
