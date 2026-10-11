/* oxlint-disable max-lines -- v1I live/offline evidence paths share one frozen harness. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configureAiTransportHost, getAiTransportHost } from "@openclaw/ai";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { AssistantMessage } from "../../llm/types.js";
import { applyTestPluginDefaults } from "../../plugins/config-state.js";
import type { RunEmbeddedAgentParams } from "../embedded-agent-runner/run/params.js";
import type { EmbeddedAgentRunResult } from "../embedded-agent-runner/types.js";
import {
  createPostResponseLiveness,
  emitPostResponseHeartbeat,
  type PostResponseCheckpoint,
  type PostResponseCounter,
  type PostResponseHeartbeat,
  type PostResponseLiveness,
  type PostResponseSnapshot,
} from "../post-response-liveness.js";
import type {
  PreparedRuntimeAcquisitionHeartbeat,
  PreparedRuntimePluginDiscoveryInputs,
  PreparedRuntimePluginTiming,
} from "../prepared-runtime-acquisition-liveness.js";
import { resolveAgentRunSessionTarget } from "../run-session-target.js";
import { resolveRunWorkspaceDir } from "../workspace-run.js";
import {
  getBenchmarkRealToolMapping,
  summarizeBenchmarkRealToolMappings,
  type BenchmarkCaseEligibility,
} from "./benchmark-real-tool-mapping.js";
import type { EmbeddedReplayFact } from "./embedded-replay-observation.js";
import {
  correlateToolCallsAndExecutions,
  type CorrelationExecution,
  type CorrelationToolCall,
} from "./model-choice-experiment-correlation.js";
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
  type V1IRequiredCell,
  type V1ISurfaceMode,
} from "./model-choice-experiment-evidence.js";
import {
  buildV1IResumeSelectionReport,
  resolveV1IResumeSelection,
} from "./model-choice-experiment-selection.js";
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
import {
  cleanupV1IWorkspace,
  persistV1IEvidenceBeforeCleanup,
} from "./v1i-evidence-finalization.js";

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
  createV1IAttemptCheckpointJournal,
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
  withSyntheticModelChoiceEnvironment,
  type Arm,
  type InvalidObservationInput,
  type MappingClass,
  type V1IAttemptCheckpointJournal,
} from "./model-choice-experiment-support.js";

type CapturedModelRequest = {
  body: Record<string, unknown>;
  url: string;
};

type ProviderResponseSummary = {
  responseClass: string;
  responseObjectType: string | null;
  responseId: string | null;
  responseModel: string | null;
  responseShape: string;
  finishReason: string | null;
  messageRole: string | null;
  contentPresent: boolean;
  contentLength: number;
  toolCallFieldPresent: boolean;
  toolCallCount: number;
  toolCallNames: string[];
  toolCallIds: string[];
  functionCallFieldPresent: boolean;
  outputItemTypes: string[];
  responseEventTypes: string[];
  parserOutcome: string;
  httpStatus: number | null;
  contentType: string | null;
  modelTurnIndex: number | null;
};

type SerializedSmokeError = {
  name: string;
  message: string;
};

type ProviderSummaryWriteDiagnostics = {
  providerSummaryPath: string;
  providerSummaryWriteAttempted: boolean;
  providerSummaryWriteCompleted: boolean;
  providerSummaryCallbackInvocations: number;
  providerSummaryWriteErrorName: string | null;
  providerSummaryWriteErrorMessage: string | null;
};

type ExperimentRun = V1IObservation;

type ModelPayloadCapture = {
  requests: CapturedModelRequest[];
  delegatedRequests: number;
  responseSummaries: ProviderResponseSummary[];
  originalFetch: typeof globalThis.fetch;
  wrapFetch: (baseFetch: typeof globalThis.fetch) => typeof globalThis.fetch;
  recordProviderRequest: (request: CapturedModelRequest) => void;
  restore: () => void;
};

class V1IProviderRequestCapturedError extends Error {
  constructor() {
    super("v1I provider request captured before network I/O");
    this.name = "V1IProviderRequestCapturedError";
  }
}

class V1ISmokeValidityError extends Error {
  constructor(readonly validityReason: string) {
    super(`v1I smoke validity failed: ${validityReason}`);
    this.name = "V1ISmokeValidityError";
  }
}

class V1ISmokeEvidenceError extends Error {
  constructor(readonly evidenceReason: string) {
    super(`v1I smoke evidence failed: ${evidenceReason}`);
    this.name = "V1ISmokeEvidenceError";
  }
}

const SMOKE_TEST = LIVE && process.env.OPENCLAW_V1I_SMOKE_TEST === "1";
const DIAGNOSTIC_TEST = LIVE && process.env.OPENCLAW_V1I_DIAGNOSTIC_TEST === "1";
const describeFullLive = LIVE && !SMOKE_TEST && !DIAGNOSTIC_TEST ? describe : describe.skip;
const describeSmokeLive = SMOKE_TEST ? describe : describe.skip;
const describeDiagnosticLive = DIAGNOSTIC_TEST ? describe : describe.skip;
const LIVE_MODE = resolveV1IMode(LIVE, process.env.OPENCLAW_V1I_MODE);

describe("v1I diagnostic resource resolution", () => {
  it("resolves the production state schema independently of CWD and artifact location", async () => {
    const previousArtifactDir = process.env.OPENCLAW_V1I_DIAGNOSTIC_ARTIFACT_DIR;
    const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-schema-cwd-"));
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-schema-artifact-"));
    const schemaPath = fileURLToPath(
      new URL("../../state/openclaw-state-schema.sql", import.meta.url),
    );
    const expectedSchema = fs.readFileSync(schemaPath, "utf8");
    const expectedHash = createHash("sha256").update(expectedSchema).digest("hex");
    const schemaModuleUrl = pathToFileURL(
      fileURLToPath(new URL("../../state/openclaw-state-schema.ts", import.meta.url)),
    ).href;
    const tsxLoader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
    const probe = [
      `const { createHash } = await import("node:crypto");`,
      `const schema = await import(${JSON.stringify(schemaModuleUrl)});`,
      `process.stdout.write(createHash("sha256").update(schema.OPENCLAW_STATE_SCHEMA_SQL).digest("hex"));`,
    ].join(" ");
    const readSchemaHash = (cwd: string): string =>
      execFileSync(process.execPath, ["--import", tsxLoader, "--input-type=module", "-e", probe], {
        cwd,
        encoding: "utf8",
      }).trim();
    try {
      process.env.OPENCLAW_V1I_DIAGNOSTIC_ARTIFACT_DIR = artifactDir;
      expect(readSchemaHash(unrelatedCwd)).toBe(expectedHash);
      expect(readSchemaHash(artifactDir)).toBe(expectedHash);
    } finally {
      if (previousArtifactDir === undefined) {
        delete process.env.OPENCLAW_V1I_DIAGNOSTIC_ARTIFACT_DIR;
      } else {
        process.env.OPENCLAW_V1I_DIAGNOSTIC_ARTIFACT_DIR = previousArtifactDir;
      }
      fs.rmSync(unrelatedCwd, { recursive: true, force: true });
      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});

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

  it("serializes completed evidence before cleanup", async () => {
    const events: string[] = [];
    const record = { outcome: "tool-call", tool: "write" };
    const finalization = await persistV1IEvidenceBeforeCleanup({
      record,
      evidenceComplete: true,
      serialize: (value) => {
        events.push(`serialize:${value.outcome}`);
      },
      cleanup: async ({ evidenceComplete, serializationComplete }) => {
        events.push(`cleanup:${evidenceComplete}:${serializationComplete}`);
        return makeCleanupOutcome({ secondary: false });
      },
    });
    expect(events).toEqual(["serialize:tool-call", "cleanup:true:true"]);
    expect(finalization.serializationComplete).toBe(true);
    expect(finalization.cleanup.result).toBe("SUCCESS");
  });

  it("keeps cleanup EPERM secondary after durable evidence", async () => {
    let serialized = false;
    const finalization = await persistV1IEvidenceBeforeCleanup({
      record: { valid: true },
      evidenceComplete: true,
      serialize: () => {
        serialized = true;
      },
      cleanup: async ({ evidenceComplete, serializationComplete }) => {
        expect(serialized).toBe(true);
        expect(evidenceComplete).toBe(true);
        expect(serializationComplete).toBe(true);
        return makeCleanupOutcome({ result: "EPERM", secondary: true });
      },
    });
    expect(finalization.serializationComplete).toBe(true);
    expect(finalization.cleanup).toMatchObject({ result: "EPERM", secondary: true });
  });

  it("fails closed when evidence serialization fails", async () => {
    let cleanupInput: { evidenceComplete: boolean; serializationComplete: boolean } | undefined;
    const finalization = await persistV1IEvidenceBeforeCleanup({
      record: { valid: true },
      evidenceComplete: true,
      serialize: () => {
        throw new Error("disk full");
      },
      cleanup: async (input) => {
        cleanupInput = input;
        return makeCleanupOutcome({ result: "EPERM", secondary: false });
      },
    });
    expect(finalization.serializationComplete).toBe(false);
    expect(finalization.serializationErrorMessage).toBe("disk full");
    expect(cleanupInput).toEqual({ evidenceComplete: true, serializationComplete: false });
    expect(finalization.cleanup.secondary).toBe(false);
  });

  it("keeps cleanup failure non-secondary when terminal evidence is incomplete", async () => {
    const finalization = await persistV1IEvidenceBeforeCleanup({
      record: { valid: false, invalidReason: "HARNESS_ERROR" },
      evidenceComplete: false,
      serialize: () => undefined,
      cleanup: async ({ evidenceComplete, serializationComplete }) => {
        expect(evidenceComplete).toBe(false);
        expect(serializationComplete).toBe(true);
        return makeCleanupOutcome({ result: "EPERM", secondary: false });
      },
    });
    expect(finalization.cleanup).toMatchObject({ result: "EPERM", secondary: false });
  });

  it("writes an invalid attempt before cleanup and resumes without duplicating a valid cell", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-evidence-resume-"));
    try {
      const input = makeTestInvalidObservationInput();
      const invalid = makeInvalidObservation({ ...input, reason: "HARNESS_ERROR" });
      fs.writeFileSync(path.join(root, "synthetic-invalid.jsonl"), `${JSON.stringify(invalid)}\n`);
      const valid = {
        ...invalid,
        valid: true,
        invalidReason: null,
        rankingEpoch: "epoch-1",
        correlationStatus: "PROVABLE" as const,
      };
      appendV1IObservation(root, "synthetic", valid);
      const sets = splitV1IExperimentSets(
        TOOL_RANKING_HELD_OUT_CASES,
        summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES),
      );
      const state = createV1IArtifactState(root, buildManifest(sets), "synthetic");
      expect(state.observations).toHaveLength(1);
      expect(state.invalidAttempts).toHaveLength(1);
      expect(v1ICellKey(state.observations[0]!)).toBe(v1ICellKey(valid));
      expect(() => assertNoDuplicateValidCells([...state.observations, valid])).toThrow(
        "duplicate valid v1I cell",
      );
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

  it("records sanitized no-tool and tool-call response summaries after body parsing", async () => {
    const noTool = await captureProviderSummaryForFixture(
      [
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"done"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n\n"),
    );
    expect(noTool.parserOutcome).toBe("no-tool-complete");
    expect(noTool.responseShape).toContain("chat.completion.chunk");
    expect(noTool.finishReason).toBe("stop");
    expect(noTool.contentPresent).toBe(true);
    expect(noTool.contentLength).toBe(4);
    expect(noTool.messageRole).toBeNull();
    expect(noTool.toolCallFieldPresent).toBe(false);
    expect(noTool.functionCallFieldPresent).toBe(false);
    expect(noTool.responseEventTypes).toEqual([]);
    expect(noTool.toolCallCount).toBe(0);

    const toolCall = await captureProviderSummaryForFixture(
      [
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"git_diff"}}]},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ].join("\n\n"),
    );
    expect(toolCall.parserOutcome).toBe("tool-call-complete");
    expect(toolCall.toolCallFieldPresent).toBe(true);
    expect(toolCall.functionCallFieldPresent).toBe(true);
    expect(toolCall.toolCallCount).toBe(1);
    expect(toolCall.toolCallNames).toEqual(["git_diff"]);
  });

  it("captures the normalized live-path tool-call and no-tool response shapes", () => {
    const toolCall = summarizeAssistantMessage(
      makeAssistantMessage([
        { type: "toolCall", id: "call-git-status", name: "git_status", arguments: {} },
      ]),
      0,
    );
    expect(toolCall.responseClass).toBe("TOOL_CALL_RESPONSE");
    expect(toolCall.toolCallCount).toBe(1);
    expect(toolCall.toolCallNames).toEqual(["git_status"]);
    expect(toolCall.toolCallIds).toEqual(["call-git-status"]);
    expect(toolCall.modelTurnIndex).toBe(0);

    const noTool = summarizeAssistantMessage(
      makeAssistantMessage([{ type: "text", text: "done" }]),
      1,
    );
    expect(noTool.responseClass).toBe("NO_TOOL_TEXT_RESPONSE");
    expect(noTool.toolCallCount).toBe(0);
    expect(noTool.contentLength).toBe(4);
    expect(noTool.modelTurnIndex).toBe(1);
  });

  it("installs the live-path observer before the run and restores it afterward", async () => {
    const diagnostics = createExperimentDiagnostics();
    const observations: string[] = [];
    const restore = installAssistantMessageObserver(diagnostics.hooks, (_message, turn) => {
      observations.push(
        `turn-${turn}:${diagnostics.hooks.onAssistantMessage ? "active" : "missing"}`,
      );
    });

    expect(diagnostics.hooks.onAssistantMessage).toBeTypeOf("function");
    diagnostics.hooks.onAssistantMessage?.(makeAssistantMessage([{ type: "text", text: "ok" }]));
    expect(observations).toEqual(["turn-0:active"]);

    restore();
    expect(diagnostics.hooks.onAssistantMessage).toBeUndefined();
  });

  it("writes normalized response evidence before later terminal stages", () => {
    const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-normalized-evidence-"));
    const providerSummaryPath = path.join(smokeRoot, "smoke-provider-response.json");
    try {
      const diagnostics = createExperimentDiagnostics();
      const summaries: ProviderResponseSummary[] = [];
      const restore = installAssistantMessageObserver(diagnostics.hooks, (message, turn) => {
        summaries.push(summarizeAssistantMessage(message, turn));
        writeSmokeProviderResponseSummary(providerSummaryPath, summaries);
      });
      diagnostics.hooks.onAssistantMessage?.(
        makeAssistantMessage([
          { type: "toolCall", id: "call-git-status", name: "git_status", arguments: {} },
        ]),
      );
      expect(fs.existsSync(providerSummaryPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(providerSummaryPath, "utf8")).summaries[0]).toMatchObject({
        responseClass: "TOOL_CALL_RESPONSE",
        toolCallNames: ["git_status"],
      });
      restore();
    } finally {
      fs.rmSync(smokeRoot, { recursive: true, force: true });
    }
  });

  it("compares authorized tool surfaces semantically while reporting real drift", () => {
    const expected = ["git_diff", "pytest", "git_status"];
    expect(compareToolSurfaces(expected, ["git_status", "git_diff", "pytest"])).toEqual({
      canonicalEqual: true,
      orderEqual: false,
      added: [],
      missing: [],
    });
    expect(compareToolSurfaces(expected, ["git_diff", "pytest", "calendar"])).toEqual({
      canonicalEqual: false,
      orderEqual: false,
      added: ["calendar"],
      missing: ["git_status"],
    });
    expect(
      sameSurfaceAsExpected(
        { tools: [{ function: { name: "git_status" } }, { function: { name: "git_diff" } }] },
        ["git_diff", "git_status"],
      ),
    ).toBe(true);
  });

  it("validates REAL_EXACT against the authorized runtime surface, not the synthetic inventory", () => {
    const authorized = makeRealRuntimeToolSurface();
    const provider = { tools: authorized };
    const valid = validateV1IRealSurface({
      authorizedRuntimeNames: REAL_RUNTIME_TOOL_NAMES,
      authorizedToolDefinitions: authorized,
      providerBodies: [provider],
      requiredTools: ["write"],
    });
    expect(valid).toMatchObject({
      valid: true,
      authorizedProviderNameSetEqual: true,
      authorizedProviderSchemaSetEqual: true,
      orderEqual: true,
      exactToolPresent: true,
    });
    expect(REAL_RUNTIME_TOOL_NAMES).toHaveLength(15);
    expect(toolNamesFromBody(provider)).toHaveLength(15);
  });

  it.each([
    [
      "missing one authorized tool",
      (tools: unknown[]) => tools.slice(1),
      "AUTHORIZED_SURFACE_DRIFT",
    ],
    [
      "adding one unauthorized tool",
      (tools: unknown[]) => [...tools, makeRealRuntimeTool("unexpected")],
      "AUTHORIZED_SURFACE_DRIFT",
    ],
    [
      "changing a tool schema",
      (tools: unknown[]) => [
        ...tools.slice(0, 1),
        {
          ...(tools[1] as Record<string, unknown>),
          function: { name: "edit", parameters: { type: "string" } },
        },
        ...tools.slice(2),
      ],
      "SCHEMA_DRIFT",
    ],
  ])("rejects REAL_EXACT %s", (_label, mutate, expectedReason) => {
    const authorized = makeRealRuntimeToolSurface();
    const providerTools = mutate(authorized);
    const validation = validateV1IRealSurface({
      authorizedRuntimeNames: REAL_RUNTIME_TOOL_NAMES,
      authorizedToolDefinitions: authorized,
      providerBodies: [{ tools: providerTools }],
      requiredTools: ["write"],
    });
    expect(validation.valid).toBe(false);
    expect(validation.invalidReason).toBe(expectedReason);
  });

  it("rejects REAL_EXACT when the required mapped tool is absent from both surfaces", () => {
    const authorized = makeRealRuntimeToolSurface().filter(
      (tool) => toolNameFromDefinition(tool) !== "write",
    );
    const authorizedNames = REAL_RUNTIME_TOOL_NAMES.filter((name) => name !== "write");
    const validation = validateV1IRealSurface({
      authorizedRuntimeNames: authorizedNames,
      authorizedToolDefinitions: authorized,
      providerBodies: [{ tools: authorized }],
      requiredTools: ["write"],
    });
    expect(validation).toMatchObject({
      valid: false,
      authorizedProviderNameSetEqual: true,
      authorizedProviderSchemaSetEqual: true,
      exactToolPresent: false,
      invalidReason: "EXACT_MAPPED_TOOL_MISSING",
    });
  });

  it("accepts provider order changes without treating them as surface drift", () => {
    const authorized = makeRealRuntimeToolSurface();
    const validation = validateV1IRealSurface({
      authorizedRuntimeNames: REAL_RUNTIME_TOOL_NAMES,
      authorizedToolDefinitions: authorized,
      providerBodies: [{ tools: authorized.toReversed() }],
      requiredTools: ["write"],
    });
    expect(validation).toMatchObject({
      valid: true,
      authorizedProviderNameSetEqual: true,
      authorizedProviderSchemaSetEqual: true,
      orderEqual: false,
    });
  });

  it("keeps all eight REAL_EXACT mappings on the real runtime surface", () => {
    const mappingSummary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
    const exactCases = mappingSummary.cases.filter((entry) => entry.mappingClass === "EXACT");
    expect(exactCases).toHaveLength(8);
    for (const entry of exactCases) {
      const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES.find(
        (candidate) => candidate.id === entry.caseId,
      );
      expect(benchmarkCase).toBeDefined();
      const requiredTool = getBenchmarkRealToolMapping(
        benchmarkCase!.expectedTopTools[0]!,
      ).realTool;
      expect(requiredTool).not.toBeNull();
      const requiredTools = benchmarkCase!.expectedTopTools.flatMap((tool) => {
        const mapped = getBenchmarkRealToolMapping(tool).realTool;
        return mapped ? [mapped] : [];
      });
      expect(requiredTools.every((tool) => new Set(REAL_RUNTIME_TOOL_NAMES).has(tool))).toBe(true);
      expect(entry.mappingClass).toBe("EXACT");
    }
  });

  it("canonicalizes tool schema key and array order but detects schema changes", () => {
    const first = [
      { type: "function", function: { name: "git_diff", parameters: { type: "object" } } },
      { type: "function", function: { name: "pytest", parameters: { type: "object" } } },
    ];
    const reordered = [
      { function: { parameters: { type: "object" }, name: "pytest" }, type: "function" },
      { function: { parameters: { type: "object" }, name: "git_diff" }, type: "function" },
    ];
    const changed = [
      ...reordered.slice(0, 1),
      { function: { parameters: { type: "string" }, name: "git_diff" }, type: "function" },
    ];
    expect(canonicalizeToolDefinitions(first)).toBe(canonicalizeToolDefinitions(reordered));
    expect(sameSchemaAcrossRequests([{ tools: first }, { tools: reordered }])).toBe(true);
    expect(sameSchemaAcrossRequests([{ tools: first }, { tools: changed }])).toBe(false);
  });

  it("captures provider responses through the AI transport host fetch boundary", async () => {
    const summaries: ProviderResponseSummary[] = [];
    const capture = captureModelPayloads(undefined, {
      onResponseSummary: (summary) => summaries.push(summary),
    });
    const previousHost = getAiTransportHost();
    const fixture = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"git_status"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ].join("\n\n");
    try {
      configureAiTransportHost({
        ...previousHost,
        buildModelFetch: () =>
          capture.wrapFetch(
            async () => new Response(fixture, { headers: { "content-type": "text/event-stream" } }),
          ),
      });
      const hostFetch = getAiTransportHost().buildModelFetch(undefined as never);
      if (!hostFetch) {
        throw new Error("AI transport host did not provide a fetch implementation");
      }
      const response = await hostFetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        body: new TextEncoder().encode(
          JSON.stringify({ tools: [{ function: { name: "git_status" } }] }),
        ),
      });
      await response.text();
      expect(summaries.at(-1)).toMatchObject({
        parserOutcome: "tool-call-complete",
        toolCallNames: ["git_status"],
        toolCallFieldPresent: true,
        functionCallFieldPresent: true,
      });
    } finally {
      configureAiTransportHost(previousHost);
      capture.restore();
    }
  });

  it("preserves provider evidence before recording an invalid smoke result", async () => {
    const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-invalid-evidence-"));
    try {
      const summary = await captureProviderSummaryForFixture(
        [
          'data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ].join("\n\n"),
      );
      const writeResult = writeSmokeProviderResponseSummary(
        path.join(smokeRoot, "smoke-provider-response.json"),
        [summary],
      );
      expect(writeResult.providerSummaryWriteAttempted).toBe(true);
      expect(writeResult.providerSummaryWriteCompleted).toBe(true);
      writeSmokeInvalidArtifact({
        smokeRoot,
        error: new V1ISmokeValidityError("AUTHORIZED_SURFACE_DRIFT"),
        lastSuccessfulCheckpoint: "terminal-observed",
        harnessCommit: HARNESS_COMMIT,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        providerSummaryWrite: {
          providerSummaryPath: path.join(smokeRoot, "smoke-provider-response.json"),
          ...writeResult,
          providerSummaryCallbackInvocations: 1,
        },
      });
      expect(fs.existsSync(path.join(smokeRoot, "smoke-provider-response.json"))).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(path.join(smokeRoot, "smoke-invalid.json"), "utf8")),
      ).toMatchObject({
        invalidReason: "AUTHORIZED_SURFACE_DRIFT",
        experimentLevelFailureClass: "VALIDITY_ERROR",
        validityReason: "AUTHORIZED_SURFACE_DRIFT",
      });
      expect(
        JSON.parse(fs.readFileSync(path.join(smokeRoot, "smoke-provider-response.json"), "utf8"))
          .summaries[0].parserOutcome,
      ).toBe("no-tool-complete");
    } finally {
      fs.rmSync(smokeRoot, { recursive: true, force: true });
    }
  });

  it("records explicit provider-summary write failures", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-summary-write-failure-"));
    fs.rmSync(root, { recursive: true, force: true });
    const writeResult = writeSmokeProviderResponseSummary(
      path.join(root, "smoke-provider-response.json"),
      [],
    );
    expect(writeResult.providerSummaryWriteAttempted).toBe(true);
    expect(writeResult.providerSummaryWriteCompleted).toBe(false);
    expect(writeResult.providerSummaryWriteErrorName).toBeTruthy();
    expect(writeResult.providerSummaryWriteErrorMessage).toBeTruthy();
  });

  it("retains duplicate tool executions for accounting instead of normalizing them away", () => {
    const accounting = summarizeExecutedTools([
      { name: "git_status", executionStarted: true },
      { name: "git_status", executionStarted: true },
      { name: "read", executionStarted: false },
    ]);
    expect(accounting.executedToolSequence).toEqual(["git_status", "git_status"]);
    expect(accounting.duplicateToolNames).toEqual(["git_status"]);
    expect(accounting.duplicateExecutionCount).toBe(1);
  });

  it("distinguishes duplicate provider observations by call id and model turn", () => {
    expect(
      classifyObservedToolCalls([
        { name: "git_status", id: "call-1", modelTurnIndex: 0 },
        { name: "git_status", id: "call-2", modelTurnIndex: 0 },
      ]),
    ).toBe("DISTINCT_PROVIDER_CALLS");
    expect(
      classifyObservedToolCalls([
        { name: "git_status", id: "call-1", modelTurnIndex: 0 },
        { name: "git_status", id: "call-1", modelTurnIndex: 0 },
      ]),
    ).toBe("DUPLICATE_OBSERVATION");
    expect(
      classifyObservedToolCalls([
        { name: "git_status", id: "call-1", modelTurnIndex: 0 },
        { name: "git_status", id: "call-2", modelTurnIndex: 1 },
      ]),
    ).toBe("MULTI_TURN_REPEAT");
  });

  it("keeps a primary terminal timeout authoritative over cleanup errors", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-cleanup-precedence-"));
    try {
      const timeout = new V1ISmokeTimeoutError({
        timeoutStage: "terminalCompletion",
        timeoutMs: 60_000,
        lastSuccessfulCheckpoint: "provider-response-received",
      });
      writeSmokeInvalidArtifact({
        smokeRoot: root,
        error: timeout,
        lastSuccessfulCheckpoint: "provider-response-received",
        harnessCommit: HARNESS_COMMIT,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        cleanupErrors: [{ name: "EPERM", message: "cleanup handle still open" }],
      });
      const invalid = JSON.parse(
        fs.readFileSync(path.join(root, "smoke-invalid.json"), "utf8"),
      ) as {
        invalidReason: string;
        failureStage: string;
        cleanupErrors: SerializedSmokeError[];
      };
      expect(invalid.invalidReason).toBe("INFRASTRUCTURE_TIMEOUT");
      expect(invalid.failureStage).toBe("terminalCompletion");
      expect(invalid.cleanupErrors).toEqual([
        { name: "EPERM", message: "cleanup handle still open" },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
      const cleanupErrors: SerializedSmokeError[] = [];
      const providerSummaryWrite: ProviderSummaryWriteDiagnostics = {
        providerSummaryPath: path.join(smokeRoot, "smoke-provider-response.json"),
        providerSummaryWriteAttempted: false,
        providerSummaryWriteCompleted: false,
        providerSummaryCallbackInvocations: 0,
        providerSummaryWriteErrorName: null,
        providerSummaryWriteErrorMessage: null,
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
        const responseSummaries: ProviderResponseSummary[] = [];
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
              requestCapture: {
                onAssistantMessage: (message, modelTurnIndex) => {
                  const summary = summarizeAssistantMessage(message, modelTurnIndex);
                  responseSummaries.push(summary);
                  providerSummaryWrite.providerSummaryCallbackInvocations += 1;
                  const writeResult = writeSmokeProviderResponseSummary(
                    providerSummaryWrite.providerSummaryPath,
                    responseSummaries,
                  );
                  Object.assign(providerSummaryWrite, writeResult);
                  if (!writeResult.providerSummaryWriteCompleted) {
                    recordCheckpoint("provider-response-summary-write-failed", {
                      providerSummaryPath: providerSummaryWrite.providerSummaryPath,
                      providerSummaryWriteAttempted:
                        providerSummaryWrite.providerSummaryWriteAttempted,
                      providerSummaryWriteErrorName:
                        providerSummaryWrite.providerSummaryWriteErrorName,
                      providerSummaryWriteErrorMessage:
                        providerSummaryWrite.providerSummaryWriteErrorMessage,
                    });
                  }
                  recordCheckpoint(
                    summary.parserOutcome === "body-pending"
                      ? "provider-response-body-pending"
                      : "provider-response-parsed",
                    {
                      responseShape: summary.responseShape,
                      finishReason: summary.finishReason,
                      contentPresent: summary.contentPresent,
                      contentLength: summary.contentLength,
                      responseObjectType: summary.responseObjectType,
                      responseId: summary.responseId,
                      responseModel: summary.responseModel,
                      messageRole: summary.messageRole,
                      toolCallFieldPresent: summary.toolCallFieldPresent,
                      toolCallCount: summary.toolCallCount,
                      toolCallNames: summary.toolCallNames,
                      toolCallIds: summary.toolCallIds,
                      functionCallFieldPresent: summary.functionCallFieldPresent,
                      outputItemTypes: summary.outputItemTypes,
                      responseEventTypes: summary.responseEventTypes,
                      parserOutcome: summary.parserOutcome,
                      modelTurnIndex: summary.modelTurnIndex,
                    },
                  );
                  if (summary.toolCallCount > 0) {
                    recordCheckpoint("tool-call-parsed", {
                      toolCount: summary.toolCallCount,
                      representativeToolNames: summary.toolCallNames,
                    });
                  } else if (summary.parserOutcome === "no-tool-complete") {
                    recordCheckpoint("no-tool-response-detected");
                  }
                },
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
          try {
            fs.rmSync(workspaceDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 50,
            });
          } catch (error) {
            cleanupErrors.push(serializeSmokeError(error));
          }
        }
        const evidenceFailure = providerSummaryWrite.providerSummaryWriteCompleted
          ? undefined
          : new V1ISmokeEvidenceError(
              providerSummaryWrite.providerSummaryCallbackInvocations === 0
                ? "PROVIDER_RESPONSE_SUMMARY_MISSING"
                : "PROVIDER_RESPONSE_SUMMARY_WRITE_FAILED",
            );
        const result = {
          status: observation.valid && !evidenceFailure ? "PASS" : "FAIL",
          harnessCommit: HARNESS_COMMIT,
          modelConfigHash: smokeManifest.modelConfigHash,
          activeFilteringEnabled: false,
          observationValid: observation.valid,
          rankingEpoch: observation.rankingEpoch,
          cleanupErrors,
          ...providerSummaryWrite,
        };
        fs.writeFileSync(
          path.join(smokeRoot, "smoke-result.json"),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        if (evidenceFailure) {
          throw evidenceFailure;
        }
        if (!observation.valid) {
          throw new V1ISmokeValidityError(observation.invalidReason ?? "UNKNOWN_VALIDITY_ERROR");
        }
      } catch (error) {
        writeSmokeInvalidArtifact({
          smokeRoot,
          error,
          lastSuccessfulCheckpoint,
          harnessCommit: HARNESS_COMMIT,
          modelConfigHash: smokeManifest.modelConfigHash,
          cleanupErrors,
          providerSummaryWrite,
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

function writeSmokeProviderResponseSummary(
  providerSummaryPath: string,
  summaries: readonly ProviderResponseSummary[],
): Pick<
  ProviderSummaryWriteDiagnostics,
  | "providerSummaryWriteAttempted"
  | "providerSummaryWriteCompleted"
  | "providerSummaryWriteErrorName"
  | "providerSummaryWriteErrorMessage"
> {
  try {
    fs.writeFileSync(providerSummaryPath, `${JSON.stringify({ summaries }, null, 2)}\n`);
    return {
      providerSummaryWriteAttempted: true,
      providerSummaryWriteCompleted: true,
      providerSummaryWriteErrorName: null,
      providerSummaryWriteErrorMessage: null,
    };
  } catch (error) {
    return {
      providerSummaryWriteAttempted: true,
      providerSummaryWriteCompleted: false,
      providerSummaryWriteErrorName: error instanceof Error ? error.name : "NonErrorThrown",
      providerSummaryWriteErrorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeSmokeInvalidArtifact(input: {
  smokeRoot: string;
  error: unknown;
  lastSuccessfulCheckpoint: string;
  harnessCommit: string;
  modelConfigHash: string;
  cleanupErrors?: readonly SerializedSmokeError[];
  providerSummaryWrite?: ProviderSummaryWriteDiagnostics;
}): void {
  const timeout = input.error instanceof V1ISmokeTimeoutError ? input.error : undefined;
  const validity = input.error instanceof V1ISmokeValidityError ? input.error : undefined;
  const evidence = input.error instanceof V1ISmokeEvidenceError ? input.error : undefined;
  const rawErrorName = input.error instanceof Error ? input.error.name : "NonErrorThrown";
  const rawErrorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const invalid = {
    valid: false,
    invalidReason: timeout
      ? "INFRASTRUCTURE_TIMEOUT"
      : evidence
        ? evidence.evidenceReason
        : (validity?.validityReason ?? "HARNESS_ERROR"),
    experimentLevelFailureClass: timeout
      ? "INFRASTRUCTURE_TIMEOUT"
      : evidence
        ? "EVIDENCE_ARTIFACT_FAILURE"
        : validity
          ? "VALIDITY_ERROR"
          : "HARNESS_ERROR",
    failureStage:
      timeout?.timeoutStage ??
      (evidence ? "evidence-artifact" : validity ? "validity" : "smoke-harness"),
    validityReason: validity?.validityReason ?? null,
    rawErrorName,
    rawErrorMessage,
    lastSuccessfulCheckpoint: timeout?.lastSuccessfulCheckpoint ?? input.lastSuccessfulCheckpoint,
    timeoutMs: timeout?.timeoutMs ?? null,
    harnessCommit: input.harnessCommit,
    modelConfigHash: input.modelConfigHash,
    cleanupErrors: input.cleanupErrors ?? [],
    providerSummaryWrite: input.providerSummaryWrite ?? null,
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

describeDiagnosticLive("v1I model-choice diagnostic", () => {
  it(
    "runs one non-formal synthetic diagnostic cell with durable checkpoints",
    { timeout: 600_000 },
    async () => {
      expect(LIVE_MODE).toBe("synthetic");
      expect(ACTIVE_FILTERING_ENABLED).toBe(false);
      const diagnosticRootValue = process.env.OPENCLAW_V1I_DIAGNOSTIC_ARTIFACT_DIR;
      if (!diagnosticRootValue) {
        throw new Error("OPENCLAW_V1I_DIAGNOSTIC_ARTIFACT_DIR is required");
      }
      const diagnosticRoot = path.resolve(diagnosticRootValue);
      if (diagnosticRoot.includes("v1i-formal-60fe82b1-real-exact-run1")) {
        throw new Error("diagnostic artifact must not be the formal REAL_EXACT artifact");
      }
      if (fs.existsSync(diagnosticRoot) && fs.readdirSync(diagnosticRoot).length > 0) {
        throw new Error(`diagnostic artifact directory must be fresh: ${diagnosticRoot}`);
      }
      fs.mkdirSync(diagnosticRoot, { recursive: true });
      const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES.find(
        (entry) => entry.id === "file-write-notes",
      );
      if (!benchmarkCase) {
        throw new Error("file-write-notes benchmark case is missing");
      }
      const journal = createV1IAttemptCheckpointJournal({
        root: diagnosticRoot,
        attemptId: v1IAttemptId("SYNTHETIC", benchmarkCase.id, "B", 3, 1),
        caseId: benchmarkCase.id,
        arm: "B",
        replicate: 3,
        attemptIndex: 1,
      });
      journal.record("attempt-initialized");
      fs.writeFileSync(
        path.join(diagnosticRoot, "diagnostic-manifest.json"),
        `${JSON.stringify(
          {
            diagnosticOnly: true,
            harnessCommit: HARNESS_COMMIT,
            caseId: benchmarkCase.id,
            arm: "B",
            replicate: 3,
            attempt: 1,
            model: MODEL_ID,
            provider: PROVIDER,
            contextLength: CONTEXT_LENGTH,
            modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
            activeFilteringEnabled: false,
          },
          null,
          2,
        )}\n`,
      );
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-diagnostic-"));
      const config = buildLiveConfig(workspaceDir);
      const requestBodies: Record<string, unknown>[] = [];
      const assistantToolCalls: Array<{ name: string; id: string }> = [];
      const acquisitionHeartbeats: PreparedRuntimeAcquisitionHeartbeat[] = [];
      const pluginPrep = {
        // SAFETY: these arrays collect the typed observer payloads emitted by the prepared-runtime owner.
        discoveryInputs: [] as PreparedRuntimePluginDiscoveryInputs[],
        // SAFETY: these arrays collect the typed observer payloads emitted by the prepared-runtime owner.
        timings: [] as PreparedRuntimePluginTiming[],
      };
      const responseSummaries: ProviderResponseSummary[] = [];
      const postResponseCheckpoints: PostResponseCheckpoint[] = [];
      const postResponseHeartbeats: PostResponseHeartbeat[] = [];
      const postResponseSnapshots: PostResponseSnapshot[] = [];
      const postResponseCounters: PostResponseCounter[] = [];
      const preparationAbortController = new AbortController();
      let preparedRuntimeAcquisitionCompleted = false;
      let observation: ExperimentRun | undefined;
      let failure: unknown;
      try {
        journal.record("model-discovery-skipped-for-preparation-diagnostic");
        journal.record("workspace-session-prep-start");
        journal.record("workspace-session-prep-complete");
        observation = await runOne({
          mode: "synthetic",
          surfaceMode: "SYNTHETIC",
          benchmarkCase,
          mappingClass: "SYNTHETIC",
          authorizedNames: benchmarkCase.tools.map((tool) => tool.name),
          v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
          arm: "B",
          replicate: 3,
          attempt: 1,
          scheduleSeed: scheduleSeedFor(benchmarkCase.id, 3),
          config,
          workspaceDir,
          timeoutMs: 120_000,
          abortSignal: preparationAbortController.signal,
          attemptCheckpointJournal: journal,
          onAcquisitionHeartbeat: (heartbeat) => acquisitionHeartbeats.push(heartbeat),
          onPluginPrepDiscoveryInputs: (inputs) => pluginPrep.discoveryInputs.push(inputs),
          onPluginPrepTiming: (timing) => pluginPrep.timings.push(timing),
          onCheckpoint: (checkpoint) => {
            if (checkpoint.stage === "prepared-runtime-acquisition-completed") {
              preparedRuntimeAcquisitionCompleted = true;
              preparationAbortController.abort(
                new Error("v1I preparation diagnostic completed before model request"),
              );
            }
          },
          postResponseDiagnostics: true,
          onPostResponseCheckpoint: (checkpoint) => postResponseCheckpoints.push(checkpoint),
          onPostResponseHeartbeat: (heartbeat) => postResponseHeartbeats.push(heartbeat),
          onPostResponseSnapshot: (snapshot) => postResponseSnapshots.push(snapshot),
          onPostResponseCounter: (counter) => postResponseCounters.push(counter),
          requestCapture: {
            onRequestCaptured: (request) => requestBodies.push(request.body),
            onResponseSummary: (summary) => responseSummaries.push(summary),
            onAssistantMessage: (message) => {
              for (const block of message.content) {
                if (block.type === "toolCall") {
                  assistantToolCalls.push({ name: block.name, id: block.id });
                }
              }
            },
          },
        });
      } catch (error) {
        if (!preparedRuntimeAcquisitionCompleted) {
          failure = error;
        }
      }
      const checkpointPath = path.join(diagnosticRoot, "attempt-checkpoints.jsonl");
      const checkpoints = fs
        .readFileSync(checkpointPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { stage: string });
      const terminalObserved =
        checkpoints.some((checkpoint) => checkpoint.stage === "terminal-observed") ||
        postResponseCheckpoints.some(
          (checkpoint) => checkpoint.stage === "terminal-observation-complete",
        );
      const diagnosticResult = {
        diagnosticOnly: true,
        harnessCommit: HARNESS_COMMIT,
        caseId: benchmarkCase.id,
        arm: "B",
        replicate: 3,
        model: MODEL_ID,
        provider: PROVIDER,
        contextLength: CONTEXT_LENGTH,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        activeFilteringEnabled: false,
        status: failure
          ? "FAILED"
          : preparedRuntimeAcquisitionCompleted
            ? "PREPARED_RUNTIME_COMPLETED"
            : observation?.valid
              ? "COMPLETED"
              : "COMPLETED_INVALID",
        checkpointSequence: checkpoints.map((checkpoint) => checkpoint.stage),
        lastDurableCheckpoint: checkpoints.at(-1)?.stage ?? null,
        timeoutArmed: checkpoints.some((checkpoint) => checkpoint.stage === "timeout-armed"),
        timeoutFired: checkpoints.some((checkpoint) => checkpoint.stage === "timeout-fired"),
        abortRequested: checkpoints.some((checkpoint) => checkpoint.stage === "abort-requested"),
        abortObserved: checkpoints.some((checkpoint) => checkpoint.stage === "abort-observed"),
        modelRequestSent: requestBodies.length > 0,
        providerResponseReceived: checkpoints.some(
          (checkpoint) => checkpoint.stage === "provider-response-received",
        ),
        toolCallNames: assistantToolCalls.map((call) => call.name),
        toolCallIds: assistantToolCalls.map((call) => call.id),
        preparedRuntimeAcquisitionHeartbeatCount: acquisitionHeartbeats.length,
        preparedRuntimeAcquisitionMaxEventLoopDelayMs: Math.max(
          0,
          ...acquisitionHeartbeats.map((heartbeat) => heartbeat.eventLoopDelayMs),
        ),
        preparedRuntimeAcquisitionEventLoopDelayDetected: acquisitionHeartbeats.some(
          (heartbeat) => heartbeat.eventLoopDelayDetected,
        ),
        preparedRuntimeAcquisitionCompleted,
        pluginDiscoveryInputs: pluginPrep.discoveryInputs,
        pluginTimings: pluginPrep.timings,
        postResponseCheckpoints,
        postResponseHeartbeats,
        postResponseSnapshots,
        postResponseCounters,
        responseSummaries,
        postResponseTimeout:
          failure instanceof Error && failure.name === "PostResponseTimeoutError",
        executedToolSequence: observation?.executedToolSequence ?? [],
        rankingEpoch: observation?.rankingEpoch ?? null,
        correlationStatus: observation?.correlationStatus ?? null,
        terminalObserved,
        terminalEvidenceComplete: terminalObserved,
        resultValidationComplete: true,
        resultSerializationComplete: true,
        terminalSuccess: observation?.terminalSuccess ?? null,
        invalidReason: observation?.invalidReason ?? (failure ? "HARNESS_ERROR" : null),
        rawRuntimeStatus:
          observation?.requestPreparationDiagnostics.normalizedRuntimeStatus ?? null,
        originalErrorName: failure instanceof Error ? failure.name : null,
        originalErrorMessage: failure instanceof Error ? failure.message : null,
        artifactSerialization: "PASS",
      };
      const normalizedResponseComplete =
        requestBodies.length > 0 &&
        (responseSummaries.length > 0 ||
          postResponseSnapshots.some(
            (snapshot) => snapshot.kind === "normalized-assistant-message",
          ));
      const evidenceComplete =
        (preparedRuntimeAcquisitionCompleted && requestBodies.length === 0) ||
        (normalizedResponseComplete &&
          terminalObserved &&
          diagnosticResult.correlationStatus === "PROVABLE");
      const finalization = await persistV1IEvidenceBeforeCleanup({
        record: diagnosticResult,
        evidenceComplete,
        serialize: (record) => {
          if (failure) {
            fs.writeFileSync(
              path.join(diagnosticRoot, "diagnostic-invalid.json"),
              `${JSON.stringify(
                {
                  valid: false,
                  invalidReason: "HARNESS_ERROR",
                  experimentLevelFailureClass: "HARNESS_ERROR",
                  rawErrorName: failure instanceof Error ? failure.name : "NonErrorThrown",
                  rawErrorMessage:
                    failure instanceof Error ? failure.message : JSON.stringify(failure),
                  recordedAt: new Date().toISOString(),
                },
                null,
                2,
              )}\n`,
            );
          }
          fs.writeFileSync(
            path.join(diagnosticRoot, "diagnostic-result.json"),
            `${JSON.stringify(record, null, 2)}\n`,
          );
          journal.record("result-serialization-complete");
        },
        cleanup: async (cleanupInput) => {
          journal.record("cleanup-started-after-serialization", {
            elapsedMs: cleanupInput.serializationComplete ? 0 : undefined,
          });
          const cleanup = await cleanupV1IWorkspace({
            workspaceDir,
            ...cleanupInput,
          });
          journal.record(cleanup.result === "SUCCESS" ? "cleanup-complete" : "cleanup-failed", {
            elapsedMs: cleanup.cleanupElapsedMs,
          });
          fs.writeFileSync(
            path.join(diagnosticRoot, "diagnostic-cleanup.json"),
            `${JSON.stringify(cleanup, null, 2)}\n`,
          );
          return cleanup;
        },
      });
      if (!finalization.serializationComplete) {
        throw new Error(
          `v1I diagnostic evidence serialization failed: ${finalization.serializationErrorMessage ?? "unknown error"}`,
        );
      }
      if (requestBodies.length > 0) {
        throw new Error("v1I preparation diagnostic sent a model request");
      }
      if (failure) {
        throw failure instanceof Error ? failure : new Error("v1I diagnostic failure");
      }
    },
  );
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
      const selection = resolveV1IResumeSelection({
        mode,
        cases,
        completedCells,
        rawCellAllowlist: process.env.OPENCLAW_V1I_CELL_ALLOWLIST,
        rawMaxCells: process.env.OPENCLAW_V1I_MAX_CELLS,
      });
      const selectionReportPath = path.join(artifactRoot, "resume-selection.json");
      const persistSelectionReport = (
        extra: Parameters<typeof buildV1IResumeSelectionReport>[1] = {},
      ) => {
        fs.writeFileSync(
          selectionReportPath,
          `${JSON.stringify(buildV1IResumeSelectionReport(selection, extra), null, 2)}\n`,
        );
      };
      persistSelectionReport();
      const firstMissingCell = selection.selectedCells[0];
      const firstMissingKey = firstMissingCell ? v1ICellKey(firstMissingCell) : undefined;
      const firstAttemptIndex = firstMissingKey
        ? (nextAttemptByCell.get(firstMissingKey) ?? 1)
        : undefined;
      const firstCheckpointJournal =
        firstMissingCell && firstAttemptIndex !== undefined
          ? createV1IAttemptCheckpointJournal({
              root: artifactRoot,
              attemptId: v1IAttemptId(
                surfaceModeForV1IMode(mode),
                firstMissingCell.caseId,
                firstMissingCell.arm,
                firstMissingCell.replicate,
                firstAttemptIndex,
              ),
              caseId: firstMissingCell.caseId,
              arm: firstMissingCell.arm,
              replicate: firstMissingCell.replicate,
              attemptIndex: firstAttemptIndex,
            })
          : undefined;
      firstCheckpointJournal?.record("attempt-initialized");
      firstCheckpointJournal?.record("model-discovery-start");
      await assertLiveModelAvailable();
      firstCheckpointJournal?.record("model-discovery-complete");
      firstCheckpointJournal?.record("workspace-session-prep-start");
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-"));
      const config = buildLiveConfig(workspaceDir);
      firstCheckpointJournal?.record("workspace-session-prep-complete");
      try {
        const newRuns = await runStratum({
          mode,
          surfaceMode: surfaceModeForV1IMode(mode),
          cases,
          mappingByCase,
          config,
          workspaceDir,
          checkpointArtifactRoot: artifactRoot,
          selectedCells: selection.selectedCells,
          hasExplicitControl: selection.hasExplicitControl,
          initialCheckpointJournal:
            firstMissingKey && firstCheckpointJournal
              ? { cellKey: firstMissingKey, journal: firstCheckpointJournal }
              : undefined,
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
        persistSelectionReport({
          selectedAttemptCount: newRuns.length,
          completedValidCount: newRuns.filter((observation) => observation.valid).length,
          remainingInvalidCount: state.invalidAttempts.filter((observation) =>
            selection.selectedCells.some((cell) => v1ICellKey(cell) === v1ICellKey(observation)),
          ).length,
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
  checkpointArtifactRoot: string;
  selectedCells: readonly V1IRequiredCell[];
  hasExplicitControl: boolean;
  initialCheckpointJournal?: { cellKey: string; journal: V1IAttemptCheckpointJournal };
  completedCells: ReadonlySet<string>;
  nextAttemptByCell: ReadonlyMap<string, number>;
  onObservation: (observation: ExperimentRun) => void;
}): Promise<ExperimentRun[]> {
  const runs: ExperimentRun[] = [];
  const caseById = new Map(input.cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  const executionCells = input.hasExplicitControl
    ? input.selectedCells
    : input.cases.flatMap((benchmarkCase) =>
        Array.from({ length: 3 }, (_, index) => index + 1).flatMap((replicate) =>
          orderedArms(scheduleSeedFor(benchmarkCase.id, replicate)).map((arm) => ({
            surfaceMode: input.surfaceMode,
            caseId: benchmarkCase.id,
            arm,
            replicate,
          })),
        ),
      );
  for (const cell of executionCells) {
    const benchmarkCase = caseById.get(cell.caseId);
    if (!benchmarkCase) {
      throw new Error(`missing selected benchmark case: ${cell.caseId}`);
    }
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
    const requiredMappedTools =
      input.mode === "synthetic"
        ? []
        : benchmarkCase.expectedTopTools.flatMap((tool) => {
            const mapped = getBenchmarkRealToolMapping(tool).realTool;
            return mapped ? [mapped] : [];
          });
    const cellKey = v1ICellKey(cell);
    if (input.completedCells.has(cellKey)) {
      continue;
    }
    const attempt = input.nextAttemptByCell.get(cellKey) ?? 1;
    const checkpointJournal =
      input.initialCheckpointJournal?.cellKey === cellKey
        ? input.initialCheckpointJournal.journal
        : createV1IAttemptCheckpointJournal({
            root: input.checkpointArtifactRoot,
            attemptId: v1IAttemptId(
              cell.surfaceMode,
              cell.caseId,
              cell.arm,
              cell.replicate,
              attempt,
            ),
            caseId: cell.caseId,
            arm: cell.arm,
            replicate: cell.replicate,
            attemptIndex: attempt,
          });
    if (input.initialCheckpointJournal?.cellKey !== cellKey) {
      checkpointJournal.record("attempt-initialized");
    }
    const attemptInput = {
      mode: input.mode,
      surfaceMode: input.surfaceMode,
      benchmarkCase,
      mappingClass,
      authorizedNames,
      v1cTop8,
      requiredMappedTools,
      arm: cell.arm,
      replicate: cell.replicate,
      attempt,
      scheduleSeed: scheduleSeedFor(benchmarkCase.id, cell.replicate),
    } satisfies Omit<InvalidObservationInput, "reason">;
    const observation = await runV1IAttempt(
      attemptInput,
      () =>
        runOne({
          ...attemptInput,
          eligibility,
          config: input.config,
          workspaceDir: input.workspaceDir,
          attemptCheckpointJournal: checkpointJournal,
        }),
      input.onObservation,
    );
    runs.push(observation);
  }
  return runs;
}

function mergeV1IAbortSignals(
  signals: readonly (AbortSignal | undefined)[],
): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      continue;
    }
    signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  }
  return controller.signal;
}

function v1IAttemptId(
  surfaceMode: V1ISurfaceMode,
  caseId: string,
  arm: Arm,
  replicate: number,
  attempt: number,
): string {
  return `v1i-${surfaceMode.toLowerCase()}-${caseId}-${arm}-${replicate}-attempt-${attempt}`;
}

async function runOne(input: {
  mode: V1IMode;
  surfaceMode: V1ISurfaceMode;
  benchmarkCase: ToolRankingBenchmarkCase;
  eligibility?: BenchmarkCaseEligibility;
  mappingClass: MappingClass;
  authorizedNames: readonly string[];
  v1cTop8: readonly string[];
  requiredMappedTools?: readonly string[];
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
    onResponseSummary?: (summary: ProviderResponseSummary) => void;
    onAssistantMessage?: (message: AssistantMessage, modelTurnIndex: number) => void;
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
  onAcquisitionHeartbeat?: (heartbeat: PreparedRuntimeAcquisitionHeartbeat) => void;
  onPluginPrepDiscoveryInputs?: (inputs: PreparedRuntimePluginDiscoveryInputs) => void;
  onPluginPrepTiming?: (timing: PreparedRuntimePluginTiming) => void;
  postResponseDiagnostics?: boolean;
  onPostResponseCheckpoint?: (checkpoint: PostResponseCheckpoint) => void;
  onPostResponseHeartbeat?: (heartbeat: PostResponseHeartbeat) => void;
  onPostResponseSnapshot?: (snapshot: PostResponseSnapshot) => void;
  onPostResponseCounter?: (counter: PostResponseCounter) => void;
  attemptCheckpointJournal?: V1IAttemptCheckpointJournal;
}): Promise<ExperimentRun> {
  if (input.mode === "synthetic" && process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS !== "1") {
    return await withSyntheticModelChoiceEnvironment(() => runOne(input));
  }
  const harness =
    input.mode === "synthetic"
      ? createSyntheticBenchmarkToolHarness(input.benchmarkCase)
      : undefined;
  const runProvider = input.provider ?? PROVIDER;
  const runModel = input.model ?? MODEL_ID;
  const diagnostics = createExperimentDiagnostics();
  const postResponseLiveness: PostResponseLiveness | undefined = input.postResponseDiagnostics
    ? createPostResponseLiveness({
        onHeartbeat: (heartbeat) => {
          emitPostResponseHeartbeat(heartbeat);
          diagnostics.hooks.onPostResponseHeartbeat?.(heartbeat);
        },
      })
    : undefined;
  const semanticToolCalls: CorrelationToolCall[] = [];
  const rawExecutionRecords: CorrelationExecution[] = [];
  const diagnosticsCheckpoint = diagnostics.hooks.onCheckpoint;
  diagnostics.hooks.onCheckpoint = (checkpoint) => {
    diagnosticsCheckpoint?.(checkpoint);
    const recordedCheckpoint = diagnostics.checkpoints.at(-1);
    input.attemptCheckpointJournal?.record(
      checkpoint.stage,
      recordedCheckpoint?.elapsedMs === undefined
        ? undefined
        : { elapsedMs: recordedCheckpoint.elapsedMs },
    );
    input.onCheckpoint?.(checkpoint);
  };
  const diagnosticsHeartbeat = diagnostics.hooks.onPreparedRuntimeAcquisitionHeartbeat;
  diagnostics.hooks.onPreparedRuntimeAcquisitionHeartbeat = (heartbeat) => {
    input.attemptCheckpointJournal?.record("prepared-runtime-acquisition-heartbeat", {
      elapsedMs: heartbeat.elapsedMs,
      expectedElapsedMs: heartbeat.expectedElapsedMs,
      eventLoopDelayMs: heartbeat.eventLoopDelayMs,
      eventLoopDelayDetected: heartbeat.eventLoopDelayDetected,
      lastSuccessfulCheckpoint: heartbeat.lastSuccessfulCheckpoint,
    });
    diagnosticsHeartbeat?.(heartbeat);
    input.onAcquisitionHeartbeat?.(heartbeat);
  };
  const diagnosticsPluginDiscoveryInputs = diagnostics.hooks.onPreparedRuntimePluginDiscoveryInputs;
  diagnostics.hooks.onPreparedRuntimePluginDiscoveryInputs = (inputs) => {
    diagnosticsPluginDiscoveryInputs?.(inputs);
    input.onPluginPrepDiscoveryInputs?.(inputs);
  };
  const diagnosticsPluginTiming = diagnostics.hooks.onPreparedRuntimePluginTiming;
  diagnostics.hooks.onPreparedRuntimePluginTiming = (timing) => {
    diagnosticsPluginTiming?.(timing);
    input.onPluginPrepTiming?.(timing);
  };
  const diagnosticsPostResponseCheckpoint = diagnostics.hooks.onPostResponseCheckpoint;
  diagnostics.hooks.onPostResponseCheckpoint = (checkpoint) => {
    diagnosticsPostResponseCheckpoint?.(checkpoint);
    const recordedCheckpoint = diagnostics.postResponseCheckpoints.at(-1) ?? checkpoint;
    input.attemptCheckpointJournal?.record(checkpoint.stage, {
      elapsedMs: recordedCheckpoint.elapsedMs,
      lastKnownToolCallId: checkpoint.toolCallId,
    });
    postResponseLiveness?.checkpoint(checkpoint);
    input.onPostResponseCheckpoint?.(recordedCheckpoint);
  };
  const diagnosticsPostResponseHeartbeat = diagnostics.hooks.onPostResponseHeartbeat;
  diagnostics.hooks.onPostResponseHeartbeat = (heartbeat) => {
    diagnosticsPostResponseHeartbeat?.(heartbeat);
    input.attemptCheckpointJournal?.record("post-response-heartbeat", {
      elapsedMs: heartbeat.elapsedMs,
      expectedElapsedMs: heartbeat.expectedElapsedMs,
      eventLoopDelayMs: heartbeat.eventLoopDelayMs,
      eventLoopDelayDetected: heartbeat.eventLoopDelayDetected,
    });
    input.onPostResponseHeartbeat?.(heartbeat);
  };
  const diagnosticsPostResponseSnapshot = diagnostics.hooks.onPostResponseSnapshot;
  diagnostics.hooks.onPostResponseSnapshot = (snapshot) => {
    diagnosticsPostResponseSnapshot?.(snapshot);
    input.onPostResponseSnapshot?.(snapshot);
  };
  const diagnosticsPostResponseCounter = diagnostics.hooks.onPostResponseCounter;
  diagnostics.hooks.onPostResponseCounter = (counter) => {
    diagnosticsPostResponseCounter?.(counter);
    input.onPostResponseCounter?.(counter);
  };
  diagnostics.hooks.onTimeoutArmed = () => {
    input.attemptCheckpointJournal?.record("timeout-armed");
  };
  diagnostics.hooks.onTimeoutFired = () => {
    input.attemptCheckpointJournal?.record("timeout-fired");
  };
  diagnostics.hooks.onAbortRequested = () => {
    input.attemptCheckpointJournal?.record("abort-requested");
  };
  diagnostics.hooks.onAbortObserved = () => {
    input.attemptCheckpointJournal?.record("abort-observed");
  };
  diagnostics.hooks.onCheckpoint?.({
    stage: "synthetic-constructed",
    toolCount: harness?.clientTools.length ?? input.authorizedNames.length,
    representativeToolNames: (harness?.clientTools ?? input.authorizedNames)
      .slice(0, 8)
      .map((tool) => (typeof tool === "string" ? tool : tool.function.name)),
  });
  const capture = captureModelPayloads(diagnostics.hooks, input.requestCapture);
  const originalAiTransportHost = getAiTransportHost();
  configureAiTransportHost({
    ...originalAiTransportHost,
    buildModelFetch: (model, timeoutMs, options) => {
      const baseFetch = originalAiTransportHost.buildModelFetch(model, timeoutMs, options);
      return capture.wrapFetch(baseFetch ?? capture.originalFetch);
    },
  });
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
    diagnostics.hooks.onPostResponseCheckpoint?.({
      stage: "provider-response-normalization-entered",
    });
    postResponseLiveness?.arm();
    await diagnosticsProviderResponse?.({ response, model });
  };
  const restoreAssistantMessageObserver = installAssistantMessageObserver(
    diagnostics.hooks,
    (message, modelTurnIndex) => {
      diagnostics.hooks.onPostResponseCheckpoint?.({
        stage: "provider-response-normalization-complete",
      });
      const normalizedToolCalls = message.content.filter(
        (block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
          block.type === "toolCall",
      );
      diagnostics.hooks.onPostResponseSnapshot?.({
        kind: "normalized-assistant-message",
        contentTypes: message.content.map((block) => block.type),
        toolCallCount: normalizedToolCalls.length,
        toolCallIds: normalizedToolCalls.map((block) => block.id),
        toolNames: normalizedToolCalls.map((block) => block.name),
      });
      normalizedToolCalls.forEach(() => {
        diagnostics.hooks.onPostResponseCounter?.({ name: "tool-call-observation" });
      });
      for (const block of message.content) {
        if (block.type !== "toolCall") {
          continue;
        }
        semanticToolCalls.push({
          toolCallId: block.id,
          toolName: block.name,
          modelTurnIndex,
        });
      }
      input.requestCapture?.onAssistantMessage?.(message, modelTurnIndex);
    },
  );
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
        const runAbortSignal = mergeV1IAbortSignals([
          params.abortSignal,
          postResponseLiveness?.signal,
        ]);
        const runPromise = runEmbeddedAgent({
          ...params,
          ...(harness ? buildSyntheticRunnerOverrides(harness) : {}),
          ...(input.arm === "B" ? { extraSystemPrompt: ARM_B_INSTRUCTION } : {}),
          capabilityIntelligenceExperiment: diagnostics.hooks,
          ...(runAbortSignal ? { abortSignal: runAbortSignal } : {}),
          onEmbeddedReplayFact: (fact) => {
            if (fact.kind === "ranking") {
              observedRanking = fact;
            } else {
              rawExecutionRecords.push({
                ...(fact.executionId ? { executionId: fact.executionId } : {}),
                ...(fact.toolCallId ? { toolCallId: fact.toolCallId } : {}),
                toolName: fact.toolName,
                modelTurnIndex: semanticToolCalls.find(
                  (call) => call.toolCallId === fact.toolCallId,
                )?.modelTurnIndex,
                ...(fact.startedAt === undefined ? {} : { startedAt: fact.startedAt }),
                ...(fact.completedAt === undefined ? {} : { completedAt: fact.completedAt }),
                success: fact.outcome === "success",
              });
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
        result = postResponseLiveness
          ? await Promise.race([runPromise, postResponseLiveness.timeoutPromise])
          : await runPromise;
      } catch (error) {
        diagnostics.hooks.onRequestPreparationError?.({
          error,
          stage: "run-embedded-agent",
        });
        throw error;
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
    postResponseLiveness?.complete();
    restoreAssistantMessageObserver?.();
    configureAiTransportHost(originalAiTransportHost);
    capture.restore();
  }
  const postResponseTimeout = postResponseLiveness?.readTimeout();
  if (postResponseTimeout) {
    throw postResponseTimeout;
  }
  const completedExecution = execution;
  if (!completedExecution) {
    throw new Error("v1I run did not produce an execution result");
  }
  const requestBodies = capture.requests.map((request) => request.body);
  const firstBody = requestBodies[0] ?? {};
  const executionAccounting = summarizeExecutedTools(completedExecution.result.executedTools);
  const executedToolSequence = executionAccounting.executedToolSequence;
  const correlation = correlateToolCallsAndExecutions({
    toolCalls: semanticToolCalls,
    executions: rawExecutionRecords,
  });
  const preferredBenchmarkTool = input.benchmarkCase.expectedTopTools[0] ?? "";
  const preferredMapping = getBenchmarkRealToolMapping(preferredBenchmarkTool);
  const mappedRealTool =
    input.mode === "synthetic" ? preferredBenchmarkTool : preferredMapping.realTool;
  const actualV1cTop8 = observedRanking
    ? observedRanking.rankings.slice(0, 8).map((entry) => entry.name)
    : input.v1cTop8;
  const authorizedRuntimeNames = observedRanking?.authorizedNames ?? [];
  const surfaceValidation = validateV1IRealSurface({
    authorizedRuntimeNames,
    providerBodies: requestBodies,
    requiredTools: input.requiredMappedTools ?? [],
  });
  const firstExecutedTool = executedToolSequence[0] ?? null;
  const valid =
    completedExecution.status === "completed" &&
    Boolean(observedRanking?.epoch) &&
    requestBodies.length > 0 &&
    surfaceValidation.valid &&
    correlation.status === "PROVABLE";
  const terminalSuccess = completedExecution.result.terminal === "success";
  const preferredToolAuthorized =
    mappedRealTool !== null && authorizedRuntimeNames.includes(mappedRealTool);
  const preferredToolInTop8 = mappedRealTool !== null && actualV1cTop8.includes(mappedRealTool);
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
    authorizedSurfaceHash: hashV1ICanonical(authorizedRuntimeNames.toSorted()),
    schemaHash: hashV1ICanonical(
      requestBodies.map((body) => sortToolDefinitions(body.tools ?? null)),
    ),
    caseSetHash: frozenCaseSetHash(),
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    v1cTop8: actualV1cTop8,
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
    toolCalls: semanticToolCalls,
    executions: correlation.executions,
    correlationStatus: correlation.status,
    duplicateExecutionClass: correlation.duplicateExecutionClass,
    valid,
    invalidReason: valid
      ? null
      : describeInvalidRun({
          execution: completedExecution,
          firstBody,
          authorizedRuntimeNames,
          requiredTools: input.requiredMappedTools ?? [],
          observedRanking,
          requestBodies,
          correlationStatus: correlation.status,
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
    plugins: {
      // Vitest disables implicit plugins; pin the production default for REAL_EXACT parity.
      slots: { memory: "memory-core" },
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
  it("preserves the production default memory slot in the live harness", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1i-memory-slot-"));
    try {
      const config = buildLiveConfig(workspaceDir);
      expect(config.plugins?.slots?.memory).toBe("memory-core");
      expect(applyTestPluginDefaults(config).plugins?.slots?.memory).toBe("memory-core");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

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

async function readCapturedFetchBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  const body = init?.body;
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  if (input instanceof Request) {
    return await input.clone().text();
  }
  return undefined;
}

function captureModelPayloads(
  hooks?: NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>,
  options?: {
    stopAfterCapture?: boolean;
    holdAfterCapture?: boolean;
    onRequestCaptured?: (request: CapturedModelRequest) => void;
    onDelegatedRequest?: () => void;
    onResponseSummary?: (summary: ProviderResponseSummary) => void;
  },
): ModelPayloadCapture {
  const requests: CapturedModelRequest[] = [];
  const responseSummaries: ProviderResponseSummary[] = [];
  let providerRequestRecorded = false;
  let delegatedRequests = 0;
  const originalFetch = globalThis.fetch;
  const wrapFetch = (baseFetch: typeof globalThis.fetch): typeof globalThis.fetch => {
    const emitResponseSummary = (summary: ProviderResponseSummary) => {
      hooks?.onPostResponseSnapshot?.({
        kind: "provider-response",
        contentTypes: summary.outputItemTypes,
        toolCallCount: summary.toolCallCount,
        toolCallIds: summary.toolCallIds,
        toolNames: summary.toolCallNames,
      });
      options?.onResponseSummary?.(summary);
    };
    return async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = await readCapturedFetchBody(input, init);
      const isProviderRequest =
        (url.startsWith(LM_STUDIO_BASE_URL) ||
          url.includes("/chat/completions") ||
          url.includes("/responses")) &&
        typeof body === "string" &&
        body.trim().startsWith("{");
      if (isProviderRequest) {
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
      const response = await baseFetch(input, init);
      if (!isProviderRequest) {
        return response;
      }
      const initialSummary = createPendingProviderResponseSummary(response);
      responseSummaries.push(initialSummary);
      emitResponseSummary(initialSummary);
      if (!response.body) {
        const emptySummary = {
          ...initialSummary,
          parserOutcome: "empty-body",
        } satisfies ProviderResponseSummary;
        responseSummaries.push(emptySummary);
        emitResponseSummary(emptySummary);
        return response;
      }
      const state = createResponseSummaryState(response.headers.get("content-type"));
      const observedBody = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            consumeProviderResponseChunk(state, chunk);
            controller.enqueue(chunk);
          },
          flush() {
            finishProviderResponseState(state);
            const summary = finishProviderResponseSummary(initialSummary, state);
            responseSummaries.push(summary);
            emitResponseSummary(summary);
          },
        }),
      );
      return new Response(observedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  };
  globalThis.fetch = wrapFetch(originalFetch);
  return {
    requests,
    delegatedRequests,
    responseSummaries,
    originalFetch,
    wrapFetch,
    recordProviderRequest: (request) => {
      providerRequestRecorded = true;
      requests.push(request);
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function installAssistantMessageObserver(
  hooks: NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>,
  observer: (message: AssistantMessage, modelTurnIndex: number) => void,
): () => void {
  const previous = hooks.onAssistantMessage;
  let modelTurnIndex = 0;
  const installed = (message: AssistantMessage) => {
    const currentTurnIndex = modelTurnIndex++;
    previous?.(message);
    observer(message, currentTurnIndex);
  };
  hooks.onAssistantMessage = installed;
  return () => {
    if (hooks.onAssistantMessage === installed) {
      hooks.onAssistantMessage = previous;
    }
  };
}

function makeAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: PROVIDER,
    model: MODEL_ID,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp: 0,
  };
}

async function captureProviderSummaryForFixture(fixture: string): Promise<ProviderResponseSummary> {
  const originalFetch = globalThis.fetch;
  const summaries: ProviderResponseSummary[] = [];
  globalThis.fetch = async () =>
    new Response(fixture, {
      headers: { "content-type": "text/event-stream" },
    });
  const capture = captureModelPayloads(undefined, {
    onResponseSummary: (summary) => summaries.push(summary),
  });
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: MODEL_ID, tools: [] }),
    });
    await response.text();
  } finally {
    capture.restore();
    globalThis.fetch = originalFetch;
  }
  const summary = summaries.at(-1);
  if (!summary) {
    throw new Error("provider response fixture did not produce a summary");
  }
  return summary;
}

function summarizeAssistantMessage(
  message: AssistantMessage,
  modelTurnIndex: number,
): ProviderResponseSummary {
  const toolCalls = message.content.filter(
    (block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
      block.type === "toolCall",
  );
  const textBlocks = message.content.filter(
    (block): block is Extract<AssistantMessage["content"][number], { type: "text" }> =>
      block.type === "text",
  );
  const contentLength = textBlocks.reduce((total, block) => total + block.text.length, 0);
  const responseClass =
    message.stopReason === "error" || message.stopReason === "aborted"
      ? "PROVIDER_FAILURE"
      : toolCalls.length > 0
        ? "TOOL_CALL_RESPONSE"
        : contentLength > 0
          ? "NO_TOOL_TEXT_RESPONSE"
          : "EMPTY_RESPONSE";
  return {
    responseClass,
    responseObjectType: "AssistantMessage",
    responseId: message.responseId ?? null,
    responseModel: message.responseModel ?? message.model ?? null,
    responseShape: "normalized-assistant-message",
    finishReason: message.stopReason,
    messageRole: message.role,
    contentPresent: contentLength > 0,
    contentLength,
    toolCallFieldPresent: toolCalls.length > 0,
    toolCallCount: toolCalls.length,
    toolCallNames: toolCalls.map((toolCall) => toolCall.name),
    toolCallIds: toolCalls.map((toolCall) => toolCall.id),
    functionCallFieldPresent: toolCalls.length > 0,
    outputItemTypes: message.content.map((block) => block.type),
    responseEventTypes: [],
    parserOutcome: "normalized-assistant-message",
    httpStatus: null,
    contentType: null,
    modelTurnIndex,
  };
}

type ObservedToolCall = {
  name: string;
  id: string;
  modelTurnIndex: number;
};

function classifyObservedToolCalls(
  calls: readonly ObservedToolCall[],
): "NONE" | "DISTINCT_PROVIDER_CALLS" | "DUPLICATE_OBSERVATION" | "MULTI_TURN_REPEAT" {
  const ids = new Set(calls.map((call) => call.id));
  if (ids.size !== calls.length) {
    return "DUPLICATE_OBSERVATION";
  }
  const names = new Set(calls.map((call) => call.name));
  if (names.size === calls.length) {
    return calls.length === 0 ? "NONE" : "DISTINCT_PROVIDER_CALLS";
  }
  const turns = new Set(calls.map((call) => call.modelTurnIndex));
  return turns.size > 1 ? "MULTI_TURN_REPEAT" : "DISTINCT_PROVIDER_CALLS";
}

type ProviderResponseSummaryState = {
  contentType: string | null;
  decoder: TextDecoder;
  buffer: string;
  sse: boolean;
  shapes: Set<string>;
  responseObjectType: string | null;
  responseId: string | null;
  responseModel: string | null;
  finishReason: string | null;
  messageRole: string | null;
  contentPresent: boolean;
  contentLength: number;
  toolCallFieldPresent: boolean;
  toolCalls: Map<string, { name: string; id: string | null }>;
  functionCallFieldPresent: boolean;
  outputItemTypes: Set<string>;
  responseEventTypes: Set<string>;
  sawTerminal: boolean;
  parseErrors: number;
};

function createResponseSummaryState(
  contentType: string | null = null,
): ProviderResponseSummaryState {
  return {
    contentType,
    decoder: new TextDecoder(),
    buffer: "",
    sse: contentType?.toLowerCase().includes("text/event-stream") ?? false,
    shapes: new Set(),
    responseObjectType: null,
    responseId: null,
    responseModel: null,
    finishReason: null,
    messageRole: null,
    contentPresent: false,
    contentLength: 0,
    toolCallFieldPresent: false,
    toolCalls: new Map(),
    functionCallFieldPresent: false,
    outputItemTypes: new Set(),
    responseEventTypes: new Set(),
    sawTerminal: false,
    parseErrors: 0,
  };
}

function createPendingProviderResponseSummary(response: Response): ProviderResponseSummary {
  return {
    responseClass: response.headers.get("content-type")?.includes("event-stream")
      ? "streaming"
      : "non-streaming",
    responseObjectType: null,
    responseId: null,
    responseModel: null,
    responseShape: response.headers.get("content-type")?.includes("event-stream")
      ? "sse"
      : "unknown",
    finishReason: null,
    messageRole: null,
    contentPresent: false,
    contentLength: 0,
    toolCallFieldPresent: false,
    toolCallCount: 0,
    toolCallNames: [],
    toolCallIds: [],
    functionCallFieldPresent: false,
    outputItemTypes: [],
    responseEventTypes: [],
    parserOutcome: response.body ? "body-pending" : "empty-body",
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    modelTurnIndex: null,
  };
}

function consumeProviderResponseChunk(
  state: ProviderResponseSummaryState,
  chunk: Uint8Array,
): void {
  state.buffer += state.decoder.decode(chunk, { stream: true });
  if (!state.sse && state.buffer.includes("data:")) {
    state.sse = true;
  }
  if (!state.sse) {
    if (state.buffer.length > 131_072) {
      state.buffer = "";
      state.parseErrors += 1;
    }
    return;
  }
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    consumeProviderResponseLine(state, line);
  }
}

function finishProviderResponseState(state: ProviderResponseSummaryState): void {
  state.buffer += state.decoder.decode();
  if (state.sse) {
    if (state.buffer.length > 0) {
      consumeProviderResponseLine(state, state.buffer);
    }
    return;
  }
  const payload = state.buffer.trim();
  if (!payload) {
    return;
  }
  try {
    consumeProviderResponsePayload(state, JSON.parse(payload) as unknown);
  } catch {
    state.parseErrors += 1;
  }
}

function consumeProviderResponseLine(state: ProviderResponseSummaryState, line: string): void {
  const trimmed = line.trim();
  if (trimmed.startsWith("event:")) {
    const eventName = trimmed.slice("event:".length).trim();
    addStringShape(state.responseEventTypes, eventName);
    if (eventName === "response.completed" || eventName === "response.done") {
      state.sawTerminal = true;
    }
    return;
  }
  if (!trimmed.startsWith("data:")) {
    return;
  }
  const data = trimmed.slice("data:".length).trim();
  if (data === "[DONE]") {
    state.sawTerminal = true;
    return;
  }
  try {
    consumeProviderResponsePayload(state, JSON.parse(data) as unknown);
  } catch {
    state.parseErrors += 1;
  }
}

function consumeProviderResponsePayload(state: ProviderResponseSummaryState, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    state.parseErrors += 1;
    return;
  }
  const payload = value as Record<string, unknown>;
  addStringShape(state.shapes, payload.object);
  addStringShape(state.shapes, payload.type);
  if (state.responseObjectType === null) {
    state.responseObjectType = firstString(payload.object, payload.type);
  }
  if (state.responseId === null && typeof payload.id === "string") {
    state.responseId = payload.id;
  }
  if (state.responseModel === null && typeof payload.model === "string") {
    state.responseModel = payload.model;
  }
  addStringShape(state.responseEventTypes, payload.type);
  if (payload.type === "response.completed" || payload.type === "response.done") {
    state.sawTerminal = true;
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      continue;
    }
    const choiceRecord = choice as Record<string, unknown>;
    if (typeof choiceRecord.finish_reason === "string") {
      state.finishReason = choiceRecord.finish_reason;
      state.sawTerminal = true;
    }
    const delta = asRecord(choiceRecord.delta) ?? asRecord(choiceRecord.message);
    if (delta) {
      if (state.messageRole === null && typeof delta.role === "string") {
        state.messageRole = delta.role;
      }
      collectProviderResponseContent(state, delta.content);
      collectProviderResponseToolCalls(state, delta.tool_calls);
    }
    if (Object.hasOwn(choiceRecord, "message")) {
      const message = asRecord(choiceRecord.message);
      if (state.messageRole === null && typeof message?.role === "string") {
        state.messageRole = message.role;
      }
    }
  }
  collectProviderResponseContent(state, payload.content);
  collectProviderResponseContent(state, payload.delta);
  collectProviderResponseToolCalls(state, payload.tool_calls);
  const item = asRecord(payload.item);
  if (item) {
    if (state.messageRole === null && typeof item.role === "string") {
      state.messageRole = item.role;
    }
    addStringShape(state.outputItemTypes, item.type);
    collectProviderResponseContent(state, item.content);
    collectProviderResponseToolCalls(state, item.tool_calls);
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const entry of output) {
    const outputItem = asRecord(entry);
    if (outputItem) {
      addStringShape(state.outputItemTypes, outputItem.type);
      collectProviderResponseToolCalls(state, outputItem.tool_calls);
      if (outputItem.type === "function_call" && typeof outputItem.name === "string") {
        addProviderToolCall(state, outputItem.name, outputItem.call_id);
      }
    }
  }
}

function collectProviderResponseContent(state: ProviderResponseSummaryState, value: unknown): void {
  if (typeof value === "string") {
    state.contentPresent = true;
    state.contentLength += value.length;
  }
}

function collectProviderResponseToolCalls(
  state: ProviderResponseSummaryState,
  value: unknown,
): void {
  if (value !== undefined) {
    state.toolCallFieldPresent = true;
  }
  if (!Array.isArray(value)) {
    return;
  }
  for (const [index, call] of value.entries()) {
    const record = asRecord(call);
    const functionRecord = record ? asRecord(record.function) : undefined;
    if (functionRecord) {
      state.functionCallFieldPresent = true;
    }
    const name =
      (functionRecord && typeof functionRecord.name === "string" && functionRecord.name) ||
      (record && typeof record.name === "string" && record.name) ||
      null;
    if (name) {
      addProviderToolCall(state, name, record?.id ?? record?.index ?? index);
    }
  }
}

function addProviderToolCall(
  state: ProviderResponseSummaryState,
  name: string,
  identity: unknown,
): void {
  const id = typeof identity === "string" || typeof identity === "number" ? String(identity) : null;
  const key = `${id ?? "?"}:${name}`;
  state.toolCalls.set(key, { name, id });
}

function finishProviderResponseSummary(
  initial: ProviderResponseSummary,
  state: ProviderResponseSummaryState,
): ProviderResponseSummary {
  const toolCalls = [...state.toolCalls.values()];
  const toolCallNames = toolCalls.map((toolCall) => toolCall.name);
  const toolCallIds = toolCalls.flatMap((toolCall) => (toolCall.id === null ? [] : [toolCall.id]));
  return {
    ...initial,
    responseObjectType: state.responseObjectType,
    responseId: state.responseId,
    responseModel: state.responseModel,
    responseShape: [...state.shapes].join("|") || initial.responseShape,
    finishReason: state.finishReason,
    messageRole: state.messageRole,
    contentPresent: state.contentPresent,
    contentLength: state.contentLength,
    toolCallFieldPresent: state.toolCallFieldPresent,
    toolCallCount: toolCallNames.length,
    toolCallNames,
    toolCallIds,
    functionCallFieldPresent: state.functionCallFieldPresent,
    outputItemTypes: [...state.outputItemTypes],
    responseEventTypes: [...state.responseEventTypes],
    modelTurnIndex: initial.modelTurnIndex,
    parserOutcome:
      state.parseErrors > 0
        ? "parse-error"
        : state.sawTerminal
          ? toolCallNames.length > 0
            ? "tool-call-complete"
            : "no-tool-complete"
          : toolCallNames.length > 0
            ? "tool-call-stream-closed-without-terminal"
            : "stream-closed-without-terminal",
  };
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string") ?? null;
}

function addStringShape(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0 && target.size < 8) {
    target.add(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function makeCleanupOutcome(
  overrides: Partial<{
    result: "SUCCESS" | "EPERM" | "ERROR";
    secondary: boolean;
  }> = {},
) {
  return {
    attempted: true as const,
    result: "SUCCESS" as const,
    secondary: false,
    cleanupPath: "diagnostic-workspace",
    cleanupAttempts: 1,
    cleanupElapsedMs: 0,
    cleanupErrorCode: null,
    cleanupErrorMessage: null,
    ...overrides,
  };
}

function serializeSmokeError(error: unknown): SerializedSmokeError {
  return {
    name: error instanceof Error ? error.name : "NonErrorThrown",
    message: error instanceof Error ? error.message : String(error),
  };
}

const REAL_RUNTIME_TOOL_NAMES = [
  "apply_patch",
  "edit",
  "exec",
  "memory_get",
  "memory_search",
  "message",
  "process",
  "read",
  "sessions_history",
  "sessions_list",
  "sessions_search",
  "sessions_spawn",
  "web_fetch",
  "web_search",
  "write",
] as const;

function makeRealRuntimeTool(name: string): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name,
      description: `OpenClaw ${name} capability`,
      parameters: { type: "object", properties: {} },
    },
  };
}

function makeRealRuntimeToolSurface(): Record<string, unknown>[] {
  return REAL_RUNTIME_TOOL_NAMES.map(makeRealRuntimeTool);
}

type V1IRealSurfaceValidation = {
  valid: boolean;
  authorizedProviderNameSetEqual: boolean;
  authorizedProviderSchemaSetEqual: boolean;
  providerSchemaStable: boolean;
  orderEqual: boolean;
  exactToolPresent: boolean;
  invalidReason: "AUTHORIZED_SURFACE_DRIFT" | "SCHEMA_DRIFT" | "EXACT_MAPPED_TOOL_MISSING" | null;
};

function validateV1IRealSurface(input: {
  authorizedRuntimeNames: readonly string[];
  authorizedToolDefinitions?: readonly unknown[];
  providerBodies: readonly Record<string, unknown>[];
  requiredTools: readonly string[];
}): V1IRealSurfaceValidation {
  const firstBody = input.providerBodies[0] ?? {};
  const providerTools = Array.isArray(firstBody.tools) ? firstBody.tools : [];
  const comparison = compareToolSurfaces(
    input.authorizedRuntimeNames,
    toolNamesFromBody(firstBody),
  );
  const authorizedProviderSchemaSetEqual =
    input.authorizedToolDefinitions === undefined ||
    canonicalizeToolDefinitions(input.authorizedToolDefinitions) ===
      canonicalizeToolDefinitions(providerTools);
  const providerSchemaStable = sameSchemaAcrossRequests(input.providerBodies);
  const exactToolPresent = input.requiredTools.every((tool) =>
    input.authorizedRuntimeNames.includes(tool),
  );
  const valid =
    comparison.canonicalEqual &&
    authorizedProviderSchemaSetEqual &&
    providerSchemaStable &&
    exactToolPresent;
  return {
    valid,
    authorizedProviderNameSetEqual: comparison.canonicalEqual,
    authorizedProviderSchemaSetEqual,
    providerSchemaStable,
    orderEqual: comparison.orderEqual,
    exactToolPresent,
    invalidReason: valid
      ? null
      : !comparison.canonicalEqual
        ? "AUTHORIZED_SURFACE_DRIFT"
        : !authorizedProviderSchemaSetEqual || !providerSchemaStable
          ? "SCHEMA_DRIFT"
          : "EXACT_MAPPED_TOOL_MISSING",
  };
}

function sameSchemaAcrossRequests(bodies: readonly Record<string, unknown>[]): boolean {
  const first = canonicalizeToolDefinitions(bodies[0]?.tools ?? null);
  return bodies.every((body) => canonicalizeToolDefinitions(body.tools ?? null) === first);
}

function sameSurfaceAsExpected(
  body: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return canonicalizeToolNames(toolNamesFromBody(body)) === canonicalizeToolNames(expected);
}

type ToolSurfaceComparison = {
  canonicalEqual: boolean;
  orderEqual: boolean;
  added: string[];
  missing: string[];
};

function compareToolSurfaces(
  expected: readonly string[],
  actual: readonly string[],
): ToolSurfaceComparison {
  const expectedCanonical = expected.toSorted();
  const actualCanonical = actual.toSorted();
  const expectedSet = new Set(expectedCanonical);
  const actualSet = new Set(actualCanonical);
  return {
    canonicalEqual:
      canonicalizeV1IValue(actualCanonical) === canonicalizeV1IValue(expectedCanonical),
    orderEqual: canonicalizeV1IValue(actual) === canonicalizeV1IValue(expected),
    added: actualCanonical.filter((name) => !expectedSet.has(name)),
    missing: expectedCanonical.filter((name) => !actualSet.has(name)),
  };
}

function canonicalizeToolNames(names: readonly string[]): string {
  return canonicalizeV1IValue(names.toSorted());
}

function canonicalizeToolDefinitions(value: unknown): string {
  return canonicalizeV1IValue(sortToolDefinitions(value));
}

function sortToolDefinitions(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.toSorted((left, right) => {
    const leftName = toolNameFromDefinition(left);
    const rightName = toolNameFromDefinition(right);
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
}

function toolNameFromDefinition(value: unknown): string {
  const record = asRecord(value);
  const nested = record ? asRecord(record.function) : undefined;
  const name = nested?.name ?? record?.name;
  return typeof name === "string" ? name : canonicalizeV1IValue(value);
}

function summarizeExecutedTools(tools: readonly { name: string; executionStarted: boolean }[]): {
  executedToolSequence: string[];
  duplicateToolNames: string[];
  duplicateExecutionCount: number;
} {
  const executedToolSequence = tools
    .filter((tool) => tool.executionStarted)
    .map((tool) => tool.name);
  const counts = new Map<string, number>();
  for (const name of executedToolSequence) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const duplicateToolNames = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  return {
    executedToolSequence,
    duplicateToolNames,
    duplicateExecutionCount: executedToolSequence.length - new Set(executedToolSequence).size,
  };
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
  authorizedRuntimeNames: readonly string[];
  requiredTools: readonly string[];
  observedRanking?: { epoch: string };
  requestBodies: readonly Record<string, unknown>[];
  correlationStatus?: "PROVABLE" | "UNPROVABLE";
}): string {
  const statusReason = invalidReasonForExecutionStatus(
    input.execution.status,
    input.requestBodies.length,
  );
  if (statusReason) {
    return statusReason;
  }
  if (input.correlationStatus === "UNPROVABLE") {
    return "CORRELATION_UNPROVABLE";
  }
  if (!input.observedRanking?.epoch) {
    return "MISSING_RANKING_EPOCH";
  }
  const surfaceValidation = validateV1IRealSurface({
    authorizedRuntimeNames: input.authorizedRuntimeNames,
    providerBodies: input.requestBodies,
    requiredTools: input.requiredTools,
  });
  if (!surfaceValidation.authorizedProviderNameSetEqual) {
    return "AUTHORIZED_SURFACE_DRIFT";
  }
  if (
    !surfaceValidation.providerSchemaStable ||
    !surfaceValidation.authorizedProviderSchemaSetEqual
  ) {
    return "SCHEMA_DRIFT";
  }
  if (!surfaceValidation.exactToolPresent) {
    return "EXACT_MAPPED_TOOL_MISSING";
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
