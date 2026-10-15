import fs from "node:fs";
import path from "node:path";
import { canonicalizeV1IValue } from "../../../src/agents/capability-intelligence/model-choice-experiment-evidence.js";
import { isV1IProvenanceAmendment } from "../../../src/agents/capability-intelligence/model-choice-experiment-provenance.js";
import {
  V1J_PREREGISTRATION_SHA256,
  type V1JObservation,
  type V1JProtocol,
} from "./model-choice-action-initiation.js";

export const V1J_SMOKE_PROVENANCE_PATH =
  "artifacts/capability-intelligence/v1j-action-initiation/provenance-amendment.json";
export const V1J_SMOKE_ARTIFACT_PARENT = "artifacts/capability-intelligence/v1j-action-initiation";
export const V1J_ARM_C_PREFLIGHT_ARTIFACT_PREFIX = "arm-c-preflight-diagnostic-";
export const V1J_FORMAL_ARTIFACT_RELATIVE_PATH =
  "artifacts/capability-intelligence/v1j-action-initiation/real-exact-run1";

export type V1JSmokeCell = {
  cellId: string;
  caseId: "smoke-tool-required" | "smoke-no-tool-control";
  stratum: "TOOL_REQUIRED" | "NO_TOOL_CONTROL";
  arm: "A" | "C";
  replicate: 1;
  prompt: string;
  requiredTools: readonly string[];
  preferredTool: string | null;
};

export type V1JSmokeRecord = {
  smokeCellId: string;
  caseId: V1JSmokeCell["caseId"];
  arm: V1JSmokeCell["arm"];
  replicate: 1;
  observation: V1JObservation;
  workspaceCleanupComplete: boolean;
};

export type V1JSmokeArtifactState = {
  repoRoot: string;
  root: string;
  harnessCommit: string;
  records: V1JSmokeRecord[];
};

export type V1JPreflightCounterName =
  | "requestObserverInvocations"
  | "providerRequestHookInvocations"
  | "fetchWrapperInvocations"
  | "providerCallbackInvocations"
  | "providerDispatchAttempts"
  | "modelRequestCounter"
  | "schemaCaptureStarts"
  | "schemaCaptureCompletes"
  | "preflightStopSignalRaised"
  | "preflightStopSignalCaught"
  | "preflightCompleted"
  | "toolExecutions"
  | "toolResultsProduced"
  | "modelResultsObserved"
  | "resultEventsObserved"
  | "syntheticAbortResultsObserved"
  | "unaccountedModelResults"
  | "promptSubmissions"
  | "providerBoundCaptureCallbacks"
  | "rawRequestsSent"
  | "bodyPublicationCalls";

export type V1JPreflightCounters = Record<V1JPreflightCounterName, number>;

export type V1JPreflightPredicateEvaluation = {
  predicateName: string;
  expected: string | number | boolean;
  observed: string | number | boolean;
  pass: boolean;
  evaluationOrder: number;
};

export function createV1JPreflightCounters(): V1JPreflightCounters {
  return {
    requestObserverInvocations: 0,
    providerRequestHookInvocations: 0,
    fetchWrapperInvocations: 0,
    providerCallbackInvocations: 0,
    providerDispatchAttempts: 0,
    modelRequestCounter: 0,
    schemaCaptureStarts: 0,
    schemaCaptureCompletes: 0,
    preflightStopSignalRaised: 0,
    preflightStopSignalCaught: 0,
    preflightCompleted: 0,
    toolExecutions: 0,
    toolResultsProduced: 0,
    modelResultsObserved: 0,
    resultEventsObserved: 0,
    syntheticAbortResultsObserved: 0,
    unaccountedModelResults: 0,
    promptSubmissions: 0,
    providerBoundCaptureCallbacks: 0,
    rawRequestsSent: 0,
    bodyPublicationCalls: 0,
  };
}

export function evaluateV1JPreflightTerminalPredicates(input: {
  counters: V1JPreflightCounters;
  requestSummaryPresent: boolean;
  providerBoundCaptureCount: number;
  expectedBodyPublicationCalls: number;
  activeFilteringEnabled: boolean;
}): V1JPreflightPredicateEvaluation[] {
  const { counters } = input;
  const predicates: V1JPreflightPredicateEvaluation[] = [];
  const add = (
    predicateName: string,
    expected: string | number | boolean,
    observed: string | number | boolean,
    pass: boolean,
  ) =>
    predicates.push({
      predicateName,
      expected,
      observed,
      pass,
      evaluationOrder: predicates.length + 1,
    });
  add("toolExecutionsIsZero", 0, counters.toolExecutions, counters.toolExecutions === 0);
  add(
    "toolResultsProducedIsZero",
    0,
    counters.toolResultsProduced,
    counters.toolResultsProduced === 0,
  );
  add(
    "modelResultsObservedIsZero",
    0,
    counters.modelResultsObserved,
    counters.modelResultsObserved === 0,
  );
  add(
    "unaccountedModelResultsIsZero",
    0,
    counters.unaccountedModelResults,
    counters.unaccountedModelResults === 0,
  );
  add("requestSummaryPresent", true, input.requestSummaryPresent, input.requestSummaryPresent);
  add(
    "providerBoundCaptureCountIsOne",
    1,
    input.providerBoundCaptureCount,
    input.providerBoundCaptureCount === 1,
  );
  add(
    "providerBoundCaptureCallbacksIsOne",
    1,
    counters.providerBoundCaptureCallbacks,
    counters.providerBoundCaptureCallbacks === 1,
  );
  add(
    "promptSubmissionsAtLeastOne",
    ">= 1",
    counters.promptSubmissions,
    counters.promptSubmissions >= 1,
  );
  add(
    "providerDispatchAttemptsIsZero",
    0,
    counters.providerDispatchAttempts,
    counters.providerDispatchAttempts === 0,
  );
  add(
    "providerCallbackInvocationsIsZero",
    0,
    counters.providerCallbackInvocations,
    counters.providerCallbackInvocations === 0,
  );
  add(
    "modelRequestCounterIsZero",
    0,
    counters.modelRequestCounter,
    counters.modelRequestCounter === 0,
  );
  add(
    "preflightStopSignalRaisedIsOne",
    1,
    counters.preflightStopSignalRaised,
    counters.preflightStopSignalRaised === 1,
  );
  add(
    "preflightStopSignalCaughtIsOne",
    1,
    counters.preflightStopSignalCaught,
    counters.preflightStopSignalCaught === 1,
  );
  add("preflightCompletedIsOne", 1, counters.preflightCompleted, counters.preflightCompleted === 1);
  add("rawRequestsSentIsZero", 0, counters.rawRequestsSent, counters.rawRequestsSent === 0);
  add(
    "bodyPublicationCallsMatchMode",
    input.expectedBodyPublicationCalls,
    counters.bodyPublicationCalls,
    counters.bodyPublicationCalls === input.expectedBodyPublicationCalls,
  );
  add(
    "activeFilteringIsDisabled",
    false,
    input.activeFilteringEnabled,
    input.activeFilteringEnabled === false,
  );
  return predicates;
}

export function buildV1JPreflightTerminalReport(input: {
  counters: V1JPreflightCounters;
  lastCompletedStage: string | null;
  blockingStage: string | null;
  captureHookLiveness: string;
  failureClass: string | null;
  predicateEvaluations: readonly V1JPreflightPredicateEvaluation[] | null;
  providerCallbackReachability?: {
    classification: string;
    events: readonly unknown[];
  };
}): Record<string, unknown> {
  const { counters, predicateEvaluations } = input;
  return {
    LAST_COMPLETED_STAGE: input.lastCompletedStage ?? "none",
    BLOCKING_STAGE: input.blockingStage ?? "none",
    CAPTURE_HOOK_LIVENESS: input.captureHookLiveness,
    FAILURE_CLASS: input.failureClass ?? "none",
    PROMPT_SUBMISSIONS: counters.promptSubmissions,
    REQUEST_OBSERVER_INVOCATIONS: counters.requestObserverInvocations,
    PROVIDER_BOUND_CAPTURE_CALLBACKS: counters.providerBoundCaptureCallbacks,
    PROVIDER_CALLBACK_INVOCATIONS: counters.providerCallbackInvocations,
    PROVIDER_DISPATCH_ATTEMPTS: counters.providerDispatchAttempts,
    MODEL_RESULTS_OBSERVED_TOTAL: counters.resultEventsObserved,
    SYNTHETIC_RESULTS_OBSERVED: counters.syntheticAbortResultsObserved,
    UNACCOUNTED_MODEL_RESULTS: counters.unaccountedModelResults,
    TOOL_EXECUTIONS: counters.toolExecutions,
    TOOL_RESULTS_PRODUCED: counters.toolResultsProduced,
    RAW_REQUESTS_SENT: counters.rawRequestsSent,
    BODY_PUBLICATION_CALLS: counters.bodyPublicationCalls,
    PREFLIGHT_PREDICATES_EVALUATED: predicateEvaluations !== null,
    PREFLIGHT_PREDICATE_EVALUATIONS: predicateEvaluations ?? [],
    PREFLIGHT_PREDICATE_FAILURES:
      predicateEvaluations?.filter((predicate) => !predicate.pass) ?? [],
    FIRST_FAILED_PREDICATE:
      predicateEvaluations?.find((predicate) => !predicate.pass)?.predicateName ??
      (predicateEvaluations ? "none" : "NOT_EVALUATED"),
    PROVIDER_CALLBACK_REACHABILITY: input.providerCallbackReachability ?? {
      classification: "NOT_REACHED",
      events: [],
    },
  };
}

export async function runV1JPreflightWithTerminalReport<T>(input: {
  operation: () => Promise<T>;
  report: () => Record<string, unknown>;
  emit: (report: Record<string, unknown>) => void;
}): Promise<T> {
  try {
    return await input.operation();
  } finally {
    try {
      input.emit(input.report());
    } catch {
      // A terminal-report sink must not replace the preflight's original outcome.
    }
  }
}

export type V1JModelResultKind =
  | "provider-result"
  | "synthetic-abort-result"
  | "sentinel-result"
  | "cached/local-result"
  | "replayed-result"
  | "other";

export function classifyV1JModelResultSource(input: {
  stopReason: string;
  hasToolCall: boolean;
  captureStopSignalRaised: boolean;
  captureStopSignalName: string | null;
  captureStopErrorMessageMatches: boolean;
  providerRequestIdPresent: boolean;
  providerCallbackSeen: boolean;
  providerDispatchSeen: boolean;
  // Set only by a source boundary that can authoritatively identify local/cache/replay production.
  explicitSourceKind?: Exclude<
    V1JModelResultKind,
    "provider-result" | "synthetic-abort-result" | "other"
  >;
}): V1JModelResultKind {
  if (
    input.captureStopSignalRaised &&
    input.captureStopSignalName === "V1IProviderRequestCapturedError" &&
    input.captureStopErrorMessageMatches &&
    !input.hasToolCall &&
    (input.stopReason === "error" || input.stopReason === "aborted")
  ) {
    return "synthetic-abort-result";
  }
  if (input.providerRequestIdPresent && input.providerCallbackSeen && input.providerDispatchSeen) {
    return "provider-result";
  }
  return input.explicitSourceKind ?? "other";
}

export type V1JPreflightRequestObservation = {
  arm: "A" | "C";
  armInstructionSha256: string;
  modelId: string | null;
  modelConfigSha256: string;
  requestUrlSha256: string;
  requestBodySha256: string;
  systemPromptSha256: string;
  authorizedToolCount: number;
  authorizedToolNameSha256: string;
  authorizedToolSchemaSha256: string;
  providerToolCount: number;
  providerToolNameSha256: string;
  providerToolSchemaSha256: string;
};

export type V1JPreflightObservationSummary = {
  rawCallbackCount: number;
  uniqueCanonicalObservations: number;
  duplicateEquivalentCallbacks: number;
  differingFields: string[];
  allCapturedObservationsEquivalent: boolean;
  canonicalObservation: V1JPreflightRequestObservation | null;
};

export function summarizeV1JPreflightObservations(
  observations: readonly V1JPreflightRequestObservation[],
): V1JPreflightObservationSummary {
  const unique = new Map<string, V1JPreflightRequestObservation>();
  for (const observation of observations) {
    unique.set(canonicalizeV1IValue(observation), observation);
  }
  const equivalent = observations.length > 0 && unique.size === 1;
  const first = observations[0];
  const differingFields = first
    ? Object.keys(first)
        .filter((field) => {
          const firstValue = first[field as keyof V1JPreflightRequestObservation];
          return observations.some(
            (observation) =>
              canonicalizeV1IValue(observation[field as keyof V1JPreflightRequestObservation]) !==
              canonicalizeV1IValue(firstValue),
          );
        })
        .toSorted()
    : [];
  return {
    rawCallbackCount: observations.length,
    uniqueCanonicalObservations: unique.size,
    duplicateEquivalentCallbacks: observations.length - unique.size,
    differingFields,
    allCapturedObservationsEquivalent: equivalent,
    canonicalObservation: equivalent ? observations[0]! : null,
  };
}

export function evaluateV1JPreflightStop(input: {
  counters: V1JPreflightCounters;
  requestObserverCount: number;
  capturedRequestCount: number;
  delegatedRequestCount: number;
  providerDispatchAttempts: number;
  observations: readonly V1JPreflightRequestObservation[];
}): { observationSummary: V1JPreflightObservationSummary; predicates: Record<string, boolean> } {
  const observationSummary = summarizeV1JPreflightObservations(input.observations);
  const predicates = {
    requestHookInvocationsAtLeastOne: input.counters.providerRequestHookInvocations >= 1,
    requestObserverInvocationsAtLeastOne: input.counters.requestObserverInvocations >= 1,
    requestObserverCounterMatches:
      input.counters.requestObserverInvocations === input.requestObserverCount,
    requestObserverCountMatchesCapturedRequests:
      input.requestObserverCount === input.capturedRequestCount,
    providerRequestHookCountMatchesCapturedRequests:
      input.counters.providerRequestHookInvocations === input.capturedRequestCount,
    capturedObservationCountMatchesRequests:
      observationSummary.rawCallbackCount === input.capturedRequestCount,
    allCapturedObservationsEquivalent: observationSummary.allCapturedObservationsEquivalent,
    uniqueCanonicalObservationIsOne: observationSummary.uniqueCanonicalObservations === 1,
    providerCallbackCountIsZero: input.counters.providerCallbackInvocations === 0,
    dispatchAttemptsIsZero:
      input.counters.providerDispatchAttempts === 0 && input.providerDispatchAttempts === 0,
    modelRequestCountIsZero: input.counters.modelRequestCounter === 0,
    stopSignalsMatchCapturedRequests:
      input.counters.preflightStopSignalRaised === input.capturedRequestCount &&
      input.capturedRequestCount > 0,
    stopSignalCaught: input.counters.preflightStopSignalCaught === 1,
    captureOnlyHasNoToolOrModelResults:
      input.counters.toolExecutions === 0 &&
      input.counters.toolResultsProduced === 0 &&
      input.counters.modelResultsObserved === 0,
    schemaCaptureNotEntered:
      input.counters.schemaCaptureStarts === 0 && input.counters.schemaCaptureCompletes === 0,
    delegatedRequestCountIsZero: input.delegatedRequestCount === 0,
  };
  return { observationSummary, predicates };
}

export function assertV1JPreflightCaptureOnly(counters: V1JPreflightCounters): void {
  const unexpected = {
    toolExecutions: counters.toolExecutions,
    toolResultsProduced: counters.toolResultsProduced,
    modelResultsObserved: counters.modelResultsObserved,
  };
  if (Object.values(unexpected).some((count) => count !== 0)) {
    throw new Error(
      `v1J capture-only preflight observed execution/result activity: ${JSON.stringify(unexpected)}`,
    );
  }
}

export type V1JPreflightDiagnosticJournal = {
  filePath: string;
  arm: "A" | "C";
  counters: () => V1JPreflightCounters;
  record: (event: string, details?: Record<string, unknown>) => void;
  increment: (
    counter: V1JPreflightCounterName,
    event: string,
    details?: Record<string, unknown>,
  ) => void;
  evaluateStop: (input: {
    requestObserverCount: number;
    capturedRequestCount: number;
    delegatedRequestCount: number;
    providerDispatchAttempts: number;
    observations: readonly V1JPreflightRequestObservation[];
    requestBodyDifferingPaths?: readonly string[];
  }) => Record<string, boolean>;
  close: () => void;
};

export function recordV1JModelResultProvenance(input: {
  journal: Pick<V1JPreflightDiagnosticJournal, "increment">;
  resultKind: V1JModelResultKind;
  details: Record<string, unknown>;
}): void {
  input.journal.increment("resultEventsObserved", "model-result-provenance-classified", {
    ...input.details,
    resultKind: input.resultKind,
  });
  if (input.resultKind === "synthetic-abort-result") {
    input.journal.increment("syntheticAbortResultsObserved", "synthetic-abort-result-observed", {
      resultEventId: input.details.resultEventId,
    });
    return;
  }
  if (input.resultKind === "other") {
    input.journal.increment("unaccountedModelResults", "unaccounted-model-result-observed", {
      resultEventId: input.details.resultEventId,
    });
  }
  input.journal.increment("modelResultsObserved", "model-result-source-observed", {
    resultEventId: input.details.resultEventId,
    resultKind: input.resultKind,
  });
}

/** Writes count-only smoke-preflight diagnostics outside both smoke and formal evidence. */
export function createV1JPreflightDiagnosticJournal(input: {
  repoRoot: string;
  harnessCommit: string;
  arm: "A" | "C";
  caseId: string;
  preflightId: string;
  pid: number;
  startedAtMs?: number;
}): V1JPreflightDiagnosticJournal {
  assertV1JFormalStateEmpty(input.repoRoot);
  if (!/^[0-9a-f]{40}$/i.test(input.harnessCommit)) {
    throw new Error("v1J preflight diagnostics require the actual full harness SHA");
  }
  const root = path.resolve(
    input.repoRoot,
    V1J_SMOKE_ARTIFACT_PARENT,
    "preflight-diagnostics",
    input.harnessCommit,
  );
  const filePath = path.join(
    root,
    `preflight-${input.arm.toLowerCase()}-${input.pid}-${Date.now()}-${input.preflightId.replace(/[^a-zA-Z0-9_-]/gu, "_")}.jsonl`,
  );
  assertV1JDiagnosticFilePath(input.repoRoot, root, filePath);
  return createV1JPreflightDiagnosticJournalAtPath(input, root, filePath, {
    createRootRecursively: true,
  });
}

export function createV1JArmCOnlyPreflightDiagnosticJournal(input: {
  repoRoot: string;
  harnessCommit: string;
  caseId: string;
  preflightId: string;
  pid: number;
  startedAtMs?: number;
}): V1JPreflightDiagnosticJournal {
  if (!/^[0-9a-f]{40}$/i.test(input.harnessCommit)) {
    throw new Error("v1J Arm C diagnostics require the actual full harness SHA");
  }
  const repoRoot = fs.realpathSync(input.repoRoot);
  const artifactParent = path.resolve(repoRoot, V1J_SMOKE_ARTIFACT_PARENT);
  fs.mkdirSync(artifactParent, { recursive: true });
  const realArtifactParent = fs.realpathSync(artifactParent);
  if (realArtifactParent !== artifactParent) {
    throw new Error("v1J Arm C diagnostics refuse an aliased artifact parent");
  }
  const root = path.join(
    realArtifactParent,
    `${V1J_ARM_C_PREFLIGHT_ARTIFACT_PREFIX}${input.harnessCommit}`,
  );
  const formalRoot = resolveV1JPhysicalPath(
    path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH),
  );
  const smokeRoot = resolveV1JPhysicalPath(resolveV1JSmokeRoot(repoRoot, input.harnessCommit));
  if (pathsOverlap(root, formalRoot) || pathsOverlap(root, smokeRoot)) {
    throw new Error("v1J Arm C diagnostics path overlaps formal or smoke artifacts");
  }
  const parent = path.dirname(root);
  const filePath = path.join(root, "arm-c-preflight.jsonl");
  assertV1JDiagnosticFilePath(input.repoRoot, root, filePath);
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(root, { recursive: false });
  if (fs.realpathSync(root) !== root) {
    throw new Error("v1J Arm C diagnostics refuse an aliased diagnostic root");
  }
  return createV1JPreflightDiagnosticJournalAtPath({ ...input, arm: "C" }, root, filePath, {
    rootAlreadyCreated: true,
    checkFormalStateEmpty: false,
    entrypointGuards: {
      armAPreflightReached: false,
      smokeScheduleReached: false,
      formalArtifactTouched: false,
      normalSmokeArtifactTouched: false,
    },
  });
}

function resolveV1JPhysicalPath(targetPath: string): string {
  let existing = path.resolve(targetPath);
  const suffix: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new Error("v1J diagnostics path has no existing filesystem ancestor");
    }
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function assertV1JDiagnosticFilePath(repoRoot: string, root: string, filePath: string): void {
  const parent = path.resolve(repoRoot, V1J_SMOKE_ARTIFACT_PARENT);
  const rootRelative = path.relative(parent, root);
  const fileRelative = path.relative(root, filePath);
  if (
    rootRelative === ".." ||
    rootRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rootRelative) ||
    fileRelative === ".." ||
    fileRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fileRelative)
  ) {
    throw new Error("v1J preflight diagnostics path escaped its artifact root");
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const leftRelative = path.relative(left, right);
  const rightRelative = path.relative(right, left);
  const isWithin = (relative: string) =>
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  return isWithin(leftRelative) || isWithin(rightRelative);
}

function createV1JPreflightDiagnosticJournalAtPath(
  input: {
    repoRoot: string;
    harnessCommit: string;
    arm: "A" | "C";
    caseId: string;
    preflightId: string;
    pid: number;
    startedAtMs?: number;
  },
  root: string,
  filePath: string,
  options: {
    createRootRecursively?: boolean;
    rootAlreadyCreated?: boolean;
    checkFormalStateEmpty?: boolean;
    entrypointGuards?: {
      armAPreflightReached: false;
      smokeScheduleReached: false;
      formalArtifactTouched: false;
      normalSmokeArtifactTouched: false;
    };
  } = {},
): V1JPreflightDiagnosticJournal {
  if (options.createRootRecursively) {
    fs.mkdirSync(root, { recursive: true });
  } else if (!options.rootAlreadyCreated) {
    fs.mkdirSync(root, { recursive: false });
  }
  const fd = fs.openSync(filePath, "wx");
  const startedAtMs = input.startedAtMs ?? Date.now();
  const counters = createV1JPreflightCounters();
  let eventIndex = 0;
  let closed = false;
  const record = (event: string, details: Record<string, unknown> = {}) => {
    if (options.checkFormalStateEmpty !== false) {
      assertV1JFormalStateEmpty(input.repoRoot);
    }
    if (closed) {
      throw new Error("v1J preflight diagnostic journal is closed");
    }
    const row = {
      event,
      captureName: input.preflightId,
      eventIndex: ++eventIndex,
      observedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAtMs,
      pid: input.pid,
      harnessCommit: input.harnessCommit,
      arm: input.arm,
      caseId: input.caseId,
      preflightId: input.preflightId,
      counters: { ...counters },
      ...details,
      ...(options.entrypointGuards ? { entrypointGuards: options.entrypointGuards } : {}),
    };
    fs.writeSync(fd, `${JSON.stringify(row)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  };
  record(`arm-${input.arm.toLowerCase()}-preflight-start`);
  return {
    filePath,
    arm: input.arm,
    counters: () => ({ ...counters }),
    record,
    increment: (counter, event, details = {}) => {
      const before = counters[counter];
      counters[counter] += 1;
      record(event, { counter, before, after: counters[counter], ...details });
    },
    evaluateStop: ({
      requestObserverCount,
      capturedRequestCount,
      delegatedRequestCount,
      providerDispatchAttempts,
      observations,
      requestBodyDifferingPaths,
    }) => {
      const { observationSummary, predicates } = evaluateV1JPreflightStop({
        counters,
        requestObserverCount,
        capturedRequestCount,
        delegatedRequestCount,
        providerDispatchAttempts,
        observations,
      });
      record("preflight-stop-assertion-evaluated", {
        requestObserverCount,
        capturedRequestCount,
        delegatedRequestCount,
        observationSummary,
        ...(requestBodyDifferingPaths ? { requestBodyDifferingPaths } : {}),
        predicates,
        passed: Object.values(predicates).every(Boolean),
      });
      return predicates;
    },
    close: () => {
      if (!closed) {
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        closed = true;
      }
    },
  };
}

export async function runV1JArmCPreflightOnly<T>(input: {
  journal: V1JPreflightDiagnosticJournal;
  captureArmC: () => Promise<T>;
}): Promise<T> {
  if (input.journal.arm !== "C") {
    throw new Error("v1J Arm C diagnostic refuses a non-C journal");
  }
  const entrypointGuards = {
    armAPreflightReached: false,
    smokeScheduleReached: false,
    formalArtifactTouched: false,
    normalSmokeArtifactTouched: false,
  } as const;
  input.journal.record("arm-c-only-preflight-start", { entrypointGuards });
  try {
    const surface = await input.captureArmC();
    input.journal.record("arm-c-only-preflight-terminated", {
      outcome: "complete",
      entrypointGuards,
    });
    return surface;
  } catch (error) {
    input.journal.record("arm-c-only-preflight-terminated", {
      outcome: "failed",
      errorName: error instanceof Error ? error.name : typeof error,
      entrypointGuards,
    });
    throw error;
  }
}

const SMOKE_CASES = [
  {
    caseId: "smoke-tool-required",
    stratum: "TOOL_REQUIRED",
    prompt:
      "Read the file smoke-reference.txt in the current workspace and return the exact token written inside it. Do not guess the token.",
    requiredTools: ["read"],
    preferredTool: "read",
  },
  {
    caseId: "smoke-no-tool-control",
    stratum: "NO_TOOL_CONTROL",
    prompt:
      "What is 14 + 27? Reply with the integer only. This is self-contained and requires no file, external information, or external action.",
    requiredTools: [],
    preferredTool: null,
  },
] as const;

const SMOKE_FILES = [
  "manifest.json",
  "smoke-observations.jsonl",
  "smoke-invalid-attempts.jsonl",
  "smoke-summary.json",
] as const;

const FORMAL_EVIDENCE_FILENAMES = new Set([
  "observations.jsonl",
  "invalid.jsonl",
  "real-exact-observations.jsonl",
  "real-exact-invalid.jsonl",
]);

export function buildV1JSmokeSchedule(protocol: V1JProtocol): V1JSmokeCell[] {
  if (
    protocol.experimentId !== "v1J-ACTION-INITIATION" ||
    protocol.design.arms.length !== 2 ||
    protocol.design.arms[0] !== "A" ||
    protocol.design.arms[1] !== "C" ||
    protocol.design.repetitionsPerCasePerArm !== 3
  ) {
    throw new Error("v1J smoke requires the accepted A/C protocol identity");
  }
  const preregisteredIds = new Set(protocol.design.cells.map((cell) => cell.caseId));
  if (SMOKE_CASES.some((entry) => preregisteredIds.has(entry.caseId))) {
    throw new Error("v1J smoke case id overlaps the frozen scientific schedule");
  }
  return SMOKE_CASES.flatMap((smokeCase) =>
    (["A", "C"] as const).map((arm) => ({
      caseId: smokeCase.caseId,
      stratum: smokeCase.stratum,
      prompt: smokeCase.prompt,
      requiredTools: smokeCase.requiredTools,
      preferredTool: smokeCase.preferredTool,
      arm,
      replicate: 1 as const,
      cellId: `${smokeCase.caseId}:${arm}:1`,
    })),
  );
}

export function assertV1JPreflightPairComplete(completedArms: readonly ("A" | "C")[]): void {
  if (
    completedArms.length !== 2 ||
    new Set(completedArms).size !== 2 ||
    !completedArms.includes("A") ||
    !completedArms.includes("C")
  ) {
    throw new Error("v1J smoke schedule requires completed A and C schema preflights");
  }
}

export function resolveV1JSmokeRoot(repoRoot: string, harnessCommit: string): string {
  if (!/^[0-9a-f]{40}$/i.test(harnessCommit)) {
    throw new Error("v1J smoke artifact path requires the actual full harness commit SHA");
  }
  return path.resolve(repoRoot, V1J_SMOKE_ARTIFACT_PARENT, `smoke-${harnessCommit}`);
}

export function assertV1JSmokeWritePath(
  repoRoot: string,
  harnessCommit: string,
  targetPath: string,
): string {
  const root = resolveV1JSmokeRoot(repoRoot, harnessCommit);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
  const formalRelative = path.relative(formalRoot, target);
  if (
    target === formalRoot ||
    (!formalRelative.startsWith("..") && !path.isAbsolute(formalRelative)) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    FORMAL_EVIDENCE_FILENAMES.has(path.basename(target)) ||
    !SMOKE_FILES.includes(path.basename(target) as (typeof SMOKE_FILES)[number])
  ) {
    throw new Error("v1J smoke refused a non-smoke or formal evidence path");
  }
  return target;
}

export function assertV1JFormalStateEmpty(repoRoot: string): void {
  const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
  if (fs.existsSync(formalRoot)) {
    throw new Error("v1J smoke requires absent formal state and will not open it");
  }
}

export function assertV1JSmokeProvenance(
  amendment: unknown,
  protocol: V1JProtocol,
  harnessCommit: string,
): void {
  if (
    !isV1IProvenanceAmendment(amendment, protocol.base.head, harnessCommit) ||
    (amendment as { amendmentType?: string }).amendmentType !== "observational/harness-control-only"
  ) {
    throw new Error("v1J smoke provenance amendment is missing, mismatched, or unrecognized");
  }
}

export function createV1JSmokeArtifactState(input: {
  repoRoot: string;
  harnessCommit: string;
  protocol: V1JProtocol;
  modelConfigHash: string;
  schemaFingerprints: Record<string, unknown>;
  startedAt: string;
}): V1JSmokeArtifactState {
  assertV1JFormalStateEmpty(input.repoRoot);
  const root = resolveV1JSmokeRoot(input.repoRoot, input.harnessCommit);
  const manifestPath = assertV1JSmokeWritePath(
    input.repoRoot,
    input.harnessCommit,
    path.join(root, "manifest.json"),
  );
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(root, { recursive: false });
  const schedule = buildV1JSmokeSchedule(input.protocol);
  const manifest = {
    artifactKind: "v1J-live-operational-smoke",
    experimentId: input.protocol.experimentId,
    scientificClassification: "NOT_CLASSIFIED",
    preregistrationSha256: V1J_PREREGISTRATION_SHA256,
    harnessCommit: input.harnessCommit,
    model: input.protocol.model,
    modelConfigHash: input.modelConfigHash,
    schemaFingerprints: input.schemaFingerprints,
    activeFilteringEnabled: input.protocol.base.productionFrozen.activeFilteringEnabled,
    schedule: schedule.map(({ cellId, caseId, stratum, arm, replicate }) => ({
      cellId,
      caseId,
      stratum,
      arm,
      replicate,
    })),
    expectedSmokeCells: 4,
    formalValidCellsBefore: 0,
    formalInvalidAttemptsBefore: 0,
    startedAt: input.startedAt,
    completedAt: null,
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, serialized, { encoding: "utf8", flag: "wx" });
  for (const filename of SMOKE_FILES.slice(1, 3)) {
    fs.writeFileSync(
      assertV1JSmokeWritePath(input.repoRoot, input.harnessCommit, path.join(root, filename)),
      "",
      { encoding: "utf8", flag: "wx" },
    );
  }
  return { repoRoot: input.repoRoot, root, harnessCommit: input.harnessCommit, records: [] };
}

export function appendV1JSmokeRecord(state: V1JSmokeArtifactState, record: V1JSmokeRecord): void {
  if (
    !record.smokeCellId.startsWith("smoke-") ||
    record.observation.cellId !== record.smokeCellId ||
    record.observation.harnessCommit !== state.harnessCommit ||
    record.observation.caseId !== record.caseId ||
    record.observation.arm !== record.arm ||
    record.observation.replicate !== 1 ||
    state.records.some((entry) => entry.smokeCellId === record.smokeCellId)
  ) {
    throw new Error("v1J smoke record has mismatched or duplicate identity");
  }
  const observationsPath = assertV1JSmokeWritePath(
    state.repoRoot,
    state.harnessCommit,
    path.join(state.root, "smoke-observations.jsonl"),
  );
  const invalidPath = assertV1JSmokeWritePath(
    state.repoRoot,
    state.harnessCommit,
    path.join(state.root, "smoke-invalid-attempts.jsonl"),
  );
  const target = record.observation.valid ? observationsPath : invalidPath;
  const line = `${JSON.stringify(record)}\n`;
  fs.appendFileSync(target, line, { encoding: "utf8", flag: "a" });
  state.records.push(record);
}

export async function runV1JSmokeSchedule(
  state: V1JSmokeArtifactState,
  schedule: readonly V1JSmokeCell[],
  executeCell: (cell: V1JSmokeCell) => Promise<{
    observation: V1JObservation;
    workspaceCleanupComplete: boolean;
  }>,
): Promise<"INVALID_SMOKE_OBSERVATION" | "CLEANUP_FAILURE" | null> {
  for (const cell of schedule) {
    const result = await executeCell(cell);
    const record: V1JSmokeRecord = {
      smokeCellId: cell.cellId,
      caseId: cell.caseId,
      arm: cell.arm,
      replicate: 1,
      ...result,
    };
    // Persist the outcome before stopping so a failed cell is never lost or retried.
    appendV1JSmokeRecord(state, record);
    if (!record.observation.valid) {
      return "INVALID_SMOKE_OBSERVATION";
    }
    if (!record.workspaceCleanupComplete) {
      return "CLEANUP_FAILURE";
    }
  }
  return null;
}

export function finalizeV1JSmokeArtifacts(
  state: V1JSmokeArtifactState,
  input: { completedAt: string; modelRequestsSent: number; preflightPassed: boolean },
): Record<string, unknown> {
  assertV1JFormalStateEmpty(state.repoRoot);
  const summary = {
    artifactKind: "v1J-live-operational-smoke",
    scientificClassification: "NOT_CLASSIFIED",
    expectedSmokeCells: 4,
    validSmokeCells: state.records.filter((record) => record.observation.valid).length,
    invalidSmokeAttempts: state.records.filter((record) => !record.observation.valid).length,
    modelRequestsSent: input.modelRequestsSent,
    preflightPassed: input.preflightPassed,
    modelResponsesReceived: state.records.filter(
      (record) => record.observation.providerResponseObserved,
    ).length,
    toolCallCount: state.records.reduce(
      (count, record) => count + record.observation.toolCalls.length,
      0,
    ),
    executionCount: state.records.reduce(
      (count, record) => count + record.observation.executions.length,
      0,
    ),
    noToolOutcomes: state.records.filter((record) => record.observation.toolCalls.length === 0)
      .length,
    cleanupFailures: state.records.filter((record) => !record.workspaceCleanupComplete).length,
    crossArmLeaks: state.records.reduce(
      (count, record) => count + (record.observation.integrity?.crossArmLeaks ?? 0),
      0,
    ),
    configDrift: state.records.reduce(
      (count, record) => count + (record.observation.integrity?.configDrift ?? 0),
      0,
    ),
    modelHashDrift: state.records.reduce(
      (count, record) => count + (record.observation.integrity?.modelHashDrift ?? 0),
      0,
    ),
    authorizedSurfaceDrift: state.records.reduce(
      (count, record) => count + (record.observation.integrity?.authorizedSurfaceDrift ?? 0),
      0,
    ),
    providerSurfaceDrift: state.records.reduce(
      (count, record) => count + (record.observation.integrity?.providerSurfaceDrift ?? 0),
      0,
    ),
    unprovableCorrelations: state.records.filter(
      (record) => record.observation.correlationStatus !== "PROVABLE",
    ).length,
    unmatchedToolCalls: state.records.reduce((count, record) => {
      const executedCallIds = new Set(
        record.observation.executions.flatMap((execution) =>
          execution.toolCallId ? [execution.toolCallId] : [],
        ),
      );
      return (
        count +
        record.observation.toolCalls.filter((toolCall) => !executedCallIds.has(toolCall.toolCallId))
          .length
      );
    }, 0),
    resultSerializationFailures: 0,
    workspaceCleanupFailures: state.records.filter((record) => !record.workspaceCleanupComplete)
      .length,
    recordsWritten: state.records.length,
    formalValidCellsBefore: 0,
    formalValidCellsAfter: 0,
    formalInvalidAttemptsBefore: 0,
    formalInvalidAttemptsAfter: 0,
    completedAt: input.completedAt,
  };
  const summaryPath = assertV1JSmokeWritePath(
    state.repoRoot,
    state.harnessCommit,
    path.join(state.root, "smoke-summary.json"),
  );
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  assertV1JFormalStateEmpty(state.repoRoot);
  return summary;
}
