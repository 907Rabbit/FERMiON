import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { withEnvAsync } from "../../test-utils/env.js";
import type { RunEmbeddedAgentParams } from "../embedded-agent-runner/run/params.js";
import type {
  PostResponseCheckpoint,
  PostResponseCounter,
  PostResponseHeartbeat,
  PostResponseSnapshot,
} from "../post-response-liveness.js";
import type { PreparedRuntimeAcquisitionHeartbeat } from "../prepared-runtime-acquisition-liveness.js";
import { getBenchmarkRealToolMapping } from "./benchmark-real-tool-mapping.js";
import {
  hashV1ICanonical,
  splitV1IExperimentSets,
  V1I_BOOTSTRAP_SEED,
  V1I_EXPERIMENT_VERSION,
  V1I_SCHEMA_VERSION,
  type V1IManifest,
  type V1IMappingClassification,
  type V1IMode,
  type V1IExperimentCheckpoint,
  type V1IObservation,
  type V1IRequestPreparationClass,
  type V1IRequestPreparationDiagnostics,
  type V1ISurfaceMode,
} from "./model-choice-experiment-evidence.js";
import { SHADOW_QUALIFICATION_POLICY_VERSION, SHADOW_RANKER_VERSION } from "./shadow-traffic.js";
import { createSyntheticBenchmarkToolHarness } from "./synthetic-benchmark-tools.js";
import {
  TOOL_RANKING_HELD_OUT_CASES,
  type ToolRankingBenchmarkCase,
} from "./tool-ranking-benchmark-cases.js";

export const MODEL_ID = "qwen/qwen3.5-9b";
export const PROVIDER = "lmstudio";
export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
export const CONTEXT_LENGTH = 262_144;
export const V1I_SMOKE_STAGE_TIMEOUTS_MS = {
  modelDiscovery: 30_000,
  runnerModuleImport: 60_000,
  workspaceSessionPreparation: 30_000,
  postBundleToPrompt: 30_000,
  requestPreparation: 30_000,
  providerFirstResponse: 120_000,
  toolExecution: 60_000,
  terminalCompletion: 60_000,
} as const;
export type V1ISmokeStage = keyof typeof V1I_SMOKE_STAGE_TIMEOUTS_MS;
export const ARM_B_INSTRUCTION = `## Tool choice
When multiple tools can perform a task, prefer the most specific purpose-built authorized tool.
Use generic tools such as exec or read as fallbacks when the purpose-built tool cannot perform the required operation.
Do not use a generic tool merely to reproduce functionality already provided directly by a more specific available tool.
If a purpose-built tool is unavailable, inadequate, or fails, a generic fallback is appropriate.`;
export const HARNESS_COMMIT = resolveRepositoryHarnessCommit();

export type Arm = "A" | "B";
export type MappingClass = V1IMappingClassification;

export class V1ISmokeTimeoutError extends Error {
  readonly timeoutStage: V1ISmokeStage;
  readonly timeoutMs: number;
  readonly lastSuccessfulCheckpoint: string;

  constructor(input: {
    timeoutStage: V1ISmokeStage;
    timeoutMs: number;
    lastSuccessfulCheckpoint: string;
  }) {
    super(`v1I smoke timed out during ${input.timeoutStage} after ${input.timeoutMs}ms`);
    this.name = "V1ISmokeTimeoutError";
    this.timeoutStage = input.timeoutStage;
    this.timeoutMs = input.timeoutMs;
    this.lastSuccessfulCheckpoint = input.lastSuccessfulCheckpoint;
  }
}

export function appendV1ISmokeCheckpoint(
  smokeRoot: string,
  checkpoint: { stage: string; [key: string]: unknown },
): void {
  fs.mkdirSync(smokeRoot, { recursive: true });
  fs.appendFileSync(
    path.join(smokeRoot, "smoke-checkpoints.jsonl"),
    `${JSON.stringify({ ...checkpoint, observedAt: new Date().toISOString() })}\n`,
  );
}

export type V1IAttemptCheckpointJournal = {
  record: (
    stage: string,
    details?: {
      modelTurnIndex?: number;
      providerAttempt?: number;
      lastKnownToolCallId?: string;
      elapsedMs?: number;
      expectedElapsedMs?: number;
      eventLoopDelayMs?: number;
      eventLoopDelayDetected?: boolean;
    },
  ) => void;
};

export class V1IAttemptCheckpointJournalError extends Error {
  readonly stage: string;

  constructor(stage: string, cause: unknown) {
    super(`v1I attempt checkpoint journal write failed at ${stage}`, { cause });
    this.name = "V1IAttemptCheckpointJournalError";
    this.stage = stage;
  }
}

export function createV1IAttemptCheckpointJournal(input: {
  root: string;
  attemptId: string;
  caseId: string;
  arm: Arm;
  replicate: number;
  attemptIndex: number;
}): V1IAttemptCheckpointJournal {
  fs.mkdirSync(input.root, { recursive: true });
  const journalPath = path.join(input.root, "attempt-checkpoints.jsonl");
  let sequenceNumber = 0;
  if (fs.existsSync(journalPath)) {
    try {
      const existing = fs.readFileSync(journalPath, "utf8").trim();
      for (const line of existing ? existing.split("\n") : []) {
        const record = JSON.parse(line) as { attemptId?: string; sequenceNumber?: number };
        if (record.attemptId === input.attemptId && typeof record.sequenceNumber === "number") {
          sequenceNumber = Math.max(sequenceNumber, record.sequenceNumber);
        }
      }
    } catch (error) {
      throw new V1IAttemptCheckpointJournalError("journal-read", error);
    }
  }
  return {
    record: (stage, details) => {
      const nextSequenceNumber = sequenceNumber + 1;
      const boundedStage = stage.slice(0, 96);
      const checkpoint = {
        attemptId: input.attemptId,
        caseId: input.caseId,
        arm: input.arm,
        replicate: input.replicate,
        attemptIndex: input.attemptIndex,
        timestamp: new Date().toISOString(),
        stage: boundedStage,
        sequenceNumber: nextSequenceNumber,
        ...(details?.modelTurnIndex === undefined
          ? {}
          : { modelTurnIndex: details.modelTurnIndex }),
        ...(details?.providerAttempt === undefined
          ? {}
          : { providerAttempt: details.providerAttempt }),
        ...(details?.lastKnownToolCallId === undefined
          ? {}
          : { lastKnownToolCallId: details.lastKnownToolCallId.slice(0, 128) }),
        ...(details?.elapsedMs === undefined ? {} : { elapsedMs: details.elapsedMs }),
        ...(details?.expectedElapsedMs === undefined
          ? {}
          : { expectedElapsedMs: details.expectedElapsedMs }),
        ...(details?.eventLoopDelayMs === undefined
          ? {}
          : { eventLoopDelayMs: details.eventLoopDelayMs }),
        ...(details?.eventLoopDelayDetected === undefined
          ? {}
          : { eventLoopDelayDetected: details.eventLoopDelayDetected }),
      };
      try {
        fs.appendFileSync(journalPath, `${JSON.stringify(checkpoint)}\n`);
      } catch (error) {
        throw new V1IAttemptCheckpointJournalError(boundedStage, error);
      }
      sequenceNumber = nextSequenceNumber;
    },
  };
}

export function createV1ISmokeDeadline(input: {
  onTimeout: (error: V1ISmokeTimeoutError) => void;
  timeouts?: Partial<Record<V1ISmokeStage, number>>;
}): {
  signal: AbortSignal;
  enter: (stage: V1ISmokeStage, checkpoint: string) => void;
  timeoutPromise: Promise<never>;
  readTimeout: () => V1ISmokeTimeoutError | undefined;
  dispose: () => void;
} {
  const controller = new AbortController();
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSuccessfulCheckpoint = "none";
  let timeoutError: V1ISmokeTimeoutError | undefined;
  let rejectTimeout!: (error: V1ISmokeTimeoutError) => void;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const enter = (stage: V1ISmokeStage, checkpoint: string) => {
    if (timeoutError) {
      return;
    }
    if (activeTimer) {
      clearTimeout(activeTimer);
    }
    lastSuccessfulCheckpoint = checkpoint;
    const timeoutMs = input.timeouts?.[stage] ?? V1I_SMOKE_STAGE_TIMEOUTS_MS[stage];
    activeTimer = setTimeout(() => {
      timeoutError = new V1ISmokeTimeoutError({
        timeoutStage: stage,
        timeoutMs,
        lastSuccessfulCheckpoint,
      });
      input.onTimeout(timeoutError);
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, timeoutMs);
  };
  return {
    signal: controller.signal,
    enter,
    timeoutPromise,
    readTimeout: () => timeoutError,
    dispose: () => {
      if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = undefined;
      }
    },
  };
}

export async function runV1ISmokeStage<T>(input: {
  stage: V1ISmokeStage;
  operation: (signal: AbortSignal) => Promise<T>;
  onTimeout?: (error: V1ISmokeTimeoutError) => void;
  timeoutMs?: number;
}): Promise<T> {
  const deadline = createV1ISmokeDeadline({
    onTimeout: input.onTimeout ?? (() => {}),
    ...(input.timeoutMs === undefined ? {} : { timeouts: { [input.stage]: input.timeoutMs } }),
  });
  deadline.enter(input.stage, `${input.stage}-started`);
  const operation = input.operation(deadline.signal);
  try {
    return await Promise.race([operation, deadline.timeoutPromise]);
  } finally {
    deadline.dispose();
  }
}

export function smokeStageForCheckpoint(stage: string): V1ISmokeStage | undefined {
  if (stage === "runner-module-import-started") {
    return "runnerModuleImport";
  }
  if (stage === "runner-module-import-completed") {
    return "workspaceSessionPreparation";
  }
  if (
    stage === "runner-entry" ||
    stage === "session-target-resolution-entered" ||
    stage === "runtime-preparation-entered" ||
    stage === "prepared-runtime-acquisition-entered" ||
    stage === "prepared-runtime-acquisition-requested" ||
    stage === "prepared-runtime-cache-check-entered" ||
    stage === "prepared-runtime-cache-check-complete" ||
    stage === "prepared-runtime-build-entered" ||
    stage === "prepared-runtime-build-complete" ||
    stage === "prepared-runtime-plugin-prep-entered" ||
    stage === "prepared-runtime-plugin-prep-complete"
  ) {
    return "workspaceSessionPreparation";
  }
  if (
    stage === "session-target-resolution-completed" ||
    stage === "prepared-runtime-acquisition-completed" ||
    stage === "runtime-preparation-completed" ||
    stage === "attempt-dispatch-entered" ||
    stage === "client-preparation-entered" ||
    stage === "client-preparation-completed"
  ) {
    return "requestPreparation";
  }
  if (
    stage === "attempt-bundle-completed" ||
    stage === "attempt-tool-catalog-entered" ||
    stage === "attempt-tool-catalog-completed" ||
    stage === "attempt-system-prompt-entered" ||
    stage === "attempt-system-prompt-completed" ||
    stage === "attempt-transcript-lifecycle-entered" ||
    stage === "attempt-transcript-lifecycle-completed" ||
    stage === "attempt-session-runtime-entered" ||
    stage === "attempt-session-runtime-completed" ||
    stage === "attempt-execution-phase-entered" ||
    stage === "attempt-history-preparation-entered" ||
    stage === "attempt-history-preparation-completed" ||
    stage === "prompt-dispatch-started"
  ) {
    return "postBundleToPrompt";
  }
  if (
    stage === "prompt-phase-entered" ||
    stage === "prompt-tool-surface-completed" ||
    stage === "provider-adapter-entered" ||
    stage === "prompt-preflight-entered" ||
    stage === "prompt-preflight-completed" ||
    stage === "model-loop-entered" ||
    stage === "prompt-submission-completed"
  ) {
    return "requestPreparation";
  }
  if (stage === "provider-request-constructed") {
    return "providerFirstResponse";
  }
  if (stage === "provider-response-received") {
    return "terminalCompletion";
  }
  if (stage === "tool-execution-finished") {
    return "terminalCompletion";
  }
  return undefined;
}

// Synthetic v1I supplies its complete client surface directly. Avoid cold bundled-extension
// discovery in this experiment-only path; production Gateway startup remains unchanged.
export function withSyntheticModelChoiceEnvironment<T>(fn: () => Promise<T>): Promise<T> {
  return withEnvAsync({ OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1" }, fn);
}

export type ExperimentDiagnostics = {
  checkpoints: V1IExperimentCheckpoint[];
  preparedRuntimeAcquisitionHeartbeats: PreparedRuntimeAcquisitionHeartbeat[];
  postResponseCheckpoints: PostResponseCheckpoint[];
  postResponseHeartbeats: PostResponseHeartbeat[];
  postResponseSnapshots: PostResponseSnapshot[];
  postResponseCounters: PostResponseCounter[];
  readFailure: () => V1IRequestPreparationDiagnostics["failure"];
  hooks: NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>;
};

export function createExperimentDiagnostics(): ExperimentDiagnostics {
  const checkpoints: V1IExperimentCheckpoint[] = [];
  const preparedRuntimeAcquisitionHeartbeats: PreparedRuntimeAcquisitionHeartbeat[] = [];
  const postResponseCheckpoints: PostResponseCheckpoint[] = [];
  const postResponseHeartbeats: PostResponseHeartbeat[] = [];
  const postResponseSnapshots: PostResponseSnapshot[] = [];
  const postResponseCounters: PostResponseCounter[] = [];
  const startedAt = performance.now();
  let failure: V1IRequestPreparationDiagnostics["failure"];
  const hooks: NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]> = {
    onCheckpoint: (checkpoint) => {
      checkpoints.push({
        stage: checkpoint.stage,
        toolCount: checkpoint.toolCount,
        representativeToolNames: [...checkpoint.representativeToolNames],
        observedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    },
    onRequestPreparationError: ({ error, stage }) => {
      failure ??= serializeRequestPreparationFailure(error, stage);
    },
    onPreparedRuntimeAcquisitionHeartbeat: (heartbeat) => {
      preparedRuntimeAcquisitionHeartbeats.push(heartbeat);
    },
    onPostResponseCheckpoint: (checkpoint) => {
      postResponseCheckpoints.push({
        ...checkpoint,
        observedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    },
    onPostResponseHeartbeat: (heartbeat) => {
      postResponseHeartbeats.push(heartbeat);
    },
    onPostResponseSnapshot: (snapshot) => {
      postResponseSnapshots.push(snapshot);
    },
    onPostResponseCounter: (counter) => {
      postResponseCounters.push(counter);
    },
  };
  return {
    checkpoints,
    preparedRuntimeAcquisitionHeartbeats,
    postResponseCheckpoints,
    postResponseHeartbeats,
    postResponseSnapshots,
    postResponseCounters,
    readFailure: () => failure,
    hooks,
  };
}

function serializeRequestPreparationFailure(
  error: unknown,
  failureStage: string,
): NonNullable<V1IRequestPreparationDiagnostics["failure"]> {
  const errorName = error instanceof Error ? error.name : "NonErrorThrown";
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? (error.stack ?? null) : null;
  const frame = errorStack
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at "));
  const parsedFrame = frame ? parseStackFrame(frame) : undefined;
  return {
    errorName,
    errorMessage,
    errorStack,
    failureFile: parsedFrame?.file ?? null,
    failureFunction: parsedFrame?.functionName ?? null,
    failureStage,
  };
}

function parseStackFrame(frame: string): { file?: string; functionName?: string } | undefined {
  const withFunction = /^at (.+) \((.+):\d+:\d+\)$/.exec(frame);
  if (withFunction) {
    return { functionName: withFunction[1], file: withFunction[2] };
  }
  const withoutFunction = /^at (.+):\d+:\d+$/.exec(frame);
  return withoutFunction ? { file: withoutFunction[1] } : undefined;
}

export function classifyRequestPreparationFailure(
  failure: V1IRequestPreparationDiagnostics["failure"],
): V1IRequestPreparationClass | null {
  if (!failure) {
    return null;
  }
  const message =
    `${failure.errorName} ${failure.errorMessage} ${failure.failureStage}`.toLowerCase();
  if (message.includes("client tool") || message.includes("clienttools")) {
    return "CLIENT_TOOL_VALIDATION_ERROR";
  }
  if (message.includes("attempt-bundle") || message.includes("attempt bundle")) {
    return "ATTEMPT_BUNDLE_ERROR";
  }
  if (message.includes("prompt")) {
    return "PROMPT_PREPARATION_ERROR";
  }
  if (message.includes("schema") || message.includes("tool definition")) {
    return "TOOL_SCHEMA_CONVERSION_ERROR";
  }
  if (message.includes("provider") || message.includes("request")) {
    return "PROVIDER_REQUEST_BUILD_ERROR";
  }
  return "OTHER_REQUEST_PREPARATION_ERROR";
}

export function assertSyntheticSmokePassed(): void {
  const smokeRoot = path.resolve(
    process.env.OPENCLAW_V1I_SMOKE_ARTIFACT_DIR ?? "artifacts/capability-intelligence/v1i-smoke",
  );
  const resultPath = path.join(smokeRoot, "smoke-result.json");
  if (!fs.existsSync(resultPath)) {
    throw new Error(
      `PREPARED_NOT_STARTED: synthetic smoke artifact is missing at ${resultPath}; run the one-cell smoke first`,
    );
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("PREPARED_NOT_STARTED: synthetic smoke artifact is not a JSON object");
  }
  const result = parsed;
  if (
    result.status !== "PASS" ||
    result.harnessCommit !== HARNESS_COMMIT ||
    result.modelConfigHash !== hashV1ICanonical(modelConfigIdentity()) ||
    result.activeFilteringEnabled !== false ||
    result.observationValid !== true
  ) {
    throw new Error("PREPARED_NOT_STARTED: synthetic smoke artifact is not a matching pass");
  }
}

export function buildSyntheticRunnerOverrides(
  harness: ReturnType<typeof createSyntheticBenchmarkToolHarness>,
): Pick<RunEmbeddedAgentParams, "clientTools" | "clientToolsOnly" | "disableTools"> {
  return { clientTools: [...harness.clientTools], clientToolsOnly: true, disableTools: true };
}

export function resolveRepositoryHarnessCommit(): string {
  const explicit = process.env.OPENCLAW_V1I_HARNESS_COMMIT;
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const sourceStatus = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--", "src"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return resolveHarnessCommit({ explicit, head, sourceDirty: sourceStatus.trim().length > 0 });
  } catch {
    return resolveHarnessCommit({ explicit, sourceDirty: true });
  }
}

export function resolveHarnessCommit(input: {
  explicit?: string;
  head?: string;
  sourceDirty: boolean;
}): string {
  if (input.explicit?.trim()) {
    return input.explicit.trim();
  }
  return !input.sourceDirty && input.head?.trim() ? input.head.trim() : "uncommitted-harness";
}

export function buildManifest(sets: ReturnType<typeof splitV1IExperimentSets>): V1IManifest {
  const modelConfig = modelConfigIdentity();
  const caseHash = (entries: readonly ToolRankingBenchmarkCase[]) =>
    hashV1ICanonical(
      entries.map((entry) => ({ id: entry.id, query: entry.query, tools: entry.tools })),
    );
  const surfaceHash = (entries: readonly ToolRankingBenchmarkCase[]) =>
    hashV1ICanonical(
      [...new Set(entries.flatMap((entry) => entry.tools.map((tool) => tool.name)))].toSorted(),
    );
  return {
    schemaVersion: V1I_SCHEMA_VERSION,
    experimentVersion: V1I_EXPERIMENT_VERSION,
    harnessCommit: HARNESS_COMMIT,
    branch: process.env.OPENCLAW_V1I_BRANCH ?? "capability-intelligence-next",
    modelId: MODEL_ID,
    provider: PROVIDER,
    contextLength: CONTEXT_LENGTH,
    modelConfig,
    modelConfigHash: hashV1ICanonical(modelConfig),
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    scheduleSeed: V1I_BOOTSTRAP_SEED,
    caseSetHash: caseHash(TOOL_RANKING_HELD_OUT_CASES),
    syntheticCaseSetHash: caseHash(sets.synthetic),
    realExactCaseSetHash: caseHash(sets.realExact),
    realAdapterCaseSetHash: caseHash(sets.realAdapter),
    syntheticSurfaceHash: surfaceHash(sets.synthetic),
    realExactSurfaceHash: surfaceHash(sets.realExact),
    realAdapterSurfaceHash: surfaceHash(sets.realAdapter),
    schemaHash: hashV1ICanonical({
      synthetic: sets.synthetic.map((entry) => entry.id),
      realExact: sets.realExact.map((entry) => entry.id),
      realAdapter: sets.realAdapter.map((entry) => entry.id),
    }),
    systemPromptHash: sha256("runtime-system-prompt-captured-per-run"),
    experimentalInstructionHash: sha256(ARM_B_INSTRUCTION),
    startedAt: new Date().toISOString(),
    completedAt: null,
    activeFilteringEnabled: false,
  };
}

export function modelConfigIdentity(): Record<string, unknown> {
  return {
    provider: PROVIDER,
    model: MODEL_ID,
    baseUrl: LM_STUDIO_BASE_URL,
    api: "openai-completions",
    contextLength: CONTEXT_LENGTH,
    maxTokens: 512,
    temperature: null,
    topP: null,
    seed: null,
  };
}

export type InvalidObservationInput = {
  mode: V1IMode;
  surfaceMode: V1ISurfaceMode;
  benchmarkCase: ToolRankingBenchmarkCase;
  mappingClass: MappingClass;
  authorizedNames: readonly string[];
  v1cTop8: readonly string[];
  arm: Arm;
  replicate: number;
  attempt: number;
  scheduleSeed: number;
  reason: string;
};

export async function runV1IAttempt(
  input: Omit<InvalidObservationInput, "reason">,
  execute: () => Promise<V1IObservation>,
  onObservation: (observation: V1IObservation) => void,
): Promise<V1IObservation> {
  let observation: V1IObservation;
  try {
    observation = await execute();
  } catch (error) {
    if (error instanceof V1IAttemptCheckpointJournalError) {
      throw error;
    }
    observation = makeInvalidObservationForError(input, error);
  }
  onObservation(observation);
  return observation;
}

function makeInvalidObservationForError(
  input: Omit<InvalidObservationInput, "reason">,
  error: unknown,
): V1IObservation {
  return makeInvalidObservation({ ...input, reason: classifyAttemptError(error) });
}

export function makeInvalidObservation(input: InvalidObservationInput): V1IObservation {
  const preferredBenchmarkTool = input.benchmarkCase.expectedTopTools[0] ?? "";
  const mappedRealTool =
    input.mode === "synthetic"
      ? preferredBenchmarkTool
      : getBenchmarkRealToolMapping(preferredBenchmarkTool).realTool;
  const now = new Date().toISOString();
  return {
    schemaVersion: V1I_SCHEMA_VERSION,
    experimentVersion: V1I_EXPERIMENT_VERSION,
    harnessCommit: HARNESS_COMMIT,
    surfaceMode: input.surfaceMode,
    caseId: input.benchmarkCase.id,
    arm: input.arm,
    replicate: input.replicate,
    attempt: input.attempt,
    scheduleSeed: input.scheduleSeed,
    modelId: MODEL_ID,
    provider: PROVIDER,
    contextLength: CONTEXT_LENGTH,
    modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
    systemPromptHash: sha256(""),
    userPromptHash: sha256(input.benchmarkCase.query),
    experimentalInstructionHash: sha256(input.arm === "B" ? ARM_B_INSTRUCTION : ""),
    authorizedSurfaceHash: hashV1ICanonical(input.authorizedNames),
    schemaHash: hashV1ICanonical(input.authorizedNames),
    caseSetHash: frozenCaseSetHash(),
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    rankingEpoch: null,
    benchmarkPreferredTool: preferredBenchmarkTool,
    mappedRealTool,
    mappingClassification: input.mappingClass,
    v1cTop8: input.v1cTop8,
    selectedTools: [],
    firstExecutedTool: null,
    executedToolSequence: [],
    terminalSuccess: false,
    terminalFailureReason: input.reason,
    preferredToolAuthorized:
      mappedRealTool !== null && input.authorizedNames.includes(mappedRealTool),
    preferredToolInTop8: mappedRealTool !== null && input.v1cTop8.includes(mappedRealTool),
    preferredToolAttempted: false,
    substituteTool: null,
    substitutionWithoutPreferredAttempt: false,
    fallbackAfterPreferredFailure: false,
    valid: false,
    invalidReason: input.reason,
    startTime: now,
    endTime: now,
  };
}

export function makeTestInvalidObservationInput(): Omit<InvalidObservationInput, "reason"> {
  const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
  if (!benchmarkCase) {
    throw new Error("held-out corpus is empty");
  }
  return {
    mode: "synthetic",
    surfaceMode: "SYNTHETIC",
    benchmarkCase,
    mappingClass: "SYNTHETIC",
    authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
    v1cTop8: benchmarkCase.expectedTopTools,
    arm: "A",
    replicate: 1,
    attempt: 1,
    scheduleSeed: 1,
  };
}

function classifyAttemptError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("fetch") || message.includes("provider")
    ? "PROVIDER_ERROR"
    : "HARNESS_ERROR";
}

export function orderedArms(seed: number): readonly Arm[] {
  return seed % 2 === 0 ? ["A", "B"] : ["B", "A"];
}

export function scheduleSeedFor(caseId: string, replicate: number): number {
  return Number.parseInt(sha256(`${caseId}:${replicate}`).slice(0, 8), 16);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function frozenCaseSetHash(): string {
  return hashV1ICanonical(
    TOOL_RANKING_HELD_OUT_CASES.map((entry) => ({
      id: entry.id,
      query: entry.query,
      tools: entry.tools,
    })),
  );
}
