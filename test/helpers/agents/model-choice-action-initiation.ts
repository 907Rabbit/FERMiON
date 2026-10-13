import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CorrelationExecution,
  CorrelationToolCall,
} from "../../../src/agents/capability-intelligence/model-choice-experiment-correlation.js";
import {
  canonicalizeV1IValue,
  hashV1ICanonical,
} from "../../../src/agents/capability-intelligence/model-choice-experiment-evidence.js";

export const V1J_PREREGISTRATION_SHA256 =
  "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172";
export const V1J_PREREGISTRATION_PATH =
  "artifacts/capability-intelligence/v1j-action-initiation/preregistration-v2.json";
export const V1J_SCHEMA_CANONICALIZATION_VERSION = "v1j-provider-schema-v1";

export type V1JArm = "A" | "C";
export type V1JStratum = "TOOL_REQUIRED" | "NO_TOOL_CONTROL";

export type V1JCase = {
  caseId: string;
  stratum: V1JStratum;
  prompt: string;
  expectedAction: "at_least_one_authorized_tool_attempt" | "no_tool_attempt";
  requiredTools: readonly string[];
  preferredTool: string | null;
};

export type V1JCell = {
  cellId: string;
  caseId: string;
  stratum: V1JStratum;
  arm: V1JArm;
  replicate: number;
  requiredTools: readonly string[];
  preferredTool: string | null;
  prompt: string;
};

export type V1JProtocol = {
  version: number;
  experimentId: string;
  base: {
    head: string;
    productionFrozen: { rankerVersion: string; topK: number; activeFilteringEnabled: boolean };
  };
  model: {
    id: string;
    provider: string;
    contextLength: number;
    modelConfigHash: string;
    modelConfig: Record<string, unknown>;
  };
  arms: Record<V1JArm, { name: string; experimentalInstruction: string }>;
  design: {
    toolRequiredCases: number;
    noToolControlCases: number;
    arms: readonly V1JArm[];
    repetitionsPerCasePerArm: number;
    expectedValidCells: number;
    cells: readonly V1JCase[];
  };
  schedule: { seed: number; noOutcomeBasedReordering: boolean };
  surfaceAndRuntime: { schemaIntegrityGate: V1JSchemaFingerprints };
  schemaBaseline: V1JSchemaBaseline;
  metrics: Record<string, string>;
  primarySuccessCriteria: Record<string, number | boolean>;
  classification: Record<string, string | readonly string[]>;
  integrityGates: Record<string, unknown>;
  retryRules: { retryOnly: readonly string[]; neverRetryScientificOutcomes: readonly string[] };
  serializationFailurePolicy: { automaticRetryCount: number; hardStop: string };
  authorizationGate: { liveExecutionAuthorized: boolean };
};

export type V1JSchemaFingerprints = {
  authorizedToolCount: number;
  providerToolCount: number;
  authorizedToolNameSha256: string;
  providerToolNameSha256: string;
  authorizedToolSchemaSha256: string;
  providerToolSchemaSha256: string;
};

export type V1JSchemaBaseline = V1JSchemaFingerprints & {
  baselineType: string;
  benchmarkCandidateInventoryCount: number;
  mappedRuntimeNameCount: number;
  expectedRealExactRuntimeCount: number;
  expectedRuntimeNames: readonly string[];
  schemaCanonicalizationVersion: string;
  schemaCanonicalization: readonly string[];
  authorizedSetEqualsProviderSet: boolean;
  freshRuntimeRepeatability: boolean;
  armAArmCParity: boolean;
  imageBenchmarkMapping: string;
  runtimeBuiltInImageToolName: string;
  imageFactoryEligible: boolean;
  imageFactoryConstructed: boolean;
  activeFilteringEnabled: boolean;
};

export type V1JCapturedSchemaSurface = V1JSchemaFingerprints & {
  authorizedToolNames: readonly string[];
};

export type V1JObservation = {
  cellId: string;
  caseId: string;
  stratum: V1JStratum;
  arm: V1JArm;
  replicate: number;
  attempt: number;
  harnessCommit: string;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  rankerVersion: string;
  topK: number;
  activeFilteringEnabled: boolean;
  modelRequestsSent: number;
  providerResponseObserved: boolean;
  experimentalInstructionHash: string;
  authorizedToolNameSha256: string;
  authorizedToolNames: readonly string[];
  providerToolNameSha256: string;
  authorizedToolSchemaSha256: string;
  providerToolSchemaSha256: string;
  v1cTop8: readonly string[];
  firstExecutedTool: string | null;
  executedToolSequence: readonly string[];
  terminalSuccess: boolean;
  rankingEpoch: string | null;
  terminalEvidenceComplete: boolean;
  correlationStatus: "PROVABLE" | "UNPROVABLE";
  toolCalls: readonly CorrelationToolCall[];
  executions: readonly CorrelationExecution[];
  substituteTool: string | null;
  fallbackAfterPreferredFailure: boolean;
  semanticSubstitution: boolean;
  valid: boolean;
  invalidReason: string | null;
  invalidClass?: "INFRASTRUCTURE_RETRY_ELIGIBLE" | "SCIENTIFIC_OUTCOME" | "INTEGRITY_FAILURE";
  integrity?: Partial<Record<V1JIntegrityFlag, number>>;
};

export type V1JIntegrityFlag =
  | "crossArmLeaks"
  | "configDrift"
  | "modelHashDrift"
  | "authorizedSurfaceDrift"
  | "providerSurfaceDrift"
  | "epochFailures"
  | "unprovableCorrelations"
  | "newEvidenceDefects"
  | "resultSerializationFailures";

export type V1JArtifactState = {
  manifest: Record<string, unknown>;
  observations: V1JObservation[];
  invalidAttempts: V1JObservation[];
};

export type V1JRuntimeGateInput = {
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  rankerVersion: string;
  topK: number;
  activeFilteringEnabled: boolean;
  surface: V1JCapturedSchemaSurface;
};

export function loadV1JPreregistration(
  rawJson: string,
  expectedSha256 = V1J_PREREGISTRATION_SHA256,
): V1JProtocol {
  const actual = createHash("sha256").update(rawJson, "utf8").digest("hex");
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(`v1J preregistration SHA-256 mismatch: ${actual}`);
  }
  const parsed = JSON.parse(rawJson) as V1JProtocol;
  validateV1JProtocol(parsed);
  return parsed;
}

export function readV1JPreregistration(root = process.cwd()): V1JProtocol {
  return loadV1JPreregistration(fs.readFileSync(path.join(root, V1J_PREREGISTRATION_PATH), "utf8"));
}

function validateV1JProtocol(protocol: V1JProtocol): void {
  const { design, schemaIntegrityGate } = {
    design: protocol.design,
    schemaIntegrityGate: protocol.surfaceAndRuntime.schemaIntegrityGate,
  };
  if (
    protocol.version !== 2 ||
    protocol.base.head !== "a6c1188899aaf365b627472f91a7627e1e87d42a" ||
    protocol.base.productionFrozen.rankerVersion !== "v1C" ||
    protocol.base.productionFrozen.topK !== 8 ||
    protocol.base.productionFrozen.activeFilteringEnabled !== false ||
    protocol.model.id !== "qwen/qwen3.5-9b" ||
    protocol.model.provider !== "lmstudio" ||
    protocol.model.contextLength !== 262_144 ||
    design.cells.length !== 16 ||
    design.toolRequiredCases !== 8 ||
    design.noToolControlCases !== 8 ||
    design.repetitionsPerCasePerArm !== 3 ||
    design.expectedValidCells !== 96 ||
    design.arms.join(",") !== "A,C" ||
    protocol.schedule.seed !== 106_993 ||
    protocol.schedule.noOutcomeBasedReordering !== true ||
    schemaIntegrityGate.authorizedToolCount !== 15 ||
    schemaIntegrityGate.providerToolCount !== 15 ||
    protocol.schemaBaseline.expectedRuntimeNames.length !== 15 ||
    protocol.schemaBaseline.authorizedToolNameSha256 !==
      schemaIntegrityGate.authorizedToolNameSha256 ||
    protocol.schemaBaseline.providerToolNameSha256 !== schemaIntegrityGate.providerToolNameSha256 ||
    protocol.schemaBaseline.authorizedToolSchemaSha256 !==
      schemaIntegrityGate.authorizedToolSchemaSha256 ||
    protocol.schemaBaseline.providerToolSchemaSha256 !==
      schemaIntegrityGate.providerToolSchemaSha256 ||
    protocol.serializationFailurePolicy.automaticRetryCount !== 0 ||
    protocol.authorizationGate.liveExecutionAuthorized !== false
  ) {
    throw new Error("v1J preregistration does not match the accepted frozen design");
  }
  const ids = new Set<string>();
  for (const entry of design.cells) {
    if (ids.has(entry.caseId)) {
      throw new Error(`duplicate v1J case id: ${entry.caseId}`);
    }
    ids.add(entry.caseId);
    if (
      (entry.stratum === "TOOL_REQUIRED" &&
        (entry.expectedAction !== "at_least_one_authorized_tool_attempt" ||
          entry.requiredTools.length === 0 ||
          !entry.preferredTool)) ||
      (entry.stratum === "NO_TOOL_CONTROL" &&
        (entry.expectedAction !== "no_tool_attempt" ||
          entry.requiredTools.length !== 0 ||
          entry.preferredTool !== null))
    ) {
      throw new Error(`v1J case does not match its stratum: ${entry.caseId}`);
    }
  }
  if (
    design.cells.filter((entry) => entry.stratum === "TOOL_REQUIRED").length !== 8 ||
    design.cells.filter((entry) => entry.stratum === "NO_TOOL_CONTROL").length !== 8 ||
    protocol.arms.A.experimentalInstruction !== "" ||
    protocol.arms.C.experimentalInstruction.trim().length === 0
  ) {
    throw new Error("v1J case/arm structure is inconsistent with the frozen design");
  }
}

export function v1jInstructionForArm(protocol: V1JProtocol, arm: V1JArm): string {
  const instruction = protocol.arms[arm]?.experimentalInstruction;
  if (typeof instruction !== "string") {
    throw new Error(`v1J Arm ${arm} instruction is missing`);
  }
  return instruction;
}

export function buildV1JSchedule(protocol: V1JProtocol): V1JCell[] {
  const seed = protocol.schedule.seed;
  const cases = [...protocol.design.cells].toSorted((left, right) =>
    compareHash(`${seed}:case:${left.caseId}`, `${seed}:case:${right.caseId}`),
  );
  return cases.flatMap((entry) =>
    Array.from(
      { length: protocol.design.repetitionsPerCasePerArm },
      (_, index) => index + 1,
    ).flatMap((replicate) =>
      [...protocol.design.arms]
        .toSorted((left, right) =>
          compareHash(
            `${seed}:arms:${entry.caseId}:${replicate}:${left}`,
            `${seed}:arms:${entry.caseId}:${replicate}:${right}`,
          ),
        )
        .map((arm) => ({
          cellId: `${entry.caseId}:${arm}:${replicate}`,
          caseId: entry.caseId,
          stratum: entry.stratum,
          arm,
          replicate,
          requiredTools: entry.requiredTools,
          preferredTool: entry.preferredTool,
          prompt: entry.prompt,
        })),
    ),
  );
}

function compareHash(left: string, right: string): number {
  const leftHash = createHash("sha256").update(left).digest("hex");
  const rightHash = createHash("sha256").update(right).digest("hex");
  return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
}

export function v1jCellKey(cell: Pick<V1JCell, "caseId" | "arm" | "replicate">): string {
  return `${cell.caseId}:${cell.arm}:${cell.replicate}`;
}

export function selectMissingV1JCells(
  schedule: readonly V1JCell[],
  observations: readonly V1JObservation[],
  allowlist?: readonly string[],
  maxCells?: number,
): V1JCell[] {
  const cellById = new Map(schedule.map((cell) => [cell.cellId, cell]));
  const validIds = observations.filter((row) => row.valid).map((row) => row.cellId);
  if (new Set(validIds).size !== validIds.length) {
    throw new Error("duplicate valid v1J cells");
  }
  for (const row of observations) {
    const expected = cellById.get(row.cellId);
    if (!expected || v1jCellKey(expected) !== v1jCellKey(row) || expected.stratum !== row.stratum) {
      throw new Error(`out-of-design v1J observation: ${row.cellId}`);
    }
  }
  const completed = new Set(validIds);
  let missing = schedule.filter((cell) => !completed.has(cell.cellId));
  if (allowlist) {
    const selected = new Set(allowlist);
    if (selected.size !== allowlist.length || allowlist.some((id) => !cellById.has(id))) {
      throw new Error("v1J cell selector contains duplicate or out-of-design cells");
    }
    missing = missing.filter((cell) => selected.has(cell.cellId));
    if (missing.length !== selected.size) {
      throw new Error("v1J cell selector includes a cell that is already valid");
    }
  }
  if (maxCells !== undefined && (!Number.isSafeInteger(maxCells) || maxCells < 1)) {
    throw new Error("v1J maxCells must be a positive integer");
  }
  return maxCells === undefined ? missing : missing.slice(0, maxCells);
}

export function v1jNextAttempt(cell: V1JCell, invalidAttempts: readonly V1JObservation[]): number {
  const history = invalidAttempts.filter((row) => row.cellId === cell.cellId);
  if (
    history.some(
      (row) =>
        row.invalidClass !== "INFRASTRUCTURE_RETRY_ELIGIBLE" ||
        row.invalidReason === "EVIDENCE_SERIALIZATION_FAILURE",
    )
  ) {
    throw new Error(`v1J cell is not eligible for continuation: ${cell.cellId}`);
  }
  return Math.max(0, ...history.map((row) => row.attempt)) + 1;
}

export function assertV1JRuntimeGate(protocol: V1JProtocol, actual: V1JRuntimeGateInput): void {
  if (
    actual.modelId !== protocol.model.id ||
    actual.provider !== protocol.model.provider ||
    actual.contextLength !== protocol.model.contextLength ||
    actual.modelConfigHash !== protocol.model.modelConfigHash ||
    actual.rankerVersion !== protocol.base.productionFrozen.rankerVersion ||
    actual.topK !== protocol.base.productionFrozen.topK ||
    actual.activeFilteringEnabled !== false
  ) {
    throw new Error("v1J model/runtime configuration drift");
  }
  assertV1JSchemaBaseline(protocol.schemaBaseline, actual.surface);
}

export function createV1JManifest(input: {
  protocol: V1JProtocol;
  protocolSha256?: string;
  harnessCommit: string;
  modelConfigHash: string;
  startedAt: string;
}): Record<string, unknown> {
  if (!/^[0-9a-f]{40}$/i.test(input.harnessCommit)) {
    throw new Error("v1J manifest requires the actual full harness commit SHA");
  }
  if (input.modelConfigHash !== input.protocol.model.modelConfigHash) {
    throw new Error("v1J manifest model config hash does not match preregistration");
  }
  return {
    experimentId: input.protocol.experimentId,
    preregistrationSha256: input.protocolSha256 ?? V1J_PREREGISTRATION_SHA256,
    baseCommit: input.protocol.base.head,
    harnessCommit: input.harnessCommit,
    model: input.protocol.model,
    rankerVersion: input.protocol.base.productionFrozen.rankerVersion,
    topK: input.protocol.base.productionFrozen.topK,
    activeFilteringEnabled: input.protocol.base.productionFrozen.activeFilteringEnabled,
    schemaBaseline: input.protocol.schemaBaseline,
    expectedValidCells: input.protocol.design.expectedValidCells,
    startedAt: input.startedAt,
    completedAt: null,
  };
}

export function openV1JArtifactState(
  root: string,
  manifest: Record<string, unknown>,
): V1JArtifactState {
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  let persistedManifest = manifest;
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const stable = (value: Record<string, unknown>) => {
      const { startedAt: _startedAt, completedAt: _completedAt, ...identity } = value;
      return identity;
    };
    if (canonicalizeV1IValue(stable(existing)) !== canonicalizeV1IValue(stable(manifest))) {
      throw new Error("incompatible v1J manifest; use a fresh artifact directory");
    }
    persistedManifest = existing;
  } else {
    if (
      fs.existsSync(path.join(root, "observations.jsonl")) ||
      fs.existsSync(path.join(root, "invalid.jsonl"))
    ) {
      throw new Error("v1J evidence exists without its source-bound manifest");
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  }
  if (
    persistedManifest.experimentId !== "v1J-ACTION-INITIATION" ||
    persistedManifest.preregistrationSha256 !== V1J_PREREGISTRATION_SHA256 ||
    typeof persistedManifest.harnessCommit !== "string" ||
    !/^[0-9a-f]{40}$/i.test(persistedManifest.harnessCommit)
  ) {
    throw new Error("v1J artifact manifest is not bound to the accepted protocol and harness");
  }
  const observations = readJsonl<V1JObservation>(path.join(root, "observations.jsonl"));
  const invalidAttempts = readJsonl<V1JObservation>(path.join(root, "invalid.jsonl"));
  if (
    observations.some(
      (row) => !row.valid || row.harnessCommit !== persistedManifest.harnessCommit,
    ) ||
    invalidAttempts.some(
      (row) => row.valid || row.harnessCommit !== persistedManifest.harnessCommit,
    ) ||
    new Set(observations.map((row) => row.cellId)).size !== observations.length
  ) {
    throw new Error("v1J artifact evidence conflicts with its manifest or validity stream");
  }
  return {
    manifest: persistedManifest,
    observations,
    invalidAttempts,
  };
}

export function appendV1JObservation(root: string, row: V1JObservation): void {
  if (!row.valid) {
    throw new Error("invalid v1J attempt must be appended to invalid history");
  }
  const existing = readJsonl<V1JObservation>(path.join(root, "observations.jsonl"));
  if (existing.some((entry) => entry.cellId === row.cellId)) {
    throw new Error(`duplicate valid v1J cell: ${row.cellId}`);
  }
  appendJsonlOnce(path.join(root, row.valid ? "observations.jsonl" : "invalid.jsonl"), row);
}

export function appendV1JInvalidAttempt(root: string, row: V1JObservation): void {
  if (row.valid) {
    throw new Error("valid v1J observation cannot be appended as invalid history");
  }
  if (row.invalidReason === "EVIDENCE_SERIALIZATION_FAILURE") {
    throw new Error("evidence serialization failures are not cell attempts");
  }
  appendJsonlOnce(path.join(root, "invalid.jsonl"), row);
}

export function writeV1JSummary(root: string, summary: V1JSummary): void {
  fs.writeFileSync(path.join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, "summary.txt"),
    [
      `v1J status: ${summary.status}`,
      `result: ${summary.result}`,
      `valid cells: ${summary.validRuns}/${summary.expectedCells}`,
      `invalid attempts: ${summary.invalidAttempts}`,
      `missing cells: ${summary.missingCells}`,
      `TOOL_REQUIRED initiation C-A: ${summary.paired.TOOL_REQUIRED.meanDeltaPP.toFixed(2)} pp ` +
        `[${summary.paired.TOOL_REQUIRED.ciLowPP.toFixed(2)}, ${summary.paired.TOOL_REQUIRED.ciHighPP.toFixed(2)}]`,
      `NO_TOOL_CONTROL unnecessary-tool C-A: ${summary.paired.NO_TOOL_CONTROL.meanDeltaPP.toFixed(2)} pp ` +
        `[${summary.paired.NO_TOOL_CONTROL.ciLowPP.toFixed(2)}, ${summary.paired.NO_TOOL_CONTROL.ciHighPP.toFixed(2)}]`,
    ].join("\n") + "\n",
  );
}

export class V1JSerializationFailureError extends Error {
  constructor(override readonly cause: unknown) {
    super("v1J result serialization failed; the cell must not be retried automatically");
    this.name = "V1JSerializationFailureError";
  }
}

export async function runV1JCellBatch(input: {
  root: string;
  manifest: Record<string, unknown>;
  protocol: V1JProtocol;
  schedule: readonly V1JCell[];
  executeCell: (cell: V1JCell, attempt: number) => Promise<V1JObservation>;
  allowlist?: readonly string[];
  maxCells?: number;
}): Promise<{ attemptedCells: string[]; remainingCells: number; integrityStop: string | null }> {
  const state = openV1JArtifactState(input.root, input.manifest);
  const selected = selectMissingV1JCells(
    input.schedule,
    [...state.observations, ...state.invalidAttempts],
    input.allowlist,
    input.maxCells,
  );
  const attemptedCells: string[] = [];
  let integrityStop: string | null = null;
  for (const cell of selected) {
    const attempt = v1jNextAttempt(cell, state.invalidAttempts);
    const row = await input.executeCell(cell, attempt);
    if (
      row.cellId !== cell.cellId ||
      row.caseId !== cell.caseId ||
      row.stratum !== cell.stratum ||
      row.arm !== cell.arm ||
      row.replicate !== cell.replicate ||
      row.attempt !== attempt
    ) {
      throw new Error(`v1J executor returned mismatched cell identity: ${cell.cellId}`);
    }
    try {
      if (row.valid) {
        appendV1JObservation(input.root, row);
        state.observations.push(row);
      } else {
        appendV1JInvalidAttempt(input.root, row);
        state.invalidAttempts.push(row);
      }
    } catch (error) {
      throw new V1JSerializationFailureError(error);
    }
    attemptedCells.push(cell.cellId);
    if (!row.valid && row.invalidClass !== "INFRASTRUCTURE_RETRY_ELIGIBLE") {
      integrityStop = row.invalidReason ?? "V1J_NON_RETRYABLE_INVALID_ATTEMPT";
      break;
    }
  }
  return {
    attemptedCells,
    remainingCells: input.schedule.length - state.observations.length,
    integrityStop,
  };
}

function appendJsonlOnce(filename: string, row: V1JObservation): void {
  // Serialization is a single fail-closed append; v2 explicitly forbids retrying it.
  const line = `${JSON.stringify(row)}\n`;
  fs.appendFileSync(filename, line, { encoding: "utf8", flag: "a" });
}

function readJsonl<T>(filename: string): T[] {
  if (!fs.existsSync(filename)) {
    return [];
  }
  return fs
    .readFileSync(filename, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function canonicalV1JToolNames(tools: readonly unknown[]): string[] {
  return tools.map(requireToolName).toSorted();
}

export function canonicalV1JToolSchema(tools: readonly unknown[]): string {
  const sorted = tools.toSorted((left, right) => {
    const a = requireToolName(left);
    const b = requireToolName(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return canonicalizeV1IValue(sorted);
}

export function fingerprintV1JToolSurface(input: {
  authorizedTools: readonly unknown[];
  providerTools: readonly unknown[];
}): V1JCapturedSchemaSurface {
  const authorizedNames = canonicalV1JToolNames(input.authorizedTools);
  const providerNames = canonicalV1JToolNames(input.providerTools);
  return {
    authorizedToolCount: authorizedNames.length,
    providerToolCount: providerNames.length,
    authorizedToolNames: authorizedNames,
    authorizedToolNameSha256: hashV1ICanonical(authorizedNames),
    providerToolNameSha256: hashV1ICanonical(providerNames),
    authorizedToolSchemaSha256: createHash("sha256")
      .update(canonicalV1JToolSchema(input.authorizedTools), "utf8")
      .digest("hex"),
    providerToolSchemaSha256: createHash("sha256")
      .update(canonicalV1JToolSchema(input.providerTools), "utf8")
      .digest("hex"),
  };
}

export function assertV1JSchemaBaseline(
  expected: V1JSchemaBaseline,
  actual: V1JCapturedSchemaSurface,
): void {
  const measuredFields = [
    "authorizedToolCount",
    "providerToolCount",
    "authorizedToolNameSha256",
    "providerToolNameSha256",
    "authorizedToolSchemaSha256",
    "providerToolSchemaSha256",
  ] as const satisfies readonly (keyof V1JSchemaFingerprints)[];
  for (const key of measuredFields) {
    if (actual[key] !== expected[key]) {
      throw new Error(`v1J frozen schema baseline mismatch: ${key}`);
    }
  }
  if (
    actual.authorizedToolNames.length !== expected.expectedRuntimeNames.length ||
    actual.authorizedToolNames.some((name, index) => name !== expected.expectedRuntimeNames[index])
  ) {
    throw new Error("v1J frozen schema baseline mismatch: authorizedToolNames");
  }
}

function requireToolName(tool: unknown): string {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    throw new Error("v1J schema contains a tool without a canonical name");
  }
  const record = tool as Record<string, unknown>;
  const fn =
    record.function && typeof record.function === "object"
      ? (record.function as Record<string, unknown>)
      : undefined;
  const name = fn?.name ?? record.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("v1J schema contains a tool without a canonical name");
  }
  return name;
}

export type V1JArmMetrics = {
  validRuns: number;
  toolAttempts: number;
  requiredInitiationRate: number | null;
  noToolRate: number | null;
  unnecessaryToolCount: number;
  unnecessaryToolRate: number | null;
  correctNoToolRate: number | null;
  c8Count: number;
  c8Rate: number | null;
  terminalSuccessCount: number;
  terminalSuccessRate: number | null;
  preferredToolChoiceCount: number;
  preferredToolChoiceRate: number | null;
  preferredToolChoiceExecutionConditionalRate: number | null;
  genericSubstituteCount: number;
  genericSubstituteRate: number | null;
  incorrectRelatedToolCount: number;
  incorrectRelatedToolRate: number | null;
  fallbackAfterPreferredFailureCount: number;
  fallbackAfterPreferredFailureRate: number | null;
  semanticSubstitutionCount: number;
  semanticSubstitutionRate: number | null;
};

export type V1JSummary = {
  status: "COMPLETE" | "PARTIAL" | "INTEGRITY_FAILURE";
  result:
    | "ACTION_INITIATION_HYPOTHESIS_SUPPORTED"
    | "OVERTRIGGERING"
    | "NO_MEANINGFUL_EFFECT"
    | "INCONCLUSIVE"
    | "NOT_CLASSIFIED";
  expectedCells: number;
  validRuns: number;
  invalidAttempts: number;
  missingCells: number;
  byStratum: Record<V1JStratum, Record<V1JArm, V1JArmMetrics>>;
  paired: Record<
    V1JStratum,
    { caseCount: number; meanDeltaPP: number; ciLowPP: number; ciHighPP: number }
  >;
  integrity: Record<V1JIntegrityFlag | "duplicateValidCells" | "outOfDesignCells", number>;
};

export function summarizeV1JObservations(input: {
  protocol: V1JProtocol;
  schedule: readonly V1JCell[];
  observations: readonly V1JObservation[];
  invalidAttempts: readonly V1JObservation[];
  expectedHarnessCommit?: string;
  resultSerializationFailures?: number;
}): V1JSummary {
  const expected = new Map(input.schedule.map((cell) => [cell.cellId, cell]));
  const rows = [...input.observations];
  const validIds = rows.map((row) => row.cellId);
  const duplicateValidCells = validIds.length - new Set(validIds).size;
  let outOfDesignCells = 0;
  const counters: V1JSummary["integrity"] = {
    duplicateValidCells,
    outOfDesignCells: 0,
    crossArmLeaks: 0,
    configDrift: 0,
    modelHashDrift: 0,
    authorizedSurfaceDrift: 0,
    providerSurfaceDrift: 0,
    epochFailures: 0,
    unprovableCorrelations: 0,
    newEvidenceDefects: 0,
    resultSerializationFailures:
      (input.resultSerializationFailures ?? 0) +
      input.invalidAttempts.filter((row) => row.invalidReason === "EVIDENCE_SERIALIZATION_FAILURE")
        .length,
  };
  counters.newEvidenceDefects += input.invalidAttempts.filter(
    (row) =>
      row.invalidClass !== "INFRASTRUCTURE_RETRY_ELIGIBLE" ||
      row.invalidReason === "EVIDENCE_SERIALIZATION_FAILURE",
  ).length;
  const expectedInstructionHashes = {
    A: sha256(input.protocol.arms.A.experimentalInstruction),
    C: sha256(input.protocol.arms.C.experimentalInstruction),
  };
  for (const row of rows) {
    const cell = expected.get(row.cellId);
    if (!cell || v1jCellKey(cell) !== v1jCellKey(row) || !row.valid) {
      outOfDesignCells += 1;
      continue;
    }
    if (
      row.modelId !== input.protocol.model.id ||
      row.provider !== input.protocol.model.provider ||
      row.contextLength !== input.protocol.model.contextLength ||
      row.rankerVersion !== input.protocol.base.productionFrozen.rankerVersion ||
      row.topK !== input.protocol.base.productionFrozen.topK ||
      row.activeFilteringEnabled !== false ||
      (input.expectedHarnessCommit !== undefined &&
        row.harnessCommit !== input.expectedHarnessCommit)
    ) {
      counters.configDrift += 1;
    }
    if (row.modelConfigHash !== input.protocol.model.modelConfigHash) {
      counters.modelHashDrift += 1;
    }
    if (row.experimentalInstructionHash !== expectedInstructionHashes[row.arm]) {
      counters.crossArmLeaks += 1;
    }
    if (
      row.authorizedToolNameSha256 !==
        input.protocol.surfaceAndRuntime.schemaIntegrityGate.authorizedToolNameSha256 ||
      row.authorizedToolSchemaSha256 !==
        input.protocol.surfaceAndRuntime.schemaIntegrityGate.authorizedToolSchemaSha256
    ) {
      counters.authorizedSurfaceDrift += 1;
    }
    if (
      row.providerToolNameSha256 !==
        input.protocol.surfaceAndRuntime.schemaIntegrityGate.providerToolNameSha256 ||
      row.providerToolSchemaSha256 !==
        input.protocol.surfaceAndRuntime.schemaIntegrityGate.providerToolSchemaSha256
    ) {
      counters.providerSurfaceDrift += 1;
    }
    if (!row.rankingEpoch) {
      counters.epochFailures += 1;
    }
    if (row.modelRequestsSent < 1 || !row.providerResponseObserved) {
      counters.newEvidenceDefects += 1;
    }
    if (!hasProvableV1JExecutionCorrelation(row) || !row.terminalEvidenceComplete) {
      counters.unprovableCorrelations += 1;
    }
    for (const [key, count] of Object.entries(row.integrity ?? {}) as [
      V1JIntegrityFlag,
      number,
    ][]) {
      counters[key] += count;
    }
  }
  counters.outOfDesignCells = outOfDesignCells;
  const complete =
    rows.length === input.protocol.design.expectedValidCells &&
    duplicateValidCells === 0 &&
    outOfDesignCells === 0 &&
    input.schedule.every((cell) => validIds.includes(cell.cellId));
  const integrityFailure = Object.values(counters).some((count) => count > 0);
  const byStratum = {} as V1JSummary["byStratum"];
  const paired = {} as V1JSummary["paired"];
  for (const stratum of ["TOOL_REQUIRED", "NO_TOOL_CONTROL"] as const) {
    byStratum[stratum] = {
      A: summarizeArm(rows, stratum, "A", input.protocol),
      C: summarizeArm(rows, stratum, "C", input.protocol),
    };
    const deltas = input.protocol.design.cells
      .filter((entry) => entry.stratum === stratum)
      .map((entry) => {
        const a = rows.filter((row) => row.caseId === entry.caseId && row.arm === "A");
        const c = rows.filter((row) => row.caseId === entry.caseId && row.arm === "C");
        if (a.length !== 3 || c.length !== 3) {
          return null;
        }
        const outcome = (row: V1JObservation) =>
          stratum === "TOOL_REQUIRED" ? hasAuthorizedAttempt(row) : hasAuthorizedAttempt(row);
        return (
          mean(c.map((row) => Number(outcome(row)))) - mean(a.map((row) => Number(outcome(row))))
        );
      })
      .filter((delta): delta is number => delta !== null);
    const ci = pairedBootstrap95(deltas, input.protocol.schedule.seed);
    paired[stratum] = {
      caseCount: deltas.length,
      meanDeltaPP: mean(deltas) * 100,
      ciLowPP: ci[0] * 100,
      ciHighPP: ci[1] * 100,
    };
  }
  const result =
    !complete || integrityFailure
      ? "NOT_CLASSIFIED"
      : classifyV1J(byStratum, paired, input.protocol);
  return {
    status: integrityFailure ? "INTEGRITY_FAILURE" : complete ? "COMPLETE" : "PARTIAL",
    result,
    expectedCells: input.protocol.design.expectedValidCells,
    validRuns: rows.length,
    invalidAttempts: input.invalidAttempts.length,
    missingCells: input.schedule.length - new Set(validIds).size,
    byStratum,
    paired,
    integrity: counters,
  };
}

function summarizeArm(
  rows: readonly V1JObservation[],
  stratum: V1JStratum,
  arm: V1JArm,
  protocol: V1JProtocol,
): V1JArmMetrics {
  const selected = rows.filter((row) => row.stratum === stratum && row.arm === arm);
  const n = selected.length;
  const attempts = selected.filter(hasAuthorizedAttempt);
  const toolRequired = stratum === "TOOL_REQUIRED";
  const divide = (value: number, denominator = n): number | null =>
    denominator === 0 ? null : value / denominator;
  const preferred = attempts.filter((row) => {
    const entry = protocol.design.cells.find((cell) => cell.caseId === row.caseId);
    return Boolean(row.firstExecutedTool && entry?.requiredTools.includes(row.firstExecutedTool));
  }).length;
  const generic = selected.filter(
    (row) =>
      (row.firstExecutedTool === "exec" || row.firstExecutedTool === "read") &&
      !protocol.design.cells
        .find((cell) => cell.caseId === row.caseId)
        ?.requiredTools.includes(row.firstExecutedTool),
  ).length;
  const incorrectRelated = selected.filter(
    (row) =>
      row.substituteTool !== null && row.substituteTool !== "exec" && row.substituteTool !== "read",
  ).length;
  const c8 = selected.filter(
    (row) => row.firstExecutedTool !== null && row.v1cTop8.includes(row.firstExecutedTool),
  ).length;
  const terminalSuccess = selected.filter((row) => row.terminalSuccess).length;
  const fallback = selected.filter((row) => row.fallbackAfterPreferredFailure).length;
  const semanticSubstitution = selected.filter((row) => row.semanticSubstitution).length;
  return {
    validRuns: n,
    toolAttempts: attempts.length,
    requiredInitiationRate: toolRequired ? divide(attempts.length) : null,
    noToolRate: toolRequired ? divide(n - attempts.length) : null,
    unnecessaryToolCount: toolRequired ? 0 : attempts.length,
    unnecessaryToolRate: toolRequired ? null : divide(attempts.length),
    correctNoToolRate: toolRequired ? null : divide(n - attempts.length),
    c8Count: toolRequired ? c8 : 0,
    c8Rate: toolRequired ? divide(c8) : null,
    terminalSuccessCount: terminalSuccess,
    terminalSuccessRate: divide(terminalSuccess),
    preferredToolChoiceCount: toolRequired ? preferred : 0,
    preferredToolChoiceRate: toolRequired ? divide(preferred) : null,
    preferredToolChoiceExecutionConditionalRate: toolRequired
      ? divide(preferred, attempts.length)
      : null,
    genericSubstituteCount: toolRequired ? generic : 0,
    genericSubstituteRate: toolRequired ? divide(generic) : null,
    incorrectRelatedToolCount: toolRequired ? incorrectRelated : 0,
    incorrectRelatedToolRate: toolRequired ? divide(incorrectRelated) : null,
    fallbackAfterPreferredFailureCount: toolRequired ? fallback : 0,
    fallbackAfterPreferredFailureRate: toolRequired ? divide(fallback) : null,
    semanticSubstitutionCount: toolRequired ? semanticSubstitution : 0,
    semanticSubstitutionRate: toolRequired ? divide(semanticSubstitution) : null,
  };
}

function hasAuthorizedAttempt(row: V1JObservation): boolean {
  if (!hasProvableV1JExecutionCorrelation(row)) {
    return false;
  }
  const callsById = new Map(row.toolCalls.map((call) => [call.toolCallId, call]));
  return row.executions.some((execution) =>
    Boolean(
      execution.executionId &&
      execution.toolCallId &&
      callsById.get(execution.toolCallId)?.toolName === execution.toolName &&
      row.authorizedToolNames.includes(execution.toolName),
    ),
  );
}

function hasProvableV1JExecutionCorrelation(row: V1JObservation): boolean {
  if (row.correlationStatus !== "PROVABLE") {
    return false;
  }
  const callsById = new Map<string, CorrelationToolCall>();
  for (const call of row.toolCalls) {
    if (!call.toolCallId || callsById.has(call.toolCallId)) {
      return false;
    }
    callsById.set(call.toolCallId, call);
  }
  return row.executions.every((execution) => {
    const call = execution.toolCallId ? callsById.get(execution.toolCallId) : undefined;
    return Boolean(execution.executionId && call && execution.toolName === call.toolName);
  });
}

function pairedBootstrap95(values: readonly number[], seed: number): [number, number] {
  if (values.length === 0) {
    return [0, 0];
  }
  const samples: number[] = [];
  let state = seed >>> 0;
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    let total = 0;
    for (const fallback of values) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223 + iteration) >>> 0;
      total += values[state % values.length] ?? fallback;
    }
    samples.push(total / values.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[50] ?? 0, samples[1_950] ?? 0];
}

function classifyV1J(
  byStratum: V1JSummary["byStratum"],
  paired: V1JSummary["paired"],
  protocol: V1JProtocol,
): V1JSummary["result"] {
  if (paired.TOOL_REQUIRED.caseCount !== 8 || paired.NO_TOOL_CONTROL.caseCount !== 8) {
    return "NOT_CLASSIFIED";
  }
  const requiredImprovement = paired.TOOL_REQUIRED.meanDeltaPP;
  const controlIncrease = paired.NO_TOOL_CONTROL.meanDeltaPP;
  const controlRateC = (byStratum.NO_TOOL_CONTROL.C.unnecessaryToolRate ?? 0) * 100;
  const criteria = protocol.primarySuccessCriteria;
  const successRegressed = (["TOOL_REQUIRED", "NO_TOOL_CONTROL"] as const).some(
    (stratum) =>
      (byStratum[stratum].C.terminalSuccessRate ?? 0) -
        (byStratum[stratum].A.terminalSuccessRate ?? 0) <
      -0.05,
  );
  if (
    requiredImprovement >= Number(criteria.toolRequiredPairedMeanImprovementPPAtLeast) &&
    paired.TOOL_REQUIRED.ciLowPP > Number(criteria.toolRequiredPairedCiLowerBoundGreaterThanPP) &&
    controlIncrease <= Number(criteria.noToolControlUnnecessaryToolRateIncreaseAtMostPP) &&
    controlRateC <= Number(criteria.noToolControlArmCUnnecessaryToolRateAtMostPct) &&
    !successRegressed
  ) {
    return "ACTION_INITIATION_HYPOTHESIS_SUPPORTED";
  }
  if (
    requiredImprovement >= Number(criteria.toolRequiredPairedMeanImprovementPPAtLeast) &&
    (controlRateC >
      Number(criteria.overtriggeringHardFailIfArmCUnnecessaryToolRateGreaterThanPct) ||
      controlIncrease > Number(criteria.overtriggeringHardFailIfControlIncreaseGreaterThanPP))
  ) {
    return "OVERTRIGGERING";
  }
  if (
    Math.abs(requiredImprovement) < 5 &&
    controlRateC <= Number(criteria.noToolControlArmCUnnecessaryToolRateAtMostPct) &&
    controlIncrease <= Number(criteria.noToolControlUnnecessaryToolRateIncreaseAtMostPP)
  ) {
    return "NO_MEANINGFUL_EFFECT";
  }
  return "INCONCLUSIVE";
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
