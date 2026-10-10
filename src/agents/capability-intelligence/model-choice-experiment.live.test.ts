import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  EmbeddedAgentRunResult,
  RunEmbeddedAgentParams,
} from "../embedded-agent-runner/types.js";
import {
  getBenchmarkRealToolMapping,
  summarizeBenchmarkRealToolMappings,
  type BenchmarkCaseEligibility,
} from "./benchmark-real-tool-mapping.js";
import type { EmbeddedReplayFact } from "./embedded-replay-observation.js";
import {
  appendV1IObservation,
  assertNoDuplicateValidCells,
  createV1IArtifactState,
  expectedCellsForV1IMode,
  finalizeV1IArtifact,
  resolveV1IMode,
  splitV1IExperimentSets,
  summarizeV1IObservations,
  surfaceModeForV1IMode,
  v1ICellKey,
  V1I_EXPERIMENT_VERSION,
  V1I_SCHEMA_VERSION,
  V1I_BOOTSTRAP_SEED,
  type V1IManifest,
  type V1IMappingClassification,
  type V1IMode,
  type V1IObservation,
  type V1ISurfaceMode,
} from "./model-choice-experiment-evidence.js";
import { rankAgentTools } from "./rank-agent-tools.js";
import {
  ACTIVE_FILTERING_ENABLED,
  SHADOW_QUALIFICATION_POLICY_VERSION,
  SHADOW_RANKER_VERSION,
} from "./shadow-traffic.js";
import { createSyntheticBenchmarkToolHarness } from "./synthetic-benchmark-tools.js";
import {
  TOOL_RANKING_HELD_OUT_CASES,
  type ToolRankingBenchmarkCase,
} from "./tool-ranking-benchmark-cases.js";

const LIVE = process.env.OPENCLAW_V1I_LIVE_TEST === "1";
const MODEL_ID = "qwen/qwen3.5-9b";
const PROVIDER = "lmstudio";
const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
const CONTEXT_LENGTH = 262_144;
const HARNESS_COMMIT = process.env.OPENCLAW_V1I_HARNESS_COMMIT ?? "uncommitted-harness";
const ARM_B_INSTRUCTION = `## Tool choice
When multiple tools can perform a task, prefer the most specific purpose-built authorized tool.
Use generic tools such as exec or read as fallbacks when the purpose-built tool cannot perform the required operation.
Do not use a generic tool merely to reproduce functionality already provided directly by a more specific available tool.
If a purpose-built tool is unavailable, inadequate, or fails, a generic fallback is appropriate.`;
type Arm = "A" | "B";
type MappingClass = V1IMappingClassification;

type CapturedModelRequest = {
  body: Record<string, unknown>;
  url: string;
};

type ExperimentRun = V1IObservation;

type ModelPayloadCapture = {
  requests: CapturedModelRequest[];
  restore: () => void;
};

const describeLive = LIVE ? describe : describe.skip;
const LIVE_MODE = resolveV1IMode(LIVE, process.env.OPENCLAW_V1I_MODE);

describe("v1I model-choice experiment preparation", () => {
  it("keeps both experimental surfaces explicit and diagnostic-only", () => {
    expect(ACTIVE_FILTERING_ENABLED).toBe(false);
    const summary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
    const syntheticTools = new Set(
      TOOL_RANKING_HELD_OUT_CASES.flatMap((entry) => entry.tools.map((tool) => tool.name)),
    );
    const firstCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!firstCase) {
      throw new Error("held-out corpus is empty");
    }
    const harness = createSyntheticBenchmarkToolHarness(firstCase);
    expect(summary.totalCases).toBe(17);
    expect(summary.exactOnlyCases + summary.exactPlusAdapterCases + summary.unsupportedCases).toBe(
      17,
    );
    expect(new Set(harness.clientTools.map((tool) => tool.function.name))).toEqual(
      new Set(firstCase.tools.map((tool) => tool.name)),
    );
    expect(syntheticTools.size).toBeGreaterThan(0);
    expect(JSON.stringify(harness.clientTools)).not.toMatch(
      /requiredTools|relevantTools|expectedOutcome|toolRoles|rank/i,
    );
  });
});

describeLive("v1I model-choice experiment live", () => {
  it(
    "runs one explicitly selected evidence stratum without pooling",
    { timeout: 3_600_000 },
    async () => {
      expect(ACTIVE_FILTERING_ENABLED).toBe(false);
      const mode = LIVE_MODE;
      if (!mode) {
        throw new Error("v1I live mode was not resolved");
      }
      const mappingSummary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
      const sets = splitV1IExperimentSets(TOOL_RANKING_HELD_OUT_CASES, mappingSummary);
      const cases =
        mode === "synthetic"
          ? sets.synthetic
          : mode === "real-exact"
            ? sets.realExact
            : sets.realAdapter;
      const mappingByCase = new Map(
        mappingSummary.cases
          .filter((entry) => cases.some((benchmarkCase) => benchmarkCase.id === entry.caseId))
          .map((entry) => [entry.caseId, entry]),
      );
      expect(cases).toHaveLength(mode === "synthetic" ? 17 : mode === "real-exact" ? 8 : 3);
      expect(expectedCellsForV1IMode(mode)).toBe(cases.length * 2 * 3);
      const artifactRoot = path.resolve(
        process.env.OPENCLAW_V1I_ARTIFACT_DIR ?? "artifacts/capability-intelligence/v1i",
      );
      const manifest = buildManifest(sets);
      const state = createV1IArtifactState(artifactRoot, manifest, mode);
      const completedCells = new Set(state.observations.map(v1ICellKey));
      const nextAttemptByCell = new Map(
        state.invalidAttempts.map((observation) => [
          v1ICellKey(observation),
          observation.attempt + 1,
        ]),
      );
      await assertLiveModelAvailable();
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-"));
      const config = buildLiveConfig(workspaceDir);
      try {
        const newRuns = await runStratum({
          mode,
          surfaceMode: surfaceModeForV1IMode(mode),
          cases,
          mappingByCase,
          config,
          workspaceDir,
          completedCells,
          nextAttemptByCell,
          onObservation: (observation) => {
            appendV1IObservation(artifactRoot, mode, observation);
            if (observation.valid) {
              state.observations.push(observation);
            } else {
              state.invalidAttempts.push(observation);
            }
          },
        });
        const summary = summarizeV1IObservations(
          state.observations,
          state.invalidAttempts,
          expectedCellsForV1IMode(mode),
          mode,
        );
        state.manifest.completedAt = new Date().toISOString();
        fs.writeFileSync(
          path.join(artifactRoot, "manifest.json"),
          `${JSON.stringify(state.manifest, null, 2)}\n`,
        );
        finalizeV1IArtifact(artifactRoot, mode, state, summary);
        const combinedIndexPath = path.join(artifactRoot, "combined-index.json");
        const combinedIndex = fs.existsSync(combinedIndexPath)
          ? (JSON.parse(fs.readFileSync(combinedIndexPath, "utf8")) as Record<string, unknown>)
          : { manifest };
        combinedIndex[mode] = { summary, newRuns: newRuns.length };
        fs.writeFileSync(combinedIndexPath, `${JSON.stringify(combinedIndex, null, 2)}\n`);
        assertNoDuplicateValidCells(state.observations);
        console.log(JSON.stringify({ mode, summary, newRuns: newRuns.length }));
        expect(state.observations.length).toBeLessThanOrEqual(expectedCellsForV1IMode(mode));
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    },
  );
});

async function runStratum(input: {
  mode: V1IMode;
  surfaceMode: V1ISurfaceMode;
  cases: readonly ToolRankingBenchmarkCase[];
  mappingByCase: ReadonlyMap<string, BenchmarkCaseEligibility>;
  config: OpenClawConfig;
  workspaceDir: string;
  completedCells: ReadonlySet<string>;
  nextAttemptByCell: ReadonlyMap<string, number>;
  onObservation: (observation: ExperimentRun) => void;
}): Promise<ExperimentRun[]> {
  const runs: ExperimentRun[] = [];
  for (const benchmarkCase of input.cases) {
    const eligibility = input.mappingByCase.get(benchmarkCase.id);
    const mappingClass: MappingClass =
      input.mode === "synthetic"
        ? "SYNTHETIC"
        : eligibility?.mappingClass === "EXACT"
          ? "EXACT"
          : "ADAPTER";
    if (input.mode !== "synthetic" && (!eligibility || eligibility.mappingClass !== mappingClass)) {
      throw new Error(`invalid mapping for ${input.mode}: ${benchmarkCase.id}`);
    }
    const authorizedNames =
      input.mode === "synthetic"
        ? benchmarkCase.tools.map((tool) => tool.name)
        : [...(eligibility?.mappedTools ?? [])];
    const v1cTools =
      input.mode === "synthetic"
        ? benchmarkCase.tools
        : authorizedNames.map((name) => ({ name, description: `OpenClaw ${name} capability` }));
    const v1cTop8 = rankTop8(v1cTools, benchmarkCase.query);
    for (let replicate = 1; replicate <= 3; replicate += 1) {
      const scheduleSeed = scheduleSeedFor(benchmarkCase.id, replicate);
      for (const arm of orderedArms(scheduleSeed)) {
        const cell = {
          surfaceMode: input.surfaceMode,
          caseId: benchmarkCase.id,
          arm,
          replicate,
        } as const;
        if (
          input.completedCells.has(
            `${cell.surfaceMode}:${cell.caseId}:${cell.arm}:${cell.replicate}`,
          )
        ) {
          continue;
        }
        let observation: ExperimentRun;
        try {
          observation = await runOne({
            mode: input.mode,
            surfaceMode: input.surfaceMode,
            benchmarkCase,
            eligibility,
            mappingClass,
            authorizedNames,
            v1cTop8,
            arm,
            replicate,
            scheduleSeed,
            attempt:
              input.nextAttemptByCell.get(
                `${cell.surfaceMode}:${cell.caseId}:${cell.arm}:${cell.replicate}`,
              ) ?? 1,
            config: input.config,
            workspaceDir: input.workspaceDir,
          });
        } catch (error) {
          observation = makeInvalidObservation({
            mode: input.mode,
            surfaceMode: input.surfaceMode,
            benchmarkCase,
            mappingClass,
            authorizedNames,
            v1cTop8,
            arm,
            replicate,
            scheduleSeed,
            attempt:
              input.nextAttemptByCell.get(
                `${cell.surfaceMode}:${cell.caseId}:${cell.arm}:${cell.replicate}`,
              ) ?? 1,
            reason: classifyAttemptError(error),
          });
        }
        runs.push(observation);
        input.onObservation(observation);
      }
    }
  }
  return runs;
}

async function runOne(input: {
  mode: V1IMode;
  surfaceMode: V1ISurfaceMode;
  benchmarkCase: ToolRankingBenchmarkCase;
  eligibility?: BenchmarkCaseEligibility;
  mappingClass: MappingClass;
  authorizedNames: readonly string[];
  v1cTop8: readonly string[];
  arm: Arm;
  replicate: number;
  attempt: number;
  scheduleSeed: number;
  config: OpenClawConfig;
  workspaceDir: string;
}): Promise<ExperimentRun> {
  const harness =
    input.mode === "synthetic"
      ? createSyntheticBenchmarkToolHarness(input.benchmarkCase)
      : undefined;
  const capture = captureModelPayloads();
  const startTime = new Date().toISOString();
  let observedRanking: Extract<EmbeddedReplayFact, { kind: "ranking" }> | undefined;
  let observedFailure = false;
  let execution:
    | Awaited<ReturnType<typeof import("./embedded-replay-runtime.js").runEmbeddedReplay>>
    | undefined;
  try {
    const { runEmbeddedReplay } = await import("./embedded-replay-runtime.js");
    const { runEmbeddedAgent } = await import("../embedded-agent-runner/run-orchestrator.js");
    const runner = async (params: RunEmbeddedAgentParams): Promise<EmbeddedAgentRunResult> => {
      const originalFactListener = params.onEmbeddedReplayFact;
      const originalResultListener = params.onAgentToolResult;
      const result = await runEmbeddedAgent({
        ...params,
        ...(harness ? { clientTools: [...harness.clientTools], disableTools: true } : {}),
        ...(input.arm === "B" ? { extraSystemPrompt: ARM_B_INSTRUCTION } : {}),
        onEmbeddedReplayFact: (fact) => {
          if (fact.kind === "ranking") {
            observedRanking = fact;
          }
          originalFactListener?.(fact);
        },
        onAgentToolResult: (event) => {
          observedFailure ||= event.isError;
          originalResultListener?.(event);
        },
      });
      if (harness && observedRanking) {
        for (const call of result.meta.pendingToolCalls ?? []) {
          originalFactListener?.({
            kind: "terminal",
            epoch: observedRanking.epoch,
            turnId: observedRanking.turnId,
            toolName: call.name,
            executionStarted: true,
            outcome: "success",
          });
        }
      }
      return result;
    };
    execution = await runEmbeddedReplay({
      request: {
        runId: `v1i-${input.surfaceMode.toLowerCase()}-${input.benchmarkCase.id}-${input.arm}-${input.replicate}`,
        turnId: "turn-1",
        caseId: input.benchmarkCase.id,
        prompt: input.benchmarkCase.query,
        authorizedToolNames: input.authorizedNames,
      },
      options: {
        workspaceDir: input.workspaceDir,
        timeoutMs: 120_000,
        provider: PROVIDER,
        model: MODEL_ID,
        config: input.config,
        runner,
      },
    });
  } finally {
    capture.restore();
  }
  const completedExecution = execution;
  if (!completedExecution) {
    throw new Error("v1I run did not produce an execution result");
  }
  const requestBodies = capture.requests.map((request) => request.body);
  const firstBody = requestBodies[0] ?? {};
  const executedToolSequence = completedExecution.result.executedTools
    .filter((tool) => tool.executionStarted)
    .map((tool) => tool.name);
  const preferredBenchmarkTool = input.benchmarkCase.expectedTopTools[0] ?? "";
  const preferredMapping = getBenchmarkRealToolMapping(preferredBenchmarkTool);
  const mappedRealTool =
    input.mode === "synthetic" ? preferredBenchmarkTool : preferredMapping.realTool;
  const firstExecutedTool = executedToolSequence[0] ?? null;
  const valid =
    completedExecution.status === "completed" &&
    Boolean(observedRanking?.epoch) &&
    requestBodies.length > 0 &&
    sameSurfaceAcrossRequests(requestBodies) &&
    sameSurfaceAsExpected(firstBody, input.authorizedNames) &&
    sameSchemaAcrossRequests(requestBodies);
  const terminalSuccess = completedExecution.result.terminal === "success";
  const preferredToolAuthorized =
    mappedRealTool !== null && input.authorizedNames.includes(mappedRealTool);
  const preferredToolInTop8 = mappedRealTool !== null && input.v1cTop8.includes(mappedRealTool);
  const preferredToolAttempted =
    mappedRealTool !== null && executedToolSequence.includes(mappedRealTool);
  const substitutionWithoutPreferredAttempt = Boolean(
    firstExecutedTool && firstExecutedTool !== mappedRealTool && !preferredToolAttempted,
  );
  const endTime = new Date().toISOString();
  return {
    surfaceMode: input.surfaceMode,
    schemaVersion: V1I_SCHEMA_VERSION,
    experimentVersion: V1I_EXPERIMENT_VERSION,
    harnessCommit: HARNESS_COMMIT,
    caseId: input.benchmarkCase.id,
    arm: input.arm,
    replicate: input.replicate,
    attempt: input.attempt,
    scheduleSeed: input.scheduleSeed,
    modelId: MODEL_ID,
    provider: PROVIDER,
    contextLength: CONTEXT_LENGTH,
    modelConfigHash: sha256(stableJson(modelConfigIdentity())),
    systemPromptHash: sha256(extractSystemPrompt(firstBody)),
    userPromptHash: sha256(input.benchmarkCase.query),
    experimentalInstructionHash: sha256(input.arm === "B" ? ARM_B_INSTRUCTION : ""),
    authorizedSurfaceHash: sha256(toolNamesFromBody(firstBody)),
    schemaHash: sha256(requestBodies.map((body) => body.tools ?? null)),
    caseSetHash: frozenCaseSetHash(),
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    v1cTop8: input.v1cTop8,
    rankingEpoch: observedRanking?.epoch ?? null,
    selectedTools: completedExecution.result.executedTools.map((tool) => tool.name),
    firstExecutedTool,
    executedToolSequence,
    terminalSuccess,
    terminalFailureReason: terminalSuccess ? null : observedFailure ? "TOOL_ERROR" : "MODEL_ERROR",
    preferredToolAuthorized,
    preferredToolInTop8,
    preferredToolAttempted,
    substituteTool:
      firstExecutedTool && firstExecutedTool !== mappedRealTool ? firstExecutedTool : null,
    benchmarkPreferredTool,
    mappedRealTool,
    mappingClassification: input.mappingClass,
    substitutionWithoutPreferredAttempt,
    fallbackAfterPreferredFailure: observedFailure && firstExecutedTool !== mappedRealTool,
    valid,
    invalidReason: valid
      ? null
      : describeInvalidRun({
          execution: completedExecution,
          firstBody,
          expected: input.authorizedNames,
          observedRanking,
          requestBodies,
        }),
    startTime,
    endTime,
  };
}

function rankTop8(
  tools: readonly { name: string; description?: string }[],
  query: string,
): readonly string[] {
  return rankAgentTools(tools, query)
    .slice(0, 8)
    .map((tool) => tool.name);
}

function buildLiveConfig(workspaceDir: string): OpenClawConfig {
  const modelRef = `${PROVIDER}/${MODEL_ID}`;
  return {
    agents: {
      defaults: {
        model: { primary: modelRef },
        models: { [modelRef]: { agentRuntime: { id: "openclaw" } } },
        workspace: workspaceDir,
        skipBootstrap: true,
        skills: [],
      },
    },
    models: {
      mode: "replace",
      providers: {
        [PROVIDER]: {
          baseUrl: LM_STUDIO_BASE_URL,
          apiKey: process.env.LM_API_TOKEN ?? "lmstudio",
          api: "openai-completions",
          request: { allowPrivateNetwork: true },
          models: [
            {
              id: MODEL_ID,
              name: MODEL_ID,
              reasoning: false,
              input: ["text" as const],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 262_144,
              maxTokens: 512,
            },
          ],
        },
      },
    },
  };
}

async function assertLiveModelAvailable(): Promise<void> {
  const response = await fetch("http://127.0.0.1:1234/api/v1/models");
  if (!response.ok) {
    throw new Error(`PREPARED_NOT_STARTED: LM Studio discovery returned ${response.status}`);
  }
  const body = (await response.json()) as { models?: Array<{ key?: string; type?: string }> };
  if (!body.models?.some((model) => model.key === MODEL_ID && model.type === "llm")) {
    throw new Error(`PREPARED_NOT_STARTED: configured model ${MODEL_ID} is unavailable`);
  }
}

function captureModelPayloads(): ModelPayloadCapture {
  const requests: CapturedModelRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (
      url.startsWith(LM_STUDIO_BASE_URL) &&
      typeof body === "string" &&
      body.trim().startsWith("{")
    ) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push({ body: parsed, url });
    }
    return await originalFetch(input, init);
  };
  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function sameSurfaceAcrossRequests(bodies: readonly Record<string, unknown>[]): boolean {
  const first = stableJson(toolNamesFromBody(bodies[0] ?? {}));
  return bodies.every((body) => stableJson(toolNamesFromBody(body)) === first);
}

function sameSchemaAcrossRequests(bodies: readonly Record<string, unknown>[]): boolean {
  const first = stableJson(bodies[0]?.tools ?? null);
  return bodies.every((body) => stableJson(body.tools ?? null) === first);
}

function sameSurfaceAsExpected(
  body: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return stableJson(toolNamesFromBody(body)) === stableJson([...expected]);
}

function toolNamesFromBody(body: Record<string, unknown>): string[] {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") {
      return [];
    }
    const record = tool as Record<string, unknown>;
    const nested = record.function;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const name = (nested as Record<string, unknown>).name;
      return typeof name === "string" ? [name] : [];
    }
    return typeof record.name === "string" ? [record.name] : [];
  });
}

function extractSystemPrompt(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages
    .filter(
      (message) =>
        message &&
        typeof message === "object" &&
        (message as Record<string, unknown>).role === "system",
    )
    .map((message) => JSON.stringify((message as Record<string, unknown>).content ?? ""))
    .join("\n");
}

function describeInvalidRun(input: {
  execution: { status: string };
  firstBody: Record<string, unknown>;
  expected: readonly string[];
  observedRanking?: { epoch: string };
  requestBodies: readonly Record<string, unknown>[];
}): string {
  if (input.execution.status !== "completed") {
    return "HARNESS_ERROR";
  }
  if (!input.observedRanking?.epoch) {
    return "MISSING_RANKING_EPOCH";
  }
  if (Object.keys(input.firstBody).length === 0) {
    return "MODEL_ERROR";
  }
  if (!sameSurfaceAsExpected(input.firstBody, input.expected)) {
    return "AUTHORIZED_SURFACE_DRIFT";
  }
  if (!sameSurfaceAcrossRequests(input.requestBodies)) {
    return "AUTHORIZED_SURFACE_DRIFT";
  }
  if (!sameSchemaAcrossRequests(input.requestBodies)) {
    return "SCHEMA_DRIFT";
  }
  return "INCOMPLETE_TERMINAL_EVIDENCE";
}

function buildManifest(sets: ReturnType<typeof splitV1IExperimentSets>): V1IManifest {
  const modelConfig = modelConfigIdentity();
  const caseHash = (entries: readonly ToolRankingBenchmarkCase[]) =>
    sha256(
      stableJson(
        entries.map((entry) => ({ id: entry.id, query: entry.query, tools: entry.tools })),
      ),
    );
  const surfaceHash = (entries: readonly ToolRankingBenchmarkCase[]) =>
    sha256(
      stableJson(
        [...new Set(entries.flatMap((entry) => entry.tools.map((tool) => tool.name)))].toSorted(),
      ),
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
    modelConfigHash: sha256(stableJson(modelConfig)),
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
    schemaHash: sha256(
      stableJson({
        synthetic: sets.synthetic.map((entry) => entry.id),
        realExact: sets.realExact.map((entry) => entry.id),
        realAdapter: sets.realAdapter.map((entry) => entry.id),
      }),
    ),
    systemPromptHash: sha256("runtime-system-prompt-captured-per-run"),
    experimentalInstructionHash: sha256(ARM_B_INSTRUCTION),
    startedAt: new Date().toISOString(),
    completedAt: null,
    activeFilteringEnabled: false,
  };
}

function modelConfigIdentity(): Record<string, unknown> {
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

function makeInvalidObservation(input: {
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
}): ExperimentRun {
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
    modelConfigHash: sha256(stableJson(modelConfigIdentity())),
    systemPromptHash: sha256(""),
    userPromptHash: sha256(input.benchmarkCase.query),
    experimentalInstructionHash: sha256(input.arm === "B" ? ARM_B_INSTRUCTION : ""),
    authorizedSurfaceHash: sha256(input.authorizedNames),
    schemaHash: sha256(input.authorizedNames),
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

function classifyAttemptError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("fetch") || message.includes("provider")
    ? "PROVIDER_ERROR"
    : "HARNESS_ERROR";
}

function orderedArms(seed: number): readonly Arm[] {
  return seed % 2 === 0 ? ["A", "B"] : ["B", "A"];
}

function scheduleSeedFor(caseId: string, replicate: number): number {
  return Number.parseInt(sha256(`${caseId}:${replicate}`).slice(0, 8), 16);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function frozenCaseSetHash(): string {
  return sha256(
    stableJson(
      TOOL_RANKING_HELD_OUT_CASES.map((entry) => ({
        id: entry.id,
        query: entry.query,
        tools: entry.tools,
      })),
    ),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
