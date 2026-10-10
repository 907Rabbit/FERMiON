/* oxlint-disable max-lines -- v1I live/offline evidence paths share one frozen harness. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { RunEmbeddedAgentParams } from "../embedded-agent-runner/run/params.js";
import type { EmbeddedAgentRunResult } from "../embedded-agent-runner/types.js";
import { resolveAgentRunSessionTarget } from "../run-session-target.js";
import { resolveRunWorkspaceDir } from "../workspace-run.js";
import {
  getBenchmarkRealToolMapping,
  summarizeBenchmarkRealToolMappings,
  type BenchmarkCaseEligibility,
} from "./benchmark-real-tool-mapping.js";
import type { EmbeddedReplayFact } from "./embedded-replay-observation.js";
import {
  appendV1IObservation,
  assertNoDuplicateValidCells,
  canonicalizeV1IValue,
  createV1IArtifactState,
  expectedCellsForV1IMode,
  finalizeV1IArtifact,
  hashV1ICanonical,
  resolveV1IMode,
  requiredV1ICells,
  splitV1IExperimentSets,
  summarizeV1IObservations,
  surfaceModeForV1IMode,
  v1ICellKey,
  V1I_EXPERIMENT_VERSION,
  V1I_SCHEMA_VERSION,
  V1I_BOOTSTRAP_SEED,
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
import {
  ARM_B_INSTRUCTION,
  CONTEXT_LENGTH,
  HARNESS_COMMIT,
  LM_STUDIO_BASE_URL,
  MODEL_ID,
  PROVIDER,
  V1ISmokeTimeoutError,
  appendV1ISmokeCheckpoint,
  assertSyntheticSmokePassed,
  buildManifest,
  buildSyntheticRunnerOverrides,
  classifyRequestPreparationFailure,
  createExperimentDiagnostics,
  frozenCaseSetHash,
  makeInvalidObservation,
  makeTestInvalidObservationInput,
  modelConfigIdentity,
  orderedArms,
  resolveHarnessCommit,
  runV1IAttempt,
  createV1ISmokeDeadline,
  runV1ISmokeStage,
  scheduleSeedFor,
  smokeStageForCheckpoint,
  sha256,
  type Arm,
  type InvalidObservationInput,
  type MappingClass,
} from "./model-choice-experiment-support.js";

type CapturedModelRequest = {
  body: Record<string, unknown>;
  url: string;
};

type ExperimentRun = V1IObservation;

type ModelPayloadCapture = {
  requests: CapturedModelRequest[];
  delegatedRequests: number;
  recordProviderRequest: (request: CapturedModelRequest) => void;
  restore: () => void;
};

class V1IProviderRequestCapturedError extends Error {
  constructor() {
    super("v1I provider request captured before network I/O");
    this.name = "V1IProviderRequestCapturedError";
  }
}

const SMOKE_TEST = LIVE && process.env.OPENCLAW_V1I_SMOKE_TEST === "1";
const describeFullLive = LIVE && !SMOKE_TEST ? describe : describe.skip;
const describeSmokeLive = SMOKE_TEST ? describe : describe.skip;
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
    expect(buildSyntheticRunnerOverrides(harness)).toEqual({
      clientTools: harness.clientTools,
      clientToolsOnly: true,
      disableTools: true,
    });
    expect(buildSyntheticRunnerOverrides(harness).clientTools).toHaveLength(31);
    expect(
      buildSyntheticRunnerOverrides(harness).clientTools?.map((tool) => tool.function.name),
    ).toEqual(expect.arrayContaining(["git_diff", "pytest", "calendar", "email"]));
    expect(syntheticTools.size).toBeGreaterThan(0);
    expect(JSON.stringify(harness.clientTools)).not.toMatch(
      /requiredTools|relevantTools|expectedOutcome|toolRoles|rank/i,
    );
  });
});

describe("v1I harness evidence repair", () => {
  it("hashes the original array-shaped crash input without coercion", () => {
    const observation = makeInvalidObservation({
      ...makeTestInvalidObservationInput(),
      reason: "SCHEMA_DRIFT",
    });
    expect(observation.valid).toBe(false);
    expect(observation.authorizedSurfaceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(observation.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(observation)).toContain('"valid":false');
  });

  it("records unexpected attempt failures as HARNESS_ERROR invalid observations", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-harness-error-test-"));
    try {
      const recorded: V1IObservation[] = [];
      await runV1IAttempt(
        makeTestInvalidObservationInput(),
        async () => {
          throw new Error("unexpected harness failure");
        },
        (observation) => {
          recorded.push(observation);
          appendV1IObservation(root, "synthetic", observation);
        },
      );
      const persisted = JSON.parse(
        fs.readFileSync(path.join(root, "synthetic-invalid.jsonl"), "utf8"),
      ) as V1IObservation;
      expect(recorded).toHaveLength(1);
      expect(persisted.valid).toBe(false);
      expect(persisted.invalidReason).toBe("HARNESS_ERROR");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("distinguishes model errors from uncaptured request preparation failures", () => {
    expect(invalidReasonForExecutionStatus("model-error", 0)).toBe("MODEL_ERROR");
    expect(invalidReasonForExecutionStatus("runtime-error", 0)).toBe("REQUEST_PREPARATION_ERROR");
    expect(invalidReasonForExecutionStatus("runtime-error", 1)).toBe("HARNESS_ERROR");
    expect(invalidReasonForExecutionStatus("aborted", 0)).toBe("HARNESS_ERROR");
    expect(invalidReasonForExecutionStatus("completed", 0)).toBe("NOT_CAPTURED");
    expect(invalidReasonForExecutionStatus("completed", 1)).toBeNull();
  });

  it("uses the source commit when only generated artifacts are dirty", () => {
    expect(resolveHarnessCommit({ head: "ae4d9d1", sourceDirty: false })).toBe("ae4d9d1");
    expect(resolveHarnessCommit({ head: "ae4d9d1", sourceDirty: true })).toBe(
      "uncommitted-harness",
    );
    expect(resolveHarnessCommit({ explicit: "override", head: "ae4d9d1", sourceDirty: true })).toBe(
      "override",
    );
  });
});

describeSmokeLive("v1I model-choice experiment smoke", () => {
  it(
    "runs one synthetic case, arm, and replicate into a separate artifact",
    { timeout: 600_000 },
    async () => {
      expect(LIVE_MODE).toBe("synthetic");
      expect(ACTIVE_FILTERING_ENABLED).toBe(false);
      const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
      if (!benchmarkCase) {
        throw new Error("held-out corpus is empty");
      }
      const smokeRoot = path.resolve(
        process.env.OPENCLAW_V1I_SMOKE_ARTIFACT_DIR ??
          "artifacts/capability-intelligence/v1i-smoke",
      );
      fs.mkdirSync(smokeRoot, { recursive: true });
      const smokeInput = {
        mode: "synthetic" as const,
        surfaceMode: "SYNTHETIC" as const,
        benchmarkCase,
        mappingClass: "SYNTHETIC" as const,
        authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
        v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
        arm: "A" as const,
        replicate: 1,
        attempt: 1,
        scheduleSeed: scheduleSeedFor(benchmarkCase.id, 1),
      };
      const smokeManifest = {
        harnessCommit: HARNESS_COMMIT,
        model: modelConfigIdentity(),
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        activeFilteringEnabled: false,
        caseId: benchmarkCase.id,
        arm: smokeInput.arm,
        replicate: smokeInput.replicate,
      };
      fs.writeFileSync(
        path.join(smokeRoot, "smoke-manifest.json"),
        `${JSON.stringify(smokeManifest, null, 2)}\n`,
      );
      let lastSuccessfulCheckpoint = "manifest-written";
      const recordCheckpoint = (stage: string, details: Record<string, unknown> = {}) => {
        lastSuccessfulCheckpoint = stage;
        appendV1ISmokeCheckpoint(smokeRoot, { stage, ...details });
      };
      recordCheckpoint("manifest-written", { harnessCommit: HARNESS_COMMIT });
      try {
        await runV1ISmokeStage({
          stage: "modelDiscovery",
          operation: (signal) => assertLiveModelAvailable(signal),
          onTimeout: (error) => recordSmokeTimeout(smokeRoot, error),
        });
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-smoke-"));
        const config = buildLiveConfig(workspaceDir);
        recordCheckpoint("live-config-built");
        const smokeDeadline = createSmokeDeadlineForRun(smokeRoot);
        smokeDeadline.enter("workspaceSessionPreparation", "live-config-built");
        let observation: ExperimentRun;
        const execution = runV1IAttempt(
          smokeInput,
          () =>
            runOne({
              ...smokeInput,
              config,
              workspaceDir,
              abortSignal: smokeDeadline.signal,
              onCheckpoint: (checkpoint) => {
                recordCheckpoint(checkpoint.stage, {
                  toolCount: checkpoint.toolCount,
                  representativeToolNames: checkpoint.representativeToolNames,
                });
                const stage = smokeStageForCheckpoint(checkpoint.stage);
                if (stage) {
                  smokeDeadline.enter(stage, checkpoint.stage);
                }
              },
            }),
          (value) => {
            fs.writeFileSync(
              path.join(smokeRoot, "smoke-observation.json"),
              `${JSON.stringify(value, null, 2)}\n`,
            );
          },
        );
        try {
          observation = await Promise.race([execution, smokeDeadline.timeoutPromise]);
        } catch (error) {
          if (error instanceof V1ISmokeTimeoutError) {
            await Promise.race([
              execution.catch(() => undefined),
              new Promise((resolve) => {
                setTimeout(resolve, 5_000);
              }),
            ]);
          }
          throw error;
        } finally {
          smokeDeadline.dispose();
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
        const result = {
          status: observation.valid ? "PASS" : "FAIL",
          harnessCommit: HARNESS_COMMIT,
          modelConfigHash: smokeManifest.modelConfigHash,
          activeFilteringEnabled: false,
          observationValid: observation.valid,
          rankingEpoch: observation.rankingEpoch,
        };
        fs.writeFileSync(
          path.join(smokeRoot, "smoke-result.json"),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        expect(observation.valid).toBe(true);
      } catch (error) {
        writeSmokeInvalidArtifact({
          smokeRoot,
          error,
          lastSuccessfulCheckpoint,
          harnessCommit: HARNESS_COMMIT,
          modelConfigHash: smokeManifest.modelConfigHash,
        });
        throw error;
      }
    },
  );
});

function createSmokeDeadlineForRun(smokeRoot: string) {
  return createV1ISmokeDeadline({
    onTimeout: (error) => recordSmokeTimeout(smokeRoot, error),
  });
}

function recordSmokeTimeout(smokeRoot: string, error: V1ISmokeTimeoutError): void {
  appendV1ISmokeCheckpoint(smokeRoot, {
    stage: "timeout",
    invalidReason: "INFRASTRUCTURE_TIMEOUT",
    timeoutStage: error.timeoutStage,
    timeoutMs: error.timeoutMs,
    lastSuccessfulCheckpoint: error.lastSuccessfulCheckpoint,
  });
}

function writeSmokeInvalidArtifact(input: {
  smokeRoot: string;
  error: unknown;
  lastSuccessfulCheckpoint: string;
  harnessCommit: string;
  modelConfigHash: string;
}): void {
  const timeout = input.error instanceof V1ISmokeTimeoutError ? input.error : undefined;
  const rawErrorName = input.error instanceof Error ? input.error.name : "NonErrorThrown";
  const rawErrorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const invalid = {
    valid: false,
    invalidReason: timeout ? "INFRASTRUCTURE_TIMEOUT" : "HARNESS_ERROR",
    failureStage: timeout?.timeoutStage ?? "smoke-harness",
    rawErrorName,
    rawErrorMessage,
    lastSuccessfulCheckpoint: timeout?.lastSuccessfulCheckpoint ?? input.lastSuccessfulCheckpoint,
    timeoutMs: timeout?.timeoutMs ?? null,
    harnessCommit: input.harnessCommit,
    modelConfigHash: input.modelConfigHash,
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(input.smokeRoot, "smoke-invalid.json"),
    `${JSON.stringify(invalid, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(input.smokeRoot, "smoke-result.json"),
    `${JSON.stringify(
      {
        status: "FAIL",
        harnessCommit: input.harnessCommit,
        modelConfigHash: input.modelConfigHash,
        activeFilteringEnabled: false,
        observationValid: false,
        invalidReason: invalid.invalidReason,
        failureStage: invalid.failureStage,
        lastSuccessfulCheckpoint: invalid.lastSuccessfulCheckpoint,
      },
      null,
      2,
    )}\n`,
  );
}

describe("v1I smoke timeout controls", () => {
  const stages = [
    "runnerModuleImport",
    "workspaceSessionPreparation",
    "postBundleToPrompt",
    "requestPreparation",
    "providerFirstResponse",
    "toolExecution",
    "terminalCompletion",
  ] as const;

  it.each(stages)("aborts and serializes a stalled %s stage", async (stage) => {
    const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-smoke-timeout-"));
    let timeout: V1ISmokeTimeoutError | undefined;
    const deadline = createV1ISmokeDeadline({
      timeouts: { [stage]: 10 },
      onTimeout: (error) => {
        timeout = error;
        recordSmokeTimeout(smokeRoot, error);
      },
    });
    deadline.enter(stage, `${stage}-checkpoint`);
    const stalled = new Promise<void>((_, reject) => {
      deadline.signal.addEventListener("abort", () => reject(abortReason(deadline.signal)), {
        once: true,
      });
    });
    try {
      await expect(Promise.race([stalled, deadline.timeoutPromise])).rejects.toBeInstanceOf(
        V1ISmokeTimeoutError,
      );
      expect(deadline.signal.aborted).toBe(true);
      expect(timeout?.timeoutStage).toBe(stage);
      writeSmokeInvalidArtifact({
        smokeRoot,
        error: timeout,
        lastSuccessfulCheckpoint: `${stage}-checkpoint`,
        harnessCommit: HARNESS_COMMIT,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
      });
      expect(fs.existsSync(path.join(smokeRoot, "smoke-invalid.json"))).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(path.join(smokeRoot, "smoke-invalid.json"), "utf8")),
      ).toMatchObject({
        valid: false,
        invalidReason: "INFRASTRUCTURE_TIMEOUT",
        failureStage: stage,
        lastSuccessfulCheckpoint: `${stage}-checkpoint`,
      });
    } finally {
      deadline.dispose();
      fs.rmSync(smokeRoot, { recursive: true, force: true });
    }
  });

  it("flushes checkpoints before the next await", () => {
    const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-smoke-checkpoints-"));
    try {
      appendV1ISmokeCheckpoint(smokeRoot, { stage: "manifest-written" });
      expect(fs.readFileSync(path.join(smokeRoot, "smoke-checkpoints.jsonl"), "utf8")).toContain(
        '"stage":"manifest-written"',
      );
      appendV1ISmokeCheckpoint(smokeRoot, { stage: "live-config-built" });
      expect(
        fs.readFileSync(path.join(smokeRoot, "smoke-checkpoints.jsonl"), "utf8").trim().split("\n"),
      ).toHaveLength(2);
    } finally {
      fs.rmSync(smokeRoot, { recursive: true, force: true });
    }
  });

  it("uses its own timeout instead of the Vitest timeout for a stalled stage", async () => {
    const startedAt = performance.now();
    await expect(
      runV1ISmokeStage({
        stage: "providerFirstResponse",
        timeoutMs: 10,
        operation: () => new Promise<never>(() => {}),
      }),
    ).rejects.toMatchObject({
      name: "V1ISmokeTimeoutError",
      timeoutStage: "providerFirstResponse",
      timeoutMs: 10,
    });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

describeFullLive("v1I model-choice experiment live", () => {
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
      if (mode === "synthetic") {
        assertSyntheticSmokePassed();
      }
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
          V1I_BOOTSTRAP_SEED,
          requiredV1ICells(mode, cases),
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
        const attemptInput = {
          mode: input.mode,
          surfaceMode: input.surfaceMode,
          benchmarkCase,
          mappingClass,
          authorizedNames,
          v1cTop8,
          arm,
          replicate,
          attempt:
            input.nextAttemptByCell.get(
              `${cell.surfaceMode}:${cell.caseId}:${cell.arm}:${cell.replicate}`,
            ) ?? 1,
          scheduleSeed,
        } satisfies Omit<InvalidObservationInput, "reason">;
        const observation = await runV1IAttempt(
          attemptInput,
          () =>
            runOne({
              ...attemptInput,
              eligibility,
              config: input.config,
              workspaceDir: input.workspaceDir,
            }),
          input.onObservation,
        );
        runs.push(observation);
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
  requestCapture?: {
    stopAfterCapture?: boolean;
    holdAfterCapture?: boolean;
    onRequestCaptured?: (request: CapturedModelRequest) => void;
    onDelegatedRequest?: () => void;
  };
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  directRunner?: boolean;
  provider?: string;
  model?: string;
  onCheckpoint?: (
    checkpoint: NonNullable<
      NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>["onCheckpoint"]
    > extends (checkpoint: infer T) => void
      ? T
      : never,
  ) => void;
}): Promise<ExperimentRun> {
  const harness =
    input.mode === "synthetic"
      ? createSyntheticBenchmarkToolHarness(input.benchmarkCase)
      : undefined;
  const runProvider = input.provider ?? PROVIDER;
  const runModel = input.model ?? MODEL_ID;
  const diagnostics = createExperimentDiagnostics();
  const diagnosticsCheckpoint = diagnostics.hooks.onCheckpoint;
  diagnostics.hooks.onCheckpoint = (checkpoint) => {
    diagnosticsCheckpoint?.(checkpoint);
    input.onCheckpoint?.(checkpoint);
  };
  diagnostics.hooks.onCheckpoint?.({
    stage: "synthetic-constructed",
    toolCount: harness?.clientTools.length ?? input.authorizedNames.length,
    representativeToolNames: (harness?.clientTools ?? input.authorizedNames)
      .slice(0, 8)
      .map((tool) => (typeof tool === "string" ? tool : tool.function.name)),
  });
  const capture = captureModelPayloads(diagnostics.hooks, input.requestCapture);
  const diagnosticsProviderRequest = diagnostics.hooks.onProviderRequest;
  diagnostics.hooks.onProviderRequest = async ({ payload, model }) => {
    const body =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const request = { body, url: "provider-adapter" };
    capture.recordProviderRequest(request);
    input.requestCapture?.onRequestCaptured?.(request);
    const toolNames = toolNamesFromBody(body);
    diagnostics.hooks.onCheckpoint?.({
      stage: "provider-request-constructed",
      toolCount: toolNames.length,
      representativeToolNames: toolNames,
    });
    await diagnosticsProviderRequest?.({ payload, model });
    if (input.requestCapture?.stopAfterCapture) {
      throw new V1IProviderRequestCapturedError();
    }
    if (input.requestCapture?.holdAfterCapture) {
      await new Promise<void>((_, reject) => {
        const signal = input.abortSignal;
        if (signal?.aborted) {
          reject(abortReason(signal));
          return;
        }
        signal?.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
      });
    }
  };
  const diagnosticsProviderResponse = diagnostics.hooks.onProviderResponse;
  diagnostics.hooks.onProviderResponse = async ({ response, model }) => {
    diagnostics.hooks.onCheckpoint?.({
      stage: "provider-response-received",
      toolCount: input.authorizedNames.length,
      representativeToolNames: input.authorizedNames.slice(0, 8),
    });
    await diagnosticsProviderResponse?.({ response, model });
  };
  const startTime = new Date().toISOString();
  let observedRanking: Extract<EmbeddedReplayFact, { kind: "ranking" }> | undefined;
  let observedFailure = false;
  let execution:
    | Awaited<ReturnType<typeof import("./embedded-replay-runtime.js").runEmbeddedReplay>>
    | undefined;
  try {
    diagnostics.hooks.onCheckpoint?.({
      stage: "runner-module-import-started",
      toolCount: harness?.clientTools.length ?? input.authorizedNames.length,
      representativeToolNames: (harness?.clientTools ?? input.authorizedNames)
        .slice(0, 8)
        .map((tool) => (typeof tool === "string" ? tool : tool.function.name)),
    });
    const { runEmbeddedAgent } = await import("../embedded-agent-runner/run-orchestrator.js");
    diagnostics.hooks.onCheckpoint?.({
      stage: "runner-module-import-completed",
      toolCount: harness?.clientTools.length ?? input.authorizedNames.length,
      representativeToolNames: (harness?.clientTools ?? input.authorizedNames)
        .slice(0, 8)
        .map((tool) => (typeof tool === "string" ? tool : tool.function.name)),
    });
    const runner = async (params: RunEmbeddedAgentParams): Promise<EmbeddedAgentRunResult> => {
      const originalFactListener = params.onEmbeddedReplayFact;
      const originalResultListener = params.onAgentToolResult;
      diagnostics.hooks.onCheckpoint?.({
        stage: "embedded-input-accepted",
        toolCount: params.clientTools?.length ?? params.toolsAllow?.length ?? 0,
        representativeToolNames: (
          params.clientTools?.map((tool) => tool.function.name) ??
          params.toolsAllow ??
          []
        ).slice(0, 8),
      });
      let result: EmbeddedAgentRunResult;
      try {
        result = await runEmbeddedAgent({
          ...params,
          ...(harness ? buildSyntheticRunnerOverrides(harness) : {}),
          ...(input.arm === "B" ? { extraSystemPrompt: ARM_B_INSTRUCTION } : {}),
          capabilityIntelligenceExperiment: diagnostics.hooks,
          onEmbeddedReplayFact: (fact) => {
            if (fact.kind === "ranking") {
              observedRanking = fact;
            }
            originalFactListener?.(fact);
          },
          onAgentToolResult: (event) => {
            observedFailure ||= event.isError;
            diagnostics.hooks.onCheckpoint?.({
              stage: "tool-execution-finished",
              toolCount: 1,
              representativeToolNames: [event.toolName],
            });
            originalResultListener?.(event);
          },
        });
      } catch (error) {
        diagnostics.hooks.onRequestPreparationError?.({
          error,
          stage: "run-embedded-agent",
        });
        throw error;
      }
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
      if (!input.abortSignal?.aborted) {
        diagnostics.hooks.onCheckpoint?.({
          stage: "terminal-observed",
          toolCount: result.meta.pendingToolCalls?.length ?? 0,
          representativeToolNames: (result.meta.pendingToolCalls ?? []).map((call) => call.name),
        });
      }
      return result;
    };
    const runId = `v1i-${input.surfaceMode.toLowerCase()}-${input.benchmarkCase.id}-${input.arm}-${input.replicate}`;
    if (input.directRunner) {
      const { embeddedReplaySessionId, embeddedReplaySessionKey } =
        await import("./embedded-replay-runtime.js");
      const { prepareSystemAgentRunAdmission } = await import("../admitted-run-context.js");
      const preparedRunAdmission = prepareSystemAgentRunAdmission(
        input.config,
        runId,
        "main",
        "capability-intelligence.embedded-replay",
      );
      try {
        await runner({
          runId,
          prompt: input.benchmarkCase.query,
          toolsAllow: [...input.authorizedNames],
          sessionId: embeddedReplaySessionId(runId),
          sessionKey: embeddedReplaySessionKey({ caseId: input.benchmarkCase.id, runId }),
          workspaceDir: input.workspaceDir,
          timeoutMs: input.timeoutMs ?? 120_000,
          disableTrajectory: true,
          preparedRunAdmission,
          authProfileFailurePolicy: "local",
          cleanupBundleMcpOnRunEnd: true,
          ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
          provider: runProvider,
          model: runModel,
          config: input.config,
        });
      } catch (error) {
        diagnostics.hooks.onRequestPreparationError?.({ error, stage: "run-embedded-agent" });
      } finally {
        preparedRunAdmission.close();
      }
      execution = {
        status: input.abortSignal?.aborted ? "aborted" : "runtime-error",
        result: {
          runId,
          turnId: "turn-1",
          terminal: input.abortSignal?.aborted ? "aborted" : "failed",
          executedTools: [],
        },
        versions: {
          schemaVersion: 1,
          rankerVersion: SHADOW_RANKER_VERSION,
          qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
        },
      };
    } else {
      const { runEmbeddedReplay } = await import("./embedded-replay-runtime.js");
      execution = await runEmbeddedReplay({
        request: {
          runId,
          turnId: "turn-1",
          caseId: input.benchmarkCase.id,
          prompt: input.benchmarkCase.query,
          authorizedToolNames: input.authorizedNames,
        },
        options: {
          workspaceDir: input.workspaceDir,
          timeoutMs: input.timeoutMs ?? 120_000,
          provider: runProvider,
          model: runModel,
          config: input.config,
          runner,
          ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
        },
      });
    }
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
  const terminalFailureReason = terminalFailureReasonForExecution({
    status: completedExecution.status,
    requestCount: requestBodies.length,
    terminalSuccess,
    observedFailure,
  });
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
    modelId: runModel,
    provider: runProvider,
    contextLength: CONTEXT_LENGTH,
    modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
    systemPromptHash: sha256(extractSystemPrompt(firstBody)),
    userPromptHash: sha256(input.benchmarkCase.query),
    experimentalInstructionHash: sha256(input.arm === "B" ? ARM_B_INSTRUCTION : ""),
    authorizedSurfaceHash: hashV1ICanonical(toolNamesFromBody(firstBody)),
    schemaHash: hashV1ICanonical(requestBodies.map((body) => body.tools ?? null)),
    caseSetHash: frozenCaseSetHash(),
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    v1cTop8: input.v1cTop8,
    rankingEpoch: observedRanking?.epoch ?? null,
    selectedTools: completedExecution.result.executedTools.map((tool) => tool.name),
    firstExecutedTool,
    executedToolSequence,
    terminalSuccess,
    terminalFailureReason,
    preferredToolAuthorized,
    preferredToolInTop8,
    preferredToolAttempted,
    substituteTool:
      firstExecutedTool && firstExecutedTool !== mappedRealTool ? firstExecutedTool : null,
    benchmarkPreferredTool: preferredBenchmarkTool,
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
    requestPreparationDiagnostics: {
      normalizedRuntimeStatus: completedExecution.status,
      highLevelClassification: terminalFailureReason,
      failureClass: classifyRequestPreparationFailure(diagnostics.readFailure()),
      checkpoints: diagnostics.checkpoints,
      lastSuccessfulCheckpoint: diagnostics.checkpoints.at(-1)?.stage ?? null,
      ...(diagnostics.readFailure() ? { failure: diagnostics.readFailure() } : {}),
    },
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
  fs.mkdirSync(path.join(workspaceDir, "agent"), { recursive: true });
  return {
    agents: {
      defaults: {
        model: { primary: modelRef },
        models: { [modelRef]: { agentRuntime: { id: "openclaw" } } },
        workspace: workspaceDir,
        skipBootstrap: true,
        skills: [],
      },
      list: [
        {
          id: "main",
          default: true,
          workspace: workspaceDir,
          agentDir: path.join(workspaceDir, "agent"),
        },
      ],
    },
    session: { store: path.join(workspaceDir, "sessions.json") },
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

function buildOfflineRequestConfig(workspaceDir: string): OpenClawConfig {
  const agentDir = path.join(workspaceDir, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  return {
    agents: {
      defaults: {
        model: { primary: "openai/mock-replay" },
        workspace: workspaceDir,
        skipBootstrap: true,
        skills: [],
      },
      list: [{ id: "main", default: true, workspace: workspaceDir, agentDir }],
    },
    session: { store: path.join(workspaceDir, "sessions.json") },
    models: {
      mode: "replace",
      providers: {
        openai: {
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "offline-v1i",
          api: "openai-responses",
          request: { allowPrivateNetwork: true },
          models: [
            {
              id: "mock-replay",
              name: "mock-replay",
              reasoning: false,
              input: ["text" as const],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16_000,
              maxTokens: 512,
            },
          ],
        },
      },
    },
  };
}

describe("v1I offline request preparation", () => {
  it("completes workspace and session preparation with a fresh roster offline", async () => {
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-v1i-workspace-prep-offline-"),
    );
    try {
      const config = buildLiveConfig(workspaceDir);
      const sessionId = "v1i-workspace-prep-offline";
      const sessionKey = "agent:main:v1i-workspace-prep-offline";
      const workspaceResolution = resolveRunWorkspaceDir({
        workspaceDir,
        sessionKey,
        agentId: "main",
        config,
      });
      const sessionTarget = await resolveAgentRunSessionTarget({
        agentId: "main",
        config,
        missingSessionKey: "create",
        sessionId,
        sessionKey,
      });
      expect(config.agents?.list).toHaveLength(1);
      expect(workspaceResolution.agentId).toBe("main");
      expect(workspaceResolution.workspaceDir).toBe(workspaceDir);
      expect(sessionTarget).toMatchObject({
        agentId: "main",
        sessionId,
        sessionKey,
      });
      expect(fs.existsSync(workspaceDir)).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, "agent"))).toBe(true);
    } finally {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Windows can retain the agent database lock until this test process exits.
      }
    }
  }, 60_000);

  it("reaches prompt phase with the live config and 31 synthetic client tools offline", async () => {
    const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!benchmarkCase) {
      throw new Error("held-out corpus is empty");
    }
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-v1i-live-config-offline-"),
    );
    const captured: CapturedModelRequest[] = [];
    const abortController = new AbortController();
    let delegatedRequests = 0;
    try {
      await installOfflinePreparedRuntimeMock();
      const observation = await runOne({
        mode: "synthetic",
        surfaceMode: "SYNTHETIC",
        benchmarkCase,
        mappingClass: "SYNTHETIC",
        authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
        v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
        arm: "A",
        replicate: 1,
        attempt: 1,
        scheduleSeed: scheduleSeedFor(benchmarkCase.id, 1),
        config: buildLiveConfig(workspaceDir),
        workspaceDir,
        directRunner: true,
        provider: PROVIDER,
        model: MODEL_ID,
        abortSignal: abortController.signal,
        requestCapture: {
          stopAfterCapture: true,
          onRequestCaptured: (request) => {
            captured.push(request);
            abortController.abort(new V1IProviderRequestCapturedError());
          },
          onDelegatedRequest: () => {
            delegatedRequests += 1;
          },
        },
      });
      const checkpoints = observation.requestPreparationDiagnostics?.checkpoints ?? [];
      const checkpoint = (stage: string) => checkpoints.find((entry) => entry.stage === stage);
      const names = toolNamesFromBody(captured[0]?.body ?? {});
      expect(observation.valid).toBe(false);
      expect(observation.invalidReason).toBe("HARNESS_ERROR");
      expect(captured).toHaveLength(1);
      expect(names).toHaveLength(31);
      expect(names).toEqual(expect.arrayContaining(["git_diff", "pytest", "calendar", "email"]));
      expect(checkpoint("client-preparation-completed")?.toolCount).toBe(31);
      expect(checkpoint("attempt-bundle-completed")?.toolCount).toBeGreaterThan(0);
      expect(checkpoint("attempt-tool-catalog-entered")).toBeDefined();
      expect(checkpoint("attempt-tool-catalog-completed")).toBeDefined();
      expect(checkpoint("attempt-system-prompt-completed")).toBeDefined();
      expect(checkpoint("attempt-transcript-lifecycle-completed")).toBeDefined();
      expect(checkpoint("attempt-session-runtime-completed")).toBeDefined();
      expect(checkpoint("attempt-history-preparation-completed")).toBeDefined();
      expect(checkpoint("prompt-phase-entered")?.toolCount).toBe(31);
      expect(checkpoint("provider-request-constructed")?.toolCount).toBe(31);
      expect(delegatedRequests).toBe(0);
    } finally {
      abortController.abort(new Error("offline v1I provider boundary complete"));
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Windows can retain the agent database lock until this test process exits.
      }
    }
  }, 60_000);

  it("serializes the raw request-preparation failure and last checkpoint", async () => {
    const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!benchmarkCase) {
      throw new Error("held-out corpus is empty");
    }
    const originalFetch = globalThis.fetch;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-offline-"));
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/chat/completions")) {
        const body = [
          `data: ${JSON.stringify({
            id: "offline-v1i",
            object: "chat.completion.chunk",
            created: 0,
            model: MODEL_ID,
            choices: [{ index: 0, delta: { content: "offline" }, finish_reason: null }],
          })}`,
          `data: ${JSON.stringify({
            id: "offline-v1i",
            object: "chat.completion.chunk",
            created: 0,
            model: MODEL_ID,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}`,
          "data: [DONE]",
          "",
        ].join("\n\n");
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected offline request: ${url} ${init?.method ?? "GET"}`);
    };
    try {
      const configured = buildLiveConfig(workspaceDir);
      expect(configured.agents?.list).toEqual([
        {
          id: "main",
          default: true,
          workspace: workspaceDir,
          agentDir: path.join(workspaceDir, "agent"),
        },
      ]);
      const failingConfig = {
        ...configured,
        agents: { defaults: configured.agents?.defaults },
      } satisfies OpenClawConfig;
      const observation = await runOne({
        mode: "synthetic",
        surfaceMode: "SYNTHETIC",
        benchmarkCase,
        mappingClass: "SYNTHETIC",
        authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
        v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
        arm: "A",
        replicate: 1,
        attempt: 1,
        scheduleSeed: scheduleSeedFor(benchmarkCase.id, 1),
        config: failingConfig,
        workspaceDir,
      });
      expect(observation.valid).toBe(false);
      expect(observation.invalidReason).toBe("REQUEST_PREPARATION_ERROR");
      expect(observation.requestPreparationDiagnostics).toMatchObject({
        normalizedRuntimeStatus: "runtime-error",
        highLevelClassification: "REQUEST_PREPARATION_ERROR",
        failureClass: "OTHER_REQUEST_PREPARATION_ERROR",
        lastSuccessfulCheckpoint: "runner-entry",
        failure: {
          errorName: "RunWorkspaceRosterRequiredError",
          failureFile: expect.stringContaining("src/agents/workspace-run.ts"),
          failureFunction: "resolveRunWorkspaceDir",
          failureStage: "run-embedded-agent",
        },
      });
      expect(observation.requestPreparationDiagnostics?.failure?.errorMessage).toContain(
        "No agents configured",
      );
    } finally {
      globalThis.fetch = originalFetch;
      try {
        fs.rmSync(workspaceDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch {
        // Windows can retain the agent database lock until this test process exits.
      }
    }
  }, 60_000);

  it("proves the 31-tool request boundary without entering provider completion", async () => {
    const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!benchmarkCase) {
      throw new Error("held-out corpus is empty");
    }
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-request-boundary-"));
    const captured: CapturedModelRequest[] = [];
    const abortController = new AbortController();
    let delegatedRequests = 0;
    try {
      await installOfflinePreparedRuntimeMock();
      const observation = await runOne({
        mode: "synthetic",
        surfaceMode: "SYNTHETIC",
        benchmarkCase,
        mappingClass: "SYNTHETIC",
        authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
        v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
        arm: "A",
        replicate: 1,
        attempt: 1,
        scheduleSeed: scheduleSeedFor(benchmarkCase.id, 1),
        config: buildOfflineRequestConfig(workspaceDir),
        workspaceDir,
        directRunner: true,
        provider: "openai",
        model: "mock-replay",
        abortSignal: abortController.signal,
        requestCapture: {
          stopAfterCapture: true,
          onRequestCaptured: (request) => {
            captured.push(request);
            abortController.abort(new V1IProviderRequestCapturedError());
          },
          onDelegatedRequest: () => {
            delegatedRequests += 1;
          },
        },
      });
      const names = toolNamesFromBody(captured[0]?.body ?? {});
      const checkpoints = observation.requestPreparationDiagnostics?.checkpoints ?? [];
      const checkpoint = (stage: string) => checkpoints.find((entry) => entry.stage === stage);
      expect(observation.valid).toBe(false);
      expect(observation.invalidReason).toBe("HARNESS_ERROR");
      expect(captured).toHaveLength(1);
      expect(names).toHaveLength(31);
      expect(new Set(names)).toHaveLength(31);
      expect(new Set(names)).toEqual(new Set(benchmarkCase.tools.map((tool) => tool.name)));
      expect(names).toEqual(expect.arrayContaining(["git_diff", "pytest", "calendar", "email"]));
      expect(checkpoint("client-preparation-completed")?.toolCount).toBe(31);
      expect(checkpoint("attempt-bundle-completed")?.toolCount).toBeGreaterThan(0);
      expect(checkpoint("prompt-phase-entered")?.toolCount).toBe(31);
      expect(checkpoint("prompt-tool-surface-completed")?.toolCount).toBe(31);
      expect(checkpoint("provider-request-constructed")?.toolCount).toBe(31);
      expect(observation.requestPreparationDiagnostics?.failure?.errorName).toBe(
        "V1IProviderRequestCapturedError",
      );
      expect(checkpoints.every((entry) => entry.observedAt && entry.elapsedMs !== undefined)).toBe(
        true,
      );
      expect(delegatedRequests).toBe(0);
    } finally {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Windows can retain the agent database lock until this test process exits.
      }
    }
  }, 60_000);

  it("bounds a stalled provider boundary with the last checkpoint", async () => {
    const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!benchmarkCase) {
      throw new Error("held-out corpus is empty");
    }
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-request-stall-"));
    const abortController = new AbortController();
    let delegatedRequests = 0;
    try {
      await installOfflinePreparedRuntimeMock();
      const observation = await runOne({
        mode: "synthetic",
        surfaceMode: "SYNTHETIC",
        benchmarkCase,
        mappingClass: "SYNTHETIC",
        authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
        v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
        arm: "A",
        replicate: 1,
        attempt: 1,
        scheduleSeed: scheduleSeedFor(benchmarkCase.id, 1),
        config: buildOfflineRequestConfig(workspaceDir),
        workspaceDir,
        abortSignal: abortController.signal,
        timeoutMs: 1_000,
        directRunner: true,
        provider: "openai",
        model: "mock-replay",
        requestCapture: {
          holdAfterCapture: true,
          onRequestCaptured: () => {
            abortController.abort(new Error("v1I deterministic provider stall timeout"));
          },
          onDelegatedRequest: () => {
            delegatedRequests += 1;
          },
        },
      });
      const checkpoints = observation.requestPreparationDiagnostics?.checkpoints ?? [];
      expect(observation.valid).toBe(false);
      expect(observation.requestPreparationDiagnostics?.normalizedRuntimeStatus).toBe("aborted");
      expect(checkpoints.at(-1)?.stage).toBe("provider-request-constructed");
      expect(observation.requestPreparationDiagnostics?.lastSuccessfulCheckpoint).toBe(
        "provider-request-constructed",
      );
      expect(delegatedRequests).toBe(0);
    } finally {
      abortController.abort(new Error("v1I deterministic provider stall timeout"));
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Windows can retain the agent database lock until this test process exits.
      }
    }
  }, 30_000);
});

async function installOfflinePreparedRuntimeMock(): Promise<void> {
  vi.doMock("../prepared-model-runtime.js", async () => {
    const actual = await vi.importActual<typeof import("../prepared-model-runtime.js")>(
      "../prepared-model-runtime.js",
    );
    const { AuthStorage } = await import("../sessions/auth-storage.js");
    const { ModelRegistry } = await import("../sessions/model-registry.js");
    const { buildInlineProviderModels } =
      await import("../embedded-agent-runner/model.inline-provider.js");
    const { createEmptyPluginRegistry } = await import("../../plugins/registry-empty.js");
    const { createEmptyPluginMetadataSnapshot } =
      await import("../test-helpers/embedded-agent-runner-e2e-mocks.js");
    const acquire = async (input: {
      agentId?: string;
      agentDir: string;
      inheritedAuthDir?: string;
      workspaceDir?: string;
      allowGatewaySubagentBinding?: boolean;
      config: { models?: { providers?: Parameters<typeof buildInlineProviderModels>[0] } };
    }) => {
      const authStorage = AuthStorage.inMemory();
      authStorage.setRuntimeApiKey(PROVIDER, "lmstudio");
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const providers = input.config.models?.providers ?? {};
      return {
        snapshot: {
          ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
          agentDir: input.agentDir,
          ...(input.inheritedAuthDir !== undefined
            ? { inheritedAuthDir: input.inheritedAuthDir }
            : {}),
          ...(input.workspaceDir !== undefined ? { workspaceDir: input.workspaceDir } : {}),
          activeProjectKeys: [],
          config: input.config,
          authModes: {},
          metadataSnapshot: createEmptyPluginMetadataSnapshot(input.workspaceDir),
          pluginRegistry: createEmptyPluginRegistry(),
          allowGatewaySubagentBinding: input.allowGatewaySubagentBinding === true,
          modelCatalog: { entries: [], routeVariants: [] },
          configuredRuntimeModels: [],
          inlineProviderModels: buildInlineProviderModels(providers),
          createStores: () => ({ authStorage, modelRegistry }),
        },
        release: () => {},
      };
    };
    return {
      ...actual,
      acquireAgentRunPreparedModelRuntime: acquire,
      acquireReadOnlyPreparedModelRuntime: acquire,
    } as typeof actual;
  });
}

async function assertLiveModelAvailable(signal?: AbortSignal): Promise<void> {
  const response = await fetch("http://127.0.0.1:1234/api/v1/models", { signal });
  if (!response.ok) {
    throw new Error(`PREPARED_NOT_STARTED: LM Studio discovery returned ${response.status}`);
  }
  const body = (await response.json()) as { models?: Array<{ key?: string; type?: string }> };
  if (!body.models?.some((model) => model.key === MODEL_ID && model.type === "llm")) {
    throw new Error(`PREPARED_NOT_STARTED: configured model ${MODEL_ID} is unavailable`);
  }
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function captureModelPayloads(
  hooks?: NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>,
  options?: {
    stopAfterCapture?: boolean;
    holdAfterCapture?: boolean;
    onRequestCaptured?: (request: CapturedModelRequest) => void;
    onDelegatedRequest?: () => void;
  },
): ModelPayloadCapture {
  const requests: CapturedModelRequest[] = [];
  let providerRequestRecorded = false;
  let delegatedRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (
      (url.startsWith(LM_STUDIO_BASE_URL) ||
        url.includes("/chat/completions") ||
        url.includes("/responses")) &&
      typeof body === "string" &&
      body.trim().startsWith("{")
    ) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const request = { body: parsed, url };
      if (!providerRequestRecorded) {
        requests.push(request);
        options?.onRequestCaptured?.(request);
      }
      const toolNames = toolNamesFromBody(parsed);
      hooks?.onCheckpoint?.({
        stage: "provider-request-constructed",
        toolCount: toolNames.length,
        representativeToolNames: toolNames,
      });
      if (options?.stopAfterCapture) {
        throw new V1IProviderRequestCapturedError();
      }
      if (options?.holdAfterCapture) {
        const signal = init?.signal;
        return await new Promise<Response>((_, reject) => {
          if (signal?.aborted) {
            reject(abortReason(signal));
            return;
          }
          signal?.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
        });
      }
    }
    options?.onDelegatedRequest?.();
    delegatedRequests += 1;
    return await originalFetch(input, init);
  };
  return {
    requests,
    delegatedRequests,
    recordProviderRequest: (request) => {
      providerRequestRecorded = true;
      requests.push(request);
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function sameSurfaceAcrossRequests(bodies: readonly Record<string, unknown>[]): boolean {
  const first = canonicalizeV1IValue(toolNamesFromBody(bodies[0] ?? {}));
  return bodies.every((body) => canonicalizeV1IValue(toolNamesFromBody(body)) === first);
}

function sameSchemaAcrossRequests(bodies: readonly Record<string, unknown>[]): boolean {
  const first = canonicalizeV1IValue(bodies[0]?.tools ?? null);
  return bodies.every((body) => canonicalizeV1IValue(body.tools ?? null) === first);
}

function sameSurfaceAsExpected(
  body: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return canonicalizeV1IValue(toolNamesFromBody(body)) === canonicalizeV1IValue([...expected]);
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
  const statusReason = invalidReasonForExecutionStatus(
    input.execution.status,
    input.requestBodies.length,
  );
  if (statusReason) {
    return statusReason;
  }
  if (!input.observedRanking?.epoch) {
    return "MISSING_RANKING_EPOCH";
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

function invalidReasonForExecutionStatus(status: string, requestCount: number): string | null {
  if (status === "completed") {
    return requestCount > 0 ? null : "NOT_CAPTURED";
  }
  if (status === "model-error") {
    return "MODEL_ERROR";
  }
  if (status === "runtime-error") {
    return requestCount > 0 ? "HARNESS_ERROR" : "REQUEST_PREPARATION_ERROR";
  }
  return "HARNESS_ERROR";
}

function terminalFailureReasonForExecution(input: {
  status: string;
  requestCount: number;
  terminalSuccess: boolean;
  observedFailure: boolean;
}): string | null {
  if (input.terminalSuccess) {
    return null;
  }
  if (input.observedFailure) {
    return "TOOL_ERROR";
  }
  return invalidReasonForExecutionStatus(input.status, input.requestCount) ?? "HARNESS_ERROR";
}
