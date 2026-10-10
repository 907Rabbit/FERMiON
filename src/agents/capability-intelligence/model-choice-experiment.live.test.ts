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
const ARM_B_INSTRUCTION = `## Tool choice
When multiple tools can perform a task, prefer the most specific purpose-built authorized tool.
Use generic tools such as exec or read as fallbacks when the purpose-built tool cannot perform the required operation.
Do not use a generic tool merely to reproduce functionality already provided directly by a more specific available tool.
If a purpose-built tool is unavailable, inadequate, or fails, a generic fallback is appropriate.`;
const REPLICATES = 3;

type SurfaceMode = "REAL" | "SYNTHETIC";
type Arm = "A" | "B";
type MappingClass = "EXACT" | "ADAPTER" | "SYNTHETIC" | "UNSUPPORTED";

type CapturedModelRequest = {
  body: Record<string, unknown>;
  url: string;
};

type ExperimentRun = {
  surfaceMode: SurfaceMode;
  mappingClass: MappingClass;
  caseId: string;
  arm: Arm;
  replicate: number;
  scheduleSeed: number;
  modelId: string;
  provider: string;
  baseUrlIdentity: string;
  modelConfigHash: string;
  systemPromptHash: string;
  userPromptHash: string;
  experimentalInstructionHash: string;
  authorizedSurfaceHash: string;
  schemaHash: string;
  v1cTop8: readonly string[];
  rankingEpoch: string | null;
  firstExecutedTool: string | null;
  executedToolSequence: readonly string[];
  terminalSuccess: boolean;
  benchmarkPreferredTool: string;
  mappedRealTool: string | null;
  mappingClassification: MappingClass;
  substitutionWithoutPreferredAttempt: boolean;
  fallbackAfterPreferredFailure: boolean;
  containment: number;
  valid: boolean;
  invalidReason?: string;
};

type ModelPayloadCapture = {
  requests: CapturedModelRequest[];
  restore: () => void;
};

const describeLive = LIVE ? describe : describe.skip;

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
  it("runs REAL and SYNTHETIC strata without pooling them", { timeout: 3_600_000 }, async () => {
    expect(ACTIVE_FILTERING_ENABLED).toBe(false);
    await assertLiveModelAvailable();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-"));
    const config = buildLiveConfig(workspaceDir);
    try {
      const mappingSummary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
      const syntheticRuns = await runStratum({
        surfaceMode: "SYNTHETIC",
        cases: TOOL_RANKING_HELD_OUT_CASES,
        mappingByCase: new Map(),
        config,
        workspaceDir,
      });
      const eligibleRealCases = mappingSummary.cases.filter(
        (entry) => entry.mappingClass !== "UNSUPPORTED",
      );
      const realRuns = await runStratum({
        surfaceMode: "REAL",
        cases: TOOL_RANKING_HELD_OUT_CASES.filter((entry) =>
          eligibleRealCases.some((candidate) => candidate.caseId === entry.id),
        ),
        mappingByCase: new Map(eligibleRealCases.map((entry) => [entry.caseId, entry])),
        config,
        workspaceDir,
      });
      const report = {
        activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
        rankerVersion: SHADOW_RANKER_VERSION,
        qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
        real: analyzeRuns(realRuns),
        synthetic: analyzeRuns(syntheticRuns),
        runCounts: { real: realRuns.length, synthetic: syntheticRuns.length },
      };
      console.log(JSON.stringify(report));
      expect(syntheticRuns).toHaveLength(TOOL_RANKING_HELD_OUT_CASES.length * REPLICATES * 2);
      expect(realRuns).toHaveLength(eligibleRealCases.length * REPLICATES * 2);
      expect(realRuns.every((run) => run.valid)).toBe(true);
      expect(syntheticRuns.every((run) => run.valid)).toBe(true);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});

async function runStratum(input: {
  surfaceMode: SurfaceMode;
  cases: readonly ToolRankingBenchmarkCase[];
  mappingByCase: ReadonlyMap<string, BenchmarkCaseEligibility>;
  config: OpenClawConfig;
  workspaceDir: string;
}): Promise<ExperimentRun[]> {
  const runs: ExperimentRun[] = [];
  for (const benchmarkCase of input.cases) {
    const eligibility = input.mappingByCase.get(benchmarkCase.id);
    const mappingClass: MappingClass =
      input.surfaceMode === "SYNTHETIC"
        ? "SYNTHETIC"
        : (eligibility?.mappingClass ?? "UNSUPPORTED");
    const authorizedNames =
      input.surfaceMode === "SYNTHETIC"
        ? benchmarkCase.tools.map((tool) => tool.name)
        : [...(eligibility?.mappedTools ?? [])];
    const v1cTools =
      input.surfaceMode === "SYNTHETIC"
        ? benchmarkCase.tools
        : authorizedNames.map((name) => ({ name, description: `OpenClaw ${name} capability` }));
    const v1cTop8 = rankTop8(v1cTools, benchmarkCase.query);
    for (let replicate = 0; replicate < REPLICATES; replicate += 1) {
      const scheduleSeed = scheduleSeedFor(benchmarkCase.id, replicate);
      for (const arm of orderedArms(scheduleSeed)) {
        runs.push(
          await runOne({
            surfaceMode: input.surfaceMode,
            benchmarkCase,
            eligibility,
            mappingClass,
            authorizedNames,
            v1cTop8,
            arm,
            replicate,
            scheduleSeed,
            config: input.config,
            workspaceDir: input.workspaceDir,
          }),
        );
      }
    }
  }
  return runs;
}

async function runOne(input: {
  surfaceMode: SurfaceMode;
  benchmarkCase: ToolRankingBenchmarkCase;
  eligibility?: BenchmarkCaseEligibility;
  mappingClass: MappingClass;
  authorizedNames: readonly string[];
  v1cTop8: readonly string[];
  arm: Arm;
  replicate: number;
  scheduleSeed: number;
  config: OpenClawConfig;
  workspaceDir: string;
}): Promise<ExperimentRun> {
  const harness =
    input.surfaceMode === "SYNTHETIC"
      ? createSyntheticBenchmarkToolHarness(input.benchmarkCase)
      : undefined;
  const capture = captureModelPayloads();
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
    input.surfaceMode === "SYNTHETIC" ? preferredBenchmarkTool : preferredMapping.realTool;
  const firstExecutedTool = executedToolSequence[0] ?? null;
  const valid =
    completedExecution.status === "completed" &&
    Boolean(observedRanking?.epoch) &&
    requestBodies.length > 0 &&
    sameSurfaceAcrossRequests(requestBodies) &&
    sameSurfaceAsExpected(firstBody, input.authorizedNames);
  return {
    surfaceMode: input.surfaceMode,
    mappingClass: input.mappingClass,
    caseId: input.benchmarkCase.id,
    arm: input.arm,
    replicate: input.replicate,
    scheduleSeed: input.scheduleSeed,
    modelId: MODEL_ID,
    provider: PROVIDER,
    baseUrlIdentity: LM_STUDIO_BASE_URL,
    modelConfigHash: sha256(
      stableJson({
        provider: PROVIDER,
        model: MODEL_ID,
        baseUrl: LM_STUDIO_BASE_URL,
        temperature: null,
        topP: null,
        seed: null,
      }),
    ),
    systemPromptHash: sha256(extractSystemPrompt(firstBody)),
    userPromptHash: sha256(input.benchmarkCase.query),
    experimentalInstructionHash: sha256(input.arm === "B" ? ARM_B_INSTRUCTION : ""),
    authorizedSurfaceHash: sha256(toolNamesFromBody(firstBody)),
    schemaHash: sha256(requestBodies.map((body) => body.tools ?? null)),
    v1cTop8: input.v1cTop8,
    rankingEpoch: observedRanking?.epoch ?? null,
    firstExecutedTool,
    executedToolSequence,
    terminalSuccess: completedExecution.result.terminal === "success",
    benchmarkPreferredTool,
    mappedRealTool,
    mappingClassification: input.mappingClass,
    substitutionWithoutPreferredAttempt: Boolean(
      firstExecutedTool &&
      firstExecutedTool !== mappedRealTool &&
      !executedToolSequence.includes(mappedRealTool ?? ""),
    ),
    fallbackAfterPreferredFailure: observedFailure && firstExecutedTool !== mappedRealTool,
    containment: firstExecutedTool && input.v1cTop8.includes(firstExecutedTool) ? 1 : 0,
    valid,
    ...(valid
      ? {}
      : {
          invalidReason: describeInvalidRun({
            execution: completedExecution,
            firstBody,
            expected: input.authorizedNames,
            observedRanking,
          }),
        }),
  };
}

function analyzeRuns(runs: readonly ExperimentRun[]) {
  const paired = new Map<string, { a: number[]; b: number[] }>();
  for (const run of runs) {
    const bucket = paired.get(run.caseId) ?? { a: [], b: [] };
    bucket[run.arm === "A" ? "a" : "b"].push(run.containment);
    paired.set(run.caseId, bucket);
  }
  const deltas = [...paired.values()]
    .filter((bucket) => bucket.a.length > 0 && bucket.b.length > 0)
    .map((bucket) => mean(bucket.b) - mean(bucket.a));
  return {
    cases: paired.size,
    validRuns: runs.filter((run) => run.valid).length,
    meanPairedDelta: mean(deltas),
    paired95Interval: bootstrapInterval(deltas),
    rawContainment: mean(runs.map((run) => run.containment)),
    successRate: mean(runs.map((run) => (run.terminalSuccess ? 1 : 0))),
    semanticSubstitutionRate: mean(
      runs.map((run) => (run.substitutionWithoutPreferredAttempt ? 1 : 0)),
    ),
    firstToolModalAgreement: mean(
      [...paired.keys()].map((caseId) =>
        modalAgreement(runs.filter((run) => run.caseId === caseId)),
      ),
    ),
    firstToolAgreementDistribution: [...paired.keys()].map((caseId) =>
      modalAgreement(runs.filter((run) => run.caseId === caseId)),
    ),
  };
}

function modalAgreement(runs: readonly ExperimentRun[]): number {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.firstExecutedTool) {
      counts.set(run.firstExecutedTool, (counts.get(run.firstExecutedTool) ?? 0) + 1);
    }
  }
  return runs.length === 0 ? 0 : Math.max(0, ...counts.values()) / runs.length;
}

function bootstrapInterval(values: readonly number[]): [number, number] {
  if (values.length === 0) {
    return [0, 0];
  }
  const samples: number[] = [];
  let state = 0x51f15eed;
  for (const iteration of Array.from({ length: 2000 }, (_, index) => index)) {
    const sample: number[] = [];
    for (const fallback of values) {
      state = (Math.imul(state, 1664525) + 1013904223 + iteration) >>> 0;
      sample.push(values[state % values.length] ?? fallback);
    }
    samples.push(mean(sample));
  }
  samples.sort((left, right) => left - right);
  return [
    samples[Math.floor(samples.length * 0.025)] ?? 0,
    samples[Math.floor(samples.length * 0.975)] ?? 0,
  ];
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
}): string {
  if (input.execution.status !== "completed") {
    return `runtime status ${input.execution.status}`;
  }
  if (!input.observedRanking?.epoch) {
    return "missing ranking epoch";
  }
  if (Object.keys(input.firstBody).length === 0) {
    return "missing captured model payload";
  }
  if (!sameSurfaceAsExpected(input.firstBody, input.expected)) {
    return "authorized surface drift";
  }
  return "unknown integrity failure";
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

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
