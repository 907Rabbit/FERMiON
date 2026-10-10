/**
 * Replay and contract evidence for the frozen v1D qualifier.
 *
 * The runtime ranks and executes. This module only schedules cases, annotates
 * roles on tools that already ran, and stores the existing shadow events.
 * It does not rank, filter, or decide promotion.
 */
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { CAPABILITY_DOMAIN_IDS, type CapabilityDomain } from "./capability-catalog.js";
import {
  SHADOW_MISS_SEVERITIES,
  SHADOW_TRAFFIC_MODES,
  TOOL_ROLE_SOURCES,
  type ShadowContainmentEvent,
  type ShadowMissSeverity,
  type ShadowSampleVersion,
  type ShadowToolRole,
  type ShadowTrafficMode,
  type ToolRoleSource,
} from "./shadow-traffic.js";
import {
  createToolRankingShadowTracker,
  type RankingEpoch,
  type ToolRankingShadowObservation,
} from "./tool-ranking-shadow.js";

export type ShadowReplayRoleSource = Exclude<ToolRoleSource, "unknown">;

/**
 * Trusted case metadata. `requiredTools` labels an execution after it happens.
 * It is not a call plan and it is not added to the model surface.
 */
export type ShadowQualificationReplayCase = {
  id: string;
  prompt: string;
  /** Scheduling hint only. Event families still come from the tools that ran. */
  domain: CapabilityDomain;
  requiredTools?: readonly string[];
  relevantTools?: readonly string[];
  roleSource: ShadowReplayRoleSource;
  expectedOutcome?: "success";
  fixtureId?: string;
  /**
   * Present only for an explicit workflow contract. The collector never
   * executes these names and never sends them to the runtime.
   */
  workflowContract?: readonly string[];
};

export type ShadowReplayTool = {
  name: string;
  description?: string;
};

export type ShadowReplayTerminal = {
  toolName: string;
  executed: boolean;
  succeeded: boolean;
  degraded?: boolean;
};

export type ShadowReplayRuntimeEpoch = {
  epoch: RankingEpoch;
  turnId: string;
  observation: ToolRankingShadowObservation;
  rankings: readonly { name: string; score: number }[];
  authorizedNames?: readonly string[];
  runtimeMandatory?: readonly string[];
  policyPreserved?: readonly string[];
  terminals: readonly ShadowReplayTerminal[];
};

/** What the normal runtime returns after it has ranked and actually called tools. */
export type ShadowReplayRuntimeResult = {
  epochs: readonly ShadowReplayRuntimeEpoch[];
};

/**
 * Runs one case. Implementations must not be given the case's required tools,
 * workflow steps, or expected outcome.
 */
export type ShadowReplayRuntime = {
  run(input: {
    runId: string;
    prompt: string;
    tools: readonly ShadowReplayTool[];
    fixtureId?: string;
    /** Isolation key only. It is not a tool role and it is not a call plan. */
    caseId?: string;
  }): Promise<ShadowReplayRuntimeResult>;
};

export type ShadowEvidenceRun = {
  caseId: string;
  runId: string;
  events: ShadowContainmentEvent[];
};

export type ShadowEvidenceBatch = {
  batchId: string;
  closed: boolean;
  version: ShadowSampleVersion | null;
  runs: ShadowEvidenceRun[];
};

export type ShadowEvidenceAdmitResult = {
  batch: ShadowEvidenceBatch;
  /** Previous batch, closed because this run used another version. */
  closedBatch?: ShadowEvidenceBatch;
};

const TRUSTED_ROLE_SOURCES = new Set<string>(
  TOOL_ROLE_SOURCES.filter((source) => source !== "unknown"),
);
const TOOL_ROLES = new Set<string>(["required", "relevant", "optional", "unknown"]);
const MISS_SEVERITIES = new Set<string>(SHADOW_MISS_SEVERITIES);
const TRAFFIC_MODES = new Set<string>(SHADOW_TRAFFIC_MODES);

let batchSequence = 0;

export function createShadowEvidenceBatch(batchId?: string): ShadowEvidenceBatch {
  batchSequence += 1;
  return {
    batchId: batchId ?? "shadow-evidence-" + batchSequence,
    closed: false,
    version: null,
    runs: [],
  };
}

export function shadowEvidenceEvents(batch: ShadowEvidenceBatch): ShadowContainmentEvent[] {
  return batch.runs.flatMap((run) => run.events);
}

export function annotateExecutedToolRole(
  replayCase: ShadowQualificationReplayCase,
  toolName: string,
  executed: boolean,
): { role: ShadowToolRole; roleSource: ToolRoleSource } {
  if (!executed) {
    return { role: "unknown", roleSource: "unknown" };
  }
  if (toolListed(replayCase.requiredTools, toolName)) {
    return { role: "required", roleSource: replayCase.roleSource };
  }
  if (toolListed(replayCase.relevantTools, toolName)) {
    return { role: "relevant", roleSource: replayCase.roleSource };
  }
  return { role: "unknown", roleSource: "unknown" };
}

function toolListed(names: readonly string[] | undefined, toolName: string): boolean {
  const target = toolName.trim();
  if (!names || target.length === 0) {
    return false;
  }
  for (const name of names) {
    if (name.trim() === target) {
      return true;
    }
  }
  return false;
}

function assertReplayCase(replayCase: ShadowQualificationReplayCase): void {
  if (replayCase.id.trim().length === 0) {
    throw new Error("replay case id is empty");
  }
  const knownDomains = CAPABILITY_DOMAIN_IDS as readonly string[]; // SAFETY: closed runtime catalog used by the domain union.
  if (!knownDomains.includes(replayCase.domain)) {
    throw new Error("replay case domain is unknown: " + replayCase.domain);
  }
  if (!TRUSTED_ROLE_SOURCES.has(replayCase.roleSource)) {
    throw new Error("replay case role source is not trusted: " + replayCase.roleSource);
  }
}

function assertUniqueCases(cases: readonly ShadowQualificationReplayCase[]): void {
  const seen = new Set<string>();
  for (const replayCase of cases) {
    assertReplayCase(replayCase);
    if (seen.has(replayCase.id)) {
      throw new Error("duplicate replay case id: " + replayCase.id);
    }
    seen.add(replayCase.id);
  }
}

function sameVersion(left: ShadowSampleVersion, right: ShadowSampleVersion): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.rankerVersion === right.rankerVersion &&
    left.qualificationPolicyVersion === right.qualificationPolicyVersion
  );
}

function eventVersion(event: ShadowContainmentEvent): ShadowSampleVersion {
  return {
    schemaVersion: event.schemaVersion,
    rankerVersion: event.rankerVersion,
    qualificationPolicyVersion: event.qualificationPolicyVersion,
  };
}

function sharedVersion(
  events: readonly ShadowContainmentEvent[],
  label: string,
): ShadowSampleVersion | null {
  const first = events[0];
  if (!first) {
    return null;
  }
  const version = eventVersion(first);
  for (const event of events) {
    if (!sameVersion(version, eventVersion(event))) {
      throw new Error("shadow evidence " + label + " mixes qualification versions");
    }
  }
  return version;
}

function cloneRun(run: ShadowEvidenceRun): ShadowEvidenceRun {
  return {
    caseId: run.caseId,
    runId: run.runId,
    events: run.events.map((event) => structuredClone(event)),
  };
}

function admitRun(batch: ShadowEvidenceBatch, run: ShadowEvidenceRun): ShadowEvidenceAdmitResult {
  if (batch.closed) {
    throw new Error("shadow evidence batch is closed");
  }
  const existing = sharedVersion(shadowEvidenceEvents(batch), "batch");
  const version = sharedVersion(run.events, "run");
  if (version && existing && !sameVersion(existing, version)) {
    return {
      closedBatch: { ...batch, closed: true, version: existing },
      batch: {
        batchId: batch.batchId + "#next",
        closed: false,
        version,
        runs: [cloneRun(run)],
      },
    };
  }
  return {
    batch: {
      ...batch,
      version: existing ?? version,
      runs: [...batch.runs, cloneRun(run)],
    },
  };
}

/**
 * Record one runtime result through the live shadow tracker.
 * Required-tool names on the case are not turned into calls.
 */
export function ingestRuntimeReplay(input: {
  batch: ShadowEvidenceBatch;
  replayCase: ShadowQualificationReplayCase;
  runtimeResult: ShadowReplayRuntimeResult;
  runId: string;
}): ShadowEvidenceAdmitResult {
  assertReplayCase(input.replayCase);
  const events: ShadowContainmentEvent[] = [];
  for (const epoch of input.runtimeResult.epochs) {
    const tracker = createToolRankingShadowTracker({ runId: input.runId });
    tracker.recordObservation(
      epoch.observation,
      epoch.rankings,
      {
        authorizedNames: epoch.authorizedNames,
        runtimeMandatory: epoch.runtimeMandatory,
        policyPreserved: epoch.policyPreserved,
      },
      { epoch: epoch.epoch, turnId: epoch.turnId },
    );
    for (const terminal of epoch.terminals) {
      const annotation = annotateExecutedToolRole(
        input.replayCase,
        terminal.toolName,
        terminal.executed,
      );
      tracker.recordOutcome(
        terminal.toolName,
        {
          executed: terminal.executed,
          succeeded: terminal.succeeded,
          ...(terminal.degraded === undefined ? {} : { degraded: terminal.degraded }),
          role: annotation.role,
          roleSource: annotation.roleSource,
        },
        undefined,
        (event) => {
          events.push(event);
        },
      );
    }
  }
  return admitRun(input.batch, {
    caseId: input.replayCase.id,
    runId: input.runId,
    events,
  });
}

function runCount(batch: ShadowEvidenceBatch, caseId: string): number {
  let count = 0;
  for (const run of batch.runs) {
    if (run.caseId === caseId) {
      count += 1;
    }
  }
  return count;
}

function domainExecutionCounts(batch: ShadowEvidenceBatch): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of shadowEvidenceEvents(batch)) {
    if (!event.executionStarted) {
      continue;
    }
    counts.set(event.family, (counts.get(event.family) ?? 0) + 1);
  }
  return counts;
}

function caseProducedRequired(batch: ShadowEvidenceBatch, caseId: string): boolean {
  for (const run of batch.runs) {
    if (run.caseId !== caseId) {
      continue;
    }
    for (const event of run.events) {
      if (event.executionStarted && event.role === "required" && event.roleSource !== "unknown") {
        return true;
      }
    }
  }
  return false;
}

/**
 * Prefer starved domains, then cases that have been run less often.
 * Required-tool cases win ties only while the batch still has no required evidence.
 */
export function selectReplayCases(input: {
  cases: readonly ShadowQualificationReplayCase[];
  batch: ShadowEvidenceBatch;
  limit: number;
}): ShadowQualificationReplayCase[] {
  assertUniqueCases(input.cases);
  const limit = Math.max(0, input.limit);
  if (limit === 0) {
    return [];
  }
  const domains = domainExecutionCounts(input.batch);
  const requiredStillNeeded = !shadowEvidenceEvents(input.batch).some(
    (event) =>
      event.executionStarted && event.role === "required" && event.roleSource !== "unknown",
  );
  const ordered = input.cases.toSorted((left, right) => {
    const domainDelta = (domains.get(left.domain) ?? 0) - (domains.get(right.domain) ?? 0);
    if (domainDelta !== 0) {
      return domainDelta;
    }
    const runDelta = runCount(input.batch, left.id) - runCount(input.batch, right.id);
    if (runDelta !== 0) {
      return runDelta;
    }
    if (requiredStillNeeded) {
      const leftRequired = toolListCount(left.requiredTools) > 0 ? 0 : 1;
      const rightRequired = toolListCount(right.requiredTools) > 0 ? 0 : 1;
      if (leftRequired !== rightRequired) {
        return leftRequired - rightRequired;
      }
    }
    if (left.id < right.id) {
      return -1;
    }
    if (left.id > right.id) {
      return 1;
    }
    return 0;
  });
  return ordered.slice(0, limit);
}

function toolListCount(names: readonly string[] | undefined): number {
  return names?.length ?? 0;
}

export async function runScheduledReplay(input: {
  cases: readonly ShadowQualificationReplayCase[];
  batch: ShadowEvidenceBatch;
  runtime: ShadowReplayRuntime;
  toolsForCase: (replayCase: ShadowQualificationReplayCase) => readonly ShadowReplayTool[];
  limit: number;
}): Promise<{ batch: ShadowEvidenceBatch; closedBatches: ShadowEvidenceBatch[] }> {
  const selected = selectReplayCases(input);
  let batch = input.batch;
  const closedBatches: ShadowEvidenceBatch[] = [];
  for (const replayCase of selected) {
    const runId =
      "replay:" + batch.batchId + ":" + replayCase.id + ":" + (runCount(batch, replayCase.id) + 1);
    const runtimeResult = await input.runtime.run({
      runId,
      prompt: replayCase.prompt,
      tools: input.toolsForCase(replayCase),
      caseId: replayCase.id,
      ...(replayCase.fixtureId === undefined ? {} : { fixtureId: replayCase.fixtureId }),
    });
    const admitted = ingestRuntimeReplay({ batch, replayCase, runtimeResult, runId });
    if (admitted.closedBatch) {
      closedBatches.push(admitted.closedBatch);
    }
    batch = admitted.batch;
  }
  return { batch, closedBatches };
}

export function exportShadowEvidenceBatch(batch: ShadowEvidenceBatch): string {
  return JSON.stringify({
    batchId: batch.batchId,
    closed: batch.closed,
    version: batch.version,
    runs: batch.runs.map((run) => ({
      caseId: run.caseId,
      runId: run.runId,
      events: run.events.map((event) => structuredClone(event)),
    })),
  });
}

export function loadShadowEvidenceBatch(
  serialized: string,
  into?: ShadowEvidenceBatch,
): ShadowEvidenceAdmitResult {
  const loaded = parseShadowEvidenceBatch(serialized);
  if (!into || into.closed || loaded.closed) {
    return loaded.closed && into && !into.closed
      ? { batch: into, closedBatch: loaded }
      : { batch: loaded };
  }
  const intoVersion = sharedVersion(shadowEvidenceEvents(into), "batch");
  if (intoVersion && loaded.version && !sameVersion(intoVersion, loaded.version)) {
    return {
      batch: loaded,
      closedBatch: { ...into, closed: true, version: intoVersion },
    };
  }
  return {
    batch: {
      ...into,
      version: intoVersion ?? loaded.version,
      runs: [...into.runs, ...loaded.runs.map((run) => cloneRun(run))],
    },
  };
}

function parseShadowEvidenceBatch(serialized: string): ShadowEvidenceBatch {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) {
    throw new Error("shadow evidence batch is not an object");
  }
  const batchId = requiredString(parsed.batchId, "batchId");
  if (typeof parsed.closed !== "boolean") {
    throw new Error("shadow evidence batch closed flag is missing");
  }
  if (!Array.isArray(parsed.runs)) {
    throw new Error("shadow evidence batch runs are missing");
  }
  const runs = parsed.runs.map((run) => parseRun(run));
  const version = sharedVersion(
    runs.flatMap((run) => run.events),
    "batch",
  );
  if (isRecord(parsed.version)) {
    const declared = parseVersion(parsed.version);
    if (!version || !sameVersion(declared, version)) {
      throw new Error("shadow evidence batch version does not match its events");
    }
  } else if (parsed.version !== null || version) {
    throw new Error("shadow evidence batch version does not match its events");
  }
  return { batchId, closed: parsed.closed, version, runs };
}

function parseRun(value: unknown): ShadowEvidenceRun {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new Error("shadow evidence run is invalid");
  }
  return {
    caseId: requiredString(value.caseId, "caseId"),
    runId: requiredString(value.runId, "runId"),
    events: value.events.map((event) => parseEvent(event)),
  };
}

function parseVersion(value: Record<string, unknown>): ShadowSampleVersion {
  if (
    typeof value.schemaVersion !== "number" ||
    typeof value.rankerVersion !== "string" ||
    typeof value.qualificationPolicyVersion !== "string"
  ) {
    throw new Error("shadow evidence batch version is invalid");
  }
  return {
    schemaVersion: value.schemaVersion,
    rankerVersion: value.rankerVersion,
    qualificationPolicyVersion: value.qualificationPolicyVersion,
  };
}

function parseEvent(value: unknown): ShadowContainmentEvent {
  if (!isRecord(value)) {
    throw new Error("shadow evidence event is invalid");
  }
  const mode = requiredString(value.mode, "mode");
  const role = requiredString(value.role, "role");
  const roleSource = requiredString(value.roleSource, "roleSource");
  if (!TRAFFIC_MODES.has(mode) || !TOOL_ROLES.has(role) || !knownRoleSource(roleSource)) {
    throw new Error("shadow evidence event has an unknown label");
  }
  const event: ShadowContainmentEvent = {
    runId: requiredString(value.runId, "runId"),
    turnId: requiredString(value.turnId, "turnId"),
    mode: mode as ShadowTrafficMode, // SAFETY: preceding membership check proves the closed traffic-mode value.
    authorizedCount: requiredNumber(value.authorizedCount, "authorizedCount"),
    rankedTop8: requiredStringList(value.rankedTop8, "rankedTop8"),
    selectedTool: requiredString(value.selectedTool, "selectedTool"),
    executionStarted: requiredBoolean(value.executionStarted, "executionStarted"),
    inTop8: requiredBoolean(value.inTop8, "inTop8"),
    role: role as ShadowToolRole, // SAFETY: preceding membership check proves the closed tool-role value.
    roleSource: roleSource as ToolRoleSource, // SAFETY: preceding membership check proves the closed role-source value.
    family: requiredString(value.family, "family"),
    schemaVersion: requiredNumber(value.schemaVersion, "schemaVersion"),
    rankerVersion: requiredString(value.rankerVersion, "rankerVersion"),
    qualificationPolicyVersion: requiredString(
      value.qualificationPolicyVersion,
      "qualificationPolicyVersion",
    ),
    authorizationEvaluable: requiredBoolean(value.authorizationEvaluable, "authorizationEvaluable"),
    authorizationRegression: requiredBoolean(
      value.authorizationRegression,
      "authorizationRegression",
    ),
    policyMismatch: requiredBoolean(value.policyMismatch, "policyMismatch"),
  };
  assignOptionalBoolean(event, "success", value.success);
  assignOptionalBoolean(event, "wouldBlockSelectedTool", value.wouldBlockSelectedTool);
  assignOptionalBoolean(event, "wouldBlockExecutedTool", value.wouldBlockExecutedTool);
  assignOptionalBoolean(event, "wouldBlockRequiredTool", value.wouldBlockRequiredTool);
  assignOptionalBoolean(event, "inKept", value.inKept);
  assignOptionalBoolean(event, "inTrialSurface", value.inTrialSurface);
  assignOptionalBoolean(event, "taskCriticalBlock", value.taskCriticalBlock);
  if (value.missSeverity !== undefined) {
    if (typeof value.missSeverity !== "string" || !MISS_SEVERITIES.has(value.missSeverity)) {
      throw new Error("shadow evidence event miss severity is invalid");
    }
    event.missSeverity = value.missSeverity as ShadowMissSeverity; // SAFETY: membership proves the closed severity value.
  }
  return event;
}

function knownRoleSource(roleSource: string): boolean {
  return roleSource === "unknown" || TRUSTED_ROLE_SOURCES.has(roleSource);
}

function assignOptionalBoolean(
  event: ShadowContainmentEvent,
  key:
    | "success"
    | "wouldBlockSelectedTool"
    | "wouldBlockExecutedTool"
    | "wouldBlockRequiredTool"
    | "inKept"
    | "inTrialSurface"
    | "taskCriticalBlock",
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    throw new Error("shadow evidence event " + key + " is invalid");
  }
  event[key] = value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error("shadow evidence batch " + label + " is invalid");
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("shadow evidence batch " + label + " is invalid");
  }
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error("shadow evidence batch " + label + " is invalid");
  }
  return value;
}

function requiredStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("shadow evidence batch " + label + " is invalid");
  }
  return [...value];
}

export function caseProducedRequiredEvidence(batch: ShadowEvidenceBatch, caseId: string): boolean {
  return caseProducedRequired(batch, caseId);
}
