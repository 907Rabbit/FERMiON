/**
 * Coverage, repetition, and stop hints for a shadow evidence batch.
 * The report still grades a full-sample pass. v1F-2 may stop early when an
 * anytime-valid rate bound is below its gate after the evidence floor.
 */
import { CAPABILITY_DOMAIN_IDS } from "./capability-catalog.js";
import {
  caseProducedRequiredEvidence,
  shadowEvidenceEvents,
  type ShadowEvidenceBatch,
  type ShadowQualificationReplayCase,
} from "./shadow-evidence-collector.js";
import { oneSidedAnytimeUpperBound } from "./confidence-sequence.js";
import {
  V1F2_EARLY_FAILURE_IDENTITY,
  type V1F2EarlyFailureIdentity,
} from "./early-failure-policy.js";
import { renderShadowQualificationReport } from "./shadow-qualification-report.js";
import { qualifyShadowTraffic } from "./shadow-qualification.js";
import {
  MIN_C8_CALLS,
  MIN_CREQ8_CALLS,
  SHADOW_QUALIFICATION_POLICY_VERSION,
  SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS,
  shadowRateSequences,
  summarizeShadowTraffic,
  type ShadowContainmentEvent,
  type ShadowTrafficQualification,
} from "./shadow-traffic.js";

export type ShadowReplayRepetition = {
  uniqueReplayCases: number;
  totalReplayRuns: number;
  maxRunsPerCase: number;
  replayCalls: number;
  maxCallsPerCase: number;
  mostRepeatedCaseId: string | null;
  /**
   * Executions from the most repeated case divided by all replay executions.
   * Diagnostic only.
   */
  rMax: number | null;
};

export type ShadowEvidenceCoverage = {
  executedCallsRemaining: number;
  multiToolTurnsRemaining: number;
  provenanceBackedRequiredCalls: number;
  requiredRoleSamplesRemaining: number;
  domainCalls: Readonly<Record<string, number>>;
  domainsBelowMinimum: readonly string[];
};

export type EvidenceCollectionReason =
  | "qualified"
  | "measured-failure"
  | "required-role-exhausted"
  | "continue";

export type StatisticalFailureBasis = "C8-below-gate" | "Creq8-below-gate";

export type EvidenceCollectionDecision = {
  /** True when more replay should not be used to edit the frozen ranker. */
  stop: boolean;
  reason: EvidenceCollectionReason;
  /**
   * Present only when v1F-2 stops before the full sample because an
   * anytime-valid 95% upper bound is below its rate gate after the evidence
   * floor. This is not a multi-tool containment claim.
   */
  basis?: StatisticalFailureBasis;
};

export function replayRepetition(batch: ShadowEvidenceBatch): ShadowReplayRepetition {
  const runsByCase = new Map<string, number>();
  const callsByCase = new Map<string, number>();
  let replayCalls = 0;
  for (const run of batch.runs) {
    runsByCase.set(run.caseId, (runsByCase.get(run.caseId) ?? 0) + 1);
    for (const event of run.events) {
      if (!event.executionStarted) {
        continue;
      }
      replayCalls += 1;
      callsByCase.set(run.caseId, (callsByCase.get(run.caseId) ?? 0) + 1);
    }
  }
  let maxRunsPerCase = 0;
  for (const count of runsByCase.values()) {
    if (count > maxRunsPerCase) {
      maxRunsPerCase = count;
    }
  }
  let maxCallsPerCase = 0;
  let mostRepeatedCaseId: string | null = null;
  for (const [caseId, count] of callsByCase) {
    if (
      count > maxCallsPerCase ||
      (count === maxCallsPerCase && (mostRepeatedCaseId === null || caseId < mostRepeatedCaseId))
    ) {
      maxCallsPerCase = count;
      mostRepeatedCaseId = caseId;
    }
  }
  return {
    uniqueReplayCases: runsByCase.size,
    totalReplayRuns: batch.runs.length,
    maxRunsPerCase,
    replayCalls,
    maxCallsPerCase,
    mostRepeatedCaseId: replayCalls === 0 ? null : mostRepeatedCaseId,
    rMax: replayCalls === 0 ? null : maxCallsPerCase / replayCalls,
  };
}

export function describeEvidenceCoverage(
  batch: ShadowEvidenceBatch,
  cases: readonly ShadowQualificationReplayCase[],
): ShadowEvidenceCoverage {
  const summary = summarizeShadowTraffic(shadowEvidenceEvents(batch));
  const thresholds = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS;
  const domainCalls: Record<string, number> = {};
  const domainsBelowMinimum: string[] = [];
  for (const domain of CAPABILITY_DOMAIN_IDS) {
    const count = summary.familyExecutionCounts[domain] ?? 0;
    domainCalls[domain] = count;
    if (count < thresholds.minExecutedCallsPerFamily) {
      domainsBelowMinimum.push(domain);
    }
  }
  return {
    executedCallsRemaining: Math.max(0, thresholds.minExecutedCalls - summary.executedCalls),
    multiToolTurnsRemaining: Math.max(0, thresholds.minMultiToolTurns - summary.multiToolTurns),
    provenanceBackedRequiredCalls: summary.requiredExecutedCalls,
    requiredRoleSamplesRemaining: cases.filter(
      (replayCase) =>
        (replayCase.requiredTools?.length ?? 0) > 0 &&
        !caseProducedRequiredEvidence(batch, replayCase.id),
    ).length,
    domainCalls,
    domainsBelowMinimum,
  };
}

export function formatReplayRepetition(batch: ShadowEvidenceBatch): string {
  const repetition = replayRepetition(batch);
  const rMax =
    repetition.rMax === null || repetition.mostRepeatedCaseId === null
      ? "Rmax = n/a"
      : `Rmax = ${formatPercent(repetition.rMax)} (${repetition.maxCallsPerCase}/${repetition.replayCalls})`;
  return [
    "REPLAY REPETITION",
    `unique replay cases = ${repetition.uniqueReplayCases}`,
    `total replay runs = ${repetition.totalReplayRuns}`,
    `max runs per case = ${repetition.maxRunsPerCase}`,
    `replay calls = ${repetition.replayCalls}`,
    `max calls per case = ${repetition.maxCallsPerCase}`,
    `most repeated case = ${repetition.mostRepeatedCaseId ?? "none"}`,
    rMax,
  ].join("\n");
}

export function formatEvidenceCoverage(
  batch: ShadowEvidenceBatch,
  cases: readonly ShadowQualificationReplayCase[],
): string {
  const coverage = describeEvidenceCoverage(batch, cases);
  const domainLines = CAPABILITY_DOMAIN_IDS.map(
    (domain) => `${domain} = ${coverage.domainCalls[domain] ?? 0}`,
  );
  const below =
    coverage.domainsBelowMinimum.length === 0 ? "none" : coverage.domainsBelowMinimum.join(", ");
  return [
    "EVIDENCE COVERAGE",
    `executed calls remaining = ${coverage.executedCallsRemaining}`,
    `multi-tool turns remaining = ${coverage.multiToolTurnsRemaining}`,
    `provenance-backed required calls = ${coverage.provenanceBackedRequiredCalls}`,
    `required-role samples remaining = ${coverage.requiredRoleSamplesRemaining}`,
    ...domainLines,
    `domains below minimum = ${below}`,
  ].join("\n");
}

/**
 * Stop collecting for a pass, a v1F-2 rate-gate failure, a quality failure on
 * a full-size sample, or a catalog that cannot produce required-role evidence.
 * A pass still needs the full sample. Early failure is allowed only after
 * MIN_C8_CALLS or MIN_CREQ8_CALLS, and only when the anytime-valid upper
 * bound on that sequence is strictly below its gate. Each gate uses its
 * v1F-2 alpha (0.05). The locked family-wise union bound is 0.10. Authorization regressions
 * and simulated blocks stay on the full sample. Domain gaps stay `continue`.
 * v1D-1 samples do not use the bound. This does not edit the ranker.
 */
export function evidenceCollectionDecision(input: {
  batch: ShadowEvidenceBatch;
  cases: readonly ShadowQualificationReplayCase[];
  offlineRequiredRecallPassed: boolean;
  offlineNdcgPassed: boolean;
}): EvidenceCollectionDecision {
  const qualification = qualifyCollectedBatch(input);
  if (qualification.passed) {
    return { stop: true, reason: "qualified" };
  }
  const requiredCases = input.cases.filter(
    (replayCase) => (replayCase.requiredTools?.length ?? 0) > 0,
  );
  if (qualification.requiredExecutedCalls === 0 && requiredCases.length === 0) {
    return { stop: true, reason: "required-role-exhausted" };
  }
  const thresholds = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS;
  const sizeMet =
    qualification.executedCalls >= thresholds.minExecutedCalls &&
    qualification.multiToolTurns >= thresholds.minMultiToolTurns;
  const basis =
    stampedPolicy(input.batch) === SHADOW_QUALIFICATION_POLICY_VERSION
      ? statisticalFailureBasis(shadowEvidenceEvents(input.batch))
      : undefined;
  if (!sizeMet && basis) {
    return { stop: true, reason: "measured-failure", basis };
  }
  if (sizeMet && qualification.requiredExecutedCalls > 0 && qualityFailed(qualification)) {
    return { stop: true, reason: "measured-failure" };
  }
  return { stop: false, reason: "continue" };
}

export function renderCollectedEvidence(input: {
  batch: ShadowEvidenceBatch;
  cases: readonly ShadowQualificationReplayCase[];
  offlineRequiredRecallPassed: boolean;
  offlineNdcgPassed: boolean;
}): string {
  const events = shadowEvidenceEvents(input.batch);
  const qualification = qualifyShadowTraffic({
    events,
    offlineRequiredRecallPassed: input.offlineRequiredRecallPassed,
    offlineNdcgPassed: input.offlineNdcgPassed,
  });
  const report = renderShadowQualificationReport(qualification, events);
  return [
    report,
    "",
    formatEvidenceCoverage(input.batch, input.cases),
    "",
    formatReplayRepetition(input.batch),
  ].join("\n");
}

function stampedPolicy(batch: ShadowEvidenceBatch): string | null {
  const versions = new Set(
    shadowEvidenceEvents(batch).map((event) => event.qualificationPolicyVersion),
  );
  if (versions.size !== 1) {
    return null;
  }
  return [...versions][0] ?? null;
}

/**
 * C8 is the overall execution sequence. Creq8 is only the provenance-backed
 * required sequence. Neither basis is a claim about multi-tool turns.
 * The bound is the running intersection along the observed order.
 */
function statisticalFailureBasis(
  events: readonly ShadowContainmentEvent[],
): StatisticalFailureBasis | undefined {
  const sequences = shadowRateSequences(events);
  const thresholds = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS;
  const identity = V1F2_EARLY_FAILURE_IDENTITY;
  if (
    sequences.executed.length >= MIN_C8_CALLS &&
    anytimeUpperIsBelow(sequences.executed, thresholds.executedContainment, identity.alphaC8)
  ) {
    return "C8-below-gate";
  }
  if (
    sequences.required.length >= MIN_CREQ8_CALLS &&
    anytimeUpperIsBelow(sequences.required, thresholds.requiredContainment, identity.alphaCreq8)
  ) {
    return "Creq8-below-gate";
  }
  return undefined;
}

function anytimeUpperIsBelow(
  observations: readonly number[],
  gate: number,
  alpha: number,
): boolean {
  const upper = oneSidedAnytimeUpperBound(observations, alpha);
  return upper !== null && upper < gate;
}

export type OrderedGateState = {
  n: number;
  /** Collection order. The bound is not a function of the success count alone. */
  observations: (0 | 1)[];
  upperIntersection: number | null;
};

export type EarlyFailureCheckpoint = {
  identity: V1F2EarlyFailureIdentity;
  c8: OrderedGateState;
  creq8: OrderedGateState;
};

function orderedGateState(observations: readonly (0 | 1)[], alpha: number): OrderedGateState {
  return {
    n: observations.length,
    observations: observations.slice(),
    upperIntersection:
      observations.length === 0 ? null : oneSidedAnytimeUpperBound(observations, alpha),
  };
}

/**
 * Ordered sequences and running intersections for a checkpoint.
 * Resume replays this from the stored events. It cannot be rebuilt from
 * a success count and a trial count.
 */
export function earlyFailureCheckpoint(
  events: readonly ShadowContainmentEvent[],
): EarlyFailureCheckpoint {
  const sequences = shadowRateSequences(events);
  const identity = V1F2_EARLY_FAILURE_IDENTITY;
  return {
    identity,
    c8: orderedGateState(sequences.executed, identity.alphaC8),
    creq8: orderedGateState(sequences.required, identity.alphaCreq8),
  };
}

export function sameOrderedGateState(left: OrderedGateState, right: OrderedGateState): boolean {
  if (left.n !== right.n || left.observations.length !== right.n) {
    return false;
  }
  if (right.observations.length !== right.n || left.upperIntersection !== right.upperIntersection) {
    return false;
  }
  for (let index = 0; index < left.observations.length; index += 1) {
    if (left.observations[index] !== right.observations[index]) {
      return false;
    }
  }
  return true;
}

function qualifyCollectedBatch(input: {
  batch: ShadowEvidenceBatch;
  offlineRequiredRecallPassed: boolean;
  offlineNdcgPassed: boolean;
}): ShadowTrafficQualification {
  return qualifyShadowTraffic({
    events: shadowEvidenceEvents(input.batch),
    offlineRequiredRecallPassed: input.offlineRequiredRecallPassed,
    offlineNdcgPassed: input.offlineNdcgPassed,
  });
}

function qualityFailed(qualification: ShadowTrafficQualification): boolean {
  return (
    !qualification.executedContainmentPassed ||
    !qualification.requiredContainmentPassed ||
    !qualification.simulatedRequiredBlocksPassed ||
    !qualification.simulatedTaskCriticalBlocksPassed ||
    !qualification.authorizationRegressionsPassed ||
    !qualification.offlineRequiredRecallPassed ||
    !qualification.offlineNdcgPassed ||
    !qualification.sampleCompatible ||
    !qualification.recognizedPolicy
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
