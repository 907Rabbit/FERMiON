import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BenchmarkRealToolMappingSummary } from "./benchmark-real-tool-mapping.js";
import type { ToolRankingBenchmarkCase } from "./tool-ranking-benchmark-cases.js";

export const V1I_SCHEMA_VERSION = 1;
export const V1I_EXPERIMENT_VERSION = "v1I";
export const V1I_BOOTSTRAP_SEED = 0x1a1f1;
export const V1I_REPLICATES = 3;

/** Canonical JSON hashing is limited to the evidence protocol's JSON provenance values. */
export function canonicalizeV1IValue(value: unknown): string {
  return stringifyV1IValue(value, "$", new WeakSet());
}

export function hashV1ICanonical(value: unknown): string {
  return createHash("sha256").update(canonicalizeV1IValue(value), "utf8").digest("hex");
}

export const V1I_MODES = ["synthetic", "real-exact", "real-adapter"] as const;
export type V1IMode = (typeof V1I_MODES)[number];

export type V1ISurfaceMode = "SYNTHETIC" | "REAL_EXACT_ONLY" | "REAL_ADAPTER";
export type V1IArm = "A" | "B";
export type V1IMappingClassification = "SYNTHETIC" | "EXACT" | "ADAPTER";

export type V1IObservation = {
  schemaVersion: number;
  experimentVersion: string;
  harnessCommit: string;
  surfaceMode: V1ISurfaceMode;
  caseId: string;
  arm: V1IArm;
  replicate: number;
  attempt: number;
  scheduleSeed: number;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  systemPromptHash: string;
  userPromptHash: string;
  experimentalInstructionHash: string;
  authorizedSurfaceHash: string;
  schemaHash: string;
  caseSetHash: string;
  rankerVersion: string;
  qualificationPolicyVersion: string;
  rankingEpoch: string | null;
  benchmarkPreferredTool: string;
  mappedRealTool: string | null;
  mappingClassification: V1IMappingClassification;
  v1cTop8: readonly string[];
  selectedTools: readonly string[];
  firstExecutedTool: string | null;
  executedToolSequence: readonly string[];
  terminalSuccess: boolean;
  terminalFailureReason: string | null;
  preferredToolAuthorized: boolean;
  preferredToolInTop8: boolean;
  preferredToolAttempted: boolean;
  substituteTool: string | null;
  substitutionWithoutPreferredAttempt: boolean;
  fallbackAfterPreferredFailure: boolean;
  valid: boolean;
  invalidReason: string | null;
  startTime: string;
  endTime: string;
};

export type V1IManifest = {
  schemaVersion: number;
  experimentVersion: string;
  harnessCommit: string;
  branch: string;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfig: Record<string, unknown>;
  modelConfigHash: string;
  rankerVersion: string;
  qualificationPolicyVersion: string;
  scheduleSeed: number;
  caseSetHash: string;
  syntheticCaseSetHash: string;
  realExactCaseSetHash: string;
  realAdapterCaseSetHash: string;
  syntheticSurfaceHash: string;
  realExactSurfaceHash: string;
  realAdapterSurfaceHash: string;
  schemaHash: string;
  systemPromptHash: string;
  experimentalInstructionHash: string;
  startedAt: string;
  completedAt: string | null;
  activeFilteringEnabled: false;
};

export type V1IExperimentSets = {
  synthetic: readonly ToolRankingBenchmarkCase[];
  realExact: readonly ToolRankingBenchmarkCase[];
  realAdapter: readonly ToolRankingBenchmarkCase[];
  unsupported: readonly ToolRankingBenchmarkCase[];
};

export type V1IArmMetrics = {
  validRuns: number;
  executions: number;
  top8Containment: number;
  successRate: number;
  semanticSubstitutionRate: number;
  substitutionWithoutPreferredAttemptRate: number;
  fallbackAfterPreferredFailureRate: number;
  purposeBuiltChoiceRate?: number;
  genericSubstituteRate?: number;
  incorrectRelatedToolRate?: number;
};

export type V1ISummary = {
  status: "COMPLETE" | "PARTIAL";
  result:
    | "INSTRUCTION_HYPOTHESIS_SUPPORTED"
    | "STABLE_MODEL_CHOICE"
    | "STOCHASTIC_SUBSTITUTION"
    | "INCONCLUSIVE"
    | "NOT_CLASSIFIED"
    | "DESCRIPTIVE_ONLY";
  expectedCells: number;
  validRuns: number;
  invalidAttempts: number;
  armAValidRuns: number;
  armBValidRuns: number;
  armA: V1IArmMetrics;
  armB: V1IArmMetrics;
  pairedCaseCount: number;
  meanPairedDelta: number;
  meanPairedDeltaPercentagePoints: number;
  paired95CiLow: number;
  paired95CiHigh: number;
  bootstrapSeed: number;
  meanModalAgreement: number;
  casesThreeOfThree: number;
  casesTwoOfThree: number;
  casesOneOfThree: number;
  noToolRunsIncludedInModalAgreement: number;
  integrityRegressions: number;
};

export type V1IArtifactState = {
  manifest: V1IManifest;
  observations: V1IObservation[];
  invalidAttempts: V1IObservation[];
};

export type V1IRequiredCell = {
  surfaceMode: V1ISurfaceMode;
  caseId: string;
  arm: V1IArm;
  replicate: number;
};

export function resolveV1IMode(live: boolean, rawMode: string | undefined): V1IMode | null {
  if (!live) {
    return null;
  }
  if (!rawMode || !V1I_MODES.includes(rawMode as V1IMode)) {
    throw new Error(
      `OPENCLAW_V1I_MODE must be one of ${V1I_MODES.join(", ")} when OPENCLAW_V1I_LIVE_TEST=1`,
    );
  }
  return rawMode as V1IMode;
}

export function splitV1IExperimentSets(
  cases: readonly ToolRankingBenchmarkCase[],
  summary: BenchmarkRealToolMappingSummary,
): V1IExperimentSets {
  const byId = new Map(cases.map((entry) => [entry.id, entry]));
  const exact = summary.cases.filter((entry) => entry.mappingClass === "EXACT");
  const adapter = summary.cases.filter((entry) => entry.mappingClass === "ADAPTER");
  const unsupported = summary.cases.filter((entry) => entry.mappingClass === "UNSUPPORTED");
  const requireCases = (entries: readonly { caseId: string }[]) =>
    entries.map((entry) => {
      const value = byId.get(entry.caseId);
      if (!value) {
        throw new Error(`missing frozen benchmark case: ${entry.caseId}`);
      }
      return value;
    });
  const result = {
    synthetic: cases,
    realExact: requireCases(exact),
    realAdapter: requireCases(adapter),
    unsupported: requireCases(unsupported),
  } satisfies V1IExperimentSets;
  if (
    result.synthetic.length !== 17 ||
    result.realExact.length !== 8 ||
    result.realAdapter.length !== 3
  ) {
    throw new Error("v1I frozen corpus accounting mismatch");
  }
  if (
    result.unsupported.length !== 6 ||
    result.realExact.length + result.realAdapter.length + result.unsupported.length !== 17
  ) {
    throw new Error("v1I real-surface strata accounting mismatch");
  }
  return result;
}

export function surfaceModeForV1IMode(mode: V1IMode): V1ISurfaceMode {
  return mode === "synthetic"
    ? "SYNTHETIC"
    : mode === "real-exact"
      ? "REAL_EXACT_ONLY"
      : "REAL_ADAPTER";
}

export function expectedCellsForV1IMode(mode: V1IMode): number {
  return (mode === "synthetic" ? 17 : mode === "real-exact" ? 8 : 3) * 2 * V1I_REPLICATES;
}

export function v1ICellKey(
  observation: Pick<V1IObservation, "surfaceMode" | "caseId" | "arm" | "replicate">,
): string {
  return `${observation.surfaceMode}:${observation.caseId}:${observation.arm}:${observation.replicate}`;
}

export function requiredV1ICells(
  mode: V1IMode,
  cases: readonly ToolRankingBenchmarkCase[],
): readonly V1IRequiredCell[] {
  const surfaceMode = surfaceModeForV1IMode(mode);
  return cases.flatMap((entry) =>
    Array.from({ length: V1I_REPLICATES }, (_, index) => index + 1).flatMap((replicate) =>
      (["A", "B"] as const).map((arm) => ({
        surfaceMode,
        caseId: entry.id,
        arm,
        replicate,
      })),
    ),
  );
}

export function missingV1ICells(
  mode: V1IMode,
  cases: readonly ToolRankingBenchmarkCase[],
  completed: ReadonlySet<string>,
): readonly V1IRequiredCell[] {
  return requiredV1ICells(mode, cases).filter((cell) => !completed.has(v1ICellKey(cell)));
}

export function assertNoDuplicateValidCells(observations: readonly V1IObservation[]): void {
  const seen = new Set<string>();
  for (const observation of observations) {
    if (!observation.valid) {
      continue;
    }
    const key = v1ICellKey(observation);
    if (seen.has(key)) {
      throw new Error(`duplicate valid v1I cell: ${key}`);
    }
    seen.add(key);
  }
}

export function summarizeV1IObservations(
  observations: readonly V1IObservation[],
  invalidAttempts: readonly V1IObservation[],
  expectedCells: number,
  mode: V1IMode,
  bootstrapSeed = V1I_BOOTSTRAP_SEED,
  requiredCells?: readonly V1IRequiredCell[],
): V1ISummary {
  assertNoDuplicateValidCells(observations);
  const armA = observations.filter((entry) => entry.arm === "A");
  const armB = observations.filter((entry) => entry.arm === "B");
  const metrics = (runs: readonly V1IObservation[]): V1IArmMetrics => {
    const executed = runs.filter((entry) => entry.firstExecutedTool !== null);
    const generic = executed.filter(
      (entry) => entry.firstExecutedTool === "exec" || entry.firstExecutedTool === "read",
    );
    const purposeBuilt = executed.filter(
      (entry) => !["exec", "read"].includes(entry.firstExecutedTool ?? ""),
    );
    const base = {
      validRuns: runs.length,
      executions: executed.length,
      top8Containment: mean(runs.map((entry) => containsTop8(entry))),
      successRate: mean(runs.map((entry) => (entry.terminalSuccess ? 1 : 0))),
      semanticSubstitutionRate: mean(runs.map((entry) => (entry.substituteTool ? 1 : 0))),
      substitutionWithoutPreferredAttemptRate: mean(
        runs.map((entry) => (entry.substitutionWithoutPreferredAttempt ? 1 : 0)),
      ),
      fallbackAfterPreferredFailureRate: mean(
        runs.map((entry) => (entry.fallbackAfterPreferredFailure ? 1 : 0)),
      ),
    } satisfies V1IArmMetrics;
    if (mode !== "synthetic") {
      return base;
    }
    return {
      ...base,
      purposeBuiltChoiceRate: mean(
        purposeBuilt.map(() => 1),
        runs.length,
      ),
      genericSubstituteRate: mean(
        generic.map(() => 1),
        runs.length,
      ),
      incorrectRelatedToolRate: mean(
        runs
          .filter(
            (entry) =>
              entry.substituteTool &&
              entry.substituteTool !== "exec" &&
              entry.substituteTool !== "read",
          )
          .map(() => 1),
        runs.length,
      ),
    };
  };
  const paired = new Map<string, { a: V1IObservation[]; b: V1IObservation[] }>();
  for (const observation of observations) {
    const bucket = paired.get(observation.caseId) ?? { a: [], b: [] };
    bucket[observation.arm === "A" ? "a" : "b"].push(observation);
    paired.set(observation.caseId, bucket);
  }
  const deltas = [...paired.values()]
    .filter((bucket) => bucket.a.length > 0 && bucket.b.length > 0)
    .map((bucket) => mean(bucket.b.map(containsTop8)) - mean(bucket.a.map(containsTop8)));
  const modal = modalAgreement(armA);
  const delta = mean(deltas);
  const interval = bootstrapInterval(deltas, bootstrapSeed);
  const integrityRegressions = observations.filter(
    (entry) => !entry.valid || entry.invalidReason !== null,
  ).length;
  const observedCells = new Set(observations.map(v1ICellKey));
  const requiredCellSet = requiredCells && new Set(requiredCells.map(v1ICellKey));
  const allRequiredCellsPresent =
    !requiredCellSet ||
    (requiredCellSet.size === observedCells.size &&
      [...requiredCellSet].every((cell) => observedCells.has(cell)));
  const expectedPairedCases = requiredCells
    ? new Set(requiredCells.map((cell) => cell.caseId)).size
    : undefined;
  const complete =
    observations.length === expectedCells &&
    allRequiredCellsPresent &&
    (expectedPairedCases === undefined || deltas.length === expectedPairedCases);
  const status = complete ? "COMPLETE" : "PARTIAL";
  return {
    status,
    result: !complete
      ? "NOT_CLASSIFIED"
      : mode === "real-adapter"
        ? "DESCRIPTIVE_ONLY"
        : classifyResult(mode, delta, interval[0], modal.mean, integrityRegressions, armA, armB),
    expectedCells,
    validRuns: observations.length,
    invalidAttempts: invalidAttempts.length,
    armAValidRuns: armA.length,
    armBValidRuns: armB.length,
    armA: metrics(armA),
    armB: metrics(armB),
    pairedCaseCount: deltas.length,
    meanPairedDelta: delta,
    meanPairedDeltaPercentagePoints: delta * 100,
    paired95CiLow: interval[0],
    paired95CiHigh: interval[1],
    bootstrapSeed,
    meanModalAgreement: modal.mean,
    casesThreeOfThree: modal.three,
    casesTwoOfThree: modal.two,
    casesOneOfThree: modal.one,
    noToolRunsIncludedInModalAgreement: modal.noToolRuns,
    integrityRegressions,
  };
}

export function createV1IArtifactState(
  root: string,
  manifest: V1IManifest,
  mode: V1IMode,
): V1IArtifactState {
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  let resolvedManifest = manifest;
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as V1IManifest;
    if (
      canonicalizeV1IValue(manifestCompatibility(existing)) !==
      canonicalizeV1IValue(manifestCompatibility(manifest))
    ) {
      throw new Error("incompatible v1I manifest; use a fresh artifact directory");
    }
    resolvedManifest = existing;
  } else {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const prefix = artifactPrefix(mode);
  const observations = readJsonl<V1IObservation>(path.join(root, `${prefix}-observations.jsonl`));
  const invalidAttempts = readJsonl<V1IObservation>(path.join(root, `${prefix}-invalid.jsonl`));
  assertNoDuplicateValidCells(observations);
  return { manifest: resolvedManifest, observations, invalidAttempts };
}

export function appendV1IObservation(
  root: string,
  mode: V1IMode,
  observation: V1IObservation,
): void {
  const prefix = artifactPrefix(mode);
  const filename = observation.valid ? `${prefix}-observations.jsonl` : `${prefix}-invalid.jsonl`;
  fs.appendFileSync(path.join(root, filename), `${JSON.stringify(observation)}\n`);
}

export function finalizeV1IArtifact(
  root: string,
  mode: V1IMode,
  state: V1IArtifactState,
  summary: V1ISummary,
): void {
  const prefix = artifactPrefix(mode);
  fs.writeFileSync(
    path.join(root, `${prefix}-observations.jsonl`),
    state.observations.map((entry) => JSON.stringify(entry)).join("\n") +
      (state.observations.length ? "\n" : ""),
  );
  fs.writeFileSync(
    path.join(root, `${prefix}-invalid.jsonl`),
    state.invalidAttempts.map((entry) => JSON.stringify(entry)).join("\n") +
      (state.invalidAttempts.length ? "\n" : ""),
  );
  fs.writeFileSync(
    path.join(root, `${prefix}-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(root, `${prefix}-summary.txt`), formatV1ISummary(summary));
}

function artifactPrefix(mode: V1IMode): string {
  return mode === "synthetic" ? "synthetic" : mode === "real-exact" ? "real-exact" : "real-adapter";
}

export function formatV1ISummary(summary: V1ISummary): string {
  return [
    `status=${summary.status}`,
    `result=${summary.result}`,
    `validRuns=${summary.validRuns}/${summary.expectedCells}`,
    `invalidAttempts=${summary.invalidAttempts}`,
    `armAContainment=${summary.armA.top8Containment}`,
    `armBContainment=${summary.armB.top8Containment}`,
    `pairedDeltaPP=${summary.meanPairedDeltaPercentagePoints}`,
    `paired95CI=${summary.paired95CiLow},${summary.paired95CiHigh}`,
    `meanModalAgreement=${summary.meanModalAgreement}`,
  ].join("\n");
}

function classifyResult(
  mode: V1IMode,
  delta: number,
  ciLow: number,
  modal: number,
  integrityRegressions: number,
  armA: readonly V1IObservation[],
  armB: readonly V1IObservation[],
): V1ISummary["result"] {
  if (mode === "real-adapter") {
    return "DESCRIPTIVE_ONLY";
  }
  const successA = mean(armA.map((entry) => (entry.terminalSuccess ? 1 : 0)));
  const successB = mean(armB.map((entry) => (entry.terminalSuccess ? 1 : 0)));
  if (
    delta >= 0.05 &&
    ciLow > 0 &&
    integrityRegressions === 0 &&
    Math.abs(successB - successA) < 0.05
  ) {
    return "INSTRUCTION_HYPOTHESIS_SUPPORTED";
  }
  if (Math.abs(delta) < 0.05 && modal >= 0.7) {
    return "STABLE_MODEL_CHOICE";
  }
  if (Math.abs(delta) < 0.05 && modal < 0.7) {
    return "STOCHASTIC_SUBSTITUTION";
  }
  return "INCONCLUSIVE";
}

function containsTop8(observation: V1IObservation): number {
  return observation.firstExecutedTool &&
    observation.v1cTop8.includes(observation.firstExecutedTool)
    ? 1
    : 0;
}

function modalAgreement(observations: readonly V1IObservation[]) {
  const byCase = new Map<string, V1IObservation[]>();
  for (const observation of observations) {
    const bucket = byCase.get(observation.caseId) ?? [];
    bucket.push(observation);
    byCase.set(observation.caseId, bucket);
  }
  const agreements: number[] = [];
  let three = 0;
  let two = 0;
  let one = 0;
  let noToolRuns = 0;
  for (const runs of byCase.values()) {
    const counts = new Map<string, number>();
    for (const run of runs) {
      const tool = run.firstExecutedTool ?? "<NO_TOOL>";
      if (tool === "<NO_TOOL>") {
        noToolRuns += 1;
      }
      counts.set(tool, (counts.get(tool) ?? 0) + 1);
    }
    const modal = Math.max(0, ...counts.values());
    agreements.push(modal / V1I_REPLICATES);
    if (modal === 3) {
      three += 1;
    } else if (modal === 2) {
      two += 1;
    } else {
      one += 1;
    }
  }
  return { mean: mean(agreements), three, two, one, noToolRuns };
}

function bootstrapInterval(values: readonly number[], seed: number): [number, number] {
  if (values.length === 0) {
    return [0, 0];
  }
  const samples: number[] = [];
  let state = seed >>> 0;
  for (const iteration of Array.from({ length: 2000 }, (_, index) => index)) {
    let total = 0;
    for (const fallback of values) {
      state = (Math.imul(state, 1664525) + 1013904223 + iteration) >>> 0;
      total += values[state % values.length] ?? fallback;
    }
    samples.push(total / values.length);
  }
  samples.sort((a, b) => a - b);
  return [
    samples[Math.floor(samples.length * 0.025)] ?? 0,
    samples[Math.floor(samples.length * 0.975)] ?? 0,
  ];
}

function mean(values: readonly number[], denominator = values.length): number {
  return denominator === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / denominator;
}

function manifestCompatibility(manifest: V1IManifest): Record<string, unknown> {
  return {
    schemaVersion: manifest.schemaVersion,
    experimentVersion: manifest.experimentVersion,
    harnessCommit: manifest.harnessCommit,
    branch: manifest.branch,
    modelId: manifest.modelId,
    provider: manifest.provider,
    contextLength: manifest.contextLength,
    modelConfigHash: manifest.modelConfigHash,
    rankerVersion: manifest.rankerVersion,
    qualificationPolicyVersion: manifest.qualificationPolicyVersion,
    scheduleSeed: manifest.scheduleSeed,
    caseSetHash: manifest.caseSetHash,
    syntheticCaseSetHash: manifest.syntheticCaseSetHash,
    realExactCaseSetHash: manifest.realExactCaseSetHash,
    realAdapterCaseSetHash: manifest.realAdapterCaseSetHash,
    syntheticSurfaceHash: manifest.syntheticSurfaceHash,
    realExactSurfaceHash: manifest.realExactSurfaceHash,
    realAdapterSurfaceHash: manifest.realAdapterSurfaceHash,
    schemaHash: manifest.schemaHash,
    systemPromptHash: manifest.systemPromptHash,
    experimentalInstructionHash: manifest.experimentalInstructionHash,
    activeFilteringEnabled: manifest.activeFilteringEnabled,
  };
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

function stringifyV1IValue(value: unknown, valuePath: string, stack: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`unsupported v1I hash value at ${valuePath}: non-finite number`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) {
      throw new TypeError(`unsupported v1I hash value at ${valuePath}: circular array`);
    }
    stack.add(value);
    try {
      return `[${value.map((entry, index) => stringifyV1IValue(entry, `${valuePath}[${index}]`, stack)).join(",")}]`;
    } finally {
      stack.delete(value);
    }
  }
  if (typeof value === "object") {
    if (stack.has(value)) {
      throw new TypeError(`unsupported v1I hash value at ${valuePath}: circular object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`unsupported v1I hash value at ${valuePath}: non-JSON object`);
    }
    stack.add(value);
    try {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).toSorted();
      const fields = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError(`unsupported v1I hash value at ${valuePath}.${key}: accessor`);
        }
        return `${JSON.stringify(key)}:${stringifyV1IValue(descriptor.value, `${valuePath}.${key}`, stack)}`;
      });
      return `{${fields.join(",")}}`;
    } finally {
      stack.delete(value);
    }
  }
  throw new TypeError(`unsupported v1I hash value at ${valuePath}: ${typeof value}`);
}
