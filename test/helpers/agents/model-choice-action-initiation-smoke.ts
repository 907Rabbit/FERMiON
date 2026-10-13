import fs from "node:fs";
import path from "node:path";
import { isV1IProvenanceAmendment } from "../../../src/agents/capability-intelligence/model-choice-experiment-provenance.js";
import {
  V1J_PREREGISTRATION_SHA256,
  type V1JObservation,
  type V1JProtocol,
} from "./model-choice-action-initiation.js";

export const V1J_SMOKE_PROVENANCE_PATH =
  "artifacts/capability-intelligence/v1j-action-initiation/provenance-amendment.json";
export const V1J_SMOKE_ARTIFACT_PARENT = "artifacts/capability-intelligence/v1j-action-initiation";
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
  | "preflightCompleted";

export type V1JPreflightCounters = Record<V1JPreflightCounterName, number>;

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
  }) => Record<string, boolean>;
  close: () => void;
};

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
  const relative = path.relative(path.resolve(input.repoRoot, V1J_SMOKE_ARTIFACT_PARENT), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("v1J preflight diagnostics path escaped its artifact root");
  }
  fs.mkdirSync(root, { recursive: true });
  const fd = fs.openSync(filePath, "wx");
  const startedAtMs = input.startedAtMs ?? Date.now();
  const counters: V1JPreflightCounters = {
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
  };
  let eventIndex = 0;
  let closed = false;
  const record = (event: string, details: Record<string, unknown> = {}) => {
    assertV1JFormalStateEmpty(input.repoRoot);
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
    }) => {
      const predicates = {
        requestObserverCountIsOne: requestObserverCount === 1,
        requestObserverCounterMatches: counters.requestObserverInvocations === requestObserverCount,
        providerRequestHookCountIsOne: counters.providerRequestHookInvocations === 1,
        providerCallbackCountIsZero: counters.providerCallbackInvocations === 0,
        dispatchAttemptsIsZero:
          counters.providerDispatchAttempts === 0 && providerDispatchAttempts === 0,
        modelRequestCountIsZero: counters.modelRequestCounter === 0,
        stopSignalRaised: counters.preflightStopSignalRaised === 1,
        stopSignalCaught: counters.preflightStopSignalCaught === 1,
        schemaCaptureNotEntered:
          counters.schemaCaptureStarts === 0 && counters.schemaCaptureCompletes === 0,
        capturedRequestCountIsOne: capturedRequestCount === 1,
        delegatedRequestCountIsZero: delegatedRequestCount === 0,
      };
      record("preflight-stop-assertion-evaluated", {
        requestObserverCount,
        capturedRequestCount,
        delegatedRequestCount,
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
