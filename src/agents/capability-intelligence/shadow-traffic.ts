/**
 * Shadow-traffic measurement for capability ranking.
 *
 * Records whether an executed tool was inside the top 8, and whether the
 * proposed filtered surface would have blocked it. No mode narrows the tools
 * the model can see. A passing qualification does not turn filtering on.
 */
import { CAPABILITY_DOMAIN_IDS, domainForTool } from "./capability-catalog.js";

export const SHADOW_TOP_K = 8;

/** Live exposure stays the full authorized set. Qualification must not flip this. */
export const ACTIVE_FILTERING_ENABLED = false;

export const SHADOW_TRAFFIC_MODES = ["off", "shadow", "simulated-filter", "active"] as const;

export type ShadowTrafficMode = (typeof SHADOW_TRAFFIC_MODES)[number];

/** Collect the counterfactual while the live surface stays complete. */
export const DEFAULT_SHADOW_TRAFFIC_MODE = "simulated-filter" satisfies ShadowTrafficMode;

/** Catalog discovery controls. Not added to the simulated kept set. */
export const DISCOVERY_CONTROL_TOOLS = ["tool_search", "tool_describe", "tool_call"] as const;

export const SHADOW_MISS_SEVERITIES = [
  "top-8 miss, task still succeeds",
  "top-8 miss, fallback/tool-search would recover",
  "top-8 miss, task degraded",
  "top-8 miss, task failed",
] as const;

export type ShadowMissSeverity = (typeof SHADOW_MISS_SEVERITIES)[number];

export type ShadowToolRole = "required" | "relevant" | "optional" | "unknown";

/** Same vocabulary as `ShadowToolRole`. Kept so telemetry can name the label directly. */
export type ToolRole = ShadowToolRole;

/**
 * Where a role label came from. `unknown` is stored and is not evidence for
 * required-containment, turn containment, or simulated required blocks.
 */
export const TOOL_ROLE_SOURCES = [
  "workflow-contract",
  "benchmark",
  "caller",
  "runtime-invariant",
  "unknown",
] as const;

export type ToolRoleSource = (typeof TOOL_ROLE_SOURCES)[number];

/** Event schema this qualifier knows how to interpret. Mixed versions do not qualify. */
export const SHADOW_CONTAINMENT_SCHEMA_VERSION = 1;
export const SHADOW_RANKER_VERSION = "v1C";
/**
 * Policy stamped on new events. v1D-1 samples stay recognized and keep the
 * full-sample stop rule. v1F-2 may stop early when an anytime-valid rate
 * bound is below its gate after the evidence floor. Each gate uses alpha
 * 0.05, so the locked family-wise union bound is 0.10. v1F-1 was not
 * collected and is not recognized.
 */
export const SHADOW_QUALIFICATION_POLICY_VERSION = "v1F-2";
export const RECOGNIZED_QUALIFICATION_POLICY_VERSIONS = ["v1D-1", "v1F-2"] as const;
export { MIN_C8_CALLS, MIN_CREQ8_CALLS, V1F2_EARLY_FAILURE_IDENTITY } from "./early-failure-policy.js";

export function isRecognizedQualificationPolicy(version: string): boolean {
  return (RECOGNIZED_QUALIFICATION_POLICY_VERSIONS as readonly string[]).includes(version); // SAFETY: widens the readonly tuple for membership only.
}

/**
 * First filtered trial, when one is eventually enabled. Not applied here.
 * Empty rankings and low confidence fail open only in that later trial.
 */
export const FILTERED_TRIAL_RECOVERY_RULES = [
  "ranking confidence low → full authorized surface",
  "empty ranking → full authorized surface",
  "required runtime condition detected → preserve required tool",
  "tool-search available → retain discovery controls",
] as const;

/** One occurrence is enough. Do not wait for an aggregate once filtering is on. */
export const FILTERED_TRIAL_ROLLBACK_TRIGGERS = [
  "required tool omitted",
  "task failure attributable to filtering",
  "authorization/policy mismatch",
  "unexpected tool-search dead end",
  "containment falls below threshold",
] as const;

export const SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS = {
  executedContainment: 0.98,
  requiredContainment: 0.99,
  minExecutedCalls: 500,
  minMultiToolTurns: 100,
  /** Known domains with at least this many executed calls. Unknown does not count. */
  minRepresentedFamilies: 4,
  minExecutedCallsPerFamily: 5,
  /**
   * Largest known domain's share of known-domain calls. Reported only.
   * A sample can pass the family count and still be this concentrated.
   */
  maxKnownDomainShare: 0.7,
} as const;

export type ShadowToolExecution = {
  executed: boolean;
  succeeded: boolean;
  /** Caller-supplied. Live traffic stays unknown; do not infer this from the query. */
  role?: ShadowToolRole;
  /** Deterministic label source. Omitted labels stay `unknown` and do not qualify. */
  roleSource?: ToolRoleSource;
  /** Set only when a caller already knows the task was harmed. Do not invent it. */
  degraded?: boolean;
};

export type ShadowContainmentEvent = {
  runId: string;
  /** One prompt ranking: `${runId}:${epoch}`. */
  turnId: string;
  mode: ShadowTrafficMode;
  authorizedCount: number;
  rankedTop8: string[];
  selectedTool: string;
  executionStarted: boolean;
  success?: boolean;
  inTop8: boolean;
  role: ShadowToolRole;
  roleSource: ToolRoleSource;
  /** `domainForTool`, or `unknown` when the catalog has no domain. */
  family: string;
  schemaVersion: number;
  rankerVersion: string;
  qualificationPolicyVersion: string;
  authorizationEvaluable: boolean;
  /** Executed tool was outside the captured authorized names. */
  authorizationRegression: boolean;
  /** A runtime-mandatory or policy-preserved name was not authorized. */
  policyMismatch: boolean;
  missSeverity?: ShadowMissSeverity;
  /** Simulated kept set is top 8 plus runtime-mandatory plus policy-preserved. */
  wouldBlockSelectedTool?: boolean;
  wouldBlockExecutedTool?: boolean;
  wouldBlockRequiredTool?: boolean;
  /** Selected tool is in that kept set. This is not the same question as `inTop8`. */
  inKept?: boolean;
  /**
   * Kept set plus authorized discovery controls. Reported for a later trial.
   * Omitted when a discovery control's authorization cannot be judged.
   */
  inTrialSurface?: boolean;
  /**
   * Provenance-backed required execution, or an executed runtime-mandatory tool,
   * outside the kept set. An unknown role source is not provenance.
   */
  taskCriticalBlock?: boolean;
};

export type ShadowContainmentInput = {
  mode: ShadowTrafficMode;
  runId: string;
  turnId: string;
  authorizedCount: number;
  rankedTop8: readonly string[];
  selectedTool: string;
  executionStarted: boolean;
  success?: boolean;
  role?: ShadowToolRole;
  roleSource?: ToolRoleSource;
  degraded?: boolean;
  authorizedNames?: readonly string[];
  runtimeMandatory?: readonly string[];
  policyPreserved?: readonly string[];
};

export type ShadowTrafficSummary = {
  executedCalls: number;
  executedInTop8: number;
  /** Ranker purity: executed tools found in the literal top 8. */
  executedContainment: number | null;
  executedInKept: number;
  /**
   * Future kept-surface safety. Null when any execution lacks a kept-set verdict.
   * Not a qualification clause.
   */
  keptContainment: number | null;
  executedInTrialSurface: number;
  /**
   * Kept surface plus authorized discovery controls. Null when that counterfactual
   * cannot be judged. Not a qualification clause.
   */
  trialContainment: number | null;
  requiredExecutedCalls: number;
  requiredInTop8: number;
  requiredContainment: number | null;
  requiredContainmentPerfect: boolean;
  missSeverity: Record<ShadowMissSeverity, number>;
  successfulEvaluatedTurns: number;
  successfulTurnsAllRequiredInTop8: number;
  /** Null when no successful turn executed a required-role tool. 0/0 is not 100%. */
  turnContainment: number | null;
  unevaluatedSuccessfulTurns: number;
  multiToolTurns: number;
  familyExecutionCounts: Record<string, number>;
  representedFamilies: string[];
  knownDomainCalls: number;
  /** Largest known domain divided by known-domain executions. Null when there are none. */
  maxDomainShare: number | null;
  /** True when the largest share is below the reporting limit. Not a gate. */
  maxDomainShareWithinLimit: boolean | null;
  simulatedFilterEvaluable: boolean;
  simulatedRequiredBlocks: number;
  simulatedTaskCriticalBlocks: number;
  discoveryControlsBlocked: number;
  authorizationRegressions: number;
  authorizationUnevaluableEvents: number;
};

export type ShadowSampleVersion = {
  schemaVersion: number;
  rankerVersion: string;
  qualificationPolicyVersion: string;
};

export type ShadowTrafficStratum = {
  version: ShadowSampleVersion;
  summary: ShadowTrafficSummary;
};

export type ShadowTrafficQualificationInput = {
  events: readonly ShadowContainmentEvent[];
  offlineRequiredRecallPassed: boolean;
  offlineNdcgPassed: boolean;
};

export type ShadowTrafficQualification = ShadowTrafficSummary & {
  /** Every trial clause passed. This still does not enable filtering. */
  passed: boolean;
  activeFilteringEnabled: false;
  offlineRequiredRecallPassed: boolean;
  offlineNdcgPassed: boolean;
  executedCallsPassed: boolean;
  executedContainmentPassed: boolean;
  requiredContainmentPassed: boolean;
  multiToolTurnsPassed: boolean;
  familyRepresentationPassed: boolean;
  simulatedRequiredBlocksPassed: boolean;
  simulatedTaskCriticalBlocksPassed: boolean;
  authorizationRegressionsPassed: boolean;
  /** False when the supplied events use more than one schema or policy version. */
  sampleCompatible: boolean;
  /** False unless every event uses the version this qualifier interprets. */
  recognizedPolicy: boolean;
  strata: ShadowTrafficStratum[];
};

const DISCOVERY_CONTROL_NAMES = new Set<string>(DISCOVERY_CONTROL_TOOLS);

/**
 * Every mode returns the same array. `active` is reserved and does not filter.
 */
export function exposeAuthorizedTools<T>(
  tools: readonly T[],
  mode: ShadowTrafficMode = DEFAULT_SHADOW_TRAFFIC_MODE,
): readonly T[] {
  switch (mode) {
    case "off":
    case "shadow":
    case "simulated-filter":
    case "active":
      return tools;
  }
  return tools;
}

function isDiscoveryControl(name: string): boolean {
  return DISCOVERY_CONTROL_NAMES.has(name.trim().toLowerCase());
}

function discoveryControlAuthorized(authorizedNames: readonly string[] | undefined): boolean {
  if (!authorizedNames) {
    return false;
  }
  const available = new Set(authorizedNames.map((name) => name.trim().toLowerCase()));
  for (const control of DISCOVERY_CONTROL_TOOLS) {
    if (available.has(control)) {
      return true;
    }
  }
  return false;
}

/**
 * Observed failure stays a failure. Recovery is only for a miss that did not
 * fail, when a discovery control was authorized and the missed tool is not
 * itself one of those controls. Degraded is recorded only when the caller says so.
 */
function classifyTop8Miss(input: {
  executionStarted: boolean;
  inTop8: boolean;
  success?: boolean;
  degraded?: boolean;
  selectedTool: string;
  authorizedNames?: readonly string[];
}): ShadowMissSeverity | undefined {
  if (!input.executionStarted || input.inTop8) {
    return undefined;
  }
  if (input.degraded === true) {
    return "top-8 miss, task degraded";
  }
  if (input.success === false) {
    return "top-8 miss, task failed";
  }
  if (
    discoveryControlAuthorized(input.authorizedNames) &&
    !isDiscoveryControl(input.selectedTool)
  ) {
    return "top-8 miss, fallback/tool-search would recover";
  }
  if (input.success === true) {
    return "top-8 miss, task still succeeds";
  }
  return undefined;
}

function keptNames(input: {
  rankedTop8: readonly string[];
  runtimeMandatory: readonly string[];
  policyPreserved: readonly string[];
}): Set<string> {
  const kept = new Set<string>();
  for (const name of input.rankedTop8) {
    kept.add(name);
  }
  for (const name of input.runtimeMandatory) {
    kept.add(name);
  }
  for (const name of input.policyPreserved) {
    kept.add(name);
  }
  return kept;
}

function preservedOutsideAuthorization(
  names: readonly string[],
  authorized: ReadonlySet<string>,
): boolean {
  for (const name of names) {
    if (!authorized.has(name)) {
      return true;
    }
  }
  return false;
}

function counterfactualMode(mode: ShadowTrafficMode): boolean {
  return mode === "simulated-filter" || mode === "active";
}

function qualifiedRequiredRole(role: ShadowToolRole, roleSource: ToolRoleSource): boolean {
  return role === "required" && roleSource !== "unknown";
}

/**
 * In-top-8 indicators in event order. `executed` is every started call.
 * `required` is the same provenance-backed subset as `requiredExecutedCalls`.
 * The anytime bound depends on this order.
 */
export function shadowRateSequences(events: readonly ShadowContainmentEvent[]): {
  executed: (0 | 1)[];
  required: (0 | 1)[];
} {
  const executed: (0 | 1)[] = [];
  const required: (0 | 1)[] = [];
  for (const event of events) {
    if (!event.executionStarted) {
      continue;
    }
    const inTop8: 0 | 1 = event.inTop8 ? 1 : 0;
    executed.push(inTop8);
    if (qualifiedRequiredRole(event.role, event.roleSource)) {
      required.push(inTop8);
    }
  }
  return { executed, required };
}

/**
 * `off` records nothing. The simulated kept set does not fail open and does
 * not add discovery controls; those recovery rules belong to a later trial.
 */
export function createShadowContainmentEvent(
  input: ShadowContainmentInput,
): ShadowContainmentEvent | undefined {
  if (input.mode === "off") {
    return undefined;
  }
  const rankedTop8 = input.rankedTop8.slice(0, SHADOW_TOP_K);
  const runtimeMandatory = input.runtimeMandatory ?? [];
  const policyPreserved = input.policyPreserved ?? [];
  const inTop8 = rankedTop8.includes(input.selectedTool);
  const role = input.role ?? "unknown";
  const roleSource = input.roleSource ?? "unknown";
  const qualifiedRequired = qualifiedRequiredRole(role, roleSource);
  const authorizationEvaluable = input.authorizedNames !== undefined;
  const authorized = authorizationEvaluable ? new Set(input.authorizedNames) : undefined;
  const authorizationRegression =
    authorized !== undefined && input.executionStarted && !authorized.has(input.selectedTool);
  const policyMismatch =
    authorized !== undefined &&
    (preservedOutsideAuthorization(runtimeMandatory, authorized) ||
      preservedOutsideAuthorization(policyPreserved, authorized));
  const event: ShadowContainmentEvent = {
    runId: input.runId,
    turnId: input.turnId,
    mode: input.mode,
    authorizedCount: input.authorizedCount,
    rankedTop8,
    selectedTool: input.selectedTool,
    executionStarted: input.executionStarted,
    inTop8,
    role,
    roleSource,
    family: domainForTool(input.selectedTool) ?? "unknown",
    schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION,
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    authorizationEvaluable,
    authorizationRegression,
    policyMismatch,
  };
  if (input.success !== undefined) {
    event.success = input.success;
  }
  const missSeverity = classifyTop8Miss({
    executionStarted: input.executionStarted,
    inTop8,
    success: input.success,
    degraded: input.degraded,
    selectedTool: input.selectedTool,
    authorizedNames: input.authorizedNames,
  });
  if (missSeverity) {
    event.missSeverity = missSeverity;
  }
  if (!counterfactualMode(input.mode)) {
    return event;
  }
  const kept = keptNames({ rankedTop8, runtimeMandatory, policyPreserved });
  const blocked = !kept.has(input.selectedTool);
  const runtimeMandatoryNames = new Set(runtimeMandatory);
  event.inKept = !blocked;
  event.wouldBlockSelectedTool = blocked;
  event.wouldBlockExecutedTool = input.executionStarted && blocked;
  event.wouldBlockRequiredTool = qualifiedRequired && blocked;
  event.taskCriticalBlock =
    input.executionStarted &&
    blocked &&
    (qualifiedRequired || runtimeMandatoryNames.has(input.selectedTool));
  // A discovery control outside the kept set is trial-contained only when it
  // was authorized. Without that name set, leave the trial verdict unset.
  if (authorized) {
    const trial = new Set(kept);
    for (const name of authorized) {
      if (isDiscoveryControl(name)) {
        trial.add(name);
      }
    }
    event.inTrialSurface = trial.has(input.selectedTool);
  } else if (!blocked || !isDiscoveryControl(input.selectedTool)) {
    event.inTrialSurface = !blocked;
  }
  return event;
}

export function shadowContainmentEventData(event: ShadowContainmentEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {
    runId: event.runId,
    turnId: event.turnId,
    mode: event.mode,
    authorizedCount: event.authorizedCount,
    rankedTop8: [...event.rankedTop8],
    selectedTool: event.selectedTool,
    executionStarted: event.executionStarted,
    inTop8: event.inTop8,
    role: event.role,
    roleSource: event.roleSource,
    family: event.family,
    schemaVersion: event.schemaVersion,
    rankerVersion: event.rankerVersion,
    qualificationPolicyVersion: event.qualificationPolicyVersion,
    authorizationEvaluable: event.authorizationEvaluable,
    authorizationRegression: event.authorizationRegression,
    policyMismatch: event.policyMismatch,
  };
  if (event.success !== undefined) {
    data.success = event.success;
  }
  if (event.missSeverity !== undefined) {
    data.missSeverity = event.missSeverity;
  }
  if (event.wouldBlockSelectedTool !== undefined) {
    data.wouldBlockSelectedTool = event.wouldBlockSelectedTool;
  }
  if (event.wouldBlockExecutedTool !== undefined) {
    data.wouldBlockExecutedTool = event.wouldBlockExecutedTool;
  }
  if (event.wouldBlockRequiredTool !== undefined) {
    data.wouldBlockRequiredTool = event.wouldBlockRequiredTool;
  }
  if (event.inKept !== undefined) {
    data.inKept = event.inKept;
  }
  if (event.inTrialSurface !== undefined) {
    data.inTrialSurface = event.inTrialSurface;
  }
  if (event.taskCriticalBlock !== undefined) {
    data.taskCriticalBlock = event.taskCriticalBlock;
  }
  return data;
}

function emptyMissSeverity(): Record<ShadowMissSeverity, number> {
  const counts = {} as Record<ShadowMissSeverity, number>; // SAFETY: every key is populated from the closed tuple below.
  for (const severity of SHADOW_MISS_SEVERITIES) {
    counts[severity] = 0;
  }
  return counts;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function shareBelow(numerator: number, denominator: number, threshold: number): boolean {
  if (denominator <= 0) {
    return false;
  }
  const scaledThreshold = Math.round(threshold * 1000);
  return numerator * 1000 < denominator * scaledThreshold;
}

function hasCounterfactual(event: ShadowContainmentEvent): boolean {
  return (
    counterfactualMode(event.mode) &&
    event.wouldBlockSelectedTool !== undefined &&
    event.wouldBlockExecutedTool !== undefined &&
    event.wouldBlockRequiredTool !== undefined &&
    event.taskCriticalBlock !== undefined
  );
}

type TurnStats = {
  executed: number;
  succeeded: number;
  required: number;
  requiredInTop8: number;
  degraded: boolean;
};

export function summarizeShadowTraffic(
  events: readonly ShadowContainmentEvent[],
): ShadowTrafficSummary {
  let executedCalls = 0;
  let executedInTop8 = 0;
  let executedInKept = 0;
  let keptEvaluable = true;
  let executedInTrialSurface = 0;
  let trialEvaluable = true;
  let requiredExecutedCalls = 0;
  let requiredInTop8 = 0;
  let simulatedRequiredBlocks = 0;
  let simulatedTaskCriticalBlocks = 0;
  let discoveryControlsBlocked = 0;
  let authorizationRegressionEvents = 0;
  let authorizationUnevaluableEvents = 0;
  let simulatedFilterEvaluable = events.length > 0;
  const missSeverity = emptyMissSeverity();
  const familyExecutionCounts: Record<string, number> = {};
  const turns = new Map<string, TurnStats>();
  const policyMismatchTurns = new Set<string>();

  for (const event of events) {
    if (!hasCounterfactual(event)) {
      simulatedFilterEvaluable = false;
    }
    if (!event.authorizationEvaluable) {
      authorizationUnevaluableEvents += 1;
    }
    if (event.authorizationRegression) {
      authorizationRegressionEvents += 1;
    }
    if (event.policyMismatch) {
      policyMismatchTurns.add(event.turnId);
    }
    if (event.wouldBlockRequiredTool === true) {
      simulatedRequiredBlocks += 1;
    }
    if (event.taskCriticalBlock === true) {
      simulatedTaskCriticalBlocks += 1;
    }
    if (event.wouldBlockExecutedTool === true && isDiscoveryControl(event.selectedTool)) {
      discoveryControlsBlocked += 1;
    }
    if (event.missSeverity) {
      missSeverity[event.missSeverity] += 1;
    }
    if (!event.executionStarted) {
      continue;
    }
    executedCalls += 1;
    if (event.inTop8) {
      executedInTop8 += 1;
    }
    if (event.inKept === undefined) {
      keptEvaluable = false;
    } else if (event.inKept) {
      executedInKept += 1;
    }
    if (event.inTrialSurface === undefined) {
      trialEvaluable = false;
    } else if (event.inTrialSurface) {
      executedInTrialSurface += 1;
    }
    const family = event.family;
    familyExecutionCounts[family] = (familyExecutionCounts[family] ?? 0) + 1;
    if (qualifiedRequiredRole(event.role, event.roleSource)) {
      requiredExecutedCalls += 1;
      if (event.inTop8) {
        requiredInTop8 += 1;
      }
    }
    let turn = turns.get(event.turnId);
    if (!turn) {
      turn = {
        executed: 0,
        succeeded: 0,
        required: 0,
        requiredInTop8: 0,
        degraded: false,
      };
      turns.set(event.turnId, turn);
    }
    turn.executed += 1;
    if (event.success === true) {
      turn.succeeded += 1;
    }
    if (event.missSeverity === "top-8 miss, task degraded") {
      turn.degraded = true;
    }
    if (qualifiedRequiredRole(event.role, event.roleSource)) {
      turn.required += 1;
      if (event.inTop8) {
        turn.requiredInTop8 += 1;
      }
    }
  }

  let multiToolTurns = 0;
  let successfulEvaluatedTurns = 0;
  let successfulTurnsAllRequiredInTop8 = 0;
  let unevaluatedSuccessfulTurns = 0;
  for (const turn of turns.values()) {
    if (turn.executed >= 2) {
      multiToolTurns += 1;
    }
    const successful = turn.executed >= 1 && turn.succeeded === turn.executed && !turn.degraded;
    if (!successful) {
      continue;
    }
    if (turn.required === 0) {
      unevaluatedSuccessfulTurns += 1;
      continue;
    }
    successfulEvaluatedTurns += 1;
    if (turn.requiredInTop8 === turn.required) {
      successfulTurnsAllRequiredInTop8 += 1;
    }
  }

  const representedFamilies: string[] = [];
  let knownDomainCalls = 0;
  let largestKnownDomainCalls = 0;
  for (const domain of CAPABILITY_DOMAIN_IDS) {
    const count = familyExecutionCounts[domain] ?? 0;
    if (count >= SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.minExecutedCallsPerFamily) {
      representedFamilies.push(domain);
    }
    if (count > 0) {
      knownDomainCalls += count;
      if (count > largestKnownDomainCalls) {
        largestKnownDomainCalls = count;
      }
    }
  }
  const maxDomainShare = ratio(largestKnownDomainCalls, knownDomainCalls);

  return {
    executedCalls,
    executedInTop8,
    executedContainment: ratio(executedInTop8, executedCalls),
    executedInKept,
    keptContainment: keptEvaluable ? ratio(executedInKept, executedCalls) : null,
    executedInTrialSurface,
    trialContainment: trialEvaluable ? ratio(executedInTrialSurface, executedCalls) : null,
    requiredExecutedCalls,
    requiredInTop8,
    requiredContainment: ratio(requiredInTop8, requiredExecutedCalls),
    requiredContainmentPerfect:
      requiredExecutedCalls > 0 && requiredInTop8 === requiredExecutedCalls,
    missSeverity,
    successfulEvaluatedTurns,
    successfulTurnsAllRequiredInTop8,
    turnContainment: ratio(successfulTurnsAllRequiredInTop8, successfulEvaluatedTurns),
    unevaluatedSuccessfulTurns,
    multiToolTurns,
    familyExecutionCounts,
    representedFamilies,
    knownDomainCalls,
    maxDomainShare,
    maxDomainShareWithinLimit:
      maxDomainShare === null
        ? null
        : shareBelow(
            largestKnownDomainCalls,
            knownDomainCalls,
            SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.maxKnownDomainShare,
          ),
    simulatedFilterEvaluable,
    simulatedRequiredBlocks,
    simulatedTaskCriticalBlocks,
    discoveryControlsBlocked,
    authorizationRegressions: authorizationRegressionEvents + policyMismatchTurns.size,
    authorizationUnevaluableEvents,
  };
}
