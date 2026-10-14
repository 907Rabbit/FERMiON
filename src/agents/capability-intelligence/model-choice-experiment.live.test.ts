/* oxlint-disable max-lines -- v1I live/offline evidence paths share one frozen harness. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configureAiTransportHost, getAiTransportHost } from "@openclaw/ai";
import { asOptionalRecord as asRecord } from "@openclaw/normalization-core/record-coerce";
import { describe, expect, it, vi } from "vitest";
import {
  assertV1JFormalStateEmpty,
  assertV1JPreflightPairComplete,
  assertV1JSmokeProvenance,
  buildV1JSmokeSchedule,
  createV1JArmCOnlyPreflightDiagnosticJournal,
  createV1JPreflightDiagnosticJournal,
  createV1JSmokeArtifactState,
  finalizeV1JSmokeArtifacts,
  resolveV1JSmokeRoot,
  runV1JArmCPreflightOnly,
  runV1JSmokeSchedule,
  summarizeV1JPreflightObservations,
  V1J_FORMAL_ARTIFACT_RELATIVE_PATH,
  V1J_SMOKE_PROVENANCE_PATH,
  type V1JPreflightDiagnosticJournal,
  type V1JPreflightRequestObservation,
  type V1JSmokeCell,
} from "../../../test/helpers/agents/model-choice-action-initiation-smoke.js";
import {
  assertV1JRuntimeGate,
  buildV1JSchedule,
  canonicalV1JToolNames,
  createV1JManifest,
  fingerprintV1JToolSurface,
  openV1JArtifactState,
  readV1JPreregistration,
  runV1JCellBatch,
  summarizeV1JObservations,
  v1jInstructionForArm,
  sha256 as sha256V1J,
  writeV1JSummary,
  V1J_PREREGISTRATION_SHA256,
  V1J_PREREGISTRATION_PATH,
  V1JSerializationFailureError,
  type V1JCell,
  type V1JObservation,
  type V1JProtocol,
} from "../../../test/helpers/agents/model-choice-action-initiation.js";
import {
  compareV1JAdapterDifferentialRequests,
  fingerprintV1JAdapterDifferentialField,
  assertV1JAdapterDifferentialPreflight,
  assertV1JAdapterDifferentialRequestBudget,
  createV1JAdapterDifferentialJournal,
  finalizeV1JAdapterDifferentialDiagnostic,
  installV1JAdapterDifferentialToolGuard,
  recordV1JAdapterDifferentialOutcomes,
  reportV1JAdapterDifferentialProgress,
  runV1JAdapterDifferentialRawTransport,
  recordV1JAdapterDifferentialRequestFingerprint,
  summarizeV1JAdapterDifferentialRequest,
  withV1JAdapterDifferentialProgress,
  V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS,
  V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS,
  V1J_ADAPTER_DIFFERENTIAL_PARENT,
  V1J_ADAPTER_DIFFERENTIAL_PREFIX,
  V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG,
} from "../../../test/helpers/agents/model-choice-adapter-differential.js";
import { recordV1JPromptAwaitDiagnostic } from "../../../test/helpers/agents/model-choice-prompt-await-diagnostic.js";
import {
  diffV1JPromptMaterializationBoundaries,
  diffV1JPromptMaterializationTransition,
  fingerprintV1JSystemPromptParagraphs,
  fingerprintV1JSystemPromptSections,
  V1J_PROMPT_MATERIALIZATION_BOUNDARY_ORDER,
  type V1JPromptMaterializationBoundary,
} from "../../../test/helpers/agents/model-choice-prompt-content-delta.js";
import {
  V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
  V1J_PROVIDER_CONTROL_SCHEMA_BASELINE,
} from "../../../test/helpers/agents/model-choice-provider-isolation.js";
import { recordV1JProviderMaterializationTrace } from "../../../test/helpers/agents/model-choice-provider-materialization-trace.js";
import { runV1JPayloadDecompositionDiagnostic } from "../../../test/helpers/agents/model-choice-provider-payload-decomposition-live.js";
import {
  V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG,
  V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG,
  V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG,
} from "../../../test/helpers/agents/model-choice-provider-payload-decomposition.js";
import {
  assertV1JRawRepeatabilityPreflight,
  createV1JRawRepeatabilityJournal,
  diffV1JProviderRequestFingerprintComponents,
  publishAndVerifyV1JProviderBoundBodyArtifact,
  runV1JPreflightWithHeartbeat,
  runV1JRawRepeatabilityTransport,
  readV1JProviderBoundBodyArtifact,
  summarizeV1JRawRepeatabilityRequest,
  V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
  V1J_PROVIDER_BOUND_BODY_PARENT,
  V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG,
  V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG,
  V1J_RAW_REPEATABILITY_COMMIT_FLAG,
  V1J_RAW_REPEATABILITY_PARENT,
  V1J_RAW_REPEATABILITY_PREFIX,
  V1J_RAW_REPEATABILITY_RUN_FLAG,
  type V1JProviderControlEvent,
  type V1JProviderRequestFingerprintComponent,
} from "../../../test/helpers/agents/model-choice-provider-repeatability.js";
import {
  createV1JProviderResponseDiagnosticJournal,
  isV1JCleanupFailureSecondary,
  observeV1JAdapterResponse,
  observeV1JProviderResponseBody,
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC_CELL,
  type V1JProviderResponseDiagnosticJournal,
} from "../../../test/helpers/agents/model-choice-provider-response-diagnostic.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { AssistantMessage } from "../../llm/types.js";
import { applyTestPluginDefaults } from "../../plugins/config-state.js";
import type { PluginRegistryLoadTraceEvent } from "../../plugins/loader-types.js";
import type {
  EmbeddedCapabilityIntelligenceModelLoopHeartbeat,
  EmbeddedCapabilityIntelligenceModelLoopSubstage,
  RunEmbeddedAgentParams,
} from "../embedded-agent-runner/run/params.js";
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
import { isV1IProvenanceAmendment } from "./model-choice-experiment-provenance.js";
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
const V1J_SCHEMA_CAPTURE_MODE = process.env.OPENCLAW_V1J_SCHEMA_CAPTURE;
const V1J_ACTION_LIVE_TEST = process.env.OPENCLAW_V1J_LIVE_TEST === "1";
const V1J_ACTION_LIVE_AUTHORIZED = process.env.OPENCLAW_V1J_LIVE_EXECUTION_AUTHORIZED === "1";
const V1J_ACTION_SMOKE_TEST = process.env.OPENCLAW_V1J_LIVE_SMOKE === "1";
const V1J_ACTION_SMOKE_AUTHORIZED = process.env.OPENCLAW_V1J_LIVE_SMOKE_AUTHORIZED === "1";
const V1J_PROVIDER_RESPONSE_DIAGNOSTIC =
  process.env.OPENCLAW_V1J_PROVIDER_RESPONSE_DIAGNOSTIC === "1";
const V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED =
  process.env.OPENCLAW_V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED === "1";
const V1J_ARM_C_PREFLIGHT_DIAGNOSTIC = process.env.OPENCLAW_V1J_ARM_C_PREFLIGHT_DIAGNOSTIC === "1";
const V1J_PAYLOAD_DECOMPOSITION = process.env[V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG] === "1";
const V1J_ADAPTER_DIFFERENTIAL = process.env[V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG] === "1";
const V1J_RAW_REPEATABILITY = process.env[V1J_RAW_REPEATABILITY_RUN_FLAG] === "1";
const V1J_RAW_REPEATABILITY_FLAGS = [
  V1J_RAW_REPEATABILITY_RUN_FLAG,
  V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG,
  V1J_RAW_REPEATABILITY_COMMIT_FLAG,
  V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG,
];
const anyV1JRawRepeatabilityFlag = V1J_RAW_REPEATABILITY_FLAGS.some(
  (name) => process.env[name] !== undefined,
);
if (anyV1JRawRepeatabilityFlag && !V1J_RAW_REPEATABILITY) {
  throw new Error("v1J raw repeatability requires its dedicated run flag");
}
if (
  V1J_RAW_REPEATABILITY &&
  Object.entries(process.env).some(
    ([name, value]) =>
      value !== undefined &&
      /^(OPENCLAW_V1[IJ]_)/.test(name) &&
      !V1J_RAW_REPEATABILITY_FLAGS.includes(name),
  )
) {
  throw new Error("v1J raw repeatability cannot share another v1I/v1J mode");
}
const V1J_PROVIDER_CAPTURE_PREFLIGHT_RUN_FLAG = "OPENCLAW_V1J_PROVIDER_CAPTURE_PREFLIGHT";
const V1J_PROVIDER_CAPTURE_PREFLIGHT_AUTHORIZED_FLAG =
  "OPENCLAW_V1J_PROVIDER_CAPTURE_PREFLIGHT_AUTHORIZED";
const V1J_PROVIDER_CAPTURE_PREFLIGHT_COMMIT_FLAG = "OPENCLAW_V1J_PROVIDER_CAPTURE_PREFLIGHT_COMMIT";
const V1J_PROVIDER_CAPTURE_PREFLIGHT = process.env[V1J_PROVIDER_CAPTURE_PREFLIGHT_RUN_FLAG] === "1";
const V1J_PROVIDER_CAPTURE_PREFLIGHT_FLAGS = new Set([
  V1J_PROVIDER_CAPTURE_PREFLIGHT_RUN_FLAG,
  V1J_PROVIDER_CAPTURE_PREFLIGHT_AUTHORIZED_FLAG,
  V1J_PROVIDER_CAPTURE_PREFLIGHT_COMMIT_FLAG,
]);
const anyV1JProviderCapturePreflightFlag = [...V1J_PROVIDER_CAPTURE_PREFLIGHT_FLAGS].some(
  (name) => process.env[name] !== undefined,
);
if (anyV1JProviderCapturePreflightFlag && !V1J_PROVIDER_CAPTURE_PREFLIGHT) {
  throw new Error("v1J provider capture preflight requires its dedicated run flag");
}
if (
  V1J_PROVIDER_CAPTURE_PREFLIGHT &&
  Object.entries(process.env).some(
    ([name, value]) =>
      value !== undefined &&
      /^(OPENCLAW_V1[IJ]_)/.test(name) &&
      !V1J_PROVIDER_CAPTURE_PREFLIGHT_FLAGS.has(name),
  )
) {
  throw new Error("v1J provider capture preflight cannot share another v1I/v1J mode");
}
const V1J_MATERIALIZATION_TRACE_PREFLIGHT_RUN_FLAG = "OPENCLAW_V1J_MATERIALIZATION_TRACE_PREFLIGHT";
const V1J_MATERIALIZATION_TRACE_PREFLIGHT_AUTHORIZED_FLAG =
  "OPENCLAW_V1J_MATERIALIZATION_TRACE_PREFLIGHT_AUTHORIZED";
const V1J_MATERIALIZATION_TRACE_PREFLIGHT_COMMIT_FLAG =
  "OPENCLAW_V1J_MATERIALIZATION_TRACE_PREFLIGHT_COMMIT";
const V1J_MATERIALIZATION_TRACE_PREFLIGHT =
  process.env[V1J_MATERIALIZATION_TRACE_PREFLIGHT_RUN_FLAG] === "1";
const V1J_MATERIALIZATION_TRACE_PREFLIGHT_FLAGS = new Set([
  V1J_MATERIALIZATION_TRACE_PREFLIGHT_RUN_FLAG,
  V1J_MATERIALIZATION_TRACE_PREFLIGHT_AUTHORIZED_FLAG,
  V1J_MATERIALIZATION_TRACE_PREFLIGHT_COMMIT_FLAG,
]);
const anyV1JMaterializationTracePreflightFlag = [...V1J_MATERIALIZATION_TRACE_PREFLIGHT_FLAGS].some(
  (name) => process.env[name] !== undefined,
);
if (anyV1JMaterializationTracePreflightFlag && !V1J_MATERIALIZATION_TRACE_PREFLIGHT) {
  throw new Error("v1J materialization trace preflight requires its dedicated run flag");
}
if (
  V1J_MATERIALIZATION_TRACE_PREFLIGHT &&
  Object.entries(process.env).some(
    ([name, value]) =>
      value !== undefined &&
      /^(OPENCLAW_V1[IJ]_)/.test(name) &&
      !V1J_MATERIALIZATION_TRACE_PREFLIGHT_FLAGS.has(name),
  )
) {
  throw new Error("v1J materialization trace preflight cannot share another v1I/v1J mode");
}
const V1J_ADAPTER_DIFFERENTIAL_FLAGS = new Set([
  V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG,
]);
const V1J_PAYLOAD_DECOMPOSITION_FLAGS = [
  V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG,
  V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG,
  V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG,
];
const anyV1JPayloadDecompositionFlag = V1J_PAYLOAD_DECOMPOSITION_FLAGS.some(
  (name) => process.env[name] !== undefined,
);
if (anyV1JPayloadDecompositionFlag && !V1J_PAYLOAD_DECOMPOSITION) {
  throw new Error("v1J payload decomposition requires its dedicated run flag");
}
if (
  V1J_PAYLOAD_DECOMPOSITION &&
  Object.entries(process.env).some(
    ([name, value]) =>
      value !== undefined &&
      /^(OPENCLAW_V1[IJ]_)/.test(name) &&
      !V1J_PAYLOAD_DECOMPOSITION_FLAGS.includes(name),
  )
) {
  throw new Error("v1J payload decomposition cannot share another v1I/v1J mode");
}
if (
  V1J_ADAPTER_DIFFERENTIAL &&
  Object.entries(process.env).some(
    ([name, value]) =>
      value !== undefined &&
      /^(OPENCLAW_V1[IJ]_)/.test(name) &&
      !V1J_ADAPTER_DIFFERENTIAL_FLAGS.has(name),
  )
) {
  throw new Error("v1J adapter differential cannot share another v1I/v1J mode");
}
if (
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC &&
  (LIVE ||
    V1J_ACTION_LIVE_TEST ||
    V1J_ACTION_LIVE_AUTHORIZED ||
    V1J_ACTION_SMOKE_TEST ||
    V1J_ACTION_SMOKE_AUTHORIZED ||
    V1J_ARM_C_PREFLIGHT_DIAGNOSTIC ||
    V1J_SCHEMA_CAPTURE_MODE !== undefined ||
    process.env.OPENCLAW_V1J_CELL_ALLOWLIST !== undefined ||
    process.env.OPENCLAW_V1J_MAX_CELLS !== undefined ||
    process.env.OPENCLAW_V1I_MODE !== undefined)
) {
  throw new Error("v1J provider-response diagnostic cannot share another live execution mode");
}
if (
  V1J_ARM_C_PREFLIGHT_DIAGNOSTIC &&
  (LIVE ||
    V1J_ACTION_LIVE_TEST ||
    V1J_ACTION_LIVE_AUTHORIZED ||
    V1J_ACTION_SMOKE_TEST ||
    V1J_ACTION_SMOKE_AUTHORIZED ||
    V1J_PROVIDER_RESPONSE_DIAGNOSTIC ||
    V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED ||
    V1J_SCHEMA_CAPTURE_MODE !== undefined ||
    process.env.OPENCLAW_V1J_CELL_ALLOWLIST !== undefined ||
    process.env.OPENCLAW_V1J_MAX_CELLS !== undefined ||
    process.env.OPENCLAW_V1I_MODE !== undefined)
) {
  throw new Error("v1J Arm C preflight diagnostic cannot share another live execution mode");
}
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

type V1JLifecycleJournal = Pick<V1JProviderResponseDiagnosticJournal, "record">;

type PromptMessageTraceEvent = Parameters<
  NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>["onPromptMessageTrace"]
>[0];
type EmbeddedCapabilityCheckpoint = Parameters<
  NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>["onCheckpoint"]
>[0];

function summarizePromptMessageTrace(
  event: PromptMessageTraceEvent,
  identity: (value: object) => number,
) {
  return {
    stage: event.stage,
    source: event.source,
    ...(event.systemPromptFingerprint
      ? { systemPromptFingerprint: event.systemPromptFingerprint }
      : {}),
    ...(event.materializationFactors
      ? { materializationFactors: event.materializationFactors }
      : {}),
    ...(event.conversationHistorySource
      ? { conversationHistorySource: event.conversationHistorySource }
      : {}),
    ...(event.promptAssemblySource ? { promptAssemblySource: event.promptAssemblySource } : {}),
    ...(event.armInstructionInsertionStage
      ? { armInstructionInsertionStage: event.armInstructionInsertionStage }
      : {}),
    ...(event.armInstructionPresent === undefined
      ? {}
      : { armInstructionPresent: event.armInstructionPresent }),
    ...(event.callbackIndex === undefined ? {} : { callbackIndex: event.callbackIndex }),
    messageArrayIdentity: identity(event.messages),
    messageCount: event.messages.length,
    messages: event.messages.map((message, index) => {
      const row =
        message && typeof message === "object" && !Array.isArray(message)
          ? (message as Record<string, unknown>)
          : {};
      const content = row.content;
      const canonicalContent = canonicalizeV1IValue(content);
      return {
        index,
        role: typeof row.role === "string" ? row.role : null,
        messageObjectIdentity: message && typeof message === "object" ? identity(message) : null,
        contentObjectIdentity: content && typeof content === "object" ? identity(content) : null,
        contentSha256: sha256V1J(canonicalContent),
        contentLength: typeof content === "string" ? content.length : canonicalContent.length,
        contentBytes: Buffer.byteLength(
          typeof content === "string" ? content : canonicalContent,
          "utf8",
        ),
        observedAtStage: event.stage,
        observedSource: event.source,
        origin: "unknown",
      };
    }),
  };
}

function diffPromptMaterializationSnapshots(
  previous: ReturnType<typeof summarizePromptMessageTrace>,
  current: ReturnType<typeof summarizePromptMessageTrace>,
): string[] {
  const differences: string[] = [];
  const previousSystem = previous.systemPromptFingerprint;
  const currentSystem = current.systemPromptFingerprint;
  if (
    previousSystem?.sha256 !== currentSystem?.sha256 ||
    previousSystem?.utf8Bytes !== currentSystem?.utf8Bytes
  ) {
    differences.push("$.systemPrompt");
  }
  for (const [key, previousValue] of Object.entries(previous.materializationFactors ?? {})) {
    if (
      current.materializationFactors &&
      key in current.materializationFactors &&
      previousValue !== current.materializationFactors[key]
    ) {
      differences.push(`$.materializationFactors.${key}`);
    }
  }
  if (previous.messageCount !== current.messageCount) {
    differences.push("$.messages.length");
  }
  const count = Math.max(previous.messages.length, current.messages.length);
  for (let index = 0; index < count; index += 1) {
    const before = previous.messages[index];
    const after = current.messages[index];
    if (!before || !after) {
      differences.push(`$.messages[${index}]`);
      continue;
    }
    if (before.role !== after.role) {
      differences.push(`$.messages[${index}].role`);
    }
    if (
      before.contentSha256 !== after.contentSha256 ||
      before.contentBytes !== after.contentBytes
    ) {
      differences.push(`$.messages[${index}].content`);
    }
  }
  return differences;
}

const V1J_PROMPT_MATERIALIZATION_STAGES = new Set<string>(
  V1J_PROMPT_MATERIALIZATION_BOUNDARY_ORDER,
);

function summarizeV1JTraceContent(content: unknown): {
  contentSha256: string | null;
  contentBytes: number | null;
} {
  try {
    const canonicalContent = canonicalizeV1IValue(content);
    return {
      contentSha256: sha256V1J(canonicalContent),
      contentBytes: Buffer.byteLength(canonicalContent, "utf8"),
    };
  } catch {
    return { contentSha256: null, contentBytes: null };
  }
}

function samePromptMessageState(
  left: ReturnType<typeof summarizePromptMessageTrace>,
  right: ReturnType<typeof summarizePromptMessageTrace>,
): boolean {
  return (
    left.messageArrayIdentity === right.messageArrayIdentity &&
    left.messageCount === right.messageCount &&
    left.messages.every((message, index) => {
      const current = right.messages[index];
      return (
        current?.messageObjectIdentity === message.messageObjectIdentity &&
        current.contentObjectIdentity === message.contentObjectIdentity &&
        current.role === message.role &&
        current.contentSha256 === message.contentSha256 &&
        current.contentBytes === message.contentBytes
      );
    })
  );
}

type V1JPreCaptureObserverTrace = {
  invocationIndex: number;
  runOneAttemptId: string;
  embeddedRunId: string | null;
  sessionIdSha256: string | null;
  promptSubmissionIndex: number;
  modelLoopIterationIndex: number;
  precedingModelTurnIndex: number | null;
  messageArrayIdentity: number;
  messageCount: number;
  messageFingerprint: string;
  nestedObserverReentry: boolean;
};

type V1JPreCaptureTranscriptGrowth = {
  runOneAttemptId: string;
  embeddedRunId: string | null;
  sessionIdSha256: string | null;
  promptSubmissionIndex: number;
  modelLoopIterationIndex: number;
  precedingModelTurnIndex: number | null;
  transcriptArrayReused: boolean;
  transcriptLengthBefore: number;
  transcriptLengthAfter: number;
  mutationType: "messages-appended" | "transcript-prefix-changed";
  sourceStage: string;
  source: string;
  appendedMessages: Array<{
    index: number;
    role: string | null;
    appendedRole: string | null;
    contentSha256: string;
    contentBytes: number;
    mutationType:
      | "user-message-appended"
      | "assistant-message-appended"
      | "tool-result-appended"
      | "other-message-appended";
  }>;
};

function captureV1JTranscriptGrowth(input: {
  previous: ReturnType<typeof summarizePromptMessageTrace>;
  current: ReturnType<typeof summarizePromptMessageTrace>;
  runOneAttemptId: string;
  embeddedRunId: string | null;
  sessionIdSha256: string | null;
  promptSubmissionIndex: number;
  modelLoopIterationIndex: number;
  precedingModelTurnIndex: number | null;
}): V1JPreCaptureTranscriptGrowth | undefined {
  const prefixMatches = input.previous.messages.every((previous, index) => {
    const current = input.current.messages[index];
    return (
      current?.role === previous.role &&
      current.contentSha256 === previous.contentSha256 &&
      current.contentBytes === previous.contentBytes
    );
  });
  const appendedMessages = prefixMatches
    ? input.current.messages.slice(input.previous.messages.length)
    : [];
  if (prefixMatches && appendedMessages.length === 0) {
    return undefined;
  }
  return {
    runOneAttemptId: input.runOneAttemptId,
    embeddedRunId: input.embeddedRunId,
    sessionIdSha256: input.sessionIdSha256,
    promptSubmissionIndex: input.promptSubmissionIndex,
    modelLoopIterationIndex: input.modelLoopIterationIndex,
    precedingModelTurnIndex: input.precedingModelTurnIndex,
    transcriptArrayReused:
      input.previous.messageArrayIdentity === input.current.messageArrayIdentity,
    transcriptLengthBefore: input.previous.messageCount,
    transcriptLengthAfter: input.current.messageCount,
    mutationType: prefixMatches ? "messages-appended" : "transcript-prefix-changed",
    sourceStage: input.current.stage,
    source: input.current.source,
    appendedMessages: appendedMessages.map((message, index) => ({
      index: input.previous.messages.length + index,
      role: message.role,
      appendedRole: message.role,
      contentSha256: message.contentSha256,
      contentBytes: message.contentBytes,
      mutationType:
        message.role === "user"
          ? "user-message-appended"
          : message.role === "assistant"
            ? "assistant-message-appended"
            : message.role === "toolResult"
              ? "tool-result-appended"
              : "other-message-appended",
    })),
  };
}

type V1JPreCaptureReentryClass =
  | "single-observation"
  | "nested-observer-reentry"
  | "same-iteration-shared-array-mutation"
  | "independent-prompt-build-pass"
  | "new-model-loop-iteration-with-transcript-growth"
  | "new-model-loop-iteration"
  | "repeated-request-build-pass"
  | "separate-run-or-session";

function classifyV1JPreCaptureReentry(input: {
  observers: readonly V1JPreCaptureObserverTrace[];
  transcriptGrowth: readonly V1JPreCaptureTranscriptGrowth[];
}): V1JPreCaptureReentryClass {
  if (input.observers.some((observer) => observer.nestedObserverReentry)) {
    return "nested-observer-reentry";
  }
  if (input.observers.length < 2) {
    return "single-observation";
  }
  const first = input.observers[0]!;
  const second = input.observers[1]!;
  if (
    first.runOneAttemptId !== second.runOneAttemptId ||
    first.embeddedRunId !== second.embeddedRunId ||
    first.sessionIdSha256 !== second.sessionIdSha256
  ) {
    return "separate-run-or-session";
  }
  if (
    first.modelLoopIterationIndex === second.modelLoopIterationIndex &&
    first.messageArrayIdentity === second.messageArrayIdentity &&
    (first.messageCount !== second.messageCount ||
      first.messageFingerprint !== second.messageFingerprint)
  ) {
    return "same-iteration-shared-array-mutation";
  }
  if (first.promptSubmissionIndex !== second.promptSubmissionIndex) {
    return "independent-prompt-build-pass";
  }
  if (first.modelLoopIterationIndex !== second.modelLoopIterationIndex) {
    const hasTranscriptGrowth = input.transcriptGrowth.some(
      (growth) =>
        growth.promptSubmissionIndex === second.promptSubmissionIndex &&
        growth.modelLoopIterationIndex >= first.modelLoopIterationIndex &&
        growth.modelLoopIterationIndex < second.modelLoopIterationIndex &&
        growth.appendedMessages.length > 0,
    );
    return hasTranscriptGrowth
      ? "new-model-loop-iteration-with-transcript-growth"
      : "new-model-loop-iteration";
  }
  return "repeated-request-build-pass";
}

type V1JCanonicalSchemaCaptureName = "capture-1" | "capture-2" | "arm-a" | "arm-c";
type V1JSchemaCaptureName = V1JCanonicalSchemaCaptureName | `capture-1-recheck-${string}`;
type V1JSchemaCaptureArm = "A" | "C";
type V1JAuthorizedToolSchema = { name: string; description?: string; parameters: unknown };
type V1JCaptureCheckpoint =
  | "capture-entrypoint-start"
  | "config-loaded"
  | "isolated-state-resolved"
  | "prepared-runtime-start"
  | "plugin-discovery-start"
  | "plugin-discovery-complete"
  | "runtime-registry-start"
  | "runtime-registry-complete"
  | "selected-runtime-load-start"
  | "selected-runtime-load-complete"
  | "authorized-catalog-start"
  | "authorized-catalog-complete"
  | "provider-tool-projection-start"
  | "provider-tool-projection-complete"
  | "capture-options-check-start"
  | "capture-options-check-complete"
  | "image-observation-read-start"
  | "image-observation-read-complete"
  | "capture-provenance-check-start"
  | "capture-provenance-check-complete"
  | "invocation-metadata-build-start"
  | "invocation-metadata-build-complete"
  | "sink-start-checkpoint-write-start"
  | "sink-start-checkpoint-write-complete"
  | "pre-sink-error"
  | "schema-sink-start"
  | "schema-sink-authorized-copy-start"
  | "schema-sink-authorized-copy-complete"
  | "schema-sink-provider-copy-start"
  | "schema-sink-provider-copy-complete"
  | "schema-sink-canonicalize-start"
  | "schema-sink-canonicalize-complete"
  | "schema-sink-validation"
  | "schema-sink-validate-start"
  | "schema-sink-validate-complete"
  | "schema-sink-mkdir-start"
  | "schema-sink-mkdir-complete"
  | "schema-sink-write-tools-start"
  | "schema-sink-write-tools-complete"
  | "schema-sink-write-metadata-start"
  | "schema-sink-write-metadata-complete"
  | "schema-sink-fsync-or-close-start"
  | "schema-sink-fsync-or-close-complete"
  | "schema-sink-error"
  | "schema-sink-complete"
  | "image-tool-factory"
  | "image-tool-pre-authorization"
  | "image-tool-post-authorization"
  | "provider-dispatch-guard-reached"
  | "prepared-runtime-heartbeat"
  | "capture-entrypoint-complete";

type V1JCaptureLiveness = ReturnType<typeof createV1JCaptureLiveness>;
type V1JImageFactoryObservation = {
  eligible: boolean;
  constructed: boolean;
};
type V1JRealExactRuntimeSurface = {
  benchmarkCandidateNames: string[];
  mappedRuntimeNames: string[];
  expectedRuntimeNames: string[];
  benchmarkImageMapping: string;
  runtimeBuiltinImageToolName: string;
  imageFactoryEligible: boolean;
  imageFactoryConstructed: boolean;
};
type V1JSchemaValidationAudit = {
  authorizedCount: number;
  providerCount: number;
  expectedRuntimeCount: number;
  authorizedUniqueCount: number;
  providerUniqueCount: number;
  authorizedNamesUnique: boolean;
  providerNamesUnique: boolean;
  authorizedNamesSha256: string;
  providerNamesSha256: string;
  authorizedDuplicateNames: string[];
  providerDuplicateNames: string[];
  authorizedOnlyNames: string[];
  providerOnlyNames: string[];
  missingAuthorizedSchemas: Array<{ index: number; name?: string; missingFields: string[] }>;
  missingProviderSchemas: Array<{ index: number; name?: string; missingFields: string[] }>;
  providerSubsetOfAuthorized: boolean;
  authorizedNameSetMatchesExpectedRuntime: boolean;
  providerNameSetMatchesExpectedRuntime: boolean;
  expectedRuntimeFingerprintMatchesFrozen?: boolean;
  validationPredicatesFailed: string[];
};

const V1J_REAL_EXACT_EXPECTED_RUNTIME_NAME_SET_SHA256 =
  "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b";
const V1J_RUNTIME_BUILTIN_IMAGE_TOOL_NAME = "view_image";

function deriveV1JRealExactRuntimeSurface(input: {
  benchmarkCandidateNames: readonly string[];
  imageFactory: V1JImageFactoryObservation;
}): V1JRealExactRuntimeSurface {
  const benchmarkCandidateNames = [...new Set(input.benchmarkCandidateNames)].toSorted();
  const mappedRuntimeNames = [
    ...new Set(
      benchmarkCandidateNames.flatMap((name) => {
        const realTool = getBenchmarkRealToolMapping(name).realTool;
        return realTool ? [realTool] : [];
      }),
    ),
  ].toSorted();
  const benchmarkImageMapping = getBenchmarkRealToolMapping("image").realTool;
  if (!benchmarkImageMapping) {
    throw new Error("v1J REAL_EXACT image mapping must remain explicitly mapped");
  }
  if (input.imageFactory.eligible !== input.imageFactory.constructed) {
    throw new Error("v1J image factory eligibility and construction disagree");
  }
  if (
    input.imageFactory.eligible &&
    benchmarkImageMapping !== V1J_RUNTIME_BUILTIN_IMAGE_TOOL_NAME
  ) {
    throw new Error("v1J eligible image factory does not match the benchmark runtime mapping");
  }
  const expectedRuntimeNames = mappedRuntimeNames
    .filter((name) => input.imageFactory.eligible || name !== benchmarkImageMapping)
    .toSorted();
  return {
    benchmarkCandidateNames,
    mappedRuntimeNames,
    expectedRuntimeNames,
    benchmarkImageMapping,
    runtimeBuiltinImageToolName: V1J_RUNTIME_BUILTIN_IMAGE_TOOL_NAME,
    imageFactoryEligible: input.imageFactory.eligible,
    imageFactoryConstructed: input.imageFactory.constructed,
  };
}

function hashV1JNameSet(names: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...names].toSorted((left, right) => left.localeCompare(right))))
    .digest("hex");
}

const V1J_SCHEMA_CAPTURE_NAME_ARM: Record<V1JCanonicalSchemaCaptureName, V1JSchemaCaptureArm> = {
  "capture-1": "A",
  "capture-2": "A",
  "arm-a": "A",
  "arm-c": "C",
};

function resolveV1JSchemaCaptureArm(
  name: string,
  harnessCommit = HARNESS_COMMIT,
): V1JSchemaCaptureArm | undefined {
  if (Object.hasOwn(V1J_SCHEMA_CAPTURE_NAME_ARM, name)) {
    return V1J_SCHEMA_CAPTURE_NAME_ARM[name as V1JCanonicalSchemaCaptureName];
  }
  const recheck = /^capture-1-recheck-([0-9a-f]{8,40})$/.exec(name);
  return recheck && harnessCommit.startsWith(recheck[1]!) ? "A" : undefined;
}

function createV1JCaptureLiveness(name: V1JSchemaCaptureName, diagnosticId?: string) {
  const root = path.resolve(
    "artifacts/capability-intelligence/v1j-action-initiation/schema-baseline",
  );
  const suffix = diagnosticId ? `-${diagnosticId}` : "";
  const filePath = path.join(root, `${name}-liveness${suffix}.jsonl`);
  if (path.relative(root, filePath).startsWith(`..${path.sep}`) || fs.existsSync(filePath)) {
    throw new Error("v1J capture liveness output is unsafe or already exists");
  }
  fs.mkdirSync(root, { recursive: true });
  const fd = fs.openSync(filePath, "wx");
  const startedAt = process.hrtime.bigint();
  let lastSuccessfulCheckpoint: V1JCaptureCheckpoint | null = null;
  let selectedRuntimes: string[] = [];
  let lastLoadedRuntime: string | null = null;
  let closed = false;
  return {
    filePath,
    record(
      checkpoint: V1JCaptureCheckpoint,
      metadata: {
        selectedRuntimes?: readonly string[];
        runtimeId?: string;
        providerDispatchAttempts?: number;
        eventLoopDelayMs?: number;
        errorName?: string;
        sinkInvocationIndex?: number;
        captureName?: string;
        caseId?: string;
        harnessCommit?: string;
        headCommit?: string;
        arm?: string;
        replicate?: number;
        providerRequestPhase?: string;
        callSite?: string;
        operation?: string;
        errorCode?: string | number;
        errorMessage?: string;
        error?: { name: string; code?: string | number; message: string };
        targetPath?: string;
        validationAudit?: V1JSchemaValidationAudit;
        imageFactoryCalled?: boolean;
        imageFactoryReturnedTool?: boolean;
        imageFactoryToolName?: string;
        viewImagePresent?: boolean;
        imagePresent?: boolean;
      } = {},
    ) {
      if (closed) {
        throw new Error("v1J capture liveness journal is closed");
      }
      if (metadata.selectedRuntimes) {
        selectedRuntimes = [...metadata.selectedRuntimes];
      }
      if (checkpoint === "selected-runtime-load-complete" && metadata.runtimeId) {
        lastLoadedRuntime = metadata.runtimeId;
      }
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const row = {
        timestamp: new Date().toISOString(),
        event: checkpoint,
        checkpoint,
        elapsedMs,
        elapsed_ms: elapsedMs,
        pid: process.pid,
        eventLoopPhase: null,
        ...(metadata.eventLoopDelayMs === undefined
          ? {}
          : { eventLoopDelayMs: metadata.eventLoopDelayMs }),
        selectedRuntimes,
        lastLoadedRuntime,
        lastSuccessfulCheckpoint,
        ...(metadata.providerDispatchAttempts === undefined
          ? {}
          : { providerDispatchAttempts: metadata.providerDispatchAttempts }),
        ...(metadata.errorName === undefined ? {} : { errorName: metadata.errorName }),
        ...(metadata.sinkInvocationIndex === undefined
          ? {}
          : { sinkInvocationIndex: metadata.sinkInvocationIndex }),
        ...(metadata.captureName === undefined ? {} : { captureName: metadata.captureName }),
        ...(metadata.captureName === undefined ? {} : { capture_name: metadata.captureName }),
        ...(metadata.caseId === undefined ? {} : { caseId: metadata.caseId }),
        ...(metadata.caseId === undefined ? {} : { case_id: metadata.caseId }),
        ...(metadata.arm === undefined ? {} : { arm: metadata.arm }),
        ...(metadata.replicate === undefined ? {} : { replicate: metadata.replicate }),
        ...(metadata.harnessCommit === undefined ? {} : { harness_commit: metadata.harnessCommit }),
        ...(metadata.headCommit === undefined ? {} : { head_commit: metadata.headCommit }),
        ...(metadata.providerRequestPhase === undefined
          ? {}
          : { providerRequestPhase: metadata.providerRequestPhase }),
        ...(metadata.callSite === undefined ? {} : { callSite: metadata.callSite }),
        ...(metadata.operation === undefined ? {} : { operation: metadata.operation }),
        ...(metadata.errorCode === undefined ? {} : { errorCode: metadata.errorCode }),
        ...(metadata.errorMessage === undefined ? {} : { errorMessage: metadata.errorMessage }),
        ...(metadata.error === undefined ? {} : { error: metadata.error }),
        ...(metadata.targetPath === undefined ? {} : { targetPath: metadata.targetPath }),
        ...(metadata.validationAudit === undefined
          ? {}
          : { validationAudit: metadata.validationAudit }),
        ...(metadata.imageFactoryCalled === undefined
          ? {}
          : { imageFactoryCalled: metadata.imageFactoryCalled }),
        ...(metadata.imageFactoryReturnedTool === undefined
          ? {}
          : { imageFactoryReturnedTool: metadata.imageFactoryReturnedTool }),
        ...(metadata.imageFactoryToolName === undefined
          ? {}
          : { imageFactoryToolName: metadata.imageFactoryToolName }),
        ...(metadata.viewImagePresent === undefined
          ? {}
          : { viewImagePresent: metadata.viewImagePresent }),
        ...(metadata.imagePresent === undefined ? {} : { imagePresent: metadata.imagePresent }),
      };
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
      fs.fsyncSync(fd);
      lastSuccessfulCheckpoint = checkpoint;
    },
    close() {
      if (!closed) {
        fs.closeSync(fd);
        closed = true;
      }
    },
  };
}

function prepareV1JPreSinkCapture(input: {
  captureName: V1JSchemaCaptureName | undefined;
  captureArm: V1JSchemaCaptureArm | undefined;
  caseId: string;
  replicate: number;
  surfaceMode: "REAL_EXACT" | "SYNTHETIC" | undefined;
  benchmarkCandidateNames: readonly string[] | undefined;
  getImageFactoryObservation: (() => V1JImageFactoryObservation | undefined) | undefined;
  harnessCommit: string;
  headCommit: string;
  invocationIndex: number;
  liveness?: Pick<V1JCaptureLiveness, "record">;
}): {
  name: V1JSchemaCaptureName;
  arm: V1JSchemaCaptureArm;
  surfaceMode: "REAL_EXACT" | "SYNTHETIC";
  benchmarkCandidateNames: readonly string[];
  imageFactory: V1JImageFactoryObservation | undefined;
  invocation: {
    index: number;
    caseId: string;
    arm: V1JSchemaCaptureArm;
    replicate: number;
    providerRequestPhase: string;
    callSite: string;
  };
  sinkMetadata: {
    sinkInvocationIndex: number;
    captureName: string;
    caseId: string;
    arm: string;
    replicate: number;
    providerRequestPhase: string;
    callSite: string;
  };
} {
  let operation = "capture-options-check";
  const arm = input.captureArm ?? "A";
  const commonMetadata = {
    ...(input.captureName ? { captureName: input.captureName } : {}),
    caseId: input.caseId,
    arm,
    replicate: input.replicate,
    harnessCommit: input.harnessCommit,
    headCommit: input.headCommit,
  };
  const record = (
    checkpoint: V1JCaptureCheckpoint,
    extra: Parameters<V1JCaptureLiveness["record"]>[1] = {},
  ) => input.liveness?.record(checkpoint, { ...commonMetadata, ...extra });
  try {
    record("capture-options-check-start");
    if (
      !input.captureName ||
      resolveV1JSchemaCaptureArm(input.captureName, input.harnessCommit) !== arm ||
      !input.surfaceMode ||
      !input.benchmarkCandidateNames
    ) {
      throw new Error("v1J capture options are incomplete");
    }
    record("capture-options-check-complete");

    operation = "image-observation-read";
    record("image-observation-read-start");
    const imageFactory = input.getImageFactoryObservation?.();
    record("image-observation-read-complete");

    operation = "capture-provenance-check";
    record("capture-provenance-check-start");
    if (input.surfaceMode === "REAL_EXACT" && !imageFactory) {
      throw new Error("v1J capture is missing REAL_EXACT surface provenance");
    }
    record("capture-provenance-check-complete");

    operation = "invocation-metadata-build";
    record("invocation-metadata-build-start");
    const invocation = {
      index: input.invocationIndex,
      caseId: input.caseId,
      arm,
      replicate: input.replicate,
      providerRequestPhase: "provider-request-constructed-before-dispatch",
      callSite: "runOne.diagnostics.hooks.onProviderRequest",
    };
    const sinkMetadata = {
      sinkInvocationIndex: invocation.index,
      captureName: input.captureName,
      caseId: invocation.caseId,
      arm: invocation.arm,
      replicate: invocation.replicate,
      providerRequestPhase: invocation.providerRequestPhase,
      callSite: invocation.callSite,
    };
    record("invocation-metadata-build-complete", sinkMetadata);

    operation = "sink-start-checkpoint-write";
    record("sink-start-checkpoint-write-start", sinkMetadata);
    record("schema-sink-start", sinkMetadata);
    record("sink-start-checkpoint-write-complete", sinkMetadata);
    return {
      name: input.captureName,
      arm,
      surfaceMode: input.surfaceMode,
      benchmarkCandidateNames: input.benchmarkCandidateNames,
      imageFactory,
      invocation,
      sinkMetadata,
    };
  } catch (error) {
    const candidate = error instanceof Error ? error : new Error(String(error));
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const message = candidate.message
      .replace(/(?:bearer\s+)[^\s,]+/gi, "Bearer [REDACTED]")
      .slice(0, 500);
    try {
      record("pre-sink-error", {
        operation,
        error: {
          name: candidate.name.slice(0, 100),
          ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
          message,
        },
      });
    } catch {
      // Preserve the pre-sink error if writing its diagnostic row also fails.
    }
    throw error;
  }
}

function recordV1JRuntimeCheckpoint(
  liveness: V1JCaptureLiveness | undefined,
  stage: string,
  runtimeId?: string,
): void {
  if (!liveness) {
    return;
  }
  const checkpoints: Record<string, V1JCaptureCheckpoint> = {
    "runtime-registry-discovery-started": "plugin-discovery-start",
    "runtime-registry-discovery-completed": "plugin-discovery-complete",
    "plugin-prep-runtime-registry-entered": "runtime-registry-start",
    "plugin-prep-runtime-registry-complete": "runtime-registry-complete",
    "runtime-registry-candidate-module-load-started": "selected-runtime-load-start",
    "runtime-registry-candidate-module-load-completed": "selected-runtime-load-complete",
    "attempt-tool-catalog-entered": "authorized-catalog-start",
    "attempt-tool-catalog-completed": "authorized-catalog-complete",
    "provider-adapter-entered": "provider-tool-projection-start",
  };
  const checkpoint = checkpoints[stage];
  if (checkpoint) {
    liveness.record(checkpoint, runtimeId ? { runtimeId } : {});
  }
}

function resolveV1JSchemaCaptureOptions(
  env: NodeJS.ProcessEnv,
  harnessCommit = HARNESS_COMMIT,
): { name: V1JSchemaCaptureName; arm: V1JSchemaCaptureArm } | undefined {
  if (env.OPENCLAW_V1J_SCHEMA_CAPTURE === undefined) {
    return undefined;
  }
  if (env.OPENCLAW_V1J_SCHEMA_CAPTURE !== "1") {
    throw new Error("OPENCLAW_V1J_SCHEMA_CAPTURE must be 1 when set");
  }
  const name = env.OPENCLAW_V1J_SCHEMA_CAPTURE_NAME;
  if (!name) {
    throw new Error("OPENCLAW_V1J_SCHEMA_CAPTURE_NAME must be a recognized capture name");
  }
  const expectedArm = resolveV1JSchemaCaptureArm(name, harnessCommit);
  if (!expectedArm) {
    throw new Error("OPENCLAW_V1J_SCHEMA_CAPTURE_NAME must be a recognized capture name");
  }
  const arm = env.OPENCLAW_V1J_SCHEMA_CAPTURE_ARM;
  if (arm !== "A" && arm !== "C") {
    throw new Error("OPENCLAW_V1J_SCHEMA_CAPTURE_ARM must be A or C");
  }
  if (expectedArm !== arm) {
    throw new Error(`schema capture ${name} is not configured for Arm ${arm}`);
  }
  return { name: name as V1JSchemaCaptureName, arm };
}

function readV1JCaptureExperimentalInstruction(arm: V1JSchemaCaptureArm): string {
  if (arm === "A") {
    return "";
  }
  const root = path.resolve("artifacts/capability-intelligence/v1j-action-initiation");
  const preregistrationPath = path.join(root, "preregistration.json");
  const hashPath = path.join(root, "preregistration.sha256");
  const bytes = fs.readFileSync(preregistrationPath);
  const expectedHash = fs.readFileSync(hashPath, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (!expectedHash || actualHash !== expectedHash) {
    throw new Error("v1J capture preregistration hash mismatch");
  }
  const preregistration = JSON.parse(bytes.toString("utf8")) as {
    experimentId?: unknown;
    arms?: { C?: { experimentalInstruction?: unknown } };
  };
  if (
    preregistration.experimentId !== "v1J-ACTION-INITIATION" ||
    typeof preregistration.arms?.C?.experimentalInstruction !== "string" ||
    preregistration.arms.C.experimentalInstruction.length === 0
  ) {
    throw new Error("v1J capture Arm C setup is missing from the frozen preregistration");
  }
  return preregistration.arms.C.experimentalInstruction;
}

function buildV1JSchemaCaptureRequestOptions(input: {
  name: V1JSchemaCaptureName;
  arm: V1JSchemaCaptureArm;
}): {
  stopAfterCapture: true;
  schemaCaptureName: V1JSchemaCaptureName;
  schemaCaptureArm: V1JSchemaCaptureArm;
  capturePromptInstruction: string;
} {
  return {
    stopAfterCapture: true,
    schemaCaptureName: input.name,
    schemaCaptureArm: input.arm,
    capturePromptInstruction: readV1JCaptureExperimentalInstruction(input.arm),
  };
}

function assertV1JCaptureProvenance(): string {
  if (process.env.OPENCLAW_V1I_HARNESS_COMMIT?.trim()) {
    throw new Error("v1J schema capture does not allow OPENCLAW_V1I_HARNESS_COMMIT overrides");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== HARNESS_COMMIT) {
    throw new Error("v1J schema capture requires a clean committed harness HEAD");
  }
  const formalRoot = path.resolve(
    "artifacts/capability-intelligence/v1i-formal-60fe82b1-real-exact-run1",
  );
  const amendment = JSON.parse(
    fs.readFileSync(path.join(formalRoot, "provenance-amendment.json"), "utf8"),
  ) as unknown;
  if (!isV1IProvenanceAmendment(amendment, "60fe82b1b7c234100556620230706e4888ebf360", head)) {
    throw new Error("v1J schema capture harness provenance is not accepted");
  }
  if (
    hashV1ICanonical(modelConfigIdentity()) !==
    "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529"
  ) {
    throw new Error("v1J schema capture model configuration drifted");
  }
  return head;
}

function persistV1JSchemaCapture(input: {
  name: V1JSchemaCaptureName;
  arm: V1JSchemaCaptureArm;
  authorizedTools: readonly V1JAuthorizedToolSchema[];
  providerTools: unknown;
  model: string;
  surfaceMode: "REAL_EXACT" | "SYNTHETIC";
  benchmarkCandidateNames: readonly string[];
  harnessCommit?: string;
  imageFactory?: V1JImageFactoryObservation;
  invocation?: {
    index: number;
    caseId: string;
    arm: V1JSchemaCaptureArm;
    replicate: number;
    providerRequestPhase: string;
    callSite: string;
  };
  recordCheckpoint?: (
    checkpoint: V1JCaptureCheckpoint,
    metadata: {
      sinkInvocationIndex?: number;
      captureName?: string;
      caseId?: string;
      arm?: string;
      replicate?: number;
      providerRequestPhase?: string;
      callSite?: string;
      operation?: string;
      targetPath?: string;
      errorName?: string;
      errorCode?: string | number;
      errorMessage?: string;
      validationAudit?: V1JSchemaValidationAudit;
    },
  ) => void;
}): void {
  const root = path.resolve(
    "artifacts/capability-intelligence/v1j-action-initiation/schema-baseline",
  );
  const toolsPath = path.join(root, `${input.name}-provider-tools.json`);
  const metadataPath = path.join(root, `${input.name}-metadata.json`);
  const invocation = input.invocation ?? {
    index: 1,
    caseId: "offline-test",
    arm: input.arm,
    replicate: 1,
    providerRequestPhase: "offline-test",
    callSite: "persistV1JSchemaCapture-test",
  };
  const invocationMetadata = {
    sinkInvocationIndex: invocation.index,
    captureName: input.name,
    caseId: invocation.caseId,
    arm: invocation.arm,
    replicate: invocation.replicate,
    providerRequestPhase: invocation.providerRequestPhase,
    callSite: invocation.callSite,
  };
  let operation = "start";
  let targetPath = "schema-baseline";
  const checkpoint = (
    name: V1JCaptureCheckpoint,
    metadata: {
      operation?: string;
      targetPath?: string;
      validationAudit?: V1JSchemaValidationAudit;
      errorName?: string;
      errorCode?: string | number;
      errorMessage?: string;
    } = {},
  ) => input.recordCheckpoint?.(name, { ...invocationMetadata, ...metadata });
  const runOperation = <T>(
    operationName: string,
    start: V1JCaptureCheckpoint,
    complete: V1JCaptureCheckpoint,
    pathHint: string,
    run: () => T,
  ): T => {
    operation = operationName;
    targetPath = pathHint;
    checkpoint(start, { operation, targetPath });
    const result = run();
    checkpoint(complete, { operation, targetPath });
    return result;
  };
  try {
    if (resolveV1JSchemaCaptureArm(input.name, input.harnessCommit) !== input.arm) {
      throw new Error("v1J schema capture name/arm pair is invalid");
    }
    const authorizedTools = runOperation(
      "authorized-tool-copy",
      "schema-sink-authorized-copy-start",
      "schema-sink-authorized-copy-complete",
      "authorized-tools",
      () => structuredClone(input.authorizedTools) as unknown,
    );
    const providerTools = runOperation(
      "provider-tool-copy",
      "schema-sink-provider-copy-start",
      "schema-sink-provider-copy-complete",
      "provider-tools",
      () => structuredClone(input.providerTools) as unknown,
    );
    if (!Array.isArray(providerTools) || !Array.isArray(authorizedTools)) {
      throw new Error("v1J schema capture requires both complete tool arrays");
    }
    runOperation(
      "directory-creation",
      "schema-sink-mkdir-start",
      "schema-sink-mkdir-complete",
      "schema-baseline",
      () => fs.mkdirSync(root, { recursive: true }),
    );
    const providerNames = providerTools.map((tool) => providerToolName(tool));
    const authorizedNames = authorizedTools.map((tool) => (tool as V1JAuthorizedToolSchema).name);
    const imageFactory = input.surfaceMode === "REAL_EXACT" ? input.imageFactory : undefined;
    if (input.surfaceMode === "REAL_EXACT" && !imageFactory) {
      throw new Error("v1J REAL_EXACT capture requires observed image-factory state");
    }
    const runtimeSurface = imageFactory
      ? deriveV1JRealExactRuntimeSurface({
          benchmarkCandidateNames: input.benchmarkCandidateNames,
          imageFactory,
        })
      : undefined;
    const expectedSurfaceNames =
      runtimeSurface?.expectedRuntimeNames ??
      [...new Set(input.benchmarkCandidateNames)].toSorted();
    const expectedRuntimeNamesSha256 = runtimeSurface
      ? hashV1JNameSet(runtimeSurface.expectedRuntimeNames)
      : undefined;
    runOperation(
      "capture-validation",
      "schema-sink-validate-start",
      "schema-sink-validate-complete",
      "tool-surfaces-and-output-paths",
      () => {
        if (
          ![toolsPath, metadataPath].every((filePath) => {
            const relative = path.relative(root, filePath);
            return (
              relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== ".."
            );
          })
        ) {
          throw new Error("v1J schema capture output path escapes schema-baseline directory");
        }
        const authorizedNameSet = new Set(
          authorizedNames.filter((name): name is string => Boolean(name)),
        );
        const providerNameSet = new Set(
          providerNames.filter((name): name is string => Boolean(name)),
        );
        const duplicateNames = (names: Array<string | undefined>) =>
          [
            ...new Set(
              names.filter(
                (name): name is string =>
                  Boolean(name) && names.indexOf(name) !== names.lastIndexOf(name),
              ),
            ),
          ].toSorted();
        const missingSchemas = (
          tools: unknown[],
          names: Array<string | undefined>,
          provider: boolean,
        ): V1JSchemaValidationAudit["missingAuthorizedSchemas"] =>
          tools.flatMap((tool, index) => {
            const record =
              tool && typeof tool === "object" && !Array.isArray(tool)
                ? (tool as Record<string, unknown>)
                : undefined;
            const schema =
              provider && record?.function && typeof record.function === "object"
                ? (record.function as Record<string, unknown>)
                : record;
            const missingFields = [
              ...(typeof names[index] === "string" && names[index] ? [] : ["name"]),
              ...(schema && Object.hasOwn(schema, "parameters") && schema.parameters != null
                ? []
                : ["parameters"]),
            ];
            return missingFields.length > 0
              ? [{ index, ...(names[index] ? { name: names[index] } : {}), missingFields }]
              : [];
          });
        const nameDigest = (names: Array<string | undefined>) =>
          createHash("sha256")
            .update(
              JSON.stringify(
                names.toSorted((left, right) => (left ?? "").localeCompare(right ?? "")),
              ),
            )
            .digest("hex");
        const authorizedOnlyNames = [...authorizedNameSet]
          .filter((name) => !providerNameSet.has(name))
          .toSorted();
        const providerOnlyNames = [...providerNameSet]
          .filter((name) => !authorizedNameSet.has(name))
          .toSorted();
        const missingAuthorizedSchemas = missingSchemas(authorizedTools, authorizedNames, false);
        const missingProviderSchemas = missingSchemas(providerTools, providerNames, true);
        const expectedRuntimeNameSet = new Set(expectedSurfaceNames);
        const authorizedNameSetMatchesExpectedRuntime =
          authorizedNameSet.size === expectedRuntimeNameSet.size &&
          [...authorizedNameSet].every((name) => expectedRuntimeNameSet.has(name));
        const providerNameSetMatchesExpectedRuntime =
          providerNameSet.size === expectedRuntimeNameSet.size &&
          [...providerNameSet].every((name) => expectedRuntimeNameSet.has(name));
        const expectedRuntimeFingerprintMatchesFrozen = runtimeSurface
          ? expectedRuntimeNamesSha256 === V1J_REAL_EXACT_EXPECTED_RUNTIME_NAME_SET_SHA256
          : undefined;
        const providerSubsetOfAuthorized = providerOnlyNames.length === 0;
        const validationAudit: V1JSchemaValidationAudit = {
          authorizedCount: authorizedNames.length,
          providerCount: providerNames.length,
          expectedRuntimeCount: expectedSurfaceNames.length,
          authorizedUniqueCount: authorizedNameSet.size,
          providerUniqueCount: providerNameSet.size,
          authorizedNamesUnique: authorizedNameSet.size === authorizedNames.length,
          providerNamesUnique: providerNameSet.size === providerNames.length,
          authorizedNamesSha256: nameDigest(authorizedNames),
          providerNamesSha256: nameDigest(providerNames),
          authorizedDuplicateNames: duplicateNames(authorizedNames),
          providerDuplicateNames: duplicateNames(providerNames),
          authorizedOnlyNames,
          providerOnlyNames,
          missingAuthorizedSchemas,
          missingProviderSchemas,
          providerSubsetOfAuthorized,
          authorizedNameSetMatchesExpectedRuntime,
          providerNameSetMatchesExpectedRuntime,
          expectedRuntimeFingerprintMatchesFrozen,
          validationPredicatesFailed: [
            ...(providerNames.length === expectedSurfaceNames.length
              ? []
              : ["providerCountMatchesExpectedRuntime"]),
            ...(authorizedNames.length === expectedSurfaceNames.length
              ? []
              : ["authorizedCountMatchesExpectedRuntime"]),
            ...(providerNames.every((name) => Boolean(name)) ? [] : ["providerNamesPresent"]),
            ...(authorizedNames.every((name) => Boolean(name)) ? [] : ["authorizedNamesPresent"]),
            ...(providerNameSet.size === providerNames.length ? [] : ["providerNamesUnique"]),
            ...(authorizedNameSet.size === authorizedNames.length ? [] : ["authorizedNamesUnique"]),
            ...(authorizedNameSetMatchesExpectedRuntime
              ? []
              : ["authorizedNameSetMatchesExpectedRuntime"]),
            ...(providerNameSetMatchesExpectedRuntime
              ? []
              : ["providerNameSetMatchesExpectedRuntime"]),
            ...(missingAuthorizedSchemas.length === 0 ? [] : ["authorizedSchemasComplete"]),
            ...(missingProviderSchemas.length === 0 ? [] : ["providerSchemasComplete"]),
            ...(authorizedOnlyNames.length === 0 ? [] : ["authorizedProviderNameSetEqual"]),
            ...(providerOnlyNames.length === 0 ? [] : ["providerSubsetOfAuthorized"]),
            ...(expectedRuntimeFingerprintMatchesFrozen !== false
              ? []
              : ["expectedRuntimeNameSetFingerprintMatchesFrozen"]),
          ],
        };
        checkpoint("schema-sink-validation", {
          operation: "independent-surface-predicate-audit",
          targetPath: "tool-surface-metadata-only",
          validationAudit,
        });
        if (fs.existsSync(toolsPath) || fs.existsSync(metadataPath)) {
          throw new Error(`v1J schema capture already exists: ${input.name}`);
        }
        if (
          providerNames.length !== expectedSurfaceNames.length ||
          authorizedNames.length !== expectedSurfaceNames.length ||
          providerNames.some((name) => !name) ||
          authorizedNames.some((name) => !name) ||
          new Set(providerNames).size !== providerNames.length ||
          new Set(authorizedNames).size !== authorizedNames.length ||
          !authorizedNameSetMatchesExpectedRuntime ||
          !providerNameSetMatchesExpectedRuntime ||
          authorizedOnlyNames.length > 0 ||
          providerOnlyNames.length > 0 ||
          missingAuthorizedSchemas.length > 0 ||
          missingProviderSchemas.length > 0 ||
          expectedRuntimeFingerprintMatchesFrozen === false
        ) {
          throw new Error(
            input.surfaceMode === "REAL_EXACT"
              ? "v1J schema capture requires matching complete REAL_EXACT runtime surfaces"
              : "v1J schema capture requires matching complete synthetic benchmark surfaces",
          );
        }
      },
    );
    const serialized = runOperation(
      "snapshot-serialization",
      "schema-sink-canonicalize-start",
      "schema-sink-canonicalize-complete",
      "schema-baseline-json-bytes",
      () => ({
        tools: `${JSON.stringify({ authorizedTools, providerTools }, null, 2)}\n`,
        metadata: `${JSON.stringify(
          {
            head: HARNESS_COMMIT,
            model: input.model,
            modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
            provider: PROVIDER,
            contextLength: CONTEXT_LENGTH,
            rankerVersion: SHADOW_RANKER_VERSION,
            topK: 8,
            activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
            canonicalizationVersion: "v1j-provider-schema-v1",
            surfaceMode: input.surfaceMode,
            authorizedToolCount: authorizedNames.length,
            authorizedToolNames: authorizedNames,
            providerToolCount: providerNames.length,
            providerToolNames: providerNames,
            benchmarkCandidateInventory: {
              count: new Set(input.benchmarkCandidateNames).size,
              names: [...new Set(input.benchmarkCandidateNames)].toSorted(),
            },
            ...(runtimeSurface
              ? {
                  realExactMappedRuntimeNames: {
                    count: runtimeSurface.mappedRuntimeNames.length,
                    names: runtimeSurface.mappedRuntimeNames,
                  },
                  expectedRealExactRuntimeSurface: {
                    count: runtimeSurface.expectedRuntimeNames.length,
                    names: runtimeSurface.expectedRuntimeNames,
                    nameSetSha256: expectedRuntimeNamesSha256,
                  },
                  benchmarkImageMapping: runtimeSurface.benchmarkImageMapping,
                  runtimeBuiltinImageToolName: runtimeSurface.runtimeBuiltinImageToolName,
                  imageFactoryEligible: runtimeSurface.imageFactoryEligible,
                  imageFactoryConstructed: runtimeSurface.imageFactoryConstructed,
                }
              : {}),
            actualAuthorizedProviderSurface: {
              authorizedCount: authorizedNames.length,
              authorizedNames,
              providerCount: providerNames.length,
              providerNames,
            },
            modelRequestsSent: 0,
            setupArm: input.arm,
          },
          null,
          2,
        )}\n`,
      }),
    );
    const writeDurable = (filePath: string, contents: string, label: string) => {
      const relativePath = path.relative(root, filePath);
      operation = `${label}-write`;
      targetPath = relativePath;
      const fd = fs.openSync(filePath, "wx");
      try {
        fs.writeFileSync(fd, contents, "utf8");
        operation = `${label}-fsync-close`;
        checkpoint("schema-sink-fsync-or-close-start", {
          operation: `${label}-fsync`,
          targetPath: relativePath,
        });
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        checkpoint("schema-sink-fsync-or-close-complete", {
          operation: `${label}-fsync-close`,
          targetPath: relativePath,
        });
      } catch (error) {
        try {
          fs.closeSync(fd);
        } catch {
          // Preserve the operation error; the durable liveness row carries its stage.
        }
        throw error;
      }
    };
    runOperation(
      "tools-file-write",
      "schema-sink-write-tools-start",
      "schema-sink-write-tools-complete",
      path.basename(toolsPath),
      () => writeDurable(toolsPath, serialized.tools, "tools"),
    );
    runOperation(
      "metadata-file-write",
      "schema-sink-write-metadata-start",
      "schema-sink-write-metadata-complete",
      path.basename(metadataPath),
      () => writeDurable(metadataPath, serialized.metadata, "metadata"),
    );
  } catch (error) {
    const candidate = error instanceof Error ? error : new Error(String(error));
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const message = candidate.message
      .replace(/(?:bearer\s+)[^\s,]+/gi, "Bearer [REDACTED]")
      .slice(0, 500);
    checkpoint("schema-sink-error", {
      operation,
      targetPath,
      errorName: candidate.name.slice(0, 100),
      errorCode: typeof code === "string" || typeof code === "number" ? code : undefined,
      errorMessage: message,
    });
    throw error;
  }
}

function providerToolName(tool: unknown): string | undefined {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return undefined;
  }
  const record = tool as Record<string, unknown>;
  if (typeof record.name === "string") {
    return record.name;
  }
  const fn = record.function;
  return fn && typeof fn === "object" && !Array.isArray(fn)
    ? typeof (fn as Record<string, unknown>).name === "string"
      ? ((fn as Record<string, unknown>).name as string)
      : undefined
    : undefined;
}

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
  providerDispatchAttempts: number;
  providerInvocationCount: number;
  responseSummaries: ProviderResponseSummary[];
  originalFetch: typeof globalThis.fetch;
  wrapFetch: (baseFetch: typeof globalThis.fetch) => typeof globalThis.fetch;
  recordProviderRequest: (request: CapturedModelRequest) => void;
  restore: () => void;
};

function safeDiagnosticError(error: unknown): { errorClass: string; errorCode?: string } {
  if (!(error instanceof Error)) {
    return { errorClass: "NonErrorThrown" };
  }
  const code = (error as Error & { code?: unknown }).code;
  return {
    errorClass: error.name || "Error",
    ...(typeof code === "string" || typeof code === "number" ? { errorCode: String(code) } : {}),
  };
}

function safeDiagnosticContentType(response: Response): string | undefined {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mediaType)
    ? mediaType
    : undefined;
}

class V1IProviderRequestCapturedError extends Error {
  constructor() {
    super("v1I provider request captured before network I/O");
    this.name = "V1IProviderRequestCapturedError";
  }
}

class V1IProviderDispatchAttemptError extends Error {
  constructor() {
    super("v1J capture blocked a provider dispatch attempt");
    this.name = "V1IProviderDispatchAttemptError";
  }
}

class V1JUnexpectedPreflightModelResultError extends Error {
  constructor(readonly classification: string) {
    super(`v1J preflight rejected unexpected model result: ${classification}`);
    this.name = "V1JUnexpectedPreflightModelResultError";
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
const describeV1JSchemaCapture = V1J_SCHEMA_CAPTURE_MODE === undefined ? describe.skip : describe;
const describeV1JActionLive =
  V1J_ACTION_LIVE_TEST &&
  V1J_ACTION_LIVE_AUTHORIZED &&
  !V1J_PROVIDER_RESPONSE_DIAGNOSTIC &&
  !V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED &&
  !V1J_ACTION_SMOKE_TEST &&
  !V1J_ACTION_SMOKE_AUTHORIZED &&
  V1J_SCHEMA_CAPTURE_MODE === undefined
    ? describe
    : describe.skip;
const describeV1JActionSmoke =
  V1J_ACTION_SMOKE_TEST || V1J_ACTION_SMOKE_AUTHORIZED ? describe : describe.skip;
const describeV1JProviderResponseDiagnostic =
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC || V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED
    ? describe
    : describe.skip;
const describeV1JArmCPreflightDiagnostic = V1J_ARM_C_PREFLIGHT_DIAGNOSTIC
  ? describe
  : describe.skip;
const describeV1JPayloadDecomposition = V1J_PAYLOAD_DECOMPOSITION ? describe : describe.skip;
const describeV1JAdapterDifferential = V1J_ADAPTER_DIFFERENTIAL ? describe : describe.skip;
const describeV1JRawRepeatability = V1J_RAW_REPEATABILITY ? describe : describe.skip;
const describeV1JProviderCapturePreflight = V1J_PROVIDER_CAPTURE_PREFLIGHT
  ? describe
  : describe.skip;
const describeV1JProviderMaterializationTracePreflight = V1J_MATERIALIZATION_TRACE_PREFLIGHT
  ? describe
  : describe.skip;
const describeFullLive =
  LIVE &&
  !SMOKE_TEST &&
  !DIAGNOSTIC_TEST &&
  V1J_SCHEMA_CAPTURE_MODE === undefined &&
  !V1J_ACTION_LIVE_TEST &&
  !V1J_ACTION_SMOKE_TEST &&
  !V1J_ACTION_SMOKE_AUTHORIZED &&
  !V1J_PROVIDER_RESPONSE_DIAGNOSTIC &&
  !V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED
    ? describe
    : describe.skip;
const describeSmokeLive = SMOKE_TEST ? describe : describe.skip;
const describeDiagnosticLive = DIAGNOSTIC_TEST ? describe : describe.skip;
const LIVE_MODE = resolveV1IMode(LIVE, process.env.OPENCLAW_V1I_MODE);

describe("v1J Arm C preflight entrypoint wiring", () => {
  it("creates its journal and reaches one preflight without entering a schedule", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-arm-c-entrypoint-wiring-"));
    const head = "7".repeat(40);
    const journal = createV1JArmCOnlyPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: head,
      caseId: "offline-arm-c-entrypoint",
      preflightId: "offline-arm-c-entrypoint-wiring",
      pid: process.pid,
    });
    let preflightCalls = 0;
    try {
      journal.record("arm-c-only-entrypoint-guards-verified", {
        armAPreflightReached: false,
        smokeScheduleReached: false,
        formalArtifactTouched: false,
        normalSmokeArtifactTouched: false,
      });
      await runV1JArmCPreflightOnly({
        journal,
        captureArmC: async () => {
          preflightCalls += 1;
          return "arm-c-preflight-complete";
        },
      });
      const events = fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { event: string }).event);
      expect(preflightCalls).toBe(1);
      expect(events).toEqual([
        "arm-c-preflight-start",
        "arm-c-only-entrypoint-guards-verified",
        "arm-c-only-preflight-start",
        "arm-c-only-preflight-terminated",
      ]);
    } finally {
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describeV1JArmCPreflightDiagnostic("v1J Arm C preflight-only diagnostic", () => {
  it(
    "captures only Arm C and terminates after its preflight outcome",
    { timeout: 120_000 },
    async () => {
      if (!V1J_ARM_C_PREFLIGHT_DIAGNOSTIC || LIVE) {
        throw new Error("v1J Arm C preflight requires its dedicated execution gate");
      }
      const protocol = readV1JPreregistration();
      const head = assertV1JCommittedHarness(protocol);
      const provenancePath = path.resolve(process.cwd(), V1J_SMOKE_PROVENANCE_PATH);
      const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as unknown;
      assertV1JSmokeProvenance(provenance, protocol, head);
      if (
        V1J_PREREGISTRATION_SHA256 !==
          "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172" ||
        protocol.base.productionFrozen.activeFilteringEnabled !== false ||
        ACTIVE_FILTERING_ENABLED !== false
      ) {
        throw new Error("v1J Arm C preflight frozen protocol/runtime guards failed");
      }
      const schemaGate = protocol.surfaceAndRuntime.schemaIntegrityGate;
      if (
        schemaGate.authorizedToolCount !== 15 ||
        schemaGate.providerToolCount !== 15 ||
        schemaGate.authorizedToolNameSha256 !==
          "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b" ||
        schemaGate.providerToolNameSha256 !==
          "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b" ||
        schemaGate.authorizedToolSchemaSha256 !==
          "e82b1930002abb9d4784edcada56491af39420d36e292c9f9792256a2231f128" ||
        schemaGate.providerToolSchemaSha256 !==
          "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2"
      ) {
        throw new Error(
          "v1J Arm C preflight schema fingerprints differ from the accepted baseline",
        );
      }
      await assertLiveModelAvailable();
      const caseId =
        protocol.design.cells.find((entry) => entry.stratum === "TOOL_REQUIRED")?.caseId ??
        "unknown";
      const journal = createV1JArmCOnlyPreflightDiagnosticJournal({
        repoRoot: process.cwd(),
        harnessCommit: head,
        caseId,
        preflightId: `arm-c-only-${head.slice(0, 8)}-${process.pid}`,
        pid: process.pid,
      });
      try {
        journal.record("arm-c-only-entrypoint-guards-verified", {
          v2Sha256: V1J_PREREGISTRATION_SHA256,
          provenanceAmendmentAccepted: true,
          schemaFingerprintsVerified: true,
          activeFilteringEnabled: false,
        });
        await runV1JArmCPreflightOnly({
          journal,
          captureArmC: () => captureV1JPreflightSurface(protocol, "C", head, journal),
        });
      } finally {
        journal.close();
      }
    },
  );
});

describeV1JProviderResponseDiagnostic("v1J provider-response first-cell diagnostic", () => {
  it(
    "diagnoses only smoke-tool-required Arm A cell 1 in an isolated artifact root",
    { timeout: 240_000 },
    async () => {
      if (
        !V1J_PROVIDER_RESPONSE_DIAGNOSTIC ||
        !V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED ||
        LIVE ||
        V1J_ACTION_LIVE_TEST ||
        V1J_ACTION_LIVE_AUTHORIZED ||
        V1J_ACTION_SMOKE_TEST ||
        V1J_ACTION_SMOKE_AUTHORIZED ||
        V1J_ARM_C_PREFLIGHT_DIAGNOSTIC ||
        V1J_SCHEMA_CAPTURE_MODE !== undefined ||
        process.env.OPENCLAW_V1J_CELL_ALLOWLIST !== undefined ||
        process.env.OPENCLAW_V1J_MAX_CELLS !== undefined ||
        process.env.OPENCLAW_V1I_MODE !== undefined
      ) {
        throw new Error("v1J provider-response diagnostic requires only its dedicated gates");
      }
      const protocol = readV1JPreregistration();
      const head = assertV1JCommittedHarness(protocol);
      const repoRoot = process.cwd();
      assertV1JFormalStateEmpty(repoRoot);
      if (
        V1J_PREREGISTRATION_SHA256 !==
          "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172" ||
        ACTIVE_FILTERING_ENABLED !== false ||
        protocol.base.productionFrozen.activeFilteringEnabled !== false
      ) {
        throw new Error("v1J provider-response diagnostic frozen protocol gate failed");
      }
      const provenancePath = path.resolve(repoRoot, V1J_SMOKE_PROVENANCE_PATH);
      const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as unknown;
      assertV1JSmokeProvenance(provenance, protocol, head);
      await assertLiveModelAvailable();

      const surfaceA = await captureV1JPreflightSurface(protocol, "A", head);
      const surfaceC = await captureV1JPreflightSurface(protocol, "C", head);
      if (canonicalizeV1IValue(surfaceA) !== canonicalizeV1IValue(surfaceC)) {
        throw new Error("v1J provider-response diagnostic A/C schema parity failed");
      }
      const expectedSurface = protocol.schemaBaseline;
      if (
        surfaceA.authorizedToolCount !== expectedSurface.authorizedToolCount ||
        surfaceA.providerToolCount !== expectedSurface.providerToolCount ||
        surfaceA.authorizedToolNameSha256 !== expectedSurface.authorizedToolNameSha256 ||
        surfaceA.providerToolNameSha256 !== expectedSurface.providerToolNameSha256 ||
        surfaceA.authorizedToolSchemaSha256 !== expectedSurface.authorizedToolSchemaSha256 ||
        surfaceA.providerToolSchemaSha256 !== expectedSurface.providerToolSchemaSha256
      ) {
        throw new Error("v1J provider-response diagnostic schema fingerprints drifted");
      }
      const smokeRoot = resolveV1JSmokeRoot(repoRoot, head);
      if (fs.existsSync(smokeRoot)) {
        throw new Error("v1J provider-response diagnostic refuses an existing normal smoke path");
      }
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-diagnostic-"));
      fs.writeFileSync(path.join(workspaceDir, "smoke-reference.txt"), "smoke-token-47\n", {
        encoding: "utf8",
        flag: "wx",
      });
      const journal = createV1JProviderResponseDiagnosticJournal({
        repoRoot,
        harnessCommit: head,
        modelId: protocol.model.id,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        schemaFingerprint: {
          authorizedToolCount: surfaceA.authorizedToolCount,
          providerToolCount: surfaceA.providerToolCount,
          authorizedToolNameSha256: surfaceA.authorizedToolNameSha256,
          providerToolNameSha256: surfaceA.providerToolNameSha256,
          authorizedToolSchemaSha256: surfaceA.authorizedToolSchemaSha256,
          providerToolSchemaSha256: surfaceA.providerToolSchemaSha256,
        },
        startedAt: new Date().toISOString(),
      });
      try {
        const cell = buildV1JSmokeSchedule(protocol)[0];
        if (!cell || cell.cellId !== V1J_PROVIDER_RESPONSE_DIAGNOSTIC_CELL) {
          fs.rmSync(workspaceDir, { recursive: true, force: true });
          throw new Error("v1J provider-response diagnostic cell identity changed");
        }
        journal.record("preflight-complete", {
          outcome: "pass",
          providerResponseObserved: false,
          terminalEvidenceComplete: false,
        });
        let observation: V1JObservation | undefined;
        let terminalEvidencePersisted = false;
        let cleanupFailure: unknown;
        try {
          observation = await executeV1JCell({
            protocol,
            cell,
            attempt: 1,
            head,
            benchmarkOverride: v1jSmokeBenchmark(cell),
            workspaceDirOverride: workspaceDir,
            allowNoToolTerminalEvidence: true,
            runIdPrefix: "v1j-provider-response-diagnostic",
            lifecycleJournal: journal,
          });
          terminalEvidencePersisted = true;
        } catch (error) {
          journal.record("diagnostic-cell-threw", {
            outcome: "rejected",
            ...safeDiagnosticError(error),
            terminalEvidenceComplete: false,
            terminalEvidencePersisted: false,
          });
          throw error;
        } finally {
          journal.record("cleanup-start", {
            terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
            terminalEvidencePersisted,
          });
          try {
            fs.rmSync(workspaceDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 50,
            });
          } catch (error) {
            cleanupFailure = error;
            const cleanupSecondary = isV1JCleanupFailureSecondary({
              terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
              terminalEvidencePersisted,
            });
            journal.record("cleanup-failed", {
              cleanupExceptionClass: safeDiagnosticError(error).errorClass,
              errorCode: safeDiagnosticError(error).errorCode,
              cleanupSecondary,
              terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
              terminalEvidencePersisted,
              outcome: "failed",
            });
          }
          if (!fs.existsSync(workspaceDir)) {
            journal.record("cleanup-complete", {
              terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
              terminalEvidencePersisted,
              outcome: "complete",
            });
          } else if (!cleanupFailure) {
            cleanupFailure = new Error("workspace remains after cleanup returned");
            const cleanupSecondary = isV1JCleanupFailureSecondary({
              terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
              terminalEvidencePersisted,
            });
            journal.record("cleanup-failed", {
              cleanupExceptionClass: "WorkspaceNotRemovedError",
              cleanupSecondary,
              terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
              terminalEvidencePersisted,
              outcome: "failed",
            });
          }
        }
        assertV1JFormalStateEmpty(repoRoot);
        if (fs.existsSync(smokeRoot)) {
          journal.record("normal-smoke-path-unexpectedly-created", { outcome: "hard-stop" });
          throw new Error("v1J provider-response diagnostic touched the normal smoke path");
        }
        journal.record("diagnostic-cell-finalized", {
          outcome: observation?.valid ? "valid" : "invalid",
          invalidReason: observation?.invalidReason ?? undefined,
          providerResponseObserved: observation?.providerResponseObserved ?? false,
          terminalEvidenceComplete: observation?.terminalEvidenceComplete ?? false,
          terminalEvidencePersisted,
          dispatchAttempt: observation?.modelRequestsSent ?? 0,
          cleanupSecondary:
            cleanupFailure !== undefined &&
            isV1JCleanupFailureSecondary({
              terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
              terminalEvidencePersisted,
            }),
        });
        const cleanupSecondary =
          cleanupFailure !== undefined &&
          isV1JCleanupFailureSecondary({
            terminalEvidenceComplete: observation?.terminalEvidenceComplete === true,
            terminalEvidencePersisted,
          });
        if (!observation?.valid || (cleanupFailure && !cleanupSecondary)) {
          throw new Error(
            `v1J provider-response diagnostic hard stop: ${observation?.invalidReason ?? "CLEANUP_FAILURE"}`,
          );
        }
      } finally {
        journal.close();
      }
    },
  );
});

describeV1JPayloadDecomposition("v1J payload-decomposition transport diagnostic", () => {
  it(
    "sends only the three commit-bound transport controls without executing tools",
    { timeout: 900_000 },
    async () =>
      runV1JPayloadDecompositionDiagnostic({
        repoRoot: process.cwd(),
        env: process.env,
        protocol: readV1JPreregistration(),
        head: assertV1JCommittedHarness(readV1JPreregistration()),
        trackedTreeClean: true,
        modelId: MODEL_ID,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        provider: PROVIDER,
        contextLength: CONTEXT_LENGTH,
        activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
        endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
        authorization: `Bearer ${process.env.LM_API_TOKEN ?? "lmstudio"}`,
        fetchImpl: fetch,
        captureArmARequest: async ({ protocol, head, smokeCell }) => {
          const bodies: Record<string, unknown>[] = [];
          const surface = await captureV1JPreflightSurface(protocol, "A", head, undefined, {
            benchmarkCase: v1jSmokeBenchmark(smokeCell),
            prepareWorkspace: (workspaceDir) =>
              fs.writeFileSync(path.join(workspaceDir, "smoke-reference.txt"), "smoke-token-47\n", {
                encoding: "utf8",
                flag: "wx",
              }),
            onCapturedRequest: (request) => bodies.push(structuredClone(request.body)),
          });
          return { bodies, surface, smokePrompt: smokeCell.prompt };
        },
      }),
  );
});

describeV1JAdapterDifferential("v1J raw-transport versus adapter differential", () => {
  it(
    "compares one raw request with one real Arm-A adapter/model-loop request",
    { timeout: 900_000 },
    async () => {
      if (
        !V1J_ADAPTER_DIFFERENTIAL ||
        process.env[V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG] !== "1" ||
        LIVE ||
        V1J_ACTION_LIVE_TEST ||
        V1J_ACTION_LIVE_AUTHORIZED ||
        V1J_ACTION_SMOKE_TEST ||
        V1J_ACTION_SMOKE_AUTHORIZED ||
        V1J_PROVIDER_RESPONSE_DIAGNOSTIC ||
        V1J_PROVIDER_RESPONSE_DIAGNOSTIC_AUTHORIZED ||
        V1J_ARM_C_PREFLIGHT_DIAGNOSTIC ||
        V1J_SCHEMA_CAPTURE_MODE !== undefined ||
        process.env.OPENCLAW_V1J_CELL_ALLOWLIST !== undefined ||
        process.env.OPENCLAW_V1J_MAX_CELLS !== undefined ||
        process.env.OPENCLAW_V1I_MODE !== undefined
      ) {
        throw new Error("v1J adapter differential requires only its dedicated authorization flags");
      }
      reportV1JAdapterDifferentialProgress({
        event: "checkpoint",
        stage: "live-config-test-start",
        elapsedMs: 0,
      });
      const protocol = readV1JPreregistration();
      const head = assertV1JCommittedHarness(protocol);
      const repoRoot = process.cwd();
      const protocolPath = path.resolve(repoRoot, V1J_PREREGISTRATION_PATH);
      const protocolBytes = fs.readFileSync(protocolPath);
      const protocolSha256 = createHash("sha256").update(protocolBytes).digest("hex");
      const provenance = JSON.parse(
        fs.readFileSync(path.resolve(repoRoot, V1J_SMOKE_PROVENANCE_PATH), "utf8"),
      ) as unknown;
      assertV1JSmokeProvenance(provenance, protocol, head);
      const artifactRoot = path.resolve(
        repoRoot,
        "artifacts/capability-intelligence/v1j-action-initiation",
        `${V1J_ADAPTER_DIFFERENTIAL_PREFIX}${head}`,
      );
      assertV1JAdapterDifferentialPreflight({
        env: process.env,
        head,
        trackedTreeClean: true,
        activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
        modelId: MODEL_ID,
        provider: PROVIDER,
        contextLength: CONTEXT_LENGTH,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        protocolSha256,
        detachedProtocolSha256: fs.readFileSync(
          protocolPath.replace(/\.json$/u, ".sha256"),
          "utf8",
        ),
        schema: protocol.schemaBaseline,
        provenanceAccepted: true,
        artifactExists: fs.existsSync(artifactRoot),
      });
      assertV1JFormalStateEmpty(repoRoot);
      await withV1JAdapterDifferentialProgress({
        stage: "lmstudio-discovery",
        operation: () => assertLiveModelAvailable(),
      });
      const modelDiscoveryStatus = "available-at-preflight";

      const cell = buildV1JSmokeSchedule(protocol).find(
        (candidate) => candidate.cellId === "smoke-tool-required:A:1",
      );
      if (!cell || cell.arm !== "A" || cell.stratum !== "TOOL_REQUIRED") {
        throw new Error("v1J adapter differential Arm-A smoke identity changed");
      }
      const benchmark = v1jSmokeBenchmark(cell);
      const capturedBodies: Record<string, unknown>[] = [];
      const schemaSurface = await withV1JAdapterDifferentialProgress({
        stage: "schema-preflight",
        operation: (checkpoint) => {
          checkpoint("prepared-runtime-acquisition-start");
          return captureV1JPreflightSurface(protocol, "A", head, undefined, {
            benchmarkCase: benchmark,
            prepareWorkspace: (preparedWorkspace) =>
              fs.writeFileSync(
                path.join(preparedWorkspace, "smoke-reference.txt"),
                "smoke-token-47\n",
                { encoding: "utf8", flag: "wx" },
              ),
            onCapturedRequest: (request) => capturedBodies.push(structuredClone(request.body)),
            onCheckpoint: (runtimeCheckpoint) => {
              if (
                runtimeCheckpoint.stage.startsWith("prepared-runtime-") ||
                runtimeCheckpoint.stage.startsWith("plugin-prep-")
              ) {
                checkpoint(runtimeCheckpoint.stage);
              }
            },
            onProgress: checkpoint,
          });
        },
      });
      const expectedSurface = protocol.schemaBaseline;
      if (
        capturedBodies.length !== 1 ||
        schemaSurface.authorizedToolCount !== expectedSurface.authorizedToolCount ||
        schemaSurface.providerToolCount !== expectedSurface.providerToolCount ||
        schemaSurface.authorizedToolNameSha256 !== expectedSurface.authorizedToolNameSha256 ||
        schemaSurface.providerToolNameSha256 !== expectedSurface.providerToolNameSha256 ||
        schemaSurface.authorizedToolSchemaSha256 !== expectedSurface.authorizedToolSchemaSha256 ||
        schemaSurface.providerToolSchemaSha256 !== expectedSurface.providerToolSchemaSha256
      ) {
        throw new Error(
          "v1J adapter differential request preflight drifted from the frozen schema",
        );
      }
      const capturedArmARequest = capturedBodies[0]!;
      const armAText = v1jSystemMessageText(capturedArmARequest);
      if (
        capturedArmARequest.model !== protocol.model.id ||
        capturedArmARequest.stream !== true ||
        !Array.isArray(capturedArmARequest.tools) ||
        capturedArmARequest.tools.length !== 15 ||
        armAText.includes(v1jInstructionForArm(protocol, "C"))
      ) {
        throw new Error("v1J adapter differential did not capture the frozen Arm-A request shape");
      }
      const schemaPreflightCompletedAtMs = Date.now();
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-adapter-differential-"));
      fs.writeFileSync(path.join(workspaceDir, "smoke-reference.txt"), "smoke-token-47\n", {
        encoding: "utf8",
        flag: "wx",
      });
      const requestMetrics = summarizeV1JAdapterDifferentialRequest(capturedArmARequest);
      const journal = await withV1JAdapterDifferentialProgress({
        stage: "differential-journal-creation",
        operation: () =>
          createV1JAdapterDifferentialJournal({
            repoRoot,
            harnessCommit: head,
            modelId: protocol.model.id,
            modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
            schemaFingerprint: schemaSurface,
            startedAt: new Date().toISOString(),
          }),
      });
      type RawOutcome = Awaited<ReturnType<typeof runV1JAdapterDifferentialRawTransport>>;
      let rawOutcome: RawOutcome | undefined;
      let rawTask: Promise<RawOutcome> | undefined;
      let observation: V1JObservation | undefined;
      let adapterDispatches = 0;
      let adapterToolGuard: ReturnType<typeof installV1JAdapterDifferentialToolGuard> | undefined;
      let adapterRequestMatch: ReturnType<typeof compareV1JAdapterDifferentialRequests> | undefined;
      let adapterRequestCandidateBody: Record<string, unknown> | undefined;
      let adapterPreparedRuntimeReadyAtMs: number | undefined;
      try {
        journal.record("captured-arm-a-request-ready", requestMetrics);
        adapterToolGuard = installV1JAdapterDifferentialToolGuard({
          workspaceRoot: workspaceDir,
          journal,
        });
        journal.record("adapter-path-start", { requestIndex: 1, outcome: "started" });
        observation = await withV1JAdapterDifferentialProgress({
          stage: "adapter-model-loop",
          operation: () =>
            executeV1JCell({
              protocol,
              cell,
              attempt: 1,
              head,
              benchmarkOverride: benchmark,
              workspaceDirOverride: workspaceDir,
              allowNoToolTerminalEvidence: true,
              runIdPrefix: "v1j-adapter-differential",
              lifecycleJournal: journal,
              onAssistantMessage: () => adapterToolGuard?.ensureInstalled(),
              onRequestCaptured: (request, requestIndex) => {
                if (requestIndex === 1) {
                  adapterRequestCandidateBody = structuredClone(request.body);
                }
                recordV1JAdapterDifferentialRequestFingerprint({
                  journal,
                  event:
                    requestIndex === 1
                      ? "adapter-initial-request-candidate"
                      : "adapter-followup-request-candidate",
                  body: request.body,
                  requestIndex,
                  dispatched: false,
                });
              },
              onProviderRequestBeforeDispatch: async ({
                request,
                rawBody,
                requestIndex,
                dispatchOrdinal,
              }) => {
                const adapterSummary = recordV1JAdapterDifferentialRequestFingerprint({
                  journal,
                  event:
                    requestIndex === 1
                      ? "adapter-initial-wire-request-pre-dispatch"
                      : "adapter-followup-wire-request-pre-dispatch",
                  body: request.body,
                  rawBody,
                  requestIndex,
                  dispatchOrdinal,
                  dispatched: false,
                });
                if (requestIndex !== 1) {
                  return;
                }
                const providerBoundRequest = JSON.parse(rawBody) as Record<string, unknown>;
                const comparison = compareV1JAdapterDifferentialRequests(
                  providerBoundRequest,
                  request.body,
                  rawBody,
                  rawBody,
                );
                adapterRequestMatch = comparison;
                journal.record("adapter-request-parity", {
                  requestIndex,
                  dispatchOrdinal,
                  requestMatch: comparison.requestMatch,
                  canonicalMatch: comparison.canonicalMatch,
                  rawRequestSha256: comparison.rawRequestSha256,
                  adapterRequestSha256: comparison.adapterRequestSha256,
                  rawCanonicalRequestSha256: comparison.rawCanonicalRequestSha256,
                  adapterCanonicalRequestSha256: comparison.adapterCanonicalRequestSha256,
                  requestJsonBytes: adapterSummary.requestJsonBytes,
                });
                const toolChoiceFingerprint = fingerprintV1JAdapterDifferentialField(
                  providerBoundRequest,
                  "tool_choice",
                );
                journal.record("provider-request-fork", {
                  requestIndex,
                  dispatchOrdinal,
                  outcome: "exact-provider-bound-body",
                  rawValueSource: "exact-provider-bound-initial-request",
                  toolChoicePresent: toolChoiceFingerprint.present,
                  toolChoiceValueType: toolChoiceFingerprint.valueType,
                  toolChoiceSha256: toolChoiceFingerprint.valueSha256 ?? undefined,
                  toolChoiceBytes: toolChoiceFingerprint.valueBytes,
                });
                for (const differingPath of comparison.differingPaths) {
                  journal.record("adapter-request-difference", {
                    requestIndex,
                    dispatchOrdinal,
                    differingPath,
                  });
                  const rawField = fingerprintV1JAdapterDifferentialField(
                    controlC.body,
                    differingPath,
                  );
                  const adapterCandidateField = fingerprintV1JAdapterDifferentialField(
                    adapterRequestCandidateBody ?? {},
                    differingPath,
                  );
                  const adapterWireField = fingerprintV1JAdapterDifferentialField(
                    request.body,
                    differingPath,
                  );
                  journal.record("adapter-request-difference-provenance", {
                    requestIndex,
                    dispatchOrdinal,
                    differingPath,
                    rawValueSource: "exact-provider-bound-initial-request",
                    adapterCandidateSource: "fresh-execute-v1jcell-request-observer",
                    adapterWireSource: "provider-fetch-body-pre-dispatch",
                    rawValuePresent: rawField.present,
                    rawValueType: rawField.valueType,
                    rawValueSha256: rawField.valueSha256,
                    rawValueBytes: rawField.valueBytes,
                    adapterCandidateValuePresent: adapterCandidateField.present,
                    adapterCandidateValueType: adapterCandidateField.valueType,
                    adapterCandidateValueSha256: adapterCandidateField.valueSha256,
                    adapterCandidateValueBytes: adapterCandidateField.valueBytes,
                    adapterWireValuePresent: adapterWireField.present,
                    adapterWireValueType: adapterWireField.valueType,
                    adapterWireValueSha256: adapterWireField.valueSha256,
                    adapterWireValueBytes: adapterWireField.valueBytes,
                  });
                }
                if (!comparison.canonicalMatch) {
                  throw new Error(
                    `v1J captured provider-bound request changed before raw fork at: ${comparison.differingPaths.join(",")}`,
                  );
                }
                let resolveRawDispatchStarted!: () => void;
                const rawDispatchStarted = new Promise<void>((resolve) => {
                  resolveRawDispatchStarted = resolve;
                });
                rawTask = withV1JAdapterDifferentialProgress({
                  stage: "raw-control-c-fork-dispatch",
                  operation: () =>
                    runV1JAdapterDifferentialRawTransport({
                      endpoint: request.url,
                      authorization: `Bearer ${process.env.LM_API_TOKEN ?? "lmstudio"}`,
                      requestBody: providerBoundRequest,
                      serializedRequestBody: rawBody,
                      fetchImpl: fetch,
                      journal,
                      dispatchContext: {
                        preparedRuntimeReadyAtMs: adapterPreparedRuntimeReadyAtMs,
                        schemaPreflightCompletedAtMs,
                        modelDiscoveryStatus,
                        requestTimeoutMs: 120_000,
                      },
                      onDispatchStarted: resolveRawDispatchStarted,
                    }),
                });
                // Release the adapter's pre-dispatch hook once the raw fork starts, not after its body completes.
                const rawDispatched = await Promise.race([
                  rawDispatchStarted.then(() => true),
                  rawTask.then(() => false),
                ]);
                if (!rawDispatched) {
                  rawOutcome = await rawTask;
                  throw new Error("v1J raw diagnostic completed without reaching dispatch");
                }
                assertV1JAdapterDifferentialRequestBudget({
                  rawRequests: 1,
                  adapterRequests: 0,
                });
              },
              onCheckpoint: (checkpoint) => {
                if (checkpoint.stage === "client-preparation-completed") {
                  adapterPreparedRuntimeReadyAtMs = Date.now();
                }
              },
              onProviderDispatchAttempt: (count, requestIndex) => {
                // The nested raw fork is provider request 2; keep it out of the adapter dispatch cap.
                if (requestIndex === 2) {
                  journal.record("raw-request-dispatch-observed", {
                    requestIndex,
                    dispatchOrdinal: count,
                    outcome: "raw-control-c",
                  });
                  return;
                }
                if (requestIndex === 0) {
                  return;
                }
                adapterDispatches += 1;
                assertV1JAdapterDifferentialRequestBudget({
                  rawRequests: rawTask ? 1 : 0,
                  adapterRequests: adapterDispatches,
                });
                const dispatchStartedAt = Date.now();
                journal.record("adapter-request-dispatch-start", {
                  dispatchOrdinal: adapterDispatches,
                  dispatchStartedAt: new Date(dispatchStartedAt).toISOString(),
                  timeSincePreparedRuntimeReadyMs:
                    adapterPreparedRuntimeReadyAtMs === undefined
                      ? undefined
                      : Math.max(0, dispatchStartedAt - adapterPreparedRuntimeReadyAtMs),
                  timeSinceSchemaPreflightCompleteMs: Math.max(
                    0,
                    dispatchStartedAt - schemaPreflightCompletedAtMs,
                  ),
                  modelDiscoveryStatus,
                  requestTimeoutMs: 120_000,
                });
                journal.record("adapter-dispatch-attempt", {
                  requestIndex,
                  outcome:
                    adapterDispatches <= V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS
                      ? "within-bound"
                      : "hard-stop",
                });
              },
            }),
        });
        if (rawTask) {
          rawOutcome ??= await rawTask;
          journal.record("raw-transport-complete", {
            httpStatus: rawOutcome.result?.httpStatus ?? null,
            responseFirstByteMs: rawOutcome.result?.responseFirstByteMs ?? null,
            responseChunkCount: rawOutcome.result?.responseChunkCount ?? 0,
            responseByteCount: rawOutcome.result?.responseByteCount ?? 0,
            elapsedMs: rawOutcome.result?.elapsedMs ?? 0,
            requestDispatchStarted: rawOutcome.dispatchStarted,
            requestDispatchCompleted: rawOutcome.result?.requestDispatchCompleted ?? false,
            outcome: rawOutcome.result?.timedOut
              ? "timed-out"
              : rawOutcome.result?.streamEnd
                ? "complete"
                : "incomplete",
            errorClass: rawOutcome.result?.errorName ?? rawOutcome.helperErrorName ?? undefined,
            errorCode: rawOutcome.result?.streamError ?? rawOutcome.helperErrorCode ?? undefined,
          });
        }
        if (!adapterRequestMatch?.canonicalMatch) {
          throw new Error("v1J initial adapter request did not prove parity with raw Control C");
        }
        if (adapterToolGuard.blockedToolCalls() > 0) {
          throw new Error("v1J adapter differential blocked an unapproved tool selection");
        }
        assertV1JAdapterDifferentialRequestBudget({
          rawRequests: rawOutcome?.dispatchStarted ? 1 : 0,
          adapterRequests: adapterDispatches,
        });
        recordV1JAdapterDifferentialOutcomes({
          journal,
          raw: rawOutcome ?? null,
          adapter: {
            dispatchCount: adapterDispatches,
            modelLoopStatus: observation.invalidReason ?? "completed",
            providerResponseObserved: observation.providerResponseObserved,
            terminalEvidenceComplete: observation.terminalEvidenceComplete,
            correlationStatus: observation.correlationStatus,
            toolCallCount: observation.toolCalls.length,
            executionCount: observation.executions.length,
            allowedReadDispatches: adapterToolGuard.readDispatches(),
            blockedToolCalls: adapterToolGuard.blockedToolCalls(),
          },
        });
      } catch (error) {
        if (rawTask && !rawOutcome) {
          try {
            rawOutcome = await rawTask;
          } catch {
            // The raw branch records its own structured result before settling.
          }
        }
        journal.record("differential-failed", {
          outcome: "failed",
          errorClass: error instanceof Error ? error.name : "NonErrorThrown",
          errorCode:
            error && typeof error === "object" && "code" in error
              ? typeof (error as { code?: unknown }).code === "string" ||
                typeof (error as { code?: unknown }).code === "number"
                ? String((error as { code: string | number }).code)
                : undefined
              : undefined,
          timeoutState:
            error instanceof Error && error.name === "TimeoutError" ? "timed-out" : "no-timeout",
        });
        throw error;
      } finally {
        finalizeV1JAdapterDifferentialDiagnostic({
          journal,
          cleanup: () => {
            adapterToolGuard?.restore();
            fs.rmSync(workspaceDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 50,
            });
          },
        });
      }
      assertV1JFormalStateEmpty(repoRoot);
      if (fs.existsSync(resolveV1JSmokeRoot(repoRoot, head))) {
        throw new Error("v1J adapter differential touched the normal smoke artifact path");
      }
      process.stdout.write(
        `${JSON.stringify({
          rawTransport: rawOutcome ?? null,
          adapterDispatches,
          maxAdapterDispatches: V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS,
          maxTotalModelRequests: V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS,
          adapterRequestMatch: Boolean(adapterRequestMatch),
          terminalEvidenceComplete: observation?.terminalEvidenceComplete ?? false,
          correlationStatus: observation?.correlationStatus ?? "UNPROVABLE",
          toolCallCount: observation?.toolCalls.length ?? 0,
          executionCount: observation?.executions.length ?? 0,
          formalStateTouched: false,
          smokeStateTouched: false,
          artifactRoot: journal.root,
        })}\n`,
      );
    },
  );
});

describe("v1J pre-capture re-entry trace", () => {
  const observer = (
    overrides: Partial<V1JPreCaptureObserverTrace> = {},
  ): V1JPreCaptureObserverTrace => ({
    invocationIndex: 1,
    runOneAttemptId: "attempt-a",
    embeddedRunId: "embedded-a",
    sessionIdSha256: "a".repeat(64),
    promptSubmissionIndex: 1,
    modelLoopIterationIndex: 1,
    precedingModelTurnIndex: null,
    messageArrayIdentity: 10,
    messageCount: 2,
    messageFingerprint: "a".repeat(64),
    nestedObserverReentry: false,
    ...overrides,
  });

  it.each([
    {
      name: "same iteration mutates the observed request array",
      observers: [
        observer(),
        observer({ invocationIndex: 2, messageCount: 4, messageFingerprint: "b".repeat(64) }),
      ],
      transcriptGrowth: [],
      expected: "same-iteration-shared-array-mutation",
    },
    {
      name: "a new model-loop iteration follows transcript growth",
      observers: [
        observer(),
        observer({
          invocationIndex: 2,
          modelLoopIterationIndex: 2,
          messageArrayIdentity: 20,
          messageCount: 4,
        }),
      ],
      transcriptGrowth: [
        {
          runOneAttemptId: "attempt-a",
          embeddedRunId: "embedded-a",
          sessionIdSha256: "a".repeat(64),
          promptSubmissionIndex: 1,
          modelLoopIterationIndex: 1,
          precedingModelTurnIndex: 0,
          transcriptArrayReused: true,
          transcriptLengthBefore: 1,
          transcriptLengthAfter: 3,
          mutationType: "messages-appended",
          sourceStage: "model-prompt-transform-enter",
          source: "AgentSession.agent.transformContext input",
          appendedMessages: [
            {
              index: 1,
              role: "assistant",
              appendedRole: "assistant",
              contentSha256: "b".repeat(64),
              contentBytes: 14,
              mutationType: "assistant-message-appended",
            },
            {
              index: 2,
              role: "toolResult",
              appendedRole: "toolResult",
              contentSha256: "c".repeat(64),
              contentBytes: 15,
              mutationType: "tool-result-appended",
            },
          ],
        },
      ],
      expected: "new-model-loop-iteration-with-transcript-growth",
    },
    {
      name: "a second prompt build is distinguished from another loop iteration",
      observers: [observer(), observer({ invocationIndex: 2, promptSubmissionIndex: 2 })],
      transcriptGrowth: [],
      expected: "independent-prompt-build-pass",
    },
    {
      name: "a distinct attempt or session is not merged with the first observation",
      observers: [observer(), observer({ invocationIndex: 2, runOneAttemptId: "attempt-b" })],
      transcriptGrowth: [],
      expected: "separate-run-or-session",
    },
    {
      name: "a second request build in the same iteration stays distinct",
      observers: [observer(), observer({ invocationIndex: 2, messageArrayIdentity: 20 })],
      transcriptGrowth: [],
      expected: "repeated-request-build-pass",
    },
    {
      name: "nested observer entry is marked as instrumentation re-entry",
      observers: [observer(), observer({ invocationIndex: 2, nestedObserverReentry: true })],
      transcriptGrowth: [],
      expected: "nested-observer-reentry",
    },
  ] satisfies Array<{
    name: string;
    observers: V1JPreCaptureObserverTrace[];
    transcriptGrowth: V1JPreCaptureTranscriptGrowth[];
    expected: V1JPreCaptureReentryClass;
  }>)("classifies $name", ({ observers, transcriptGrowth, expected }) => {
    const before = structuredClone({ observers, transcriptGrowth });
    expect(classifyV1JPreCaptureReentry({ observers, transcriptGrowth })).toBe(expected);
    expect({ observers, transcriptGrowth }).toEqual(before);
  });

  it("summarizes transcript messages without retaining their content", () => {
    const privateText = "private transcript content must not be persisted";
    const event = {
      stage: "model-prompt-transform-enter",
      messages: [{ role: "user", content: privateText }],
      source: "offline trace fixture",
    } as PromptMessageTraceEvent;
    const identities = new WeakMap<object, number>();
    let nextIdentity = 1;
    const summary = summarizePromptMessageTrace(event, (value) => {
      const identity = identities.get(value) ?? nextIdentity++;
      identities.set(value, identity);
      return identity;
    });

    expect(summary.messages).toMatchObject([
      {
        index: 0,
        role: "user",
        contentSha256: sha256V1J(canonicalizeV1IValue(privateText)),
        contentBytes: Buffer.byteLength(privateText, "utf8"),
        origin: "unknown",
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain(privateText);
  });

  it("reports the first content-free prompt-materialization boundary that diverges", () => {
    const privateSystem = "private system material";
    const privateUser = "private user material";
    const messages = [{ role: "user", content: privateUser }];
    const identity = (value: object) => (value === messages ? 1 : 2);
    const source = {
      stage: "model-prompt-transform-complete",
      source: "offline materialization fixture",
      messages,
      systemPromptFingerprint: {
        sha256: sha256V1J(privateSystem),
        utf8Bytes: Buffer.byteLength(privateSystem, "utf8"),
      },
      materializationFactors: { boundaryTimezoneConfigured: false },
    } as PromptMessageTraceEvent;
    const first = summarizePromptMessageTrace(source, identity);
    const same = summarizePromptMessageTrace({ ...source }, identity);
    const changed = summarizePromptMessageTrace(
      {
        ...source,
        stage: "agent-llm-boundary-normalized",
        messages: [{ role: "user", content: `${privateUser}!` }],
      },
      identity,
    );

    expect(diffPromptMaterializationSnapshots(first, same)).toEqual([]);
    expect(diffPromptMaterializationSnapshots(first, changed)).toEqual(["$.messages[0].content"]);
    expect(
      diffPromptMaterializationSnapshots(first, {
        ...same,
        stage: "agent-llm-boundary-input",
        materializationFactors: { boundaryTimezoneConfigured: true },
      }),
    ).toEqual(["$.materializationFactors.boundaryTimezoneConfigured"]);
    expect(JSON.stringify([first, changed])).not.toContain(privateSystem);
    expect(JSON.stringify([first, changed])).not.toContain(privateUser);
    expect([...V1J_PROMPT_MATERIALIZATION_STAGES]).toEqual([
      "prompt-context-built",
      "prompt-submit-enter",
      "prompt-history-normalized",
      "model-prompt-transform-enter",
      "model-prompt-transform-complete",
      "agent-llm-boundary-input",
      "agent-llm-boundary-normalized",
      "agent-llm-boundary-relocated",
      "agent-llm-boundary-converted",
      "provider-adapter-input",
      "provider-message-conversion-input",
      "provider-message-conversion-output",
      "provider-request-object-constructed",
      "provider-onPayload-transform-enter",
    ]);
  });

  it("journals same-run transcript growth with appended roles and hashes only", () => {
    const privateUserText = "private user prompt";
    const privateAssistantText = "private assistant response";
    const privateToolText = "private tool result";
    const messages: Array<Record<string, unknown>> = [{ role: "user", content: privateUserText }];
    const identities = new WeakMap<object, number>();
    let nextIdentity = 1;
    const identity = (value: object) => {
      const current = identities.get(value) ?? nextIdentity++;
      identities.set(value, current);
      return current;
    };
    const previous = summarizePromptMessageTrace(
      {
        stage: "model-prompt-transform-enter",
        messages,
        source: "AgentSession.agent.transformContext input",
      } as PromptMessageTraceEvent,
      identity,
    );
    messages.push(
      { role: "assistant", content: privateAssistantText },
      { role: "toolResult", content: privateToolText },
    );
    const current = summarizePromptMessageTrace(
      {
        stage: "model-prompt-transform-enter",
        messages,
        source: "AgentSession.agent.transformContext input",
      } as PromptMessageTraceEvent,
      identity,
    );
    const growth = captureV1JTranscriptGrowth({
      previous,
      current,
      runOneAttemptId: "attempt-a",
      embeddedRunId: "embedded-a",
      sessionIdSha256: "a".repeat(64),
      promptSubmissionIndex: 1,
      modelLoopIterationIndex: 1,
      precedingModelTurnIndex: 0,
    });

    expect(growth).toMatchObject({
      runOneAttemptId: "attempt-a",
      embeddedRunId: "embedded-a",
      promptSubmissionIndex: 1,
      modelLoopIterationIndex: 1,
      transcriptArrayReused: true,
      transcriptLengthBefore: 1,
      transcriptLengthAfter: 3,
      mutationType: "messages-appended",
      sourceStage: "model-prompt-transform-enter",
      source: "AgentSession.agent.transformContext input",
      appendedMessages: [
        {
          index: 1,
          role: "assistant",
          appendedRole: "assistant",
          contentSha256: sha256V1J(canonicalizeV1IValue(privateAssistantText)),
          contentBytes: Buffer.byteLength(privateAssistantText, "utf8"),
          mutationType: "assistant-message-appended",
        },
        {
          index: 2,
          role: "toolResult",
          appendedRole: "toolResult",
          contentSha256: sha256V1J(canonicalizeV1IValue(privateToolText)),
          contentBytes: Buffer.byteLength(privateToolText, "utf8"),
          mutationType: "tool-result-appended",
        },
      ],
    });
    expect(JSON.stringify(growth)).not.toContain(privateUserText);
    expect(JSON.stringify(growth)).not.toContain(privateAssistantText);
    expect(JSON.stringify(growth)).not.toContain(privateToolText);

    const classification = classifyV1JPreCaptureReentry({
      observers: [
        observer(),
        observer({
          invocationIndex: 2,
          modelLoopIterationIndex: 2,
          messageArrayIdentity: 20,
          messageCount: 4,
        }),
      ],
      transcriptGrowth: growth ? [growth] : [],
    });
    expect(classification).toBe("new-model-loop-iteration-with-transcript-growth");
  });

  it("keeps the request-equivalence gate closed for a 2-to-4 message re-entry", () => {
    const twoMessages = { messages: [{ role: "system" }, { role: "user" }] };
    const fourMessages = {
      messages: [{ role: "system" }, { role: "user" }, { role: "assistant" }, { role: "tool" }],
    };
    const summary = summarizeV1JPreflightObservations([
      testV1JPreflightObservation(),
      testV1JPreflightObservation({ requestBodySha256: "9".repeat(64) }),
    ]);

    expect(differingV1JRequestBodyPaths([twoMessages, fourMessages])).toEqual([
      ".messages[2]",
      ".messages[3]",
    ]);
    expect(summary).toMatchObject({
      rawCallbackCount: 2,
      uniqueCanonicalObservations: 2,
      allCapturedObservationsEquivalent: false,
    });
  });
});

describeV1JProviderCapturePreflight("v1J provider-bound body capture preflight only", () => {
  it(
    "captures one serialized request and terminates before every dispatch path",
    { timeout: 600_000 },
    async () => {
      await runV1JProviderCapturePreflight("body-export");
    },
  );
});

describeV1JProviderMaterializationTracePreflight(
  "v1J provider materialization trace preflight only",
  () => {
    it(
      "records materialization fingerprints without publishing the provider body",
      { timeout: 600_000 },
      async () => {
        await runV1JProviderCapturePreflight("materialization-trace");
      },
    );
  },
);

async function runV1JProviderCapturePreflight(mode: "body-export" | "materialization-trace") {
  const materializationTraceOnly = mode === "materialization-trace";
  const runFlag = materializationTraceOnly
    ? V1J_MATERIALIZATION_TRACE_PREFLIGHT
    : V1J_PROVIDER_CAPTURE_PREFLIGHT;
  const authorizedFlag = materializationTraceOnly
    ? process.env[V1J_MATERIALIZATION_TRACE_PREFLIGHT_AUTHORIZED_FLAG]
    : process.env[V1J_PROVIDER_CAPTURE_PREFLIGHT_AUTHORIZED_FLAG];
  const commitFlag = materializationTraceOnly
    ? process.env[V1J_MATERIALIZATION_TRACE_PREFLIGHT_COMMIT_FLAG]
    : process.env[V1J_PROVIDER_CAPTURE_PREFLIGHT_COMMIT_FLAG];
  if (
    !runFlag ||
    authorizedFlag !== "1" ||
    LIVE ||
    V1J_ACTION_LIVE_TEST ||
    V1J_ACTION_LIVE_AUTHORIZED ||
    V1J_ACTION_SMOKE_TEST ||
    V1J_ACTION_SMOKE_AUTHORIZED ||
    V1J_ADAPTER_DIFFERENTIAL ||
    V1J_PROVIDER_RESPONSE_DIAGNOSTIC ||
    V1J_ARM_C_PREFLIGHT_DIAGNOSTIC ||
    V1J_SCHEMA_CAPTURE_MODE !== undefined ||
    process.env.OPENCLAW_V1I_MODE !== undefined ||
    process.env.OPENCLAW_V1I_CELL_ALLOWLIST !== undefined ||
    process.env.OPENCLAW_V1I_MAX_CELLS !== undefined
  ) {
    throw new Error("v1J provider preflight requires only its dedicated flags");
  }

  const protocol = readV1JPreregistration();
  const head = assertV1JCommittedHarness(protocol);
  const repoRoot = process.cwd();
  if (commitFlag !== head) {
    throw new Error("v1J provider preflight commit authorization mismatch");
  }
  const protocolPath = path.resolve(repoRoot, V1J_PREREGISTRATION_PATH);
  const protocolBytes = fs.readFileSync(protocolPath);
  const protocolSha256 = createHash("sha256").update(protocolBytes).digest("hex");
  const detachedHash = fs.readFileSync(protocolPath.replace(/\.json$/u, ".sha256"), "utf8");
  const provenance = JSON.parse(
    fs.readFileSync(path.resolve(repoRoot, V1J_SMOKE_PROVENANCE_PATH), "utf8"),
  ) as unknown;
  assertV1JSmokeProvenance(provenance, protocol, head);

  const modelConfigHash = hashV1ICanonical(modelConfigIdentity());
  const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
  const normalSmokeRoot = resolveV1JSmokeRoot(repoRoot, head);
  const bodyArtifactRoot = path.resolve(repoRoot, V1J_PROVIDER_BOUND_BODY_PARENT, head);
  const formalStateExists = fs.existsSync(formalRoot);
  const normalSmokeStateExists = fs.existsSync(normalSmokeRoot);
  const bodyArtifactExists = fs.existsSync(bodyArtifactRoot);
  const measuredSchemaMatches =
    protocol.schemaBaseline.authorizedToolCount ===
      V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.authorizedToolCount &&
    protocol.schemaBaseline.providerToolCount ===
      V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolCount &&
    protocol.schemaBaseline.authorizedToolNameSha256 ===
      V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.authorizedToolNameSha256 &&
    protocol.schemaBaseline.providerToolNameSha256 ===
      V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolNameSha256 &&
    protocol.schemaBaseline.authorizedToolSchemaSha256 ===
      V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.authorizedToolSchemaSha256 &&
    protocol.schemaBaseline.providerToolSchemaSha256 ===
      V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolSchemaSha256;
  if (
    protocolSha256 !== V1J_PREREGISTRATION_SHA256 ||
    detachedHash.trim().split(/\s+/)[0]?.toLowerCase() !== V1J_PREREGISTRATION_SHA256 ||
    protocol.model.id !== MODEL_ID ||
    protocol.model.provider !== PROVIDER ||
    protocol.model.contextLength !== CONTEXT_LENGTH ||
    modelConfigHash !== V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256 ||
    protocol.base.productionFrozen.activeFilteringEnabled !== false ||
    ACTIVE_FILTERING_ENABLED !== false ||
    !measuredSchemaMatches ||
    formalStateExists ||
    normalSmokeStateExists ||
    bodyArtifactExists
  ) {
    throw new Error("v1J provider preflight frozen gates failed");
  }

  const cell = buildV1JSmokeSchedule(protocol).find(
    (candidate) => candidate.cellId === "smoke-tool-required:A:1",
  );
  if (!cell || cell.arm !== "A" || cell.stratum !== "TOOL_REQUIRED") {
    throw new Error("v1J provider capture preflight request-construction case changed");
  }
  const journal = createV1JPreflightDiagnosticJournal({
    repoRoot,
    harnessCommit: head,
    arm: "A",
    caseId: cell.caseId,
    preflightId: `provider-bound-capture-${head.slice(0, 8)}-${process.pid}`,
    pid: process.pid,
  });
  let preflightStage = "lmstudio-discovery";
  let providerBoundCaptureCount = 0;
  let requestSummary: ReturnType<typeof summarizeV1JRawRepeatabilityRequest> | undefined;
  let bodyArtifact: ReturnType<typeof publishAndVerifyV1JProviderBoundBodyArtifact> | undefined;
  const providerCaptureStages: string[] = [];
  const callbackStageStartedAt = new Map<string, string>();
  const recordCaptureStage = (event: V1JProviderControlEvent) => {
    preflightStage = event.event;
    providerCaptureStages.push(event.event);
    const observedAt = new Date().toISOString();
    const stageName = event.event.replace(
      /-(?:start|complete|failed|enter|exit|raised|caught)$/,
      "",
    );
    const phase =
      event.event.match(/(?:start|complete|failed|enter|exit|raised|caught)$/)?.[0] ?? "event";
    const enteredAt =
      phase === "start" || phase === "enter" ? observedAt : callbackStageStartedAt.get(stageName);
    if (phase === "start" || phase === "enter") {
      callbackStageStartedAt.set(stageName, observedAt);
    }
    if (
      phase === "complete" ||
      phase === "failed" ||
      phase === "exit" ||
      phase === "raised" ||
      phase === "caught"
    ) {
      callbackStageStartedAt.delete(stageName);
    }
    const allowedDetails = new Set([
      "canonicalRequestSha256",
      "rawBodySha256",
      "componentFingerprint",
      "callbackIndex",
      "contentBytes",
      "errorName",
      "messageCount",
      "requestJsonBytes",
      "stageName",
      "awaited",
      "awaitTargetClass",
      "phase",
      "enteredAt",
      "completedAt",
      "targetEvent",
      "toolCount",
    ]);
    const details = Object.fromEntries(
      Object.entries(event.details ?? {}).filter(([key]) => allowedDetails.has(key)),
    );
    journal.record(`provider-capture-${event.event}`, {
      stageName,
      phase,
      enteredAt: enteredAt ?? observedAt,
      completedAt:
        phase === "complete" ||
        phase === "failed" ||
        phase === "exit" ||
        phase === "raised" ||
        phase === "caught"
          ? observedAt
          : null,
      awaited: event.details?.awaited === true,
      awaitTargetClass:
        typeof event.details?.awaitTargetClass === "string" ? event.details.awaitTargetClass : null,
      ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
      ...(Object.keys(details).length === 0 ? {} : { details }),
    });
  };
  const recordCallbackJournalEvent = (event: string, details: Record<string, unknown> = {}) => {
    recordV1JPreflightCallbackJournalEvent(journal, event, details, recordCaptureStage);
  };
  try {
    journal.record("provider-capture-preflight-start", {
      preflightMode: materializationTraceOnly ? "materialization-trace-only" : mode,
      harnessCommit: head,
      v2Sha256: protocolSha256,
      activeFilteringEnabled: false,
      providerDispatches: 0,
      rawRequestsSent: 0,
      toolExecutions: 0,
    });
    journal.record("lmstudio-discovery-start");
    await runV1JPreflightWithHeartbeat({
      operation: () => assertLiveModelAvailable(),
      stage: () => preflightStage,
      record: (event) => journal.record(event.event, event.details),
      heartbeat: ({ stage, elapsedMs }) =>
        process.stdout.write(
          `v1J capture preflight waiting stage=${stage} elapsedMs=${elapsedMs}\n`,
        ),
    });
    journal.record("lmstudio-discovery-complete");
    preflightStage = "prepared-runtime";
    journal.record("prepared-runtime-start");
    const surface = await runV1JPreflightWithHeartbeat({
      operation: () =>
        captureV1JPreflightSurface(protocol, "A", head, journal, {
          benchmarkCase: v1jSmokeBenchmark(cell),
          prepareWorkspace: (workspaceDir) =>
            fs.writeFileSync(path.join(workspaceDir, "smoke-reference.txt"), "smoke-token-47\n", {
              encoding: "utf8",
              flag: "wx",
            }),
          onCheckpoint: (checkpoint) => {
            if (checkpoint.stage === "client-preparation-completed") {
              preflightStage = "provider-bound-capture";
              journal.record("prepared-runtime-complete", { checkpoint: checkpoint.stage });
              journal.record("provider-bound-capture-start");
            }
          },
          onProgress: (stage) => {
            preflightStage = stage;
            journal.record("preflight-progress", { stage });
          },
          onProviderCaptureStage: recordCaptureStage,
          onProviderBoundRequest: ({ request, rawBody, requestIndex, dispatchOrdinal }) => {
            providerBoundCaptureCount += 1;
            if (providerBoundCaptureCount !== 1 || requestIndex !== 1 || dispatchOrdinal !== 1) {
              throw new Error("v1J provider capture preflight exceeded its one-request bound");
            }
            recordCallbackJournalEvent("capture-record-build-start", {
              awaited: false,
              stageName: "capture-record-build",
            });
            if (materializationTraceOnly) {
              requestSummary = recordV1JProviderMaterializationTrace({
                capture: { request, rawBody },
                expectedCanonicalSha256: V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
                record: (event, details) => journal.record(event, details),
                onStage: recordCaptureStage,
              });
            } else {
              requestSummary = summarizeV1JRawRepeatabilityRequest(
                { endpoint: request.url, rawBody, requestObject: request.body },
                recordCaptureStage,
              );
            }
            const previousCaptureComponents: V1JProviderRequestFingerprintComponent[] = [
              {
                path: "$.messageCount",
                sha256: createHash("sha256").update("2", "utf8").digest("hex"),
                bytes: null,
              },
              {
                path: "$.toolCount",
                sha256: createHash("sha256").update("15", "utf8").digest("hex"),
                bytes: null,
              },
              {
                path: "$.requestJsonBytes",
                sha256: createHash("sha256").update("26653", "utf8").digest("hex"),
                bytes: null,
              },
              {
                path: "$.canonicalRequest",
                sha256: "66ea318a79db06b91146e433ed7765f9b4edc14a0d73d744db57aa80b500fd7a",
                bytes: null,
              },
              {
                path: "$.messages[0].role",
                sha256: createHash("sha256").update('"system"', "utf8").digest("hex"),
                bytes: null,
              },
              {
                path: "$.messages[0].content",
                sha256: "807473baaf56fe2403b3456e2461a9ccaf1b151c73d3cf17431b1de89e4c2d74",
                bytes: 4866,
              },
              {
                path: "$.messages[1].role",
                sha256: createHash("sha256").update('"user"', "utf8").digest("hex"),
                bytes: null,
              },
              {
                path: "$.messages[1].content",
                sha256: "a0f77b7bf2790c81ea52130a4226671601df6c12f95d5ec06d1ebdaa73d45e00",
                bytes: 156,
              },
              {
                path: "$.tools.canonicalNameSet",
                sha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
                bytes: null,
              },
              {
                path: "$.tools.canonicalSchemaSet",
                sha256: "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2",
                bytes: null,
              },
            ];
            const drift = diffV1JProviderRequestFingerprintComponents(
              previousCaptureComponents,
              requestSummary.componentFingerprint.components,
            );
            journal.record("canonical-request-drift-diagnosis", {
              priorCaptureCommit: "7782b3fc1ff68fccc021b61611dfc478a21c0d55",
              priorCanonicalRequestSha256:
                "66ea318a79db06b91146e433ed7765f9b4edc14a0d73d744db57aa80b500fd7a",
              priorRequestJsonBytes: 26653,
              currentCanonicalRequestSha256: requestSummary.requestCanonicalSha256,
              currentRawBodySha256: requestSummary.requestSha256,
              currentRequestJsonBytes: requestSummary.requestJsonBytes,
              comparedPaths: drift.comparedPaths,
              canonicalDriftPaths: drift.differences
                .filter(
                  ({ path: componentPath }) =>
                    componentPath !== "$.canonicalRequest" &&
                    componentPath !== "$.rawSerializedBody",
                )
                .map(({ path: componentPath }) => componentPath),
              differences: drift.differences,
              priorEvidenceUnavailablePaths: [
                "$.rootKeys",
                "$.model",
                "$.stream",
                "$.tool_choice",
                "$.providerOptions",
                "$.messages[0].toolCalls",
                "$.messages[1].toolCalls",
                "$.tools.names",
                "$.tools.schemas",
                "$.rawSerializedBody",
              ],
            });
            if (materializationTraceOnly) {
              journal.record("provider-body-publication-skipped", {
                bodyPublicationCalls: 0,
                bodyArtifactCreated: false,
                canonicalPinMatches:
                  requestSummary.requestCanonicalSha256 ===
                  V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
              });
            } else {
              bodyArtifact = publishAndVerifyV1JProviderBoundBodyArtifact({
                repoRoot,
                captureCommit: head,
                endpoint: request.url,
                provider: protocol.model.provider,
                model: protocol.model.id,
                rawBody,
                expectedCanonicalRequestSha256: V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
              });
              if (
                bodyArtifact.metadata.bodyBytes !== requestSummary.requestJsonBytes ||
                bodyArtifact.metadata.canonicalRequestSha256 !==
                  requestSummary.requestCanonicalSha256
              ) {
                throw new Error(
                  "v1J provider-bound body export metadata differs from captured request",
                );
              }
              journal.record("provider-bound-body-export-complete", {
                captureCommit: bodyArtifact.metadata.captureCommit,
                bodyBytes: bodyArtifact.metadata.bodyBytes,
                rawBodySha256: bodyArtifact.metadata.rawBodySha256,
                canonicalRequestSha256: bodyArtifact.metadata.canonicalRequestSha256,
                messageCount: bodyArtifact.metadata.messageCount,
                toolCount: bodyArtifact.metadata.toolCount,
                provider: bodyArtifact.metadata.provider,
                model: bodyArtifact.metadata.model,
              });
            }
            recordCallbackJournalEvent("capture-record-build-complete", {
              awaited: false,
              stageName: "capture-record-build",
              messageCount: requestSummary.messageCount,
              toolCount: requestSummary.toolCount,
              requestJsonBytes: requestSummary.requestJsonBytes,
              canonicalRequestSha256: requestSummary.requestCanonicalSha256,
            });
          },
          onPreflightStopRaised: () => {
            recordCaptureStage({
              event: "stop-signal-raise",
              details: { stageName: "preflight-stop-signal", awaited: false },
            });
            recordCallbackJournalEvent("preflight-stop-signal-raised");
          },
          onPreflightStopCaught: () => {
            recordCaptureStage({
              event: "stop-signal-caught",
              details: { stageName: "preflight-stop-signal", awaited: false },
            });
            recordCallbackJournalEvent("preflight-stop-signal-caught");
          },
        }),
      stage: () => preflightStage,
      record: (event) => journal.record(event.event, event.details),
      heartbeat: ({ stage, elapsedMs }) =>
        process.stdout.write(
          `v1J capture preflight waiting stage=${stage} elapsedMs=${elapsedMs}\n`,
        ),
    });
    const counters = journal.counters();
    if (
      !requestSummary ||
      providerBoundCaptureCount !== 1 ||
      counters.providerDispatchAttempts !== 0 ||
      counters.providerCallbackInvocations !== 0 ||
      counters.modelRequestCounter !== 0 ||
      counters.preflightStopSignalRaised !== 1 ||
      counters.preflightStopSignalCaught !== 1 ||
      counters.preflightCompleted !== 1 ||
      ACTIVE_FILTERING_ENABLED !== false
    ) {
      throw new Error("v1J provider preflight did not terminate on its no-dispatch gate");
    }
    if (fs.existsSync(formalRoot) || fs.existsSync(normalSmokeRoot)) {
      throw new Error("v1J provider capture preflight observed formal or smoke state");
    }
    if (materializationTraceOnly) {
      if (bodyArtifact || fs.existsSync(bodyArtifactRoot)) {
        throw new Error("v1J materialization trace created a provider-bound body artifact");
      }
    } else {
      if (!bodyArtifact) {
        throw new Error("v1J provider-bound body was not verified before preflight stop");
      }
      if (
        bodyArtifact.metadata.bodyBytes !== requestSummary.requestJsonBytes ||
        bodyArtifact.metadata.canonicalRequestSha256 !== requestSummary.requestCanonicalSha256
      ) {
        throw new Error("v1J provider-bound body metadata changed after callback verification");
      }
    }
    journal.record("provider-capture-preflight-complete", {
      ...counters,
      authorizedToolCount: surface.authorizedToolCount,
      providerToolCount: surface.providerToolCount,
      messageCount: requestSummary.messageCount,
      toolCount: requestSummary.toolCount,
      requestJsonBytes: requestSummary.requestJsonBytes,
      canonicalRequestSha256: requestSummary.requestCanonicalSha256,
      rawBodySha256: requestSummary.requestSha256,
      ...(bodyArtifact ? { bodyArtifactRoot: bodyArtifact.artifactRoot } : {}),
      bodyPublicationCalls: materializationTraceOnly ? 0 : 1,
      bodyArtifactCreated: !materializationTraceOnly,
      providerDispatches: 0,
      rawRequestsSent: 0,
      toolExecutions: 0,
      formalStateTouched: false,
      normalSmokeStateTouched: false,
    });
    process.stdout.write(
      `${JSON.stringify({
        harnessCommit: head,
        requestObserverInvocations: counters.requestObserverInvocations,
        requestObjectReceived: providerBoundCaptureCount === 1,
        providerBoundCaptured: true,
        providerCaptureStages,
        preflightStopRaised: counters.preflightStopSignalRaised === 1,
        preflightStopCaught: counters.preflightStopSignalCaught === 1,
        preflightCompleted: true,
        messageCount: requestSummary.messageCount,
        toolCount: requestSummary.toolCount,
        requestJsonBytes: requestSummary.requestJsonBytes,
        canonicalRequestSha256: requestSummary.requestCanonicalSha256,
        rawBodySha256: requestSummary.requestSha256,
        ...(bodyArtifact ? { bodyArtifactRoot: bodyArtifact.artifactRoot } : {}),
        bodyPublicationCalls: materializationTraceOnly ? 0 : 1,
        bodyArtifactCreated: !materializationTraceOnly,
        providerDispatches: 0,
        rawRequestsSent: 0,
        toolExecutions: 0,
        activeFilteringEnabled: false,
        formalStateTouched: false,
        normalSmokeStateTouched: false,
        artifactPath: journal.filePath,
      })}\n`,
    );
  } catch (error) {
    try {
      recordCaptureStage({
        event: "outer-catch-enter",
        details: {
          stageName: "provider-capture-preflight",
          awaited: false,
          errorName: error instanceof Error ? error.name : "NonErrorThrown",
        },
      });
      journal.record("provider-capture-preflight-failed", {
        errorName: error instanceof Error ? error.name : "NonErrorThrown",
        lastCheckpoint: preflightStage,
      });
    } catch {
      // A failed diagnostic sink must not replace the callback's original failure.
    }
    throw error;
  } finally {
    journal.close();
  }
}

describeV1JRawRepeatability("v1J raw-only provider repeatability", () => {
  it(
    "verifies a saved provider-bound body, then sends it three times over raw transport",
    { timeout: 900_000 },
    async () => {
      if (
        !V1J_RAW_REPEATABILITY ||
        process.env[V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG] !== "1" ||
        LIVE ||
        V1J_ACTION_LIVE_TEST ||
        V1J_ACTION_LIVE_AUTHORIZED ||
        V1J_ACTION_SMOKE_TEST ||
        V1J_ACTION_SMOKE_AUTHORIZED ||
        V1J_ADAPTER_DIFFERENTIAL ||
        V1J_PROVIDER_RESPONSE_DIAGNOSTIC ||
        V1J_ARM_C_PREFLIGHT_DIAGNOSTIC ||
        V1J_SCHEMA_CAPTURE_MODE !== undefined ||
        process.env.OPENCLAW_V1I_MODE !== undefined ||
        process.env.OPENCLAW_V1I_CELL_ALLOWLIST !== undefined ||
        process.env.OPENCLAW_V1I_MAX_CELLS !== undefined
      ) {
        throw new Error("v1J raw repeatability requires only its dedicated authorization flags");
      }

      const protocol = readV1JPreregistration();
      const head = assertV1JCommittedHarness(protocol);
      const repoRoot = process.cwd();
      const captureCommit = process.env[V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG] ?? "";
      execFileSync("git", ["merge-base", "--is-ancestor", captureCommit, head], {
        stdio: "ignore",
      });
      const protocolPath = path.resolve(repoRoot, V1J_PREREGISTRATION_PATH);
      const protocolBytes = fs.readFileSync(protocolPath);
      const protocolSha256 = createHash("sha256").update(protocolBytes).digest("hex");
      const provenance = JSON.parse(
        fs.readFileSync(path.resolve(repoRoot, V1J_SMOKE_PROVENANCE_PATH), "utf8"),
      ) as unknown;
      assertV1JSmokeProvenance(provenance, protocol, head);

      const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
      const normalSmokeRoot = resolveV1JSmokeRoot(repoRoot, head);
      const artifactRoot = path.resolve(
        repoRoot,
        V1J_RAW_REPEATABILITY_PARENT,
        `${V1J_RAW_REPEATABILITY_PREFIX}${head}`,
      );
      const formalStateExists = fs.existsSync(formalRoot);
      const normalSmokeStateExists = fs.existsSync(normalSmokeRoot);
      assertV1JRawRepeatabilityPreflight({
        env: process.env,
        head,
        captureCommit,
        trackedTreeClean: true,
        activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
        modelId: MODEL_ID,
        provider: PROVIDER,
        contextLength: CONTEXT_LENGTH,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        preregistrationHash: protocolSha256,
        detachedPreregistrationHash: fs.readFileSync(
          protocolPath.replace(/\.json$/u, ".sha256"),
          "utf8",
        ),
        schemaBaseline: protocol.schemaBaseline,
        provenanceAccepted: true,
        artifactExists: fs.existsSync(artifactRoot),
        formalStateExists,
        normalSmokeStateExists,
      });
      if (formalStateExists || normalSmokeStateExists || ACTIVE_FILTERING_ENABLED !== false) {
        throw new Error("v1J raw repeatability preflight isolation guard failed");
      }

      const modelConfigHash = hashV1ICanonical(modelConfigIdentity());
      const capturedRequest = readV1JProviderBoundBodyArtifact({
        repoRoot,
        captureCommit,
        endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
        expectedCanonicalRequestSha256: V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
      });
      const requestSummary = summarizeV1JRawRepeatabilityRequest(capturedRequest.capture);
      if (
        capturedRequest.metadata.provider !== protocol.model.provider ||
        capturedRequest.metadata.model !== protocol.model.id ||
        capturedRequest.metadata.bodyBytes !== requestSummary.requestJsonBytes ||
        capturedRequest.metadata.rawBodySha256 !== requestSummary.requestSha256 ||
        requestSummary.requestCanonicalSha256 !== V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256
      ) {
        throw new Error("v1J captured provider-bound request does not match its frozen identity");
      }
      const journal = createV1JRawRepeatabilityJournal({
        repoRoot,
        harnessCommit: head,
        captureCommit,
        modelId: protocol.model.id,
        provider: protocol.model.provider,
        contextLength: protocol.model.contextLength,
        modelConfigHash,
        startedAt: new Date().toISOString(),
      });
      journal.record({ event: "raw-repeatability-test-start" });
      journal.record({
        event: "preregistration-loaded",
        details: { preregistrationSha256: protocolSha256 },
      });
      journal.record({
        event: "repeatability-body-verified",
        details: {
          captureCommit,
          bodyBytes: capturedRequest.metadata.bodyBytes,
          rawBodySha256: capturedRequest.metadata.rawBodySha256,
          canonicalRequestSha256: capturedRequest.metadata.canonicalRequestSha256,
        },
      });
      journal.record({ event: "repeatability-journal-created" });
      if (ACTIVE_FILTERING_ENABLED !== false || formalStateExists || normalSmokeStateExists) {
        throw new Error("v1J raw repeatability isolation changed before transport");
      }
      journal.record({ event: "preflight-complete" });
      journal.record({
        event: "captured-body-preflight-complete",
        details: {
          preflightCount: 0,
          providerDispatches: 0,
          toolExecutions: 0,
          capturedRequestSha256: requestSummary.requestSha256,
          requestSha256: requestSummary.requestSha256,
          requestCanonicalSha256: requestSummary.requestCanonicalSha256,
        },
      });
      const results = await runV1JRawRepeatabilityTransport({
        endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
        authorization: `Bearer ${process.env.LM_API_TOKEN ?? "lmstudio"}`,
        capture: capturedRequest.capture,
        expectedCanonicalRequestSha256: V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
        fetchImpl: fetch,
        record: journal.record,
        heartbeat: (event) => {
          process.stdout.write(
            `v1J raw repeatability awaiting response elapsedMs=${event.elapsedMs ?? 0} chunks=${event.chunkCount ?? 0} bytes=${event.byteCount ?? 0}\n`,
          );
        },
      });
      const formalStateAfter = fs.existsSync(formalRoot);
      const normalSmokeStateAfter = fs.existsSync(normalSmokeRoot);
      if (formalStateAfter || normalSmokeStateAfter) {
        throw new Error("v1J raw repeatability touched formal or normal smoke state");
      }
      process.stdout.write(
        `${JSON.stringify({
          harnessCommit: head,
          modelId: protocol.model.id,
          modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
          captureCommit,
          requestSummary,
          preflightEmbeddedRunnerCount: 0,
          preflightProviderDispatches: 0,
          rawRequestCount: results.length,
          rawRequestSha256: results.map((result) => result.requestSha256),
          rawCanonicalRequestSha256: results.map((result) => result.requestCanonicalSha256),
          results,
          toolExecutionCount: 0,
          formalStateTouched: false,
          normalSmokeStateTouched: false,
          activeFilteringEnabled: false,
          artifactRoot: journal.artifactRoot,
        })}\n`,
      );
    },
  );
});

describeV1JActionSmoke("v1J isolated live operational smoke", () => {
  it(
    "captures four smoke-only cells without touching formal v1J state",
    { timeout: 600_000 },
    async () => {
      if (
        !V1J_ACTION_SMOKE_TEST ||
        !V1J_ACTION_SMOKE_AUTHORIZED ||
        V1J_ACTION_LIVE_TEST ||
        V1J_ACTION_LIVE_AUTHORIZED ||
        LIVE ||
        V1J_SCHEMA_CAPTURE_MODE !== undefined
      ) {
        throw new Error("v1J smoke requires only its two dedicated authorization flags");
      }
      const protocol = readV1JPreregistration();
      const head = assertV1JCommittedHarness(protocol);
      const repoRoot = process.cwd();
      assertV1JFormalStateEmpty(repoRoot);
      const provenancePath = path.resolve(repoRoot, V1J_SMOKE_PROVENANCE_PATH);
      const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as unknown;
      assertV1JSmokeProvenance(provenance, protocol, head);
      if (ACTIVE_FILTERING_ENABLED !== false) {
        throw new Error("v1J smoke requires active filtering to remain disabled");
      }
      await assertLiveModelAvailable();
      const preflightJournals: V1JPreflightDiagnosticJournal[] = [];
      let surfaceA: ReturnType<typeof fingerprintV1JToolSurface> | undefined;
      let surfaceC: ReturnType<typeof fingerprintV1JToolSurface> | undefined;
      const completedArms: ("A" | "C")[] = [];
      try {
        for (const arm of ["A", "C"] as const) {
          const preflightId = `v1j-preflight-${arm}-${head.slice(0, 8)}-${process.pid}`;
          const journal = createV1JPreflightDiagnosticJournal({
            repoRoot,
            harnessCommit: head,
            arm,
            caseId:
              protocol.design.cells.find((entry) => entry.stratum === "TOOL_REQUIRED")?.caseId ??
              "unknown",
            preflightId,
            pid: process.pid,
          });
          preflightJournals.push(journal);
          const surface = await captureV1JPreflightSurface(protocol, arm, head, journal);
          completedArms.push(arm);
          if (arm === "A") {
            surfaceA = surface;
          } else {
            surfaceC = surface;
          }
        }
      } finally {
        for (const journal of preflightJournals) {
          journal.close();
        }
      }
      assertV1JPreflightPairComplete(completedArms);
      if (!surfaceA || !surfaceC) {
        throw new Error("v1J smoke schema preflight pair completed without both surfaces");
      }
      if (canonicalizeV1IValue(surfaceA) !== canonicalizeV1IValue(surfaceC)) {
        throw new Error("v1J smoke A/C provider schema preflight mismatch");
      }
      const schedule = buildV1JSmokeSchedule(protocol);
      const artifactState = createV1JSmokeArtifactState({
        repoRoot,
        harnessCommit: head,
        protocol,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        schemaFingerprints: surfaceA,
        startedAt: new Date().toISOString(),
      });
      const stopReason = await runV1JSmokeSchedule(artifactState, schedule, async (cell) => {
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-smoke-cell-"));
        let observation: V1JObservation;
        let workspaceCleanupComplete: boolean;
        try {
          if (cell.caseId === "smoke-tool-required") {
            fs.writeFileSync(path.join(workspaceDir, "smoke-reference.txt"), "smoke-token-47\n", {
              encoding: "utf8",
              flag: "wx",
            });
          }
          observation = await executeV1JCell({
            protocol,
            cell,
            attempt: 1,
            head,
            benchmarkOverride: v1jSmokeBenchmark(cell),
            workspaceDirOverride: workspaceDir,
            allowNoToolTerminalEvidence: true,
            runIdPrefix: "v1j-smoke",
          });
        } finally {
          try {
            fs.rmSync(workspaceDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 50,
            });
          } catch {
            // Record cleanup failure with the smoke row; do not retry a live cell.
          }
          workspaceCleanupComplete = !fs.existsSync(workspaceDir);
        }
        return {
          observation,
          workspaceCleanupComplete,
        };
      });
      const modelRequestsSent = artifactState.records.reduce(
        (total, record) => total + record.observation.modelRequestsSent,
        0,
      );
      finalizeV1JSmokeArtifacts(artifactState, {
        completedAt: new Date().toISOString(),
        modelRequestsSent,
        preflightPassed: true,
      });
      assertV1JFormalStateEmpty(repoRoot);
      if (stopReason) {
        throw new Error(`v1J smoke hard stop: ${stopReason}`);
      }
      if (
        artifactState.records.length !== 4 ||
        artifactState.records.some((record) => !record.observation.valid)
      ) {
        throw new Error("v1J operational smoke did not serialize four valid smoke observations");
      }
    },
  );
});

describeV1JActionLive("v1J action-initiation experiment live", () => {
  it(
    "runs only the preregistered A/C cells after no-dispatch schema preflight",
    { timeout: 3_600_000 },
    async () => {
      const protocol = readV1JPreregistration();
      const head = assertV1JCommittedHarness(protocol);
      expect(ACTIVE_FILTERING_ENABLED).toBe(false);
      await assertLiveModelAvailable();
      const schedule = buildV1JSchedule(protocol);
      const surfaceA = await captureV1JPreflightSurface(protocol, "A", head);
      const surfaceC = await captureV1JPreflightSurface(protocol, "C", head);
      expect(surfaceA).toEqual(surfaceC);

      const root = path.resolve(
        "artifacts/capability-intelligence/v1j-action-initiation/real-exact-run1",
      );
      const manifest = createV1JManifest({
        protocol,
        harnessCommit: head,
        modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
        startedAt: new Date().toISOString(),
      });
      const allowlist = process.env.OPENCLAW_V1J_CELL_ALLOWLIST?.split(",").filter(Boolean);
      const maxCells = parseV1JMaxCells(process.env.OPENCLAW_V1J_MAX_CELLS);
      let batch: Awaited<ReturnType<typeof runV1JCellBatch>>;
      try {
        batch = await runV1JCellBatch({
          root,
          manifest,
          protocol,
          schedule,
          ...(allowlist ? { allowlist } : {}),
          ...(maxCells === undefined ? {} : { maxCells }),
          executeCell: (cell, attempt) => executeV1JCell({ protocol, cell, attempt, head }),
        });
      } catch (error) {
        if (error instanceof V1JSerializationFailureError) {
          const state = openV1JArtifactState(root, manifest);
          writeV1JSummary(
            root,
            summarizeV1JObservations({
              protocol,
              schedule,
              observations: state.observations,
              invalidAttempts: state.invalidAttempts,
              expectedHarnessCommit: head,
              resultSerializationFailures: 1,
            }),
          );
        }
        throw error;
      }
      const state = openV1JArtifactState(root, manifest);
      const summary = summarizeV1JObservations({
        protocol,
        schedule,
        observations: state.observations,
        invalidAttempts: state.invalidAttempts,
        expectedHarnessCommit: head,
      });
      writeV1JSummary(root, summary);
      if (batch.integrityStop) {
        throw new Error(`v1J hard stop: ${batch.integrityStop}`);
      }
    },
  );
});

function assertV1JCommittedHarness(protocol: V1JProtocol): string {
  if (process.env.OPENCLAW_V1I_HARNESS_COMMIT) {
    throw new Error("v1J refuses an explicit harness-commit override");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Harness helpers are part of the evidence producer, so any tracked dirty path invalidates HEAD binding.
  const sourceStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], {
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/i.test(head) || sourceStatus || HARNESS_COMMIT !== head) {
    throw new Error("v1J requires a clean, committed harness at the actual HEAD");
  }
  execFileSync("git", ["merge-base", "--is-ancestor", protocol.base.head, head], {
    stdio: "ignore",
  });
  return head;
}

async function captureV1JPreflightSurface(
  protocol: V1JProtocol,
  arm: "A" | "C",
  head: string,
  preflightDiagnostics?: V1JPreflightDiagnosticJournal,
  options?: {
    benchmarkCase?: ToolRankingBenchmarkCase;
    prepareWorkspace?: (workspaceDir: string) => void;
    onCapturedRequest?: (request: CapturedModelRequest) => void;
    onProviderCaptureStage?: (event: V1JProviderControlEvent) => void;
    onProviderBoundRequest?: (input: {
      request: CapturedModelRequest;
      rawBody: string;
      requestIndex: number;
      dispatchOrdinal: number;
    }) => void;
    onPreflightStopRaised?: () => void;
    onPreflightStopCaught?: () => void;
    onCheckpoint?: (checkpoint: EmbeddedCapabilityCheckpoint) => void;
    onProgress?: (stage: string) => void;
  },
): Promise<ReturnType<typeof fingerprintV1JToolSurface>> {
  const benchmarkCase =
    options?.benchmarkCase ??
    requireV1JBenchmarkCase(
      protocol,
      protocol.design.cells.find((entry) => entry.stratum === "TOOL_REQUIRED")?.caseId ?? "",
    );
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), `v1j-preflight-${arm}-`));
  const preflightStopController = new AbortController();
  if (preflightDiagnostics) {
    recordV1JPromptAwaitDiagnostic(preflightDiagnostics, "abort-signal-created", {
      sourceStage: "captureV1JPreflightSurface preflightStopController",
    });
    preflightStopController.signal.addEventListener(
      "abort",
      () => {
        recordV1JPromptAwaitDiagnostic(preflightDiagnostics, "abort-signal-fired", {
          sourceStage: "captureV1JPreflightSurface preflightStopController",
          abortSignalAborted: true,
          abortReasonClass:
            preflightStopController.signal.reason instanceof Error
              ? preflightStopController.signal.reason.name
              : null,
        });
      },
      { once: true },
    );
  }
  const authorizedTools: V1JAuthorizedToolSchema[] = [];
  const requests: CapturedModelRequest[] = [];
  const requestObservations: V1JPreflightRequestObservation[] = [];
  let observation: ExperimentRun | undefined;
  let dispatchAttempts = 0;
  let delegatedRequests = 0;
  let providerBoundRequestCount = 0;
  let runtimeReadyRecorded = false;
  try {
    options?.prepareWorkspace?.(workspaceDir);
    observation = await runOne({
      mode: "real-exact",
      surfaceMode: "REAL_EXACT_ONLY",
      benchmarkCase,
      mappingClass: "EXACT",
      authorizedNames: protocol.schemaBaseline.expectedRuntimeNames,
      v1cTop8: rankTop8(benchmarkCase.tools, benchmarkCase.query),
      requiredMappedTools: [],
      preferredToolOverride: null,
      // The v1I result shape is A/B; v1J Arm C is applied by the explicit prompt override below.
      arm: "A",
      replicate: 1,
      attempt: 1,
      scheduleSeed: protocol.schedule.seed,
      config: buildLiveConfig(workspaceDir),
      workspaceDir,
      abortSignal: preflightStopController.signal,
      provider: protocol.model.provider,
      model: protocol.model.id,
      runIdOverride: `v1j-preflight-${arm}-${head.slice(0, 8)}-${process.pid}`,
      requestCapture: {
        stopAfterProviderBoundCapture: true,
        ...(preflightDiagnostics ? { preflightDiagnostics } : {}),
        onProviderCaptureStage: options?.onProviderCaptureStage,
        capturePromptInstruction: v1jInstructionForArm(protocol, arm),
        onAuthorizedToolsCaptured: (tools) =>
          authorizedTools.splice(0, authorizedTools.length, ...tools),
        onRequestCaptured: (request) => {
          options?.onProviderCaptureStage?.({
            event: "capture-record-build-start",
            details: {
              stageName: "request-object-observation",
              awaited: false,
              awaitTargetClass: null,
            },
          });
          requests.push(request);
          options?.onCapturedRequest?.(request);
          const surface = fingerprintV1JToolSurface({
            authorizedTools,
            providerTools: Array.isArray(request.body.tools) ? request.body.tools : [],
          });
          const requestObservation: V1JPreflightRequestObservation = {
            arm,
            armInstructionSha256: sha256V1J(v1jInstructionForArm(protocol, arm)),
            modelId: typeof request.body.model === "string" ? request.body.model : null,
            modelConfigSha256: hashV1ICanonical(modelConfigIdentity()),
            requestUrlSha256: sha256V1J(request.url),
            requestBodySha256: hashV1ICanonical(request.body),
            systemPromptSha256: sha256V1J(v1jSystemMessageText(request.body)),
            authorizedToolCount: surface.authorizedToolCount,
            authorizedToolNameSha256: surface.authorizedToolNameSha256,
            authorizedToolSchemaSha256: surface.authorizedToolSchemaSha256,
            providerToolCount: surface.providerToolCount,
            providerToolNameSha256: surface.providerToolNameSha256,
            providerToolSchemaSha256: surface.providerToolSchemaSha256,
          };
          requestObservations.push(requestObservation);
          options?.onProviderCaptureStage?.({
            event: "capture-record-build-complete",
            details: {
              stageName: "request-object-observation",
              awaited: false,
              awaitTargetClass: null,
              messageCount: Array.isArray(request.body.messages) ? request.body.messages.length : 0,
              toolCount: surface.providerToolCount,
            },
          });
          if (preflightDiagnostics) {
            recordV1JPreflightCallbackJournalEvent(
              preflightDiagnostics,
              `arm-${arm.toLowerCase()}-request-observation-captured`,
              {
                observationIndex: requestObservations.length,
                observation: requestObservation,
              },
              options?.onProviderCaptureStage ?? (() => undefined),
            );
          }
          // The request observer runs before final provider serialization. Keep the run alive until
          // the exact wire body is captured by the pre-dispatch hook below.
          if (!options?.onProviderBoundRequest) {
            preflightStopController.abort(new V1IProviderRequestCapturedError());
          }
        },
        ...(options?.onProviderBoundRequest
          ? {
              onProviderRequestBeforeDispatch: (requestInput: {
                request: CapturedModelRequest;
                rawBody: string;
                requestIndex: number;
                dispatchOrdinal: number;
              }) => {
                providerBoundRequestCount += 1;
                if (providerBoundRequestCount !== 1 || requestInput.requestIndex !== 1) {
                  throw new Error("v1J raw repeatability preflight observed multiple requests");
                }
                try {
                  options.onProviderBoundRequest?.(requestInput);
                } finally {
                  preflightStopController.abort(new V1IProviderRequestCapturedError());
                }
              },
            }
          : {}),
        ...(options?.onPreflightStopRaised
          ? { onPreflightStopRaised: options.onPreflightStopRaised }
          : {}),
        onProviderDispatchAttempt: (count) => {
          dispatchAttempts = count;
        },
        onDelegatedRequest: () => {
          delegatedRequests += 1;
        },
      },
      onCheckpoint: (checkpoint) => {
        options?.onCheckpoint?.(checkpoint);
        if (
          preflightDiagnostics &&
          !runtimeReadyRecorded &&
          checkpoint.stage === "client-preparation-completed"
        ) {
          runtimeReadyRecorded = true;
          preflightDiagnostics.record(`arm-${arm.toLowerCase()}-runtime-ready`, {
            sourceCheckpoint: checkpoint.stage,
          });
        }
      },
    });
    options?.onProgress?.("schema-preflight-validation-start");
    const failureName = observation.requestPreparationDiagnostics?.failure?.errorName;
    if (failureName === V1IProviderRequestCapturedError.name) {
      options?.onPreflightStopCaught?.();
      preflightDiagnostics?.increment(
        "preflightStopSignalCaught",
        `arm-${arm.toLowerCase()}-preflight-stop-signal-caught`,
        { caughtAt: "requestPreparationDiagnostics", failureName },
      );
    }
  } catch (error) {
    preflightDiagnostics?.record(`arm-${arm.toLowerCase()}-preflight-error`, {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    if (error instanceof V1IProviderRequestCapturedError) {
      options?.onPreflightStopCaught?.();
      preflightDiagnostics?.increment(
        "preflightStopSignalCaught",
        `arm-${arm.toLowerCase()}-preflight-stop-signal-caught`,
        { caughtAt: "runOne-rejection", failureName: error.name },
      );
    }
    throw error;
  } finally {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Prepared agent stores may remain open until this test process exits on Windows.
    }
  }
  const observationSummary = summarizeV1JPreflightObservations(requestObservations);
  const requestBodyDifferingPaths = differingV1JRequestBodyPaths(
    requests.map((request) => request.body),
  );
  const predicates = preflightDiagnostics?.evaluateStop({
    requestObserverCount: requests.length,
    capturedRequestCount: requests.length,
    delegatedRequestCount: delegatedRequests,
    providerDispatchAttempts: dispatchAttempts,
    observations: requestObservations,
    requestBodyDifferingPaths,
  });
  const stopFailureName = observation?.requestPreparationDiagnostics?.failure?.errorName;
  if (stopFailureName === V1IProviderRequestCapturedError.name && preflightDiagnostics) {
    preflightDiagnostics.record(`arm-${arm.toLowerCase()}-preflight-stop-caught`, {
      failureName: stopFailureName,
    });
  }
  const passed =
    requests.length > 0 &&
    requestObservations.length === requests.length &&
    observationSummary.allCapturedObservationsEquivalent &&
    observationSummary.uniqueCanonicalObservations === 1 &&
    dispatchAttempts === 0 &&
    delegatedRequests === 0 &&
    (!predicates || Object.values(predicates).every(Boolean));
  if (!passed) {
    throw new Error(
      `v1J schema preflight failed: ${JSON.stringify({
        arm,
        requestObserverInvocations: preflightDiagnostics?.counters().requestObserverInvocations,
        providerRequestHookInvocations:
          preflightDiagnostics?.counters().providerRequestHookInvocations,
        fetchWrapperInvocations: preflightDiagnostics?.counters().fetchWrapperInvocations,
        providerCallbackInvocations: preflightDiagnostics?.counters().providerCallbackInvocations,
        providerDispatchAttempts: dispatchAttempts,
        providerDispatchCallbackCount: dispatchAttempts,
        capturedRequestCount: requests.length,
        delegatedRequestCount: delegatedRequests,
        stopFailureName,
        modelRequestCounter: preflightDiagnostics?.counters().modelRequestCounter,
        schemaCaptureStarts: preflightDiagnostics?.counters().schemaCaptureStarts,
        schemaCaptureCompletes: preflightDiagnostics?.counters().schemaCaptureCompletes,
        preflightStopSignalRaised: preflightDiagnostics?.counters().preflightStopSignalRaised,
        preflightStopSignalCaught: preflightDiagnostics?.counters().preflightStopSignalCaught,
        preflightCompleted: preflightDiagnostics?.counters().preflightCompleted,
        observationSummary,
        requestBodyDifferingPaths,
        predicates,
      })}`,
    );
  }
  preflightDiagnostics?.record(`arm-${arm.toLowerCase()}-preflight-observations-equivalent`, {
    rawCallbackCount: observationSummary.rawCallbackCount,
    uniqueCanonicalObservations: observationSummary.uniqueCanonicalObservations,
    duplicateEquivalentCallbacks: observationSummary.duplicateEquivalentCallbacks,
    allCapturedObservationsEquivalent: observationSummary.allCapturedObservationsEquivalent,
    canonicalObservation: observationSummary.canonicalObservation,
  });
  // Select the first request only after every callback has matched its frozen-field fingerprint.
  const canonicalRequest = requests[0]!;
  const actionInstruction = v1jInstructionForArm(protocol, "C");
  const systemText = v1jSystemMessageText(canonicalRequest.body);
  if (
    (arm === "C" && !systemText.includes(actionInstruction)) ||
    (arm === "A" && systemText.includes(actionInstruction))
  ) {
    throw new Error("v1J preflight observed an Arm A/C prompt-isolation failure");
  }
  const actual = fingerprintV1JToolSurface({
    authorizedTools,
    providerTools: Array.isArray(canonicalRequest.body.tools) ? canonicalRequest.body.tools : [],
  });
  assertV1JPreflightRuntimeNames(
    protocol.schemaBaseline.expectedRuntimeNames,
    authorizedTools,
    Array.isArray(canonicalRequest.body.tools) ? canonicalRequest.body.tools : [],
  );
  assertV1JRuntimeGate(protocol, {
    modelId: observationSummary.canonicalObservation?.modelId ?? "",
    provider: protocol.model.provider,
    contextLength: protocol.model.contextLength,
    modelConfigHash: observationSummary.canonicalObservation?.modelConfigSha256 ?? "",
    rankerVersion: SHADOW_RANKER_VERSION,
    topK: 8,
    activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
    surface: actual,
  });
  options?.onProgress?.("schema-preflight-validation-complete");
  preflightDiagnostics?.record(`arm-${arm.toLowerCase()}-schema-validated`, {
    requestObserverCallSite: "runOne.diagnostics.hooks.onProviderRequest",
  });
  preflightDiagnostics?.increment(
    "preflightCompleted",
    `arm-${arm.toLowerCase()}-preflight-complete`,
  );
  return actual;
}

function recordV1JPreflightCallbackJournalEvent(
  journal: Pick<V1JPreflightDiagnosticJournal, "record">,
  event: string,
  details: Record<string, unknown>,
  recordStage: (event: V1JProviderControlEvent) => void,
): void {
  const startedAt = performance.now();
  const enteredAt = new Date().toISOString();
  recordStage({
    event: "journal-write-start",
    details: { stageName: "journal-write", awaited: false, targetEvent: event },
  });
  try {
    journal.record(event, details);
  } catch (error) {
    try {
      recordStage({
        event: "journal-write-failed",
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        details: {
          stageName: "journal-write",
          awaited: false,
          targetEvent: event,
          errorName: error instanceof Error ? error.name : "NonErrorThrown",
        },
      });
    } catch {
      // Preserve the journal failure if the diagnostic sink itself is unavailable.
    }
    throw error;
  }
  recordStage({
    event: "journal-write-complete",
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    details: {
      stageName: "journal-write",
      awaited: false,
      awaitTargetClass: null,
      targetEvent: event,
      enteredAt,
    },
  });
}

function assertV1JPreflightRuntimeNames(
  expectedNames: readonly string[],
  authorizedTools: readonly unknown[],
  providerTools: readonly unknown[],
): void {
  const expected = [...expectedNames].toSorted();
  if (
    canonicalV1JToolNames(authorizedTools).join("\n") !== expected.join("\n") ||
    canonicalV1JToolNames(providerTools).join("\n") !== expected.join("\n")
  ) {
    throw new Error("v1J preflight runtime tool names differ from the frozen exact set");
  }
}

function requireV1JBenchmarkCase(protocol: V1JProtocol, caseId: string): ToolRankingBenchmarkCase {
  const specification = protocol.design.cells.find((entry) => entry.caseId === caseId);
  if (!specification) {
    throw new Error(`v1J preregistration is missing case ${caseId}`);
  }
  const benchmark = TOOL_RANKING_HELD_OUT_CASES.find((entry) => entry.id === caseId);
  if (!benchmark || benchmark.query !== specification.prompt) {
    throw new Error(`v1J required case no longer matches frozen benchmark: ${caseId}`);
  }
  const mapped = benchmark.expectedTopTools.map(
    (name) => getBenchmarkRealToolMapping(name).realTool,
  );
  if (
    specification.stratum !== "TOOL_REQUIRED" ||
    mapped.length !== specification.requiredTools.length ||
    mapped.some((name, index) => name !== specification.requiredTools[index]) ||
    specification.preferredTool !== mapped[0]
  ) {
    throw new Error(`v1J case mapping differs from frozen REAL_EXACT mapping: ${caseId}`);
  }
  return benchmark;
}

function v1jSmokeBenchmark(cell: V1JSmokeCell): ToolRankingBenchmarkCase {
  const benchmark = TOOL_RANKING_HELD_OUT_CASES.find((entry) =>
    entry.tools.some((tool) => getBenchmarkRealToolMapping(tool.name).realTool === "read"),
  );
  const readBenchmarkName = benchmark?.tools.find(
    (tool) => getBenchmarkRealToolMapping(tool.name).realTool === "read",
  )?.name;
  if (!benchmark || !readBenchmarkName) {
    throw new Error(
      "v1J smoke requires an existing benchmark mapping for the authorized read tool",
    );
  }
  return {
    ...benchmark,
    id: cell.caseId,
    query: cell.prompt,
    expectedTopTools: cell.caseId === "smoke-tool-required" ? [readBenchmarkName] : [],
  };
}

function parseV1JMaxCells(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error("OPENCLAW_V1J_MAX_CELLS must be a positive integer");
  }
  return Number(value);
}

async function executeV1JCell(input: {
  protocol: V1JProtocol;
  cell: V1JCell;
  attempt: number;
  head: string;
  benchmarkOverride?: ToolRankingBenchmarkCase;
  workspaceDirOverride?: string;
  allowNoToolTerminalEvidence?: boolean;
  runIdPrefix?: string;
  lifecycleJournal?: V1JLifecycleJournal;
  onRequestCaptured?: (request: CapturedModelRequest, requestIndex: number) => void;
  onProviderRequestBeforeDispatch?: (input: {
    request: CapturedModelRequest;
    rawBody: string;
    requestIndex: number;
    dispatchOrdinal: number;
  }) => void | Promise<void>;
  onAssistantMessage?: (message: AssistantMessage, modelTurnIndex: number) => void;
  onProviderDispatchAttempt?: (count: number) => void;
  onCheckpoint?: (
    checkpoint: NonNullable<
      NonNullable<RunEmbeddedAgentParams["capabilityIntelligenceExperiment"]>["onCheckpoint"]
    > extends (checkpoint: infer T) => void
      ? T
      : never,
  ) => void;
}): Promise<V1JObservation> {
  const { protocol, cell, attempt, head } = input;
  const benchmark =
    input.benchmarkOverride ??
    (cell.stratum === "TOOL_REQUIRED"
      ? requireV1JBenchmarkCase(protocol, cell.caseId)
      : {
          id: cell.caseId,
          category: "mixed" as const,
          split: "held-out" as const,
          query: cell.prompt,
          tools: [],
          expectedTopTools: [],
          topK: 8,
        });
  const workspaceDir =
    input.workspaceDirOverride ?? fs.mkdtempSync(path.join(os.tmpdir(), "v1j-cell-"));
  const authorizedTools: V1JAuthorizedToolSchema[] = [];
  const providerRequests: CapturedModelRequest[] = [];
  const responseSummaries: ProviderResponseSummary[] = [];
  let dispatchAttempts = 0;
  let delegatedRequests = 0;
  let capturedProviderRequestCount = 0;
  let gateFailure: Error | undefined;
  let run: ExperimentRun | undefined;
  try {
    run = await runOne({
      mode: "real-exact",
      surfaceMode: "REAL_EXACT_ONLY",
      benchmarkCase: { ...benchmark, query: cell.prompt },
      mappingClass: "EXACT",
      authorizedNames: protocol.schemaBaseline.expectedRuntimeNames,
      v1cTop8: rankTop8(benchmark.tools, cell.prompt),
      requiredMappedTools: [...cell.requiredTools],
      preferredToolOverride: cell.preferredTool,
      arm: "A",
      replicate: cell.replicate,
      attempt,
      scheduleSeed: protocol.schedule.seed,
      config: buildLiveConfig(workspaceDir),
      workspaceDir,
      provider: protocol.model.provider,
      model: protocol.model.id,
      runIdOverride: `${input.runIdPrefix ?? "v1j"}-${head.slice(0, 8)}-${cell.cellId}-attempt-${attempt}`,
      requestCapture: {
        ...(input.lifecycleJournal
          ? {
              lifecycleJournal: input.lifecycleJournal,
              requestCorrelationId: `${input.runIdPrefix ?? "v1j"}-${head.slice(0, 8)}-${cell.cellId}-attempt-${attempt}`,
            }
          : {}),
        capturePromptInstruction: v1jInstructionForArm(protocol, cell.arm),
        onAuthorizedToolsCaptured: (tools) =>
          authorizedTools.splice(0, authorizedTools.length, ...tools),
        onAssistantMessage: input.onAssistantMessage,
        onRequestCaptured: (request) => {
          const requestIndex = ++capturedProviderRequestCount;
          providerRequests.push(request);
          try {
            const surface = fingerprintV1JToolSurface({
              authorizedTools,
              providerTools: Array.isArray(request.body.tools) ? request.body.tools : [],
            });
            assertV1JRuntimeGate(protocol, {
              modelId: protocol.model.id,
              provider: protocol.model.provider,
              contextLength: protocol.model.contextLength,
              modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
              rankerVersion: SHADOW_RANKER_VERSION,
              topK: 8,
              activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
              surface,
            });
            const expectedNames = [...protocol.schemaBaseline.expectedRuntimeNames].toSorted();
            if (canonicalV1JToolNames(authorizedTools).join("\n") !== expectedNames.join("\n")) {
              throw new Error("v1J AUTHORIZED_SURFACE_DRIFT: frozen tool name set drift");
            }
            if (
              canonicalV1JToolNames(
                Array.isArray(request.body.tools) ? request.body.tools : [],
              ).join("\n") !== expectedNames.join("\n")
            ) {
              throw new Error("v1J PROVIDER_SURFACE_DRIFT: frozen tool name set drift");
            }
            const systemText = v1jSystemMessageText(request.body);
            const actionInstruction = v1jInstructionForArm(protocol, "C");
            if (
              (cell.arm === "C" && !systemText.includes(actionInstruction)) ||
              (cell.arm === "A" && systemText.includes(actionInstruction))
            ) {
              throw new Error("v1J CROSS_ARM_LEAK: provider-bound system instruction mismatch");
            }
            input.onRequestCaptured?.(request, requestIndex);
          } catch (error) {
            gateFailure = error instanceof Error ? error : new Error("schema gate failed");
            throw gateFailure;
          }
        },
        onProviderRequestBeforeDispatch: input.onProviderRequestBeforeDispatch,
        onProviderDispatchAttempt: (count) => {
          dispatchAttempts = count;
          input.onProviderDispatchAttempt?.(count);
        },
        onDelegatedRequest: () => {
          delegatedRequests += 1;
        },
        onResponseSummary: (summary) => responseSummaries.push(summary),
      },
      onCheckpoint: input.onCheckpoint,
    });
  } catch (error) {
    if (!gateFailure) {
      gateFailure = error instanceof Error ? error : new Error("harness threw");
    }
  } finally {
    if (!input.workspaceDirOverride) {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Agent-local SQLite handles may outlive terminal evidence on Windows.
      }
    }
  }

  const baseline = protocol.schemaBaseline;
  const surface =
    providerRequests.length > 0 && authorizedTools.length > 0
      ? fingerprintV1JToolSurface({
          authorizedTools,
          providerTools: Array.isArray(providerRequests.at(-1)?.body.tools)
            ? (providerRequests.at(-1)!.body.tools as unknown[])
            : [],
        })
      : baseline;
  const providerResponseObserved = responseSummaries.some(
    (summary) => summary.parserOutcome !== "body-pending",
  );
  const correlationAudit = correlateToolCallsAndExecutions({
    toolCalls: run?.toolCalls ?? [],
    executions: run?.executions ?? [],
  });
  const noToolTerminalComplete =
    input.allowNoToolTerminalEvidence === true &&
    run?.toolCalls.length === 0 &&
    run.executions.length === 0 &&
    correlationAudit.status === "PROVABLE";
  const terminalEvidenceComplete =
    Boolean(run?.valid) &&
    dispatchAttempts > 0 &&
    providerResponseObserved &&
    correlationAudit.status === "PROVABLE" &&
    correlationAudit.unmatchedToolCalls === 0 &&
    correlationAudit.unmatchedExecutions === 0 &&
    (delegatedRequests > 0 || noToolTerminalComplete);
  const reason = gateFailure
    ? v1jHardStopReason(gateFailure)
    : run?.executions?.some(
          (execution) => !protocol.schemaBaseline.expectedRuntimeNames.includes(execution.toolName),
        )
      ? "AUTHORIZATION_DRIFT"
      : (
            input.allowNoToolTerminalEvidence === true
              ? terminalEvidenceComplete
              : run?.valid &&
                dispatchAttempts > 0 &&
                providerResponseObserved &&
                delegatedRequests > 0
          )
        ? null
        : (run?.invalidReason ??
          (dispatchAttempts === 0 ? "REQUEST_PREPARATION_ERROR" : "INCOMPLETE_TERMINAL_EVIDENCE"));
  const hardStop =
    reason !== null &&
    !["MODEL_ERROR", "HARNESS_ERROR", "REQUEST_PREPARATION_ERROR", "NOT_CAPTURED"].includes(reason);
  const row: V1JObservation = {
    cellId: cell.cellId,
    caseId: cell.caseId,
    stratum: cell.stratum,
    arm: cell.arm,
    replicate: cell.replicate,
    attempt,
    harnessCommit: head,
    modelId: protocol.model.id,
    provider: protocol.model.provider,
    contextLength: protocol.model.contextLength,
    modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
    rankerVersion: SHADOW_RANKER_VERSION,
    topK: 8,
    activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
    modelRequestsSent: dispatchAttempts,
    providerResponseObserved,
    experimentalInstructionHash: sha256V1J(v1jInstructionForArm(protocol, cell.arm)),
    authorizedToolNameSha256: surface.authorizedToolNameSha256,
    authorizedToolNames: authorizedTools.length > 0 ? canonicalV1JToolNames(authorizedTools) : [],
    providerToolNameSha256: surface.providerToolNameSha256,
    authorizedToolSchemaSha256: surface.authorizedToolSchemaSha256,
    providerToolSchemaSha256: surface.providerToolSchemaSha256,
    v1cTop8: run?.v1cTop8 ?? [],
    firstExecutedTool: run?.firstExecutedTool ?? null,
    executedToolSequence: run?.executedToolSequence ?? [],
    terminalSuccess: run?.terminalSuccess ?? false,
    rankingEpoch: run?.rankingEpoch ?? null,
    terminalEvidenceComplete: input.allowNoToolTerminalEvidence
      ? terminalEvidenceComplete
      : Boolean(
          run?.valid && dispatchAttempts > 0 && providerResponseObserved && delegatedRequests > 0,
        ),
    correlationStatus: run?.correlationStatus ?? "UNPROVABLE",
    toolCalls: run?.toolCalls ?? [],
    executions: run?.executions ?? [],
    substituteTool: run?.substituteTool ?? null,
    fallbackAfterPreferredFailure: run?.fallbackAfterPreferredFailure ?? false,
    semanticSubstitution: Boolean(run?.substituteTool),
    valid: reason === null,
    invalidReason: reason,
    ...(reason === null
      ? {}
      : {
          invalidClass: hardStop
            ? ("INTEGRITY_FAILURE" as const)
            : ("INFRASTRUCTURE_RETRY_ELIGIBLE" as const),
        }),
    ...(gateFailure ? { integrity: v1jIntegrityForReason(reason) } : {}),
  };
  input.lifecycleJournal?.record("terminal-evidence-finalized", {
    terminalEvidenceComplete: row.terminalEvidenceComplete,
    terminalEvidencePersisted: true,
    invalidReason: row.invalidReason ?? undefined,
    toolCallCount: row.toolCalls.length,
    executionCount: row.executions.length,
    correlationStatus: row.correlationStatus,
    providerResponseObserved: row.providerResponseObserved,
    dispatchAttempt: row.modelRequestsSent,
    outcome: row.valid ? "valid" : "invalid",
  });
  return row;
}

function v1jHardStopReason(error: Error): string {
  const message = error.message;
  if (message.includes("CROSS_ARM_LEAK")) {
    return "CROSS_ARM_LEAK";
  }
  if (message.includes("AUTHORIZED_SURFACE_DRIFT")) {
    return "AUTHORIZED_SURFACE_DRIFT";
  }
  if (message.includes("PROVIDER_SURFACE_DRIFT")) {
    return "PROVIDER_SURFACE_DRIFT";
  }
  if (message.includes("tool name set drift")) {
    return "AUTHORIZED_SURFACE_DRIFT";
  }
  if (message.includes("model/runtime configuration")) {
    return "CONFIG_DRIFT";
  }
  if (message.includes("authorizedTool")) {
    return "AUTHORIZED_SURFACE_DRIFT";
  }
  if (message.includes("providerTool")) {
    return "PROVIDER_SURFACE_DRIFT";
  }
  return "V1J_RUNTIME_GATE_FAILURE";
}

function v1jIntegrityForReason(
  reason: string | null,
): Partial<NonNullable<V1JObservation["integrity"]>> {
  if (reason === "CROSS_ARM_LEAK") {
    return { crossArmLeaks: 1 };
  }
  if (reason === "AUTHORIZATION_DRIFT") {
    return { authorizedSurfaceDrift: 1, newEvidenceDefects: 1 };
  }
  if (reason === "CONFIG_DRIFT") {
    return { configDrift: 1, modelHashDrift: 1 };
  }
  if (reason === "AUTHORIZED_SURFACE_DRIFT") {
    return { authorizedSurfaceDrift: 1 };
  }
  if (reason === "PROVIDER_SURFACE_DRIFT") {
    return { providerSurfaceDrift: 1 };
  }
  return { newEvidenceDefects: 1 };
}

function v1jSystemMessageText(body: Record<string, unknown>): string {
  if (!Array.isArray(body.messages)) {
    return "";
  }
  return body.messages
    .filter(
      (message): message is Record<string, unknown> =>
        Boolean(message && typeof message === "object" && !Array.isArray(message)) &&
        (message as Record<string, unknown>).role === "system",
    )
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") {
        return content;
      }
      if (!Array.isArray(content)) {
        return "";
      }
      return content
        .filter((part) => Boolean(part && typeof part === "object" && !Array.isArray(part)))
        .map((part) => {
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        })
        .join("\n");
    })
    .join("\n");
}

function differingV1JRequestBodyPaths(bodies: readonly unknown[]): string[] {
  if (bodies.length < 2) {
    return [];
  }
  const paths = new Set<string>();
  const compare = (values: readonly unknown[], currentPath: string) => {
    const first = values[0];
    if (
      values.every(
        (value) =>
          Object.is(value, first) ||
          (value !== undefined &&
            first !== undefined &&
            canonicalizeV1IValue(value) === canonicalizeV1IValue(first)),
      )
    ) {
      return;
    }
    if (
      values.every((value) => value !== null && typeof value === "object" && !Array.isArray(value))
    ) {
      const keys = new Set(values.flatMap((value) => Object.keys(value)));
      for (const key of keys) {
        compare(
          values.map((value) => (value as Record<string, unknown>)[key]),
          `${currentPath}.${key}`,
        );
      }
      return;
    }
    if (values.every((value) => Array.isArray(value))) {
      const arrays = values as readonly unknown[][];
      const maxLength = Math.max(...arrays.map((array) => array.length));
      for (let index = 0; index < maxLength; index += 1) {
        compare(
          arrays.map((array) => array[index]),
          `${currentPath}[${index}]`,
        );
      }
      return;
    }
    paths.add(currentPath || "$request");
  };
  compare(bodies, "");
  return [...paths].toSorted();
}

function testV1JPreflightObservation(
  overrides: Partial<V1JPreflightRequestObservation> = {},
): V1JPreflightRequestObservation {
  return {
    arm: "C",
    armInstructionSha256: "a".repeat(64),
    modelId: MODEL_ID,
    modelConfigSha256: "b".repeat(64),
    requestUrlSha256: "c".repeat(64),
    requestBodySha256: "d".repeat(64),
    systemPromptSha256: "e".repeat(64),
    authorizedToolCount: 15,
    authorizedToolNameSha256: "f".repeat(64),
    authorizedToolSchemaSha256: "1".repeat(64),
    providerToolCount: 15,
    providerToolNameSha256: "2".repeat(64),
    providerToolSchemaSha256: "3".repeat(64),
    ...overrides,
  };
}

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

describe("v1J schema-capture dispatch guard", () => {
  it("accepts the canonical 15-tool surface and fails closed on fixture drift", async () => {
    const protocol = readV1JPreregistration();
    const names = protocol.schemaBaseline.expectedRuntimeNames;
    expect(names).toHaveLength(15);
    const authorized = names.map((name) => ({ name, parameters: { type: "object" } }));
    const provider = names.map((name) => ({
      type: "function",
      function: { name, parameters: { type: "object" } },
    }));
    expect(() => assertV1JPreflightRuntimeNames(names, authorized, provider)).not.toThrow();
    expect(() => assertV1JPreflightRuntimeNames(names, authorized.slice(1), provider)).toThrow(
      /frozen exact set/,
    );
  });

  it("captures the serialized provider request once and blocks every dispatch/re-entry", async () => {
    const requestBody = JSON.stringify({
      model: MODEL_ID,
      messages: [{ role: "user", content: "private request content" }],
      tools: [{ type: "function", function: { name: "read" } }],
      stream: true,
    });
    let underlyingFetches = 0;
    const captured: string[] = [];
    let stopSignals = 0;
    const invocations: unknown[] = [];
    const payloadCapture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderInvocation: (invocation) => invocations.push(invocation),
      onProviderRequestBeforeDispatch: ({ rawBody, requestIndex, dispatchOrdinal }) => {
        captured.push(rawBody);
        expect(requestIndex).toBe(1);
        expect(dispatchOrdinal).toBe(1);
      },
      onProviderDispatchAttempt: () => {
        stopSignals += 100;
      },
    });
    const wrappedFetch = payloadCapture.wrapFetch(async () => {
      underlyingFetches += 1;
      return new Response("{}");
    });
    try {
      const send = () =>
        wrappedFetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
      await expect(send()).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);
      await expect(send()).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);

      expect(captured).toEqual([requestBody]);
      expect(payloadCapture.requests).toHaveLength(1);
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
      expect(payloadCapture.providerInvocationCount).toBe(0);
      expect(payloadCapture.delegatedRequests).toBe(0);
      expect(invocations).toEqual([]);
      expect(underlyingFetches).toBe(0);
      expect(stopSignals).toBe(0);
    } finally {
      payloadCapture.restore();
    }
  });

  it("journals only structural capture stages and completes before provider dispatch", async () => {
    const privateText = "never persist this diagnostic prompt";
    const requestBody = JSON.stringify({
      model: MODEL_ID,
      messages: [{ role: "user", content: privateText }],
      tools: Array.from({ length: 15 }, (_, index) => ({
        type: "function",
        function: { name: `tool-${index}`, parameters: { type: "object" } },
      })),
      stream: true,
    });
    const events: V1JProviderControlEvent[] = [];
    let underlyingFetches = 0;
    const capture = {
      endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
      rawBody: requestBody,
      requestObject: JSON.parse(requestBody) as Record<string, unknown>,
    };
    const payloadCapture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderCaptureStage: (event) => events.push(event),
      onProviderRequestBeforeDispatch: ({ request, rawBody }) => {
        summarizeV1JRawRepeatabilityRequest(
          { ...capture, rawBody, requestObject: request.body },
          (event) => events.push(event),
        );
        events.push({ event: "capture-record-build-start" });
        events.push({ event: "capture-record-build-complete" });
      },
    });
    const wrappedFetch = payloadCapture.wrapFetch(async () => {
      underlyingFetches += 1;
      return new Response("{}");
    });
    try {
      await expect(
        wrappedFetch(capture.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
      ).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);
      expect(events.map((event) => event.event)).toEqual([
        "request-serialization-start",
        "request-serialization-complete",
        "request-object-received",
        "provider-bound-callback-enter",
        "callback-return-or-throw",
        "provider-bound-callback-enter",
        "request-raw-body-fingerprint",
        "request-canonicalization-start",
        "request-canonicalization-complete",
        "request-component-fingerprints",
        "capture-record-build-start",
        "capture-record-build-complete",
        "callback-return-or-throw",
        "provider-bound-request-captured",
        "stop-signal-prepare",
        "preflight-stop-signal-raised",
        "stop-signal-raise",
      ]);
      expect(events[1]?.details).toMatchObject({
        stageName: "body-serialization",
        awaited: true,
        awaitTargetClass: "readCapturedFetchBody",
        requestJsonBytes: Buffer.byteLength(requestBody),
      });
      expect(events[2]?.details).toMatchObject({ messageCount: 1, toolCount: 15 });
      expect(JSON.stringify(events)).not.toContain(privateText);
      const rawFingerprintIndex = events.findIndex(
        (event) => event.event === "request-raw-body-fingerprint",
      );
      const canonicalizationIndex = events.findIndex(
        (event) => event.event === "request-canonicalization-start",
      );
      expect(rawFingerprintIndex).toBeLessThan(canonicalizationIndex);
      expect(events[rawFingerprintIndex]?.details).toMatchObject({
        rawBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        requestJsonBytes: Buffer.byteLength(requestBody, "utf8"),
      });
      expect(
        events.find((event) => event.event === "request-component-fingerprints")?.details,
      ).toMatchObject({
        componentFingerprint: {
          canonicalRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          rootKeySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          toolCount: 15,
        },
      });
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
      expect(underlyingFetches).toBe(0);
    } finally {
      payloadCapture.restore();
    }
  });

  it("runs the materialization-only callback without creating a body artifact or dispatching", async () => {
    const privateSystem = "private trace-only system";
    const privateUser = "private trace-only user";
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-materialization-only-callback-"));
    const captureCommit = "8".repeat(40);
    const bodyArtifactRoot = path.resolve(repoRoot, V1J_PROVIDER_BOUND_BODY_PARENT, captureCommit);
    const requestBody = JSON.stringify({
      model: MODEL_ID,
      messages: [
        { role: "system", content: privateSystem },
        { role: "user", content: privateUser },
      ],
      tools: Array.from({ length: 15 }, (_, index) => ({
        type: "function",
        function: { name: `tool-${index}`, parameters: { type: "object" } },
      })),
      stream: true,
    });
    const journalRows: Array<{ event: string; details: Record<string, unknown> }> = [];
    let callbackInvocations = 0;
    let providerFetches = 0;
    const payloadCapture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderRequestBeforeDispatch: (captured) => {
        callbackInvocations += 1;
        recordV1JProviderMaterializationTrace({
          capture: { request: captured.request, rawBody: captured.rawBody },
          expectedCanonicalSha256: V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256,
          record: (event, details) => journalRows.push({ event, details }),
        });
      },
    });
    const wrappedFetch = payloadCapture.wrapFetch(async () => {
      providerFetches += 1;
      return new Response("{}");
    });
    try {
      await expect(
        wrappedFetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
      ).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);

      expect(callbackInvocations).toBe(1);
      expect(journalRows).toMatchObject([
        {
          event: "provider-bound-materialization-fingerprints",
          details: {
            preflightMode: "materialization-trace-only",
            bodyPublicationCalls: 0,
            bodyArtifactCreated: false,
            messageCount: 2,
            toolCount: 15,
          },
        },
      ]);
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
      expect(payloadCapture.providerInvocationCount).toBe(0);
      expect(payloadCapture.delegatedRequests).toBe(0);
      expect(providerFetches).toBe(0);
      expect(fs.existsSync(bodyArtifactRoot)).toBe(false);
      expect(fs.existsSync(path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH))).toBe(false);
      expect(fs.existsSync(resolveV1JSmokeRoot(repoRoot, captureCommit))).toBe(false);
      expect(JSON.stringify(journalRows)).not.toContain(privateSystem);
      expect(JSON.stringify(journalRows)).not.toContain(privateUser);
    } finally {
      payloadCapture.restore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails closed and records a safe stage when provider-body serialization fails", async () => {
    const events: V1JProviderControlEvent[] = [];
    const payloadCapture = captureModelPayloads(undefined, {
      onProviderCaptureStage: (event) => events.push(event),
    });
    let underlyingFetches = 0;
    const wrappedFetch = payloadCapture.wrapFetch(async () => {
      underlyingFetches += 1;
      return new Response("{}");
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("private body failure detail"));
      },
    });
    try {
      const request = new Request(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit);
      await expect(wrappedFetch(request)).rejects.toThrow();
      expect(events.map((event) => event.event)).toEqual([
        "request-serialization-start",
        "request-serialization-failed",
      ]);
      expect(events[1]?.details).toMatchObject({
        stageName: "body-serialization",
        awaited: true,
        awaitTargetClass: "readCapturedFetchBody",
        errorName: "TypeError",
      });
      expect(JSON.stringify(events)).not.toContain("private body failure detail");
      expect(underlyingFetches).toBe(0);
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
    } finally {
      payloadCapture.restore();
    }
  });

  it("fails closed on canonicalization mismatch before dispatch", async () => {
    const requestBody = JSON.stringify({
      model: MODEL_ID,
      messages: [{ role: "user", content: "private canonicalization prompt" }],
      tools: Array.from({ length: 15 }, (_, index) => ({
        type: "function",
        function: { name: `tool-${index}`, parameters: { type: "object" } },
      })),
      stream: true,
    });
    const events: V1JProviderControlEvent[] = [];
    const payloadCapture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderCaptureStage: (event) => events.push(event),
      onProviderRequestBeforeDispatch: ({ request, rawBody }) => {
        summarizeV1JRawRepeatabilityRequest(
          {
            endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
            rawBody,
            requestObject: { ...request.body, model: "mismatched-model" },
          },
          (event) => events.push(event),
        );
      },
    });
    let underlyingFetches = 0;
    const wrappedFetch = payloadCapture.wrapFetch(async () => {
      underlyingFetches += 1;
      return new Response("{}");
    });
    try {
      await expect(
        wrappedFetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
      ).rejects.toThrow(/does not match its provider object/);
      expect(events.map((event) => event.event)).toContain("request-canonicalization-failed");
      expect(events.map((event) => event.event)).toContain("provider-bound-callback-enter");
      expect(events.map((event) => event.event)).toContain("outer-catch-enter");
      expect(
        events.find(
          (event) =>
            event.event === "callback-return-or-throw" &&
            event.details?.stageName === "provider-bound-callback",
        )?.details,
      ).toMatchObject({
        phase: "throw",
        awaited: true,
        awaitTargetClass: "onProviderRequestBeforeDispatch",
      });
      expect(events.map((event) => event.event)).not.toContain("capture-record-build-start");
      expect(events.map((event) => event.event)).not.toContain("stop-signal-raise");
      expect(events.map((event) => event.event)).not.toContain("provider-bound-request-captured");
      expect(JSON.stringify(events)).not.toContain("private canonicalization prompt");
      expect(underlyingFetches).toBe(0);
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
    } finally {
      payloadCapture.restore();
    }
  });

  it("journals callback-write start and failure without dispatching or masking the sink error", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-callback-journal-failure-"));
    const journal = createV1JPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: "7".repeat(40),
      arm: "A",
      caseId: "offline-callback-journal-failure",
      preflightId: `offline-callback-journal-failure-${process.pid}`,
      pid: process.pid,
    });
    const events: V1JProviderControlEvent[] = [];
    const originalRecord = journal.record.bind(journal);
    const failure = new Error("private journal failure detail");
    journal.record = (event, details) => {
      if (event === "capture-record-build-complete") {
        throw failure;
      }
      originalRecord(event, details);
    };
    const recordStage = (event: V1JProviderControlEvent) => {
      events.push(event);
      originalRecord(`provider-capture-${event.event}`, {
        ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
        ...(event.details === undefined ? {} : { details: event.details }),
      });
    };
    let underlyingFetches = 0;
    const payloadCapture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderCaptureStage: recordStage,
      onProviderRequestBeforeDispatch: () =>
        recordV1JPreflightCallbackJournalEvent(
          journal,
          "capture-record-build-complete",
          { messageCount: 1, toolCount: 15 },
          recordStage,
        ),
    });

    try {
      await expect(
        payloadCapture.wrapFetch(async () => {
          underlyingFetches += 1;
          return new Response("{}");
        })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: MODEL_ID, messages: [], tools: [], stream: true }),
        }),
      ).rejects.toBe(failure);
      expect(events.map((event) => event.event)).toEqual([
        "request-serialization-start",
        "request-serialization-complete",
        "request-object-received",
        "provider-bound-callback-enter",
        "callback-return-or-throw",
        "provider-bound-callback-enter",
        "journal-write-start",
        "journal-write-failed",
        "outer-catch-enter",
        "callback-return-or-throw",
      ]);
      expect(events[6]?.details).toMatchObject({
        awaited: false,
        targetEvent: "capture-record-build-complete",
      });
      expect(events[7]?.details).toMatchObject({ awaited: false, errorName: "Error" });
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
      expect(underlyingFetches).toBe(0);
      const journalText = fs.readFileSync(journal.filePath, "utf8");
      expect(journalText).toContain("journal-write-start");
      expect(journalText).not.toContain("private journal failure detail");
      expect(journalText).not.toContain('"event":"capture-record-build-complete"');
    } finally {
      payloadCapture.restore();
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps the preflight heartbeat on a stalled request-serialization stage", async () => {
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
    });
    const events: V1JProviderControlEvent[] = [];
    const heartbeats: V1JProviderControlEvent[] = [];
    let resolveHeartbeat!: () => void;
    const heartbeatObserved = new Promise<void>((resolve) => {
      resolveHeartbeat = resolve;
    });
    let stage = "provider-bound-capture";
    let underlyingFetches = 0;
    const payloadCapture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderCaptureStage: (event) => {
        events.push(event);
        stage = event.event;
      },
      onProviderRequestBeforeDispatch: () => undefined,
    });
    const wrappedFetch = payloadCapture.wrapFetch(async () => {
      underlyingFetches += 1;
      return new Response("{}");
    });
    const request = new Request(`${LM_STUDIO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    let preflight: Promise<Response> | undefined;
    let bodyReleased = false;
    try {
      preflight = runV1JPreflightWithHeartbeat({
        operation: () => wrappedFetch(request),
        stage: () => stage,
        record: (event) => {
          heartbeats.push(event);
          if (event.event === "preflight-heartbeat") {
            resolveHeartbeat();
          }
        },
        heartbeatMs: 10,
      });
      void preflight.catch(() => undefined);
      await heartbeatObserved;
      expect(heartbeats[0]).toMatchObject({
        event: "preflight-heartbeat",
        details: { stage: "request-serialization-start" },
      });
      expect(underlyingFetches).toBe(0);
      bodyController?.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            model: MODEL_ID,
            messages: [{ role: "user", content: "private heartbeat prompt" }],
            tools: Array.from({ length: 15 }, (_, index) => ({
              type: "function",
              function: { name: `tool-${index}`, parameters: { type: "object" } },
            })),
            stream: true,
          }),
        ),
      );
      bodyController?.close();
      bodyReleased = true;
      await expect(preflight).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);
      expect(events.map((event) => event.event)).toContain("request-serialization-complete");
      expect(events.map((event) => event.event)).toContain("provider-bound-request-captured");
      expect(events.map((event) => event.event)).toContain("preflight-stop-signal-raised");
      expect(payloadCapture.providerDispatchAttempts).toBe(0);
      expect(underlyingFetches).toBe(0);
      expect(JSON.stringify([...events, ...heartbeats])).not.toContain("private heartbeat prompt");
    } finally {
      if (!bodyReleased) {
        bodyController?.error(new Error("test cleanup"));
      }
      await preflight?.catch(() => undefined);
      payloadCapture.restore();
    }
  });

  it("keeps Arm C preflight closed when its offline runtime fixture drifts", async () => {
    const protocol = readV1JPreregistration();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-preflight-path-test-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(repoRoot);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const journal = createV1JPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: head,
      arm: "C",
      caseId:
        protocol.design.cells.find((entry) => entry.stratum === "TOOL_REQUIRED")?.caseId ??
        "unknown",
      preflightId: `offline-arm-c-${process.pid}`,
      pid: process.pid,
    });
    try {
      await installOfflinePreparedRuntimeMock();
      let capturedSurface: ReturnType<typeof fingerprintV1JToolSurface> | undefined;
      let preflightError: unknown;
      try {
        capturedSurface = await captureV1JPreflightSurface(protocol, "C", head, journal);
      } catch (error) {
        preflightError = error;
      }
      const acceptedCanonicalSurface = capturedSurface !== undefined;
      if (acceptedCanonicalSurface) {
        expect(capturedSurface).toMatchObject(protocol.schemaBaseline);
        expect(capturedSurface.authorizedToolNames).toEqual(
          protocol.schemaBaseline.expectedRuntimeNames,
        );
      } else {
        expect(preflightError).toBeInstanceOf(Error);
        expect((preflightError as Error).message).toMatch(/frozen exact set/);
      }
      expect(journal.counters()).toMatchObject({
        requestObserverInvocations: 1,
        providerRequestHookInvocations: 1,
        fetchWrapperInvocations: 0,
        providerCallbackInvocations: 0,
        providerDispatchAttempts: 0,
        modelRequestCounter: 0,
        preflightStopSignalRaised: 1,
        preflightStopSignalCaught: 1,
        preflightCompleted: acceptedCanonicalSurface ? 1 : 0,
      });
      expect(() => assertV1JPreflightPairComplete(["C"])).toThrow(/requires completed A and C/);
      expect(fs.existsSync(path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH))).toBe(false);
      expect(fs.existsSync(resolveV1JSmokeRoot(repoRoot, head))).toBe(false);
      const rows = fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const events = rows.map((row) => row.event);
      expect(events).toContain("arm-c-preflight-start");
      expect(events).toContain("arm-c-runtime-ready");
      expect(events).toContain("arm-c-request-observer-enter");
      expect(events.includes("arm-c-schema-validated")).toBe(acceptedCanonicalSurface);
      expect(events.includes("arm-c-preflight-complete")).toBe(acceptedCanonicalSurface);
      expect(events).toContain("arm-c-preflight-observations-equivalent");
      expect(events).toContain("preflight-stop-signal-raised");
      expect(events).toContain("arm-c-preflight-stop-signal-caught");
      expect(events).toContain("observer-return-1");
      expect(events).toContain("model-loop-await-start");
      expect(events).toContain("model-loop-await-end");
      expect(events.indexOf("observer-return-1")).toBeLessThan(
        events.indexOf("preflight-stop-signal-raised"),
      );
      expect(events.indexOf("model-loop-await-start")).toBeLessThan(
        events.indexOf("observer-return-1"),
      );
      expect(rows.find((row) => row.event === "model-loop-await-end")).toMatchObject({
        awaited: true,
        awaitTargetClass: "AgentSession.prompt",
        elapsedMs: expect.any(Number),
      });
      expect(rows.find((row) => row.event === "observer-return-1")).toMatchObject({
        invocationIndex: 1,
        outcome: "completed",
        runOneAttemptId: expect.any(String),
        embeddedRunId: expect.any(String),
      });
      expect(events.some((event) => event.startsWith("arm-a-"))).toBe(false);
      expect(events.some((event) => event.includes("smoke-schedule"))).toBe(false);
      expect(events.some((event) => event.includes("tool-execution-started"))).toBe(false);
      expect(events).not.toContain("tool-call-produced");
      expect(events).not.toContain("tool-result-produced");
      expect(events).not.toContain("tool-result-appended");
      expect(events.some((event) => event.includes("raw-transport"))).toBe(false);
      const observationRows = rows.filter(
        (row) => row.event === "arm-c-request-observation-captured",
      );
      expect(observationRows).toHaveLength(1);
      expect(new Set(observationRows.map((row) => JSON.stringify(row.observation))).size).toBe(1);
      expect(JSON.stringify(observationRows)).not.toContain("## Tool use");
      expect(JSON.stringify(observationRows)).not.toContain(
        protocol.arms.C.experimentalInstruction,
      );
      expect(rows.find((row) => row.event === "preflight-stop-assertion-evaluated")).toMatchObject({
        passed: true,
        requestBodyDifferingPaths: [],
        observationSummary: {
          rawCallbackCount: 1,
          uniqueCanonicalObservations: 1,
          duplicateEquivalentCallbacks: 0,
          differingFields: [],
          allCapturedObservationsEquivalent: true,
        },
        predicates: {
          allCapturedObservationsEquivalent: true,
          uniqueCanonicalObservationIsOne: true,
          providerCallbackCountIsZero: true,
          dispatchAttemptsIsZero: true,
          modelRequestCountIsZero: true,
        },
      });
      const hookRows = rows.filter((row) => row.event === "arm-c-provider-request-hook-enter");
      expect(hookRows.map((row) => row.invocationIndex)).toEqual([1]);
      expect(
        hookRows.every((row) => row.callSite === "runOne.diagnostics.hooks.onProviderRequest"),
      ).toBe(true);
      const messageTraceRows = rows.filter((row) => row.event === "arm-c-prompt-message-trace");
      const traceStages = messageTraceRows.map((row) => row.stage);
      expect(traceStages).toContain("prompt-context-built");
      expect(traceStages).toContain("prompt-submit-enter");
      expect(traceStages).toContain("prompt-history-normalized");
      expect(traceStages).toContain("model-prompt-transform-enter");
      expect(traceStages).toContain("model-prompt-transform-complete");
      expect(traceStages).toContain("agent-llm-boundary-input");
      expect(traceStages).toContain("agent-llm-boundary-normalized");
      expect(traceStages).toContain("agent-llm-boundary-relocated");
      expect(traceStages).toContain("agent-llm-boundary-converted");
      expect(traceStages).toContain("provider-adapter-input");
      expect(traceStages).toContain("provider-message-conversion-input");
      expect(traceStages).toContain("provider-message-conversion-output");
      expect(traceStages).toContain("provider-request-object-constructed");
      expect(traceStages).toContain("provider-onPayload-transform-enter");
      const materializationRows = rows.filter(
        (row) => row.event === "prompt-materialization-boundary",
      );
      expect(materializationRows.map((row) => row.stage)).toEqual(
        expect.arrayContaining([...V1J_PROMPT_MATERIALIZATION_STAGES]),
      );
      expect(
        materializationRows.every(
          (row) =>
            typeof row.messageArrayIdentity === "number" &&
            Array.isArray(row.messages) &&
            (row.messages as Array<Record<string, unknown>>).every(
              (message) =>
                "messageObjectIdentity" in message &&
                "contentObjectIdentity" in message &&
                typeof message.contentSha256 === "string" &&
                typeof message.contentBytes === "number" &&
                !("content" in message),
            ),
        ),
      ).toBe(true);
      const normalizedBoundary = materializationRows.find(
        (row) => row.stage === "agent-llm-boundary-normalized",
      );
      const inputBoundary = materializationRows.find(
        (row) => row.stage === "agent-llm-boundary-input",
      );
      expect(normalizedBoundary?.contentDeltaPairing).toMatchObject({
        sourceBoundary: "agent-llm-boundary-input",
        destinationBoundary: "agent-llm-boundary-normalized",
        identity: {
          runOneAttemptId: expect.any(String),
          embeddedRunId: expect.any(String),
          sessionIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          promptSubmissionIndex: 1,
          modelLoopIterationIndex: 1,
        },
      });
      const inputUserMessage = Array.isArray(inputBoundary?.messages)
        ? (inputBoundary.messages as Array<Record<string, unknown>>).find(
            (message) => message.role === "user",
          )
        : undefined;
      const normalizedUserMessage = Array.isArray(normalizedBoundary?.messages)
        ? (normalizedBoundary.messages as Array<Record<string, unknown>>).find(
            (message) => message.role === "user",
          )
        : undefined;
      const normalizedUserDelta = Array.isArray(normalizedBoundary?.contentDeltas)
        ? (normalizedBoundary.contentDeltas as Array<Record<string, unknown>>).find(
            (delta) => delta.role === "user",
          )
        : undefined;
      expect(normalizedUserDelta).toBeDefined();
      expect(normalizedUserDelta).toMatchObject({
        sourceBoundary: "agent-llm-boundary-input",
        destinationBoundary: "agent-llm-boundary-normalized",
        ordinalWithinRole: 0,
        pairingStatus: "PAIRED",
        delta: {
          beforeBytes: inputUserMessage?.contentBytes,
          afterBytes: normalizedUserMessage?.contentBytes,
        },
      });
      expect(normalizedBoundary?.contentDeltaPairing).toMatchObject({
        transitionInstanceId: expect.any(Number),
      });
      expect(normalizedUserDelta?.beforeContentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(normalizedUserDelta?.afterContentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(normalizedBoundary?.systemPromptSections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sectionName: "providerSystemMessage",
            present: false,
            sha256: null,
            utf8Bytes: null,
          }),
        ]),
      );
      expect(JSON.stringify(materializationRows)).not.toContain(
        protocol.arms.C.experimentalInstruction,
      );
      const providerMessageBoundary = materializationRows.find(
        (row) => row.stage === "provider-message-conversion-output",
      );
      expect(providerMessageBoundary?.systemPromptParagraphs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sectionName: expect.stringMatching(/^paragraph-\d+$/u),
            present: true,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            utf8Bytes: expect.any(Number),
          }),
        ]),
      );
      expect(JSON.stringify(providerMessageBoundary?.systemPromptParagraphs)).not.toContain(
        protocol.arms.C.experimentalInstruction,
      );
      const promptContexts = messageTraceRows.filter((row) => row.stage === "prompt-context-built");
      expect(promptContexts.map((row) => row.callbackIndex)).toEqual([1]);
      expect(promptContexts.map((row) => row.messageCount)).toEqual([0]);
      expect(
        promptContexts.every(
          (row) =>
            row.armInstructionInsertionStage ===
              "attempt.extraSystemPrompt -> systemPromptForHook" &&
            row.armInstructionPresent === true,
        ),
      ).toBe(true);
      expect(
        traceStages.filter((stage) => stage === "provider-onPayload-transform-enter"),
      ).toHaveLength(1);
      const observerEntries = messageTraceRows
        .filter((row) => row.stage === "request-observer-enter")
        .toSorted((left, right) => Number(left.callbackIndex) - Number(right.callbackIndex));
      const observerExits = messageTraceRows
        .filter((row) => row.stage === "request-observer-exit")
        .toSorted((left, right) => Number(left.callbackIndex) - Number(right.callbackIndex));
      expect(observerEntries).toHaveLength(1);
      expect(observerExits).toHaveLength(1);
      expect(observerEntries.map((row) => row.callbackIndex)).toEqual([1]);
      expect(observerEntries[0]).toMatchObject({
        runOneAttemptId: expect.any(String),
        embeddedRunId: expect.any(String),
        sessionIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSubmissionIndex: 1,
        modelLoopIterationIndex: 1,
        precedingModelTurnIndex: null,
        payloadTransformInvocation: 1,
        payloadTransformInputMessageCount: 2,
        nestedObserverReentry: false,
      });
      expect(new Set(observerEntries.map((row) => row.messageArrayIdentity)).size).toBe(1);
      expect(
        observerExits.every((row) => row.arrayOrMessageStateChangedDuringObserver === false),
      ).toBe(true);
      expect(
        observerEntries
          .map((row) => row.messages)
          .map((messages) => (messages as unknown[]).length),
      ).toEqual([2]);
      expect(observerEntries.every((row) => Number.isInteger(row.messageArrayIdentity))).toBe(true);
      const promptSubmitEntries = messageTraceRows.filter(
        (row) => row.stage === "prompt-submit-enter",
      );
      expect(promptSubmitEntries.map((row) => row.callbackIndex)).toEqual([1]);
      expect(promptSubmitEntries.map((row) => row.messageCount)).toEqual([0]);
      const promptTransformEntries = messageTraceRows.filter(
        (row) => row.stage === "model-prompt-transform-enter",
      );
      expect(promptTransformEntries.map((row) => row.messageCount)).toEqual([1]);
      const firstPromptTransform = promptTransformEntries[0]!;
      expect(
        (firstPromptTransform.messages as Array<Record<string, unknown>>).map(
          (message) => message.role,
        ),
      ).toEqual(["user"]);
      const settledAgentStates = messageTraceRows.filter(
        (row) => row.stage === "prompt-agent-state-settled",
      );
      expect(settledAgentStates.map((row) => row.messageCount)).toEqual([1]);
      expect(
        messageTraceRows.some((row) => row.stage === "provider-onPayload-transform-complete"),
      ).toBe(true);
      const firstObserverMessages = observerEntries[0]!.messages as Array<Record<string, unknown>>;
      expect(firstObserverMessages.map((message) => Object.keys(message).toSorted())).toEqual(
        firstObserverMessages.map(() =>
          [
            "contentBytes",
            "contentLength",
            "contentObjectIdentity",
            "contentSha256",
            "index",
            "messageObjectIdentity",
            "observedAtStage",
            "observedSource",
            "origin",
            "role",
          ].toSorted(),
        ),
      );
      expect(rows.find((row) => row.event === "preflight-stop-assertion-evaluated")).toMatchObject({
        passed: true,
        predicates: {
          requestHookInvocationsAtLeastOne: true,
          requestObserverInvocationsAtLeastOne: true,
          allCapturedObservationsEquivalent: true,
          uniqueCanonicalObservationIsOne: true,
          providerCallbackCountIsZero: true,
          dispatchAttemptsIsZero: true,
          modelRequestCountIsZero: true,
          stopSignalsMatchCapturedRequests: true,
          stopSignalCaught: true,
        },
      });
    } finally {
      journal.close();
      cwd.mockRestore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("captures the provider-bound body and stops before dispatch or repeatability transport", async () => {
    const privateText = "private preflight-only request content";
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-bound-journal-test-"));
    const commit = "9".repeat(40);
    const journal = createV1JPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: commit,
      arm: "A",
      caseId: "offline-provider-capture",
      preflightId: `offline-provider-capture-${process.pid}`,
      pid: process.pid,
    });
    const requestBody = JSON.stringify({
      model: MODEL_ID,
      messages: [{ role: "user", content: privateText }],
      tools: Array.from({ length: 15 }, (_, index) => ({
        type: "function",
        function: { name: `tool-${index}`, parameters: { type: "object" } },
      })),
      stream: true,
    });
    const events: V1JProviderControlEvent[] = [];
    let exportedBodyPath: string | undefined;
    let providerDispatches = 0;
    let rawRequests = 0;
    journal.record("provider-bound-capture-start");
    const capture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      preflightDiagnostics: journal,
      onProviderCaptureStage: (event) => {
        events.push(event);
        journal.record(`provider-capture-${event.event}`, {
          ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
          ...(event.details === undefined ? {} : { details: event.details }),
        });
      },
      onProviderDispatchAttempt: () => {
        providerDispatches += 1;
      },
      onProviderRequestBeforeDispatch: ({ request, rawBody, requestIndex, dispatchOrdinal }) => {
        expect(requestIndex).toBe(1);
        expect(dispatchOrdinal).toBe(1);
        events.push({ event: "capture-record-build-start" });
        journal.record("capture-record-build-start");
        const summary = summarizeV1JRawRepeatabilityRequest(
          {
            endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
            rawBody,
            requestObject: request.body,
          },
          (event) => events.push(event),
        );
        expect(summary).toMatchObject({
          messageCount: 1,
          toolCount: 15,
          requestJsonBytes: Buffer.byteLength(requestBody),
        });
        const exported = publishAndVerifyV1JProviderBoundBodyArtifact({
          repoRoot,
          captureCommit: commit,
          endpoint: request.url,
          provider: "lmstudio",
          model: MODEL_ID,
          rawBody,
          expectedCanonicalRequestSha256: summary.requestCanonicalSha256,
        });
        exportedBodyPath = path.join(exported.artifactRoot, "request-body.bin");
        expect(exported.metadata.rawBodySha256).toBe(summary.requestSha256);
        expect(exported.metadata.canonicalRequestSha256).toBe(summary.requestCanonicalSha256);
        events.push({ event: "provider-bound-body-published-and-verified" });
        events.push({ event: "capture-record-build-complete" });
        journal.record("capture-record-build-complete", summary);
      },
    });
    const wrappedFetch = capture.wrapFetch(async () => {
      rawRequests += 1;
      return new Response("{}");
    });
    try {
      await expect(
        wrappedFetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
      ).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);
      journal.increment("preflightStopSignalCaught", "preflight-stop-signal-caught", {
        caughtAt: "offline-provider-capture-regression",
      });
      journal.increment("preflightCompleted", "preflight-complete");

      expect(capture.requests).toHaveLength(1);
      expect(exportedBodyPath).toBeDefined();
      expect(fs.readFileSync(exportedBodyPath!, "utf8")).toBe(requestBody);
      expect(capture.providerDispatchAttempts).toBe(0);
      expect(capture.delegatedRequests).toBe(0);
      expect(providerDispatches).toBe(0);
      expect(rawRequests).toBe(0);
      expect(events.map((event) => event.event)).toEqual([
        "request-serialization-start",
        "request-serialization-complete",
        "request-object-received",
        "provider-bound-callback-enter",
        "callback-return-or-throw",
        "provider-bound-callback-enter",
        "capture-record-build-start",
        "request-raw-body-fingerprint",
        "request-canonicalization-start",
        "request-canonicalization-complete",
        "request-component-fingerprints",
        "provider-bound-body-published-and-verified",
        "capture-record-build-complete",
        "callback-return-or-throw",
        "provider-bound-request-captured",
        "stop-signal-prepare",
        "preflight-stop-signal-raised",
        "stop-signal-raise",
      ]);
      expect(events[1]?.details).toMatchObject({
        stageName: "body-serialization",
        awaited: true,
        awaitTargetClass: "readCapturedFetchBody",
        requestJsonBytes: Buffer.byteLength(requestBody),
      });
      expect(events[5]?.details).toMatchObject({
        stageName: "provider-bound-callback",
        awaited: true,
        awaitTargetClass: "onProviderRequestBeforeDispatch",
      });
      const publishIndex = events.findIndex(
        (event) => event.event === "provider-bound-body-published-and-verified",
      );
      const callbackReturnIndex = events.findIndex(
        (event) =>
          event.event === "callback-return-or-throw" &&
          event.details?.phase === "return" &&
          event.details.awaited === true,
      );
      const stopSignalIndex = events.findIndex(
        (event) => event.event === "preflight-stop-signal-raised",
      );
      expect(publishIndex).toBeGreaterThan(-1);
      expect(publishIndex).toBeLessThan(callbackReturnIndex);
      expect(callbackReturnIndex).toBeLessThan(stopSignalIndex);
      expect(JSON.stringify(events)).not.toContain(privateText);
      expect(events.map((event) => event.event)).not.toContain("tool-execution-started");
      expect(journal.counters()).toMatchObject({
        providerDispatchAttempts: 0,
        providerCallbackInvocations: 0,
        modelRequestCounter: 0,
        preflightStopSignalRaised: 1,
        preflightStopSignalCaught: 1,
        preflightCompleted: 1,
      });
      const journalText = fs.readFileSync(journal.filePath, "utf8");
      expect(journalText).not.toContain(privateText);
      expect(journalText).not.toContain(requestBody);
      expect(journalText).toContain("requestJsonBytes");
      expect(fs.existsSync(path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH))).toBe(false);
      expect(fs.existsSync(resolveV1JSmokeRoot(repoRoot, commit))).toBe(false);
    } finally {
      capture.restore();
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "canonical mismatch",
    "artifact publication failure",
    "published-byte verification failure",
  ])("%s fails inside the provider-bound callback before any stop or dispatch", async (failure) => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-body-callback-failure-"));
    const commit = "6".repeat(40);
    const artifactRoot = path.join(repoRoot, V1J_PROVIDER_BOUND_BODY_PARENT, commit);
    const requestBody = JSON.stringify({
      model: MODEL_ID,
      messages: [{ role: "user", content: "private callback failure prompt" }],
      tools: Array.from({ length: 15 }, (_, index) => ({
        type: "function",
        function: { name: `tool-${index}`, parameters: { type: "object" } },
      })),
      stream: true,
    });
    const requestObject = JSON.parse(requestBody) as Record<string, unknown>;
    const requestSummary = summarizeV1JRawRepeatabilityRequest({
      endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
      rawBody: requestBody,
      requestObject,
    });
    if (failure === "artifact publication failure") {
      fs.mkdirSync(artifactRoot, { recursive: true });
    }

    const originalReadFileSync = fs.readFileSync.bind(fs);
    const readSpy =
      failure === "published-byte verification failure"
        ? vi.spyOn(fs, "readFileSync").mockImplementation((filePath, options) => {
            if (typeof filePath === "string" && path.basename(filePath) === "request-body.bin") {
              return Buffer.from("tampered body") as never;
            }
            return originalReadFileSync(filePath as never, options as never);
          })
        : undefined;
    const events: V1JProviderControlEvent[] = [];
    let callbackReturned = false;
    let rawRequests = 0;
    const capture = captureModelPayloads(undefined, {
      stopAfterProviderBoundCapture: true,
      onProviderCaptureStage: (event) => events.push(event),
      onProviderRequestBeforeDispatch: ({ request, rawBody }) => {
        publishAndVerifyV1JProviderBoundBodyArtifact({
          repoRoot,
          captureCommit: commit,
          endpoint: request.url,
          provider: "lmstudio",
          model: MODEL_ID,
          rawBody,
          expectedCanonicalRequestSha256:
            failure === "canonical mismatch"
              ? "0".repeat(64)
              : requestSummary.requestCanonicalSha256,
        });
        callbackReturned = true;
      },
    });
    try {
      await expect(
        capture.wrapFetch(async () => {
          rawRequests += 1;
          return new Response("{}");
        })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
      ).rejects.toThrow();

      expect(callbackReturned).toBe(false);
      expect(capture.providerDispatchAttempts).toBe(0);
      expect(capture.delegatedRequests).toBe(0);
      expect(rawRequests).toBe(0);
      expect(events.map((event) => event.event)).not.toContain("preflight-stop-signal-raised");
    } finally {
      readSpy?.mockRestore();
      capture.restore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("records a blocked preflight separately from a provider dispatch and keeps the schedule closed", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-preflight-dispatch-test-"));
    const commit = "8".repeat(40);
    const blockedJournal = createV1JPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: commit,
      arm: "C",
      caseId: "offline-preflight",
      preflightId: "offline-preflight-c-blocked",
      pid: process.pid,
    });
    const blockedFetch = captureModelPayloads(undefined, {
      stopAfterCapture: true,
      preflightDiagnostics: blockedJournal,
    });
    blockedJournal.increment(
      "providerRequestHookInvocations",
      "arm-c-provider-request-hook-enter",
      {
        callSite: "offline-regression-test",
      },
    );
    let blockedProviderCallbackCalls = 0;
    try {
      await expect(
        blockedFetch.wrapFetch(async () => {
          blockedProviderCallbackCalls += 1;
          return new Response("{}");
        })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          body: JSON.stringify({ model: MODEL_ID, tools: [] }),
        }),
      ).rejects.toBeInstanceOf(V1IProviderRequestCapturedError);
      blockedJournal.increment("preflightStopSignalCaught", "arm-c-preflight-stop-signal-caught", {
        caughtAt: "offline-regression-test",
      });
      const blockedPredicates = blockedJournal.evaluateStop({
        requestObserverCount: blockedJournal.counters().requestObserverInvocations,
        capturedRequestCount: blockedFetch.requests.length,
        delegatedRequestCount: blockedFetch.delegatedRequests,
        providerDispatchAttempts: blockedFetch.providerDispatchAttempts,
        observations: [testV1JPreflightObservation()],
      });
      expect(Object.values(blockedPredicates).every(Boolean)).toBe(true);
      expect(blockedProviderCallbackCalls).toBe(0);
      expect(blockedJournal.counters()).toMatchObject({
        providerDispatchAttempts: 0,
        modelRequestCounter: 0,
        preflightStopSignalRaised: 1,
        preflightStopSignalCaught: 1,
      });
      let scheduleStarted = false;
      expect(() => {
        assertV1JPreflightPairComplete(["A"]);
        scheduleStarted = true;
      }).toThrow(/requires completed A and C/);
      expect(scheduleStarted).toBe(false);
    } finally {
      blockedFetch.restore();
      blockedJournal.close();
    }

    const dispatchJournal = createV1JPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: commit,
      arm: "C",
      caseId: "offline-preflight",
      preflightId: "offline-preflight-c-dispatched",
      pid: process.pid,
    });
    const dispatchFetch = captureModelPayloads(undefined, {
      preflightDiagnostics: dispatchJournal,
    });
    dispatchJournal.increment(
      "providerRequestHookInvocations",
      "arm-c-provider-request-hook-enter",
      {
        callSite: "offline-regression-test",
      },
    );
    let dispatchedProviderCallbackCalls = 0;
    try {
      await dispatchFetch.wrapFetch(async () => {
        dispatchedProviderCallbackCalls += 1;
        return new Response("{}", { headers: { "content-type": "application/json" } });
      })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: MODEL_ID, tools: [] }),
      });
      const dispatchPredicates = dispatchJournal.evaluateStop({
        requestObserverCount: dispatchJournal.counters().requestObserverInvocations,
        capturedRequestCount: dispatchFetch.requests.length,
        delegatedRequestCount: dispatchFetch.delegatedRequests,
        providerDispatchAttempts: dispatchFetch.providerDispatchAttempts,
        observations: [testV1JPreflightObservation()],
      });
      expect(dispatchPredicates.providerCallbackCountIsZero).toBe(false);
      expect(dispatchPredicates.dispatchAttemptsIsZero).toBe(false);
      expect(dispatchPredicates.modelRequestCountIsZero).toBe(false);
      expect(dispatchedProviderCallbackCalls).toBe(1);
    } finally {
      dispatchFetch.restore();
      dispatchJournal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("blocks the wrapped provider fetch in capture mode and preserves normal dispatch", async () => {
    let captureFetchCalls = 0;
    const capture = captureModelPayloads(undefined, {
      schemaCaptureName: "capture-1",
    });
    try {
      await expect(
        capture.wrapFetch(async () => {
          captureFetchCalls += 1;
          return new Response("{}");
        })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
          method: "POST",
          body: JSON.stringify({ model: MODEL_ID, tools: [] }),
        }),
      ).rejects.toBeInstanceOf(V1IProviderDispatchAttemptError);
      expect(capture.providerDispatchAttempts).toBe(1);
      expect(captureFetchCalls).toBe(0);
    } finally {
      capture.restore();
    }

    let normalFetchCalls = 0;
    const normal = captureModelPayloads();
    const invocationEvents: unknown[] = [];
    const invocationOrder: string[] = [];
    const normalWithInvocationObserver = captureModelPayloads(undefined, {
      onProviderInvocation: (event) => {
        invocationEvents.push(event);
        invocationOrder.push("provider-invoke-enter");
      },
    });
    try {
      await normal.wrapFetch(async () => {
        normalFetchCalls += 1;
        return new Response("{}", { headers: { "content-type": "application/json" } });
      })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: MODEL_ID, tools: [] }),
      });
      expect(normal.providerDispatchAttempts).toBe(1);
      expect(normalFetchCalls).toBe(1);
      expect(normal.providerInvocationCount).toBe(1);
      expect(invocationEvents).toEqual([]);
      await normalWithInvocationObserver.wrapFetch(async () => {
        invocationOrder.push("network-request-start");
        return new Response("{}", { headers: { "content-type": "application/json" } });
      })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: MODEL_ID, tools: [] }),
      });
      expect(normalWithInvocationObserver.providerInvocationCount).toBe(1);
      expect(invocationEvents).toEqual([
        expect.objectContaining({ count: 1, requestIndex: 1, dispatchOrdinal: 1 }),
      ]);
      expect(invocationOrder).toEqual(["provider-invoke-enter", "network-request-start"]);
    } finally {
      normalWithInvocationObserver.restore();
      normal.restore();
    }
  });

  it("rejects an unaccounted preflight model result and records tool identity only", () => {
    const records: Array<{ event: string; details: Record<string, unknown> }> = [];
    const journal = {
      record: (event: string, details: Record<string, unknown> = {}) =>
        records.push({ event, details }),
    } as unknown as V1JPreflightDiagnosticJournal;
    const toolCall = {
      type: "toolCall" as const,
      id: "private-call-id",
      name: "read",
      arguments: { path: "private prompt content" },
    };
    const assistant = makeAssistantMessage([toolCall]);

    expect(() =>
      guardV1JPreflightAssistantResult({
        message: assistant,
        modelTurnIndex: 0,
        providerInvocationCount: 0,
        stopSignalRaised: false,
        journal,
        captureOnly: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "V1JUnexpectedPreflightModelResultError",
        classification: "UNACCOUNTED_MODEL_RESULT_SOURCE",
      }),
    );

    expect(records).toEqual([
      {
        event: "preflight-unexpected-model-result",
        details: expect.objectContaining({
          classification: "UNACCOUNTED_MODEL_RESULT_SOURCE",
          providerInvocationCount: 0,
          toolCallCount: 1,
          toolCalls: [{ toolName: "read", callIdSha256: sha256V1J("private-call-id") }],
          toolHandlerEntryCount: 0,
          toolResultCallbackCount: 0,
          secondModelLoopIterationAllowed: false,
        }),
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private-call-id");
    expect(JSON.stringify(records)).not.toContain("private prompt content");
  });

  it("recognizes only the local capture-stop error without treating it as a model result", () => {
    const record = vi.fn();
    const result = guardV1JPreflightAssistantResult({
      message: { ...makeAssistantMessage([]), stopReason: "error" },
      modelTurnIndex: 0,
      providerInvocationCount: 0,
      stopSignalRaised: true,
      journal: { record } as unknown as V1JPreflightDiagnosticJournal,
      captureOnly: true,
    });

    expect(result).toBe(true);
    expect(record).toHaveBeenCalledWith(
      "preflight-stop-assistant-error-observed",
      expect.objectContaining({ providerInvocationCount: 0, stopReason: "error" }),
    );
  });

  it("allows the wrapped provider fetch only after exact canonical parity", async () => {
    const rawControlBody = {
      model: MODEL_ID,
      messages: [{ role: "user", content: "raw control message" }],
      tools: [],
      stream: true,
    };
    let delegatedFetchCalls = 0;
    let comparison: ReturnType<typeof compareV1JAdapterDifferentialRequests> | undefined;
    const capture = captureModelPayloads(undefined, {
      onProviderRequestBeforeDispatch: ({ request, rawBody, requestIndex, dispatchOrdinal }) => {
        expect(requestIndex).toBe(1);
        expect(dispatchOrdinal).toBe(1);
        comparison = compareV1JAdapterDifferentialRequests(rawControlBody, request.body, rawBody);
        expect(comparison.canonicalMatch).toBe(true);
      },
    });
    try {
      await capture.wrapFetch(async () => {
        delegatedFetchCalls += 1;
        return new Response("{}", { headers: { "content-type": "application/json" } });
      })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        body: JSON.stringify(rawControlBody),
      });
      expect(comparison?.canonicalMatch).toBe(true);
      expect(delegatedFetchCalls).toBe(1);
      expect(capture.providerDispatchAttempts).toBe(1);
    } finally {
      capture.restore();
    }
  });

  it("awaits the raw fork of the exact provider-bound body before adapter dispatch", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-body-fork-"));
    const journal = createV1JAdapterDifferentialJournal({
      repoRoot,
      harnessCommit: "a".repeat(40),
      modelId: MODEL_ID,
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      schemaFingerprint: {
        authorizedToolCount: 15,
        providerToolCount: 15,
        authorizedToolNameSha256: "b".repeat(64),
        providerToolNameSha256: "b".repeat(64),
        authorizedToolSchemaSha256: "c".repeat(64),
        providerToolSchemaSha256: "d".repeat(64),
      },
      startedAt: new Date().toISOString(),
    });
    const providerBody = {
      model: MODEL_ID,
      messages: [
        { role: "system", content: "private provider-bound system prompt" },
        { role: "user", content: "private provider-bound user prompt" },
      ],
      tools: Array.from({ length: 15 }, (_, index) => ({
        function: { name: `tool_${index}`, parameters: { type: "object" } },
      })),
      max_tokens: 128,
      stream: true,
    };
    const serializedProviderBody = ` {\n  ${JSON.stringify(providerBody).slice(1, -1)}\n}`;
    const dispatchOrder: string[] = [];
    let rawBodySent: string | undefined;
    let parity: ReturnType<typeof compareV1JAdapterDifferentialRequests> | undefined;
    const capture = captureModelPayloads(undefined, {
      onProviderRequestBeforeDispatch: async ({ request, rawBody, requestIndex }) => {
        if (requestIndex !== 1) {
          return;
        }
        const providerRequest = JSON.parse(rawBody) as Record<string, unknown>;
        expect(Object.hasOwn(providerRequest, "tool_choice")).toBe(false);
        parity = compareV1JAdapterDifferentialRequests(
          providerRequest,
          request.body,
          rawBody,
          rawBody,
        );
        await runV1JAdapterDifferentialRawTransport({
          endpoint: request.url,
          authorization: "Bearer test-only",
          requestBody: providerRequest,
          serializedRequestBody: rawBody,
          journal,
          fetchImpl: async (_input, init) => {
            dispatchOrder.push("raw");
            rawBodySent = init?.body as string;
            return new Response("data: [DONE]\n\n", {
              headers: { "content-type": "text/event-stream" },
            });
          },
          timeoutMs: 1_000,
          heartbeatMs: 1_000,
        });
      },
    });
    try {
      await capture.wrapFetch(async (_input, init) => {
        dispatchOrder.push("adapter");
        expect(init?.body).toBe(serializedProviderBody);
        return new Response("{}", { headers: { "content-type": "application/json" } });
      })(`${LM_STUDIO_BASE_URL}/chat/completions`, {
        method: "POST",
        body: serializedProviderBody,
      });

      expect(dispatchOrder).toEqual(["raw", "adapter"]);
      expect(rawBodySent).toBe(serializedProviderBody);
      expect(parity?.canonicalMatch).toBe(true);
      expect(parity?.requestMatch).toBe(true);
      expect(capture.providerDispatchAttempts).toBe(1);
      const artifactParent = path.join(repoRoot, V1J_ADAPTER_DIFFERENTIAL_PARENT);
      expect(fs.existsSync(path.join(artifactParent, "real-exact-run1"))).toBe(false);
      expect(fs.existsSync(path.join(artifactParent, `smoke-${"a".repeat(40)}`))).toBe(false);
      const persisted = fs.readFileSync(journal.filePath, "utf8");
      expect(persisted).not.toContain("private provider-bound");
    } finally {
      capture.restore();
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "message content",
      rawBody: {
        model: MODEL_ID,
        messages: [{ role: "user", content: "raw private prompt" }],
        tools: [],
        stream: true,
      },
      adapterBody: {
        model: MODEL_ID,
        messages: [{ role: "user", content: "adapter private prompt" }],
        tools: [],
        stream: true,
      },
      differingPath: "messages.0.content",
    },
    {
      name: "tool choice",
      rawBody: {
        model: MODEL_ID,
        messages: [{ role: "user", content: "same prompt" }],
        tools: [],
        stream: true,
        tool_choice: "auto",
      },
      adapterBody: {
        model: MODEL_ID,
        messages: [{ role: "user", content: "same prompt" }],
        tools: [],
        stream: true,
        tool_choice: "none",
      },
      differingPath: "tool_choice",
    },
    {
      name: "tool schema",
      rawBody: {
        model: MODEL_ID,
        messages: [{ role: "user", content: "same prompt" }],
        tools: [{ function: { name: "read", parameters: { type: "object" } } }],
        stream: true,
      },
      adapterBody: {
        model: MODEL_ID,
        messages: [{ role: "user", content: "same prompt" }],
        tools: [{ function: { name: "read", parameters: { type: "string" } } }],
        stream: true,
      },
      differingPath: "tools.0.function.parameters.type",
    },
  ])("latches a $name parity mismatch before all provider dispatches", async (scenario) => {
    const mismatch = new Error("final request differs from raw control");
    const journalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-adapter-parity-gate-"));
    const journalHead = "a".repeat(40);
    const journal = createV1JAdapterDifferentialJournal({
      repoRoot: journalRoot,
      harnessCommit: journalHead,
      modelId: MODEL_ID,
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      schemaFingerprint: {
        authorizedToolCount: 15,
        providerToolCount: 15,
        authorizedToolNameSha256: "b".repeat(64),
        providerToolNameSha256: "b".repeat(64),
        authorizedToolSchemaSha256: "c".repeat(64),
        providerToolSchemaSha256: "d".repeat(64),
      },
      startedAt: new Date().toISOString(),
    });
    let beforeDispatchCallbacks = 0;
    let delegatedFetchCalls = 0;
    const capture = captureModelPayloads(undefined, {
      onProviderRequestBeforeDispatch: ({ request, rawBody, requestIndex, dispatchOrdinal }) => {
        beforeDispatchCallbacks += 1;
        if (requestIndex !== 1) {
          return;
        }
        const comparison = compareV1JAdapterDifferentialRequests(
          scenario.rawBody,
          request.body,
          rawBody,
        );
        journal.record("adapter-request-parity", {
          requestIndex,
          dispatchOrdinal,
          requestMatch: comparison.requestMatch,
          canonicalMatch: comparison.canonicalMatch,
          rawCanonicalRequestSha256: comparison.rawCanonicalRequestSha256,
          adapterCanonicalRequestSha256: comparison.adapterCanonicalRequestSha256,
        });
        for (const differingPath of comparison.differingPaths) {
          journal.record("adapter-request-difference", {
            requestIndex,
            dispatchOrdinal,
            differingPath,
          });
          const rawField = fingerprintV1JAdapterDifferentialField(scenario.rawBody, differingPath);
          const adapterField = fingerprintV1JAdapterDifferentialField(
            scenario.adapterBody,
            differingPath,
          );
          journal.record("adapter-request-difference-provenance", {
            requestIndex,
            dispatchOrdinal,
            differingPath,
            rawValueSource: "control-c-clone-of-preflight-arm-a",
            adapterCandidateSource: "fresh-execute-v1jcell-request-observer",
            adapterWireSource: "provider-fetch-body-pre-dispatch",
            rawValuePresent: rawField.present,
            rawValueType: rawField.valueType,
            rawValueSha256: rawField.valueSha256,
            rawValueBytes: rawField.valueBytes,
            adapterCandidateValuePresent: adapterField.present,
            adapterCandidateValueType: adapterField.valueType,
            adapterCandidateValueSha256: adapterField.valueSha256,
            adapterCandidateValueBytes: adapterField.valueBytes,
            adapterWireValuePresent: adapterField.present,
            adapterWireValueType: adapterField.valueType,
            adapterWireValueSha256: adapterField.valueSha256,
            adapterWireValueBytes: adapterField.valueBytes,
          });
        }
        if (!comparison.canonicalMatch) {
          throw mismatch;
        }
      },
    });
    const fetch = capture.wrapFetch(async () => {
      delegatedFetchCalls += 1;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    const url = `${LM_STUDIO_BASE_URL}/chat/completions`;
    const initFor = (body: Record<string, unknown>) => ({
      method: "POST",
      body: JSON.stringify(body),
    });
    try {
      await expect(fetch(url, initFor(scenario.adapterBody))).rejects.toBe(mismatch);
      await expect(fetch(url, initFor(scenario.adapterBody))).rejects.toBe(mismatch);

      expect(beforeDispatchCallbacks).toBe(1);
      expect(delegatedFetchCalls).toBe(0);
      expect(capture.providerDispatchAttempts).toBe(0);
      const persisted = fs.readFileSync(journal.filePath, "utf8");
      const events = persisted
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              event: string;
              differingPath?: string;
              rawValueSource?: string;
              rawValueSha256?: string;
            },
        );
      expect(events.map((event) => event.event)).toEqual([
        "diagnostic-start",
        "adapter-request-parity",
        "adapter-request-difference",
        "adapter-request-difference-provenance",
      ]);
      expect(events[2]?.differingPath).toBe(scenario.differingPath);
      expect(events[3]).toMatchObject({
        differingPath: scenario.differingPath,
        rawValueSource: "control-c-clone-of-preflight-arm-a",
        rawValueSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(persisted).not.toContain("raw private prompt");
      expect(persisted).not.toContain("adapter private prompt");
      expect(
        fs.existsSync(
          path.join(
            journalRoot,
            "artifacts/capability-intelligence/v1j-action-initiation/real-exact-run1",
          ),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(
            journalRoot,
            "artifacts/capability-intelligence/v1j-action-initiation",
            `smoke-${journalHead}`,
          ),
        ),
      ).toBe(false);
    } finally {
      capture.restore();
      journal.close();
      fs.rmSync(journalRoot, { recursive: true, force: true });
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
      expect(
        requiredTools.every((tool) => new Set<string>(REAL_RUNTIME_TOOL_NAMES).has(tool)),
      ).toBe(true);
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
    const diagnostic = createTestV1JProviderResponseDiagnosticJournal();
    const capture = captureModelPayloads(undefined, {
      onResponseSummary: (summary) => summaries.push(summary),
      lifecycleJournal: diagnostic.journal,
      requestCorrelationId: "offline-response-success",
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
      const lifecycle = diagnostic.readRows();
      expect(lifecycle.map((row) => row.event)).toEqual(
        expect.arrayContaining([
          "request-created",
          "request-dispatch-start",
          "request-dispatch-complete",
          "http-response-headers",
          "network-response-headers",
          "provider-response-observed",
          "network-response-body-start",
          "http-response-body-start",
          "adapter-stream-enter",
          "response-first-byte",
          "adapter-first-chunk",
          "response-stream-progress",
          "stream-end",
          "http-response-body-complete",
        ]),
      );
      expect(lifecycle.find((row) => row.event === "provider-response-observed")).toMatchObject({
        providerResponseObserved: true,
        httpStatus: 200,
      });
      expect(lifecycle.find((row) => row.event === "http-response-body-complete")).toMatchObject({
        responseBytes: new TextEncoder().encode(fixture).byteLength,
        parserOutcome: "tool-call-complete",
      });
      expect(lifecycle.find((row) => row.event === "stream-end")).toMatchObject({
        responseChunkCount: expect.any(Number),
        responseByteCount: new TextEncoder().encode(fixture).byteLength,
        outcome: "complete",
      });
      expect(JSON.stringify(lifecycle)).not.toContain("git_status");
      expect(capture.providerDispatchAttempts).toBe(1);
      expect(capture.providerInvocationCount).toBe(1);
    } finally {
      configureAiTransportHost(previousHost);
      capture.restore();
      diagnostic.dispose();
    }
  });

  it("records HTTP error status without persisting its body", async () => {
    const diagnostic = createTestV1JProviderResponseDiagnosticJournal();
    const capture = captureModelPayloads(undefined, { lifecycleJournal: diagnostic.journal });
    try {
      const response = await capture.wrapFetch(
        async () =>
          new Response('{"error":{"message":"private provider detail"}}', {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      )(LM_STUDIO_BASE_URL + "/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: MODEL_ID, messages: [] }),
      });
      await response.text();
      const rows = diagnostic.readRows();
      expect(rows.find((row) => row.event === "provider-response-observed")).toMatchObject({
        providerResponseObserved: true,
        httpStatus: 503,
      });
      expect(rows.find((row) => row.event === "http-response-body-complete")).toMatchObject({
        parserOutcome: "stream-closed-without-terminal",
      });
      expect(JSON.stringify(rows)).not.toContain("private provider detail");
    } finally {
      capture.restore();
      diagnostic.dispose();
    }
  });

  it("preserves a rejected fetch error and records its abort classification", async () => {
    const diagnostic = createTestV1JProviderResponseDiagnosticJournal();
    const capture = captureModelPayloads(undefined, { lifecycleJournal: diagnostic.journal });
    const abortError = new DOMException("request aborted", "AbortError");
    try {
      const request = capture.wrapFetch(async () => {
        throw abortError;
      })(LM_STUDIO_BASE_URL + "/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: MODEL_ID, messages: [] }),
      });
      await expect(request).rejects.toBe(abortError);
      expect(
        diagnostic.readRows().find((row) => row.event === "request-dispatch-complete"),
      ).toMatchObject({ outcome: "rejected", errorClass: "AbortError", timeoutState: "aborted" });
      expect(diagnostic.readRows().some((row) => row.event === "http-response-headers")).toBe(
        false,
      );
    } finally {
      capture.restore();
      diagnostic.dispose();
    }
  });

  it("distinguishes a received but unparseable body from no provider response", async () => {
    const diagnostic = createTestV1JProviderResponseDiagnosticJournal();
    const summaries: ProviderResponseSummary[] = [];
    const capture = captureModelPayloads(undefined, {
      lifecycleJournal: diagnostic.journal,
      onResponseSummary: (summary) => summaries.push(summary),
    });
    try {
      const response = await capture.wrapFetch(
        async () =>
          new Response("data: not-json\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      )(LM_STUDIO_BASE_URL + "/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: MODEL_ID, messages: [] }),
      });
      await response.text();
      expect(
        diagnostic
          .readRows()
          .some(
            (row) => row.event === "provider-response-observed" && row.providerResponseObserved,
          ),
      ).toBe(true);
      expect(summaries.at(-1)?.parserOutcome).toBe("parse-error");
      expect(diagnostic.readRows().some((row) => row.event === "adapter-response-parsed")).toBe(
        false,
      );
    } finally {
      capture.restore();
      diagnostic.dispose();
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
      const diagnosticStyle = process.env.OPENCLAW_V1I_DIAGNOSTIC_STYLE ?? "smoke";
      if (diagnosticStyle !== "smoke" && diagnosticStyle !== "formal-resume") {
        throw new Error(`unsupported diagnostic style: ${diagnosticStyle}`);
      }
      const diagnosticMode: V1IMode =
        diagnosticStyle === "formal-resume" ? "real-exact" : "synthetic";
      const diagnosticAttempt = diagnosticStyle === "formal-resume" ? 2 : 1;
      if (LIVE_MODE !== diagnosticMode) {
        throw new Error(`diagnostic mode mismatch: style=${diagnosticStyle} mode=${LIVE_MODE}`);
      }
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
        attemptId: v1IAttemptId(
          surfaceModeForV1IMode(diagnosticMode),
          benchmarkCase.id,
          "B",
          3,
          diagnosticAttempt,
        ),
        caseId: benchmarkCase.id,
        arm: "B",
        replicate: 3,
        attemptIndex: diagnosticAttempt,
      });
      journal.record("attempt-initialized");
      fs.writeFileSync(
        path.join(diagnosticRoot, "diagnostic-manifest.json"),
        `${JSON.stringify(
          {
            diagnosticOnly: true,
            harnessCommit: HARNESS_COMMIT,
            diagnosticStyle,
            caseId: benchmarkCase.id,
            arm: "B",
            replicate: 3,
            attempt: diagnosticAttempt,
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
        // SAFETY: these events are diagnostic-only and identify the synchronous registry seam.
        registryTraces: [] as PluginRegistryLoadTraceEvent[],
      };
      const responseSummaries: ProviderResponseSummary[] = [];
      const postResponseCheckpoints: PostResponseCheckpoint[] = [];
      const postResponseHeartbeats: PostResponseHeartbeat[] = [];
      const postResponseSnapshots: PostResponseSnapshot[] = [];
      const postResponseCounters: PostResponseCounter[] = [];
      const modelLoopSubstages: Array<{
        stage: EmbeddedCapabilityIntelligenceModelLoopSubstage;
        elapsedMs: number;
      }> = [];
      const modelLoopHeartbeats: EmbeddedCapabilityIntelligenceModelLoopHeartbeat[] = [];
      const preparationAbortController = new AbortController();
      let preparedRuntimeAcquisitionCompleted = false;
      let delegatedModelRequests = 0;
      let observation: ExperimentRun | undefined;
      let failure: unknown;
      const modelLoopDiagnostics = process.env.OPENCLAW_V1I_MODEL_LOOP_DIAGNOSTICS === "1";
      try {
        journal.record("model-discovery-skipped-for-preparation-diagnostic");
        journal.record("workspace-session-prep-start");
        journal.record("workspace-session-prep-complete");
        observation = await runOne({
          mode: diagnosticMode,
          surfaceMode: surfaceModeForV1IMode(diagnosticMode),
          benchmarkCase,
          mappingClass: diagnosticMode === "synthetic" ? "SYNTHETIC" : "EXACT",
          authorizedNames:
            diagnosticMode === "synthetic"
              ? benchmarkCase.tools.map((tool) => tool.name)
              : benchmarkCase.tools.flatMap((tool) => {
                  const mapped = getBenchmarkRealToolMapping(tool.name).realTool;
                  return mapped ? [mapped] : [];
                }),
          v1cTop8: rankTop8(
            diagnosticMode === "synthetic"
              ? benchmarkCase.tools
              : benchmarkCase.tools.flatMap((tool) => {
                  const mapped = getBenchmarkRealToolMapping(tool.name).realTool;
                  return mapped
                    ? [{ name: mapped, description: `OpenClaw ${mapped} capability` }]
                    : [];
                }),
            benchmarkCase.query,
          ),
          requiredMappedTools:
            diagnosticMode === "synthetic"
              ? []
              : benchmarkCase.expectedTopTools.flatMap((tool) => {
                  const mapped = getBenchmarkRealToolMapping(tool).realTool;
                  return mapped ? [mapped] : [];
                }),
          arm: "B",
          replicate: 3,
          attempt: diagnosticAttempt,
          scheduleSeed: scheduleSeedFor(benchmarkCase.id, 3),
          config,
          workspaceDir,
          timeoutMs: 120_000,
          abortSignal: preparationAbortController.signal,
          attemptCheckpointJournal: journal,
          onAcquisitionHeartbeat: (heartbeat) => acquisitionHeartbeats.push(heartbeat),
          onPluginPrepDiscoveryInputs: (inputs) => pluginPrep.discoveryInputs.push(inputs),
          onPluginPrepTiming: (timing) => pluginPrep.timings.push(timing),
          onPluginPrepRegistryTrace: (event) => pluginPrep.registryTraces.push(event),
          onCheckpoint: (checkpoint) => {
            if (
              checkpoint.stage === "prepared-runtime-acquisition-completed" &&
              !modelLoopDiagnostics
            ) {
              preparedRuntimeAcquisitionCompleted = true;
              preparationAbortController.abort(
                new Error("v1I preparation diagnostic completed before model request"),
              );
            }
          },
          modelLoopDiagnostics: modelLoopDiagnostics
            ? {
                onSubstage: (event) => modelLoopSubstages.push(event),
                onHeartbeat: (heartbeat) => modelLoopHeartbeats.push(heartbeat),
              }
            : undefined,
          postResponseDiagnostics: true,
          onPostResponseCheckpoint: (checkpoint) => postResponseCheckpoints.push(checkpoint),
          onPostResponseHeartbeat: (heartbeat) => postResponseHeartbeats.push(heartbeat),
          onPostResponseSnapshot: (snapshot) => postResponseSnapshots.push(snapshot),
          onPostResponseCounter: (counter) => postResponseCounters.push(counter),
          requestCapture: {
            stopAfterCapture: modelLoopDiagnostics,
            onRequestCaptured: (request) => requestBodies.push(request.body),
            onDelegatedRequest: () => {
              delegatedModelRequests += 1;
            },
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
        providerRequestConstructed: requestBodies.length > 0,
        delegatedModelRequests,
        modelLoopSubstages,
        modelLoopHeartbeats,
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
        pluginRegistryTraces: pluginPrep.registryTraces,
        diagnosticStyle,
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
          observation?.requestPreparationDiagnostics?.normalizedRuntimeStatus ?? null,
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
        (modelLoopDiagnostics &&
          (modelLoopSubstages.length > 0 || requestBodies.length > 0 || failure !== undefined)) ||
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
      if (requestBodies.length > 0 && delegatedModelRequests > 0) {
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
          requiredMappedTools,
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
  preferredToolOverride?: string | null;
  runIdOverride?: string;
  arm: Arm;
  replicate: number;
  attempt: number;
  scheduleSeed: number;
  config: OpenClawConfig;
  workspaceDir: string;
  requestCapture?: {
    stopAfterCapture?: boolean;
    stopAfterProviderBoundCapture?: boolean;
    holdAfterCapture?: boolean;
    preflightDiagnostics?: V1JPreflightDiagnosticJournal;
    schemaCaptureName?: V1JSchemaCaptureName;
    schemaCaptureArm?: V1JSchemaCaptureArm;
    headCommit?: string;
    capturePromptInstruction?: string;
    surfaceMode?: "REAL_EXACT" | "SYNTHETIC";
    benchmarkCandidateNames?: readonly string[];
    getImageFactoryObservation?: () => V1JImageFactoryObservation | undefined;
    onImageFactoryResult?: (observation: V1JImageFactoryObservation) => void;
    onAuthorizedToolsCaptured?: (tools: readonly V1JAuthorizedToolSchema[]) => void;
    onRequestCaptured?: (request: CapturedModelRequest) => void;
    onProviderCaptureStage?: (event: V1JProviderControlEvent) => void;
    onProviderRequestBeforeDispatch?: (input: {
      request: CapturedModelRequest;
      rawBody: string;
      requestIndex: number;
      dispatchOrdinal: number;
    }) => void | Promise<void>;
    onPreflightStopRaised?: () => void;
    onDelegatedRequest?: () => void;
    onResponseSummary?: (summary: ProviderResponseSummary) => void;
    onAssistantMessage?: (message: AssistantMessage, modelTurnIndex: number) => void;
    liveness?: V1JCaptureLiveness;
    onProviderDispatchAttempt?: (count: number, requestIndex: number) => void;
    lifecycleJournal?: V1JLifecycleJournal;
    requestCorrelationId?: string;
  };
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  modelLoopDiagnostics?: {
    onSubstage: (event: {
      stage: EmbeddedCapabilityIntelligenceModelLoopSubstage;
      elapsedMs: number;
    }) => void;
    onHeartbeat: (heartbeat: EmbeddedCapabilityIntelligenceModelLoopHeartbeat) => void;
  };
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
  onPluginPrepRegistryTrace?: (event: PluginRegistryLoadTraceEvent) => void;
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
  const runId =
    input.runIdOverride ??
    `v1i-${input.surfaceMode.toLowerCase()}-${input.benchmarkCase.id}-${input.arm}-${input.replicate}`;
  const preflightDiagnostics = input.requestCapture?.preflightDiagnostics;
  const configuredAttemptTimeoutMs = input.timeoutMs ?? 120_000;
  const timeoutConfigurationSource =
    input.timeoutMs === undefined ? "runOne-default" : "runOne-input";
  let timeoutFired = false;
  let abortRequested = false;
  let abortObserved = false;
  let providerSelectionCompleted = false;
  let providerCallPrepareObserved = false;
  let preDispatchCallbackInvoked = false;
  let assistantFinalReason: string | null = null;
  let assistantContentSha256: string | null = null;
  let assistantContentBytes: number | null = null;
  let assistantToolCallCount = 0;
  let providerInvocationCount = 0;
  let providerBoundCaptureInvocationIndex = 0;
  let preflightStopSignalRaised = false;
  const preDispatchCallbackExpected = input.requestCapture?.stopAfterProviderBoundCapture === true;
  const preDispatchCallbackRegistered = preDispatchCallbackExpected;
  const recordPromptAwait = (event: string, details: Record<string, unknown> = {}) =>
    recordV1JPromptAwaitDiagnostic(preflightDiagnostics, event, {
      runOneAttemptId: runId,
      embeddedRunId,
      sessionIdSha256,
      promptSubmissionIndex: promptSubmissionTraceIndex,
      modelLoopIterationIndex: currentProviderPayloadTraceIndex,
      ...details,
    });
  const diagnostics = createExperimentDiagnostics();
  const recordProviderCaptureStage = (
    event: string,
    details?: Record<string, unknown>,
    elapsedMs?: number,
  ) => {
    if (event === "provider-bound-callback-enter") {
      preDispatchCallbackInvoked = true;
      recordPromptAwait("pre-dispatch-callback-invoked", {
        sourceStage: event,
        preDispatchCallbackExpected,
        preDispatchCallbackRegistered,
      });
    }
    input.requestCapture?.onProviderCaptureStage?.({
      event,
      ...(details ? { details } : {}),
      ...(elapsedMs === undefined ? {} : { elapsedMs: Math.max(0, Math.round(elapsedMs)) }),
    });
  };
  const promptMessageIdentities = new WeakMap<object, number>();
  let nextPromptMessageIdentity = 1;
  const identifyPromptObject = (value: object) => {
    const existing = promptMessageIdentities.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const identity = nextPromptMessageIdentity++;
    promptMessageIdentities.set(value, identity);
    return identity;
  };
  let promptSubmissionTraceIndex = 0;
  let providerPayloadTraceIndex = 0;
  let currentProviderPayloadTraceIndex = 0;
  let embeddedRunId: string | null = null;
  let sessionIdSha256: string | null = null;
  let precedingModelTurnIndex: number | null = null;
  let activeRequestObserverCount = 0;
  let previousTranscriptTrace:
    | {
        messageArrayIdentity: number;
        messages: ReturnType<typeof summarizePromptMessageTrace>["messages"];
      }
    | undefined;
  let previousMaterializationBoundary:
    | {
        trace: ReturnType<typeof summarizePromptMessageTrace>;
        content: V1JPromptMaterializationBoundary;
      }
    | undefined;
  let materializationRequestIndex = 0;
  const preCaptureObserverTraces: V1JPreCaptureObserverTrace[] = [];
  const preCaptureTranscriptGrowth: V1JPreCaptureTranscriptGrowth[] = [];
  if (preflightDiagnostics) {
    recordPromptAwait("provider-selection-start", {
      provider: runProvider,
      model: runModel,
      providerSelectionSource: "runOne invocation configuration",
    });
    recordPromptAwait("attempt-timeout-configured", {
      configuredAttemptTimeoutMs,
      timeoutConfigurationSource,
    });
    recordPromptAwait("pre-dispatch-callback-expected", {
      preDispatchCallbackExpected,
      sourceStage: "stopAfterProviderBoundCapture configuration",
    });
    recordPromptAwait("pre-dispatch-callback-registered", {
      preDispatchCallbackRegistered,
      sourceStage: "onProviderRequestBeforeDispatch configuration",
    });
  }
  const originalPromptMessageTrace = diagnostics.hooks.onPromptMessageTrace;
  diagnostics.hooks.onPromptMessageTrace = (event) => {
    originalPromptMessageTrace?.(event);
    if (event.stage === "provider-onPayload-transform-enter") {
      providerCallPrepareObserved = true;
      recordPromptAwait("provider-call-prepare", {
        sourceStage: event.stage,
        providerCallStatus: "provider-payload-transform-entered",
      });
    } else if (event.stage === "provider-onPayload-transform-complete") {
      recordPromptAwait("provider-call-payload-prepared", {
        sourceStage: event.stage,
        providerCallStatus: "provider-payload-transform-completed",
      });
    }
    if (event.stage === "provider-onPayload-transform-start") {
      recordProviderCaptureStage("provider-payload-transform-start", {
        callbackIndex: event.callbackIndex ?? null,
      });
      recordProviderCaptureStage("payload-transform-start", {
        callbackIndex: event.callbackIndex ?? null,
        awaited: false,
        awaitTargetClass: null,
      });
    } else if (event.stage === "provider-onPayload-transform-complete") {
      recordProviderCaptureStage("provider-payload-transform-complete", {
        callbackIndex: event.callbackIndex ?? null,
      });
      recordProviderCaptureStage("payload-transform-complete", {
        callbackIndex: event.callbackIndex ?? null,
        awaited: false,
        awaitTargetClass: null,
      });
    }
    const journal = input.requestCapture?.preflightDiagnostics;
    if (journal) {
      if (event.stage === "prompt-context-built") {
        previousMaterializationBoundary = undefined;
        materializationRequestIndex = 0;
      } else if (event.stage === "provider-adapter-input") {
        materializationRequestIndex += 1;
        if (materializationRequestIndex > 1) {
          previousMaterializationBoundary = undefined;
        }
      }
      if (event.stage === "prompt-context-built") {
        promptSubmissionTraceIndex += 1;
        if (promptSubmissionTraceIndex > 1) {
          journal.record("prompt-reentry-start", {
            runOneAttemptId: runId,
            embeddedRunId,
            sessionIdSha256,
            promptSubmissionIndex: promptSubmissionTraceIndex,
            source: event.source,
          });
        }
      }
      if (event.stage === "provider-onPayload-transform-enter") {
        currentProviderPayloadTraceIndex = ++providerPayloadTraceIndex;
        journal.record("model-loop-iteration-start", {
          runOneAttemptId: runId,
          embeddedRunId,
          sessionIdSha256,
          promptSubmissionIndex: promptSubmissionTraceIndex,
          modelLoopIterationIndex: currentProviderPayloadTraceIndex,
          messageCount: event.messages.length,
          source: event.source,
        });
        if (currentProviderPayloadTraceIndex > 1) {
          journal.record("retry-reentry-start", {
            runOneAttemptId: runId,
            embeddedRunId,
            sessionIdSha256,
            promptSubmissionIndex: promptSubmissionTraceIndex,
            modelLoopIterationIndex: currentProviderPayloadTraceIndex,
            reentryKind: "next-provider-request-in-model-loop",
            retryDetected: null,
            retryReason: "not-established-by-this-trace",
            messageCount: event.messages.length,
            sourceStage: event.stage,
            source: event.source,
          });
          journal.record("next-request-build-start", {
            runOneAttemptId: runId,
            embeddedRunId,
            sessionIdSha256,
            promptSubmissionIndex: promptSubmissionTraceIndex,
            modelLoopIterationIndex: currentProviderPayloadTraceIndex,
            messageCount: event.messages.length,
            sourceStage: event.stage,
            source: event.source,
          });
        }
      }
      const callbackIndex =
        event.stage === "provider-onPayload-transform-enter" ||
        event.stage === "provider-onPayload-transform-start" ||
        event.stage === "provider-onPayload-transform-complete"
          ? currentProviderPayloadTraceIndex
          : (event.callbackIndex ?? promptSubmissionTraceIndex);
      const summary = summarizePromptMessageTrace(
        callbackIndex === undefined ? event : { ...event, callbackIndex },
        identifyPromptObject,
      );
      if (journal && V1J_PROMPT_MATERIALIZATION_STAGES.has(event.stage)) {
        const previousTrace = previousMaterializationBoundary?.trace;
        const differingPaths = previousTrace
          ? diffPromptMaterializationSnapshots(previousTrace, summary)
          : [];
        const materializationContent = (messages: readonly unknown[]) =>
          messages.map((message, index) => {
            const row =
              message && typeof message === "object" && !Array.isArray(message)
                ? (message as Record<string, unknown>)
                : {};
            const content = (() => {
              try {
                // Keep text bytes raw and canonically serialize structured content, matching the
                // summary's byte-count rule without retaining either side in the journal.
                return typeof row.content === "string"
                  ? row.content
                  : canonicalizeV1IValue(row.content);
              } catch {
                return null;
              }
            })();
            return {
              index,
              role: typeof row.role === "string" ? row.role : null,
              content,
            };
          });
        const outputContent = materializationContent(event.messages);
        const contentBoundary: V1JPromptMaterializationBoundary = {
          stage: event.stage as V1JPromptMaterializationBoundary["stage"],
          identity: {
            runOneAttemptId: runId,
            embeddedRunId,
            sessionIdSha256,
            promptSubmissionIndex: promptSubmissionTraceIndex,
            modelLoopIterationIndex: currentProviderPayloadTraceIndex || promptSubmissionTraceIndex,
          },
          messages: outputContent,
        };
        const deltaPairing = event.transition
          ? diffV1JPromptMaterializationTransition({
              transitionInstanceId: event.transition.instanceId,
              sourceBoundary: event.transition.sourceStage,
              destinationBoundary: event.stage,
              inputMessages: event.transition.inputMessages
                ? materializationContent(event.transition.inputMessages)
                : undefined,
              outputMessages: outputContent,
            })
          : diffV1JPromptMaterializationBoundaries(
              previousMaterializationBoundary?.content,
              contentBoundary,
            );
        const systemMessage = outputContent.find((message) => message.role === "system");
        journal.record("prompt-materialization-boundary", {
          materializationRequestIndex,
          previousStage: previousTrace?.stage ?? null,
          stage: event.stage,
          firstDivergentStage: previousTrace && differingPaths.length > 0 ? event.stage : null,
          differingPaths,
          source: summary.source,
          messageArrayIdentity: summary.messageArrayIdentity,
          systemPromptFingerprint: summary.systemPromptFingerprint ?? null,
          materializationFactors: summary.materializationFactors ?? null,
          messageCount: summary.messageCount,
          contentDeltaPairing: {
            ...deltaPairing,
            identity: contentBoundary.identity,
          },
          contentDeltas: deltaPairing.deltas,
          systemPromptSections: fingerprintV1JSystemPromptSections({
            providerSystemMessage: systemMessage?.content,
          }),
          systemPromptParagraphs: fingerprintV1JSystemPromptParagraphs(systemMessage?.content),
          messages: summary.messages.map(
            ({
              index,
              role,
              messageObjectIdentity,
              contentObjectIdentity,
              contentSha256,
              contentBytes,
            }) => ({
              index,
              role,
              messageObjectIdentity,
              contentObjectIdentity,
              contentSha256,
              contentBytes,
            }),
          ),
        });
        previousMaterializationBoundary = { trace: summary, content: contentBoundary };
      }
      const transcriptStages = new Set([
        "prompt-submit-enter",
        "prompt-history-normalized",
        "model-prompt-transform-enter",
        "prompt-active-session-settled",
        "prompt-agent-state-settled",
      ]);
      const isTranscriptSnapshot = transcriptStages.has(event.stage);
      const transcriptLengthBefore = previousTranscriptTrace?.messages.length ?? null;
      const traceDetails = {
        ...summary,
        runOneAttemptId: runId,
        embeddedRunId,
        sessionIdSha256,
        promptSubmissionIndex: promptSubmissionTraceIndex,
        modelLoopIterationIndex: currentProviderPayloadTraceIndex,
        precedingModelTurnIndex,
        payloadTransformInvocation: currentProviderPayloadTraceIndex || null,
        payloadTransformInputMessageCount:
          event.stage === "provider-onPayload-transform-enter" ||
          event.stage === "provider-onPayload-transform-start"
            ? summary.messageCount
            : null,
        payloadTransformOutputMessageCount:
          event.stage === "provider-onPayload-transform-complete" ? summary.messageCount : null,
        transcriptLengthBefore: isTranscriptSnapshot ? transcriptLengthBefore : null,
        transcriptLengthAfter: isTranscriptSnapshot ? summary.messageCount : null,
        transcriptLengthDelta:
          isTranscriptSnapshot && transcriptLengthBefore !== null
            ? summary.messageCount - transcriptLengthBefore
            : null,
      };
      journal.record(`arm-${journal.arm.toLowerCase()}-prompt-message-trace`, traceDetails);

      if (isTranscriptSnapshot) {
        if (previousTranscriptTrace) {
          const growth = captureV1JTranscriptGrowth({
            previous: {
              stage: event.stage,
              source: event.source,
              messageArrayIdentity: previousTranscriptTrace.messageArrayIdentity,
              messageCount: previousTranscriptTrace.messages.length,
              messages: previousTranscriptTrace.messages,
            },
            current: summary,
            runOneAttemptId: runId,
            embeddedRunId,
            sessionIdSha256,
            promptSubmissionIndex: promptSubmissionTraceIndex,
            modelLoopIterationIndex: currentProviderPayloadTraceIndex,
            precedingModelTurnIndex,
          });
          if (growth) {
            preCaptureTranscriptGrowth.push(growth);
            journal.record(`arm-${journal.arm.toLowerCase()}-transcript-growth-observed`, growth);
            journal.record("transcript-mutation-observed", growth);
            for (const message of growth.appendedMessages) {
              const legacyAppendEvent =
                message.role === "user"
                  ? "user-message-append-observed"
                  : message.role === "assistant"
                    ? "assistant-message-append-observed"
                    : message.role === "toolResult"
                      ? "tool-result-append-observed"
                      : undefined;
              if (legacyAppendEvent) {
                journal.record(`arm-${journal.arm.toLowerCase()}-${legacyAppendEvent}`, {
                  ...growth,
                  message,
                });
              }
              journal.record(message.mutationType, {
                ...growth,
                mutationType: message.mutationType,
                appendedRole: message.appendedRole,
                appendedContentSha256: message.contentSha256,
                appendedContentBytes: message.contentBytes,
                message,
              });
            }
          }
        }
        previousTranscriptTrace = {
          messageArrayIdentity: summary.messageArrayIdentity,
          messages: summary.messages,
        };
      }
    }
  };
  const postResponseLiveness: PostResponseLiveness | undefined = input.postResponseDiagnostics
    ? createPostResponseLiveness({
        onHeartbeat: (heartbeat) => {
          emitPostResponseHeartbeat(heartbeat);
          diagnostics.hooks.onPostResponseHeartbeat?.(heartbeat);
        },
      })
    : undefined;
  const semanticToolCalls: CorrelationToolCall[] = [];
  let authorizedToolSchemas: readonly V1JAuthorizedToolSchema[] = [];
  const rawExecutionRecords: CorrelationExecution[] = [];
  const diagnosticsCheckpoint = diagnostics.hooks.onCheckpoint;
  const diagnosticsPreparationError = diagnostics.hooks.onRequestPreparationError;
  diagnostics.hooks.onRequestPreparationError = (event) => {
    recordPromptAwait("request-preparation-error", {
      sourceStage: event.stage,
      assistantErrorClass: event.error instanceof Error ? event.error.name : "NonErrorThrown",
    });
    diagnosticsPreparationError?.(event);
  };
  diagnostics.hooks.onCheckpoint = (checkpoint) => {
    diagnosticsCheckpoint?.(checkpoint);
    if (checkpoint.stage === "provider-adapter-entered") {
      providerSelectionCompleted = true;
      recordPromptAwait("provider-selection-complete", {
        provider: runProvider,
        model: runModel,
        providerSelectionSource: checkpoint.stage,
        sourceStage: checkpoint.stage,
      });
    } else if (checkpoint.stage === "model-loop-entered") {
      recordPromptAwait("model-loop-entered", {
        sourceStage: checkpoint.stage,
      });
      recordPromptAwait("model-loop-iteration-start", {
        sourceStage: checkpoint.stage,
      });
    } else if (checkpoint.stage === "model-loop-completed") {
      recordPromptAwait("model-loop-iteration-end", {
        sourceStage: checkpoint.stage,
        elapsedMs: diagnostics.checkpoints.at(-1)?.elapsedMs,
      });
      recordPromptAwait("prompt-call-returned", {
        sourceStage: checkpoint.stage,
        promptCallOutcome: "returned",
      });
    }
    const recordedCheckpoint = diagnostics.checkpoints.at(-1);
    input.attemptCheckpointJournal?.record(
      checkpoint.stage,
      recordedCheckpoint?.elapsedMs === undefined
        ? undefined
        : { elapsedMs: recordedCheckpoint.elapsedMs },
    );
    input.onCheckpoint?.(checkpoint);
    if (input.requestCapture?.liveness) {
      recordV1JRuntimeCheckpoint(input.requestCapture.liveness, checkpoint.stage);
    }
  };
  if (input.modelLoopDiagnostics) {
    diagnostics.hooks.onModelLoopHeartbeat = (heartbeat) => {
      input.attemptCheckpointJournal?.record("model-loop-heartbeat", {
        elapsedMs: heartbeat.elapsedMs,
        expectedElapsedMs: heartbeat.expectedIntervalMs,
        eventLoopDelayMs: heartbeat.eventLoopDelayMs,
        eventLoopDelayDetected: heartbeat.eventLoopDelayMs > 0,
        lastSuccessfulCheckpoint: "active-session-prompt",
      });
      input.modelLoopDiagnostics?.onHeartbeat(heartbeat);
    };
  }
  const originalModelLoopSubstage = diagnostics.hooks.onModelLoopSubstage;
  diagnostics.hooks.onModelLoopSubstage = (event) => {
    const awaitStage =
      event.stage === "active-session-prompt-entered"
        ? "model-loop-await-start"
        : event.stage === "active-session-prompt-completed"
          ? "model-loop-await-end"
          : undefined;
    if (awaitStage) {
      recordPromptAwait(
        event.stage === "active-session-prompt-entered"
          ? "prompt-call-start"
          : "prompt-call-settled",
        {
          elapsedMs: event.elapsedMs,
          settlementKind: "prompt wrapper finally",
          promptCallOutcome: timeoutFired
            ? "attempt-timeout-fired"
            : abortObserved
              ? "abort-observed"
              : "settled-outcome-unavailable",
          sourceStage: event.stage,
          configuredAttemptTimeoutMs,
          timeoutFired,
          abortRequested,
          abortObserved,
          abortSignalAborted: input.abortSignal?.aborted === true,
          providerRequestHookInvocations:
            preflightDiagnostics?.counters().providerRequestHookInvocations ?? 0,
          requestObserverInvocations:
            preflightDiagnostics?.counters().requestObserverInvocations ?? 0,
          fetchWrapperInvocations: preflightDiagnostics?.counters().fetchWrapperInvocations ?? 0,
          providerDispatchAttempts: preflightDiagnostics?.counters().providerDispatchAttempts ?? 0,
        },
      );
      input.requestCapture?.preflightDiagnostics?.record(awaitStage, {
        runOneAttemptId: runId,
        embeddedRunId,
        sessionIdSha256,
        promptSubmissionIndex: promptSubmissionTraceIndex,
        modelLoopIterationIndex: currentProviderPayloadTraceIndex,
        activeSessionPromptStage: event.stage,
        elapsedMs: event.elapsedMs,
        awaited: true,
        awaitTargetClass: "AgentSession.prompt",
      });
    }
    if (input.modelLoopDiagnostics) {
      input.attemptCheckpointJournal?.record(`model-loop:${event.stage}`, {
        elapsedMs: event.elapsedMs,
        lastSuccessfulCheckpoint: event.stage,
      });
      input.modelLoopDiagnostics.onSubstage(event);
    }
    originalModelLoopSubstage?.(event);
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
    input.requestCapture?.liveness?.record("prepared-runtime-heartbeat", {
      eventLoopDelayMs: heartbeat.eventLoopDelayMs,
    });
  };
  const diagnosticsPluginDiscoveryInputs = diagnostics.hooks.onPreparedRuntimePluginDiscoveryInputs;
  diagnostics.hooks.onPreparedRuntimePluginDiscoveryInputs = (inputs) => {
    diagnosticsPluginDiscoveryInputs?.(inputs);
    input.onPluginPrepDiscoveryInputs?.(inputs);
    input.requestCapture?.liveness?.record("plugin-discovery-start", {
      selectedRuntimes: inputs.enabledPluginIds,
    });
  };
  const diagnosticsPluginTiming = diagnostics.hooks.onPreparedRuntimePluginTiming;
  diagnostics.hooks.onPreparedRuntimePluginTiming = (timing) => {
    diagnosticsPluginTiming?.(timing);
    input.onPluginPrepTiming?.(timing);
  };
  const diagnosticsPluginRegistryTrace = diagnostics.hooks.onPreparedRuntimePluginRegistryTrace;
  diagnostics.hooks.onPreparedRuntimePluginRegistryTrace = (event) => {
    input.attemptCheckpointJournal?.record(`runtime-registry:${event.stage}`, {
      registryTrace: event,
      lastSuccessfulCheckpoint: `runtime-registry:${event.stage}`,
    });
    diagnosticsPluginRegistryTrace?.(event);
    input.onPluginPrepRegistryTrace?.(event);
    recordV1JRuntimeCheckpoint(input.requestCapture?.liveness, event.stage, event.pluginId);
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
    recordPromptAwait("attempt-timeout-armed", {
      configuredAttemptTimeoutMs,
    });
    input.attemptCheckpointJournal?.record("timeout-armed");
    input.requestCapture?.lifecycleJournal?.record("timeout-armed", { timeoutState: "armed" });
  };
  diagnostics.hooks.onTimeoutFired = () => {
    timeoutFired = true;
    recordPromptAwait("attempt-timeout-fired", {
      configuredAttemptTimeoutMs,
      timeoutSource: "embedded-attempt-run-budget",
    });
    input.attemptCheckpointJournal?.record("timeout-fired");
    input.requestCapture?.lifecycleJournal?.record("timeout-fired", {
      timeoutState: "timed-out",
    });
  };
  diagnostics.hooks.onAbortRequested = () => {
    abortRequested = true;
    recordPromptAwait("abort-requested", {
      timeoutSource: timeoutFired ? "embedded-attempt-run-budget" : "unknown-abort-owner",
    });
    input.attemptCheckpointJournal?.record("abort-requested");
    input.requestCapture?.lifecycleJournal?.record("abort-requested", { abortState: true });
  };
  diagnostics.hooks.onAbortObserved = () => {
    abortObserved = true;
    recordPromptAwait("abort-observed", {
      timeoutSource: timeoutFired ? "embedded-attempt-run-budget" : "unknown-abort-owner",
    });
    input.attemptCheckpointJournal?.record("abort-observed");
    input.requestCapture?.lifecycleJournal?.record("abort-observed", { abortState: true });
  };
  diagnostics.hooks.onCheckpoint?.({
    stage: "synthetic-constructed",
    toolCount: harness?.clientTools.length ?? input.authorizedNames.length,
    representativeToolNames: (harness?.clientTools ?? input.authorizedNames)
      .slice(0, 8)
      .map((tool) => (typeof tool === "string" ? tool : tool.function.name)),
  });
  const capture = captureModelPayloads(
    diagnostics.hooks,
    input.requestCapture
      ? {
          ...input.requestCapture,
          onProviderInvocation: ({ count, requestIndex, dispatchOrdinal, requestUrlSha256 }) => {
            providerInvocationCount = count;
            input.requestCapture?.preflightDiagnostics?.record("provider-invoke-enter", {
              providerInvocationCount: count,
              requestIndex,
              dispatchOrdinal,
              requestUrlSha256,
              callSite: "runOne.captureModelPayloads.baseFetch",
            });
            input.requestCapture?.lifecycleJournal?.record("network-request-start", {
              requestId: `${input.requestCapture?.requestCorrelationId ?? runId}:${requestIndex}`,
              requestIndex,
              providerInvocationCount: count,
              dispatchOrdinal,
            });
          },
          onProviderCaptureStage: (event) =>
            recordProviderCaptureStage(event.event, event.details, event.elapsedMs),
        }
      : undefined,
  );
  let schemaSinkInvocationIndex = 0;
  const originalAiTransportHost = getAiTransportHost();
  configureAiTransportHost({
    ...originalAiTransportHost,
    buildModelFetch: (model, timeoutMs, options) => {
      const baseFetch = originalAiTransportHost.buildModelFetch(model, timeoutMs, options);
      return capture.wrapFetch(baseFetch ?? capture.originalFetch);
    },
  });
  const diagnosticsProviderRequest = diagnostics.hooks.onProviderRequest;
  let requestObserverInvocationIndex = 0;
  diagnostics.hooks.onProviderRequest = async ({ payload, model }) => {
    const callbackIndex = ++requestObserverInvocationIndex;
    const callbackStartedAt = performance.now();
    const callbackJournal = input.requestCapture?.preflightDiagnostics;
    const nestedObserverReentry = activeRequestObserverCount > 0;
    activeRequestObserverCount += 1;
    if (callbackIndex === 2) {
      callbackJournal?.record("observer-enter-2", {
        runOneAttemptId: runId,
        embeddedRunId,
        sessionIdSha256,
        promptSubmissionIndex: promptSubmissionTraceIndex,
        modelLoopIterationIndex: currentProviderPayloadTraceIndex,
      });
    }
    callbackJournal?.increment(
      "providerRequestHookInvocations",
      `arm-${callbackJournal.arm.toLowerCase()}-provider-request-hook-enter`,
      {
        invocationIndex: callbackJournal.counters().providerRequestHookInvocations + 1,
        providerRequestPhase: "request-hook-enter",
        callSite: "runOne.diagnostics.hooks.onProviderRequest",
      },
    );
    const body =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const request = { body, url: "provider-adapter" };
    const requestMessages = Array.isArray(body.messages) ? body.messages : [];
    recordPromptAwait("request-observer-enter", {
      messageCount: requestMessages.length,
      providerRequestHookInvocations:
        callbackJournal?.counters().providerRequestHookInvocations ?? 0,
      requestObserverInvocations: callbackIndex,
      sourceStage: "runOne.diagnostics.hooks.onProviderRequest",
    });
    recordProviderCaptureStage("request-observer-enter", {
      messageCount: requestMessages.length,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    });
    const callbackEntry = summarizePromptMessageTrace(
      {
        stage: "request-observer-enter",
        messages: requestMessages,
        source: "runOne.diagnostics.hooks.onProviderRequest input",
        promptAssemblySource: "provider request payload before observer callback",
        callbackIndex,
      },
      identifyPromptObject,
    );
    const observerTrace: V1JPreCaptureObserverTrace = {
      invocationIndex: callbackIndex,
      runOneAttemptId: runId,
      embeddedRunId,
      sessionIdSha256,
      promptSubmissionIndex: promptSubmissionTraceIndex,
      modelLoopIterationIndex: currentProviderPayloadTraceIndex,
      precedingModelTurnIndex,
      messageArrayIdentity: callbackEntry.messageArrayIdentity,
      messageCount: callbackEntry.messageCount,
      messageFingerprint: hashV1ICanonical(
        callbackEntry.messages.map(({ role, contentSha256, contentBytes }) => ({
          role,
          contentSha256,
          contentBytes,
        })),
      ),
      nestedObserverReentry,
    };
    preCaptureObserverTraces.push(observerTrace);
    callbackJournal?.record(`arm-${callbackJournal.arm.toLowerCase()}-prompt-message-trace`, {
      ...callbackEntry,
      ...observerTrace,
      tracePhase: "request-observer-entry-snapshot",
      payloadTransformInvocation: currentProviderPayloadTraceIndex,
      payloadTransformInputMessageCount: callbackEntry.messageCount,
      transcriptLengthBefore: previousTranscriptTrace?.messages.length ?? null,
      transcriptLengthAfter: previousTranscriptTrace?.messages.length ?? null,
    });
    input.requestCapture?.liveness?.record("provider-tool-projection-complete");
    if (input.requestCapture?.schemaCaptureName) {
      callbackJournal?.increment(
        "schemaCaptureStarts",
        `arm-${input.arm.toLowerCase()}-schema-capture-start`,
        {
          captureName: input.requestCapture.schemaCaptureName,
          invocationIndex: schemaSinkInvocationIndex + 1,
        },
      );
      const preSink = prepareV1JPreSinkCapture({
        captureName: input.requestCapture.schemaCaptureName,
        captureArm: input.requestCapture.schemaCaptureArm,
        caseId: input.benchmarkCase.id,
        replicate: input.replicate,
        surfaceMode: input.requestCapture.surfaceMode,
        benchmarkCandidateNames: input.requestCapture.benchmarkCandidateNames,
        getImageFactoryObservation: input.requestCapture.getImageFactoryObservation,
        harnessCommit: HARNESS_COMMIT,
        headCommit: input.requestCapture.headCommit ?? HARNESS_COMMIT,
        invocationIndex: ++schemaSinkInvocationIndex,
        liveness: input.requestCapture.liveness,
      });
      persistV1JSchemaCapture({
        name: preSink.name,
        arm: preSink.arm,
        authorizedTools: authorizedToolSchemas,
        providerTools: body.tools,
        model: runModel,
        surfaceMode: preSink.surfaceMode,
        benchmarkCandidateNames: preSink.benchmarkCandidateNames,
        harnessCommit: input.requestCapture.headCommit ?? HARNESS_COMMIT,
        ...(preSink.imageFactory ? { imageFactory: preSink.imageFactory } : {}),
        invocation: preSink.invocation,
        recordCheckpoint: (checkpoint, metadata) =>
          input.requestCapture?.liveness?.record(checkpoint, metadata),
      });
      input.requestCapture.liveness?.record("schema-sink-complete", preSink.sinkMetadata);
      callbackJournal?.increment(
        "schemaCaptureCompletes",
        `arm-${input.arm.toLowerCase()}-schema-capture-complete`,
        {
          captureName: input.requestCapture.schemaCaptureName,
          invocationIndex: schemaSinkInvocationIndex,
        },
      );
    }
    const stopAtProviderBoundPayload = input.requestCapture?.stopAfterProviderBoundCapture === true;
    if (!stopAtProviderBoundPayload) {
      capture.recordProviderRequest(request);
    }
    callbackJournal?.increment(
      "requestObserverInvocations",
      `arm-${callbackJournal.arm.toLowerCase()}-request-observer-enter`,
      {
        invocationIndex: callbackIndex,
        providerRequestPhase: "request-observer-enter",
        callSite: "runOne.diagnostics.hooks.onProviderRequest",
      },
    );
    if (!stopAtProviderBoundPayload) {
      input.requestCapture?.onRequestCaptured?.(request);
    }
    callbackJournal?.record(`arm-${callbackJournal.arm.toLowerCase()}-request-observer-exit`, {
      callSite: "runOne.diagnostics.hooks.onProviderRequest",
      invocationIndex: callbackIndex,
    });
    const toolNames = toolNamesFromBody(body);
    diagnostics.hooks.onCheckpoint?.({
      stage: "provider-request-constructed",
      toolCount: toolNames.length,
      representativeToolNames: toolNames,
    });
    const observerStartedAt = performance.now();
    const observerEnteredAt = new Date().toISOString();
    const observerAwaitTargetClass = diagnosticsProviderRequest?.constructor.name ?? null;
    let observerOutcome: "completed" | "failed" = "completed";
    recordProviderCaptureStage("request-observer-await-start", {
      callbackIndex,
      messageCount: requestMessages.length,
      toolCount: toolNames.length,
      awaited: diagnosticsProviderRequest !== undefined,
      awaitTargetClass: observerAwaitTargetClass,
      enteredAt: observerEnteredAt,
    });
    try {
      await diagnosticsProviderRequest?.({ payload, model });
      recordProviderCaptureStage(
        "request-observer-await-complete",
        {
          callbackIndex,
          awaited: diagnosticsProviderRequest !== undefined,
          awaitTargetClass: observerAwaitTargetClass,
          enteredAt: observerEnteredAt,
          completedAt: new Date().toISOString(),
        },
        performance.now() - observerStartedAt,
      );
    } catch (error) {
      observerOutcome = "failed";
      recordProviderCaptureStage(
        "request-observer-await-failed",
        {
          callbackIndex,
          errorName: error instanceof Error ? error.name : "NonErrorThrown",
          awaited: diagnosticsProviderRequest !== undefined,
          awaitTargetClass: observerAwaitTargetClass,
          enteredAt: observerEnteredAt,
          completedAt: new Date().toISOString(),
        },
        performance.now() - observerStartedAt,
      );
      throw error;
    } finally {
      const callbackExit = summarizePromptMessageTrace(
        {
          stage: "request-observer-exit",
          messages: Array.isArray(body.messages) ? body.messages : [],
          source: "runOne.diagnostics.hooks.onProviderRequest after observer callback",
          promptAssemblySource: "provider request payload before provider onPayload transforms",
          callbackIndex,
        },
        identifyPromptObject,
      );
      callbackJournal?.record(`arm-${callbackJournal.arm.toLowerCase()}-prompt-message-trace`, {
        ...callbackExit,
        callbackEntry,
        ...observerTrace,
        tracePhase: "request-observer-exit-snapshot",
        payloadTransformInvocation: currentProviderPayloadTraceIndex,
        payloadTransformOutputMessageCount: callbackExit.messageCount,
        transcriptLengthBefore: previousTranscriptTrace?.messages.length ?? null,
        transcriptLengthAfter: previousTranscriptTrace?.messages.length ?? null,
        arrayOrMessageStateChangedDuringObserver: !samePromptMessageState(
          callbackEntry,
          callbackExit,
        ),
      });
      activeRequestObserverCount = Math.max(0, activeRequestObserverCount - 1);
      callbackJournal?.record(
        `arm-${callbackJournal.arm.toLowerCase()}-pre-capture-reentry-classification`,
        {
          classification: classifyV1JPreCaptureReentry({
            observers: preCaptureObserverTraces,
            transcriptGrowth: preCaptureTranscriptGrowth,
          }),
          observerCount: preCaptureObserverTraces.length,
          nestedObserverReentry,
          retryDetected: null,
          reentryDetected: preCaptureObserverTraces.length > 1,
          sameRunReentry:
            preCaptureObserverTraces.length > 1 &&
            preCaptureObserverTraces.every(
              (observer) =>
                observer.runOneAttemptId === runId &&
                observer.embeddedRunId === embeddedRunId &&
                observer.sessionIdSha256 === sessionIdSha256,
            ),
          runOneAttemptId: runId,
          embeddedRunId,
          sessionIdSha256,
        },
      );
      callbackJournal?.record(
        `arm-${callbackJournal.arm.toLowerCase()}-provider-request-hook-exit`,
        { callSite: "runOne.diagnostics.hooks.onProviderRequest" },
      );
      callbackJournal?.record(`observer-return-${callbackIndex}`, {
        runOneAttemptId: runId,
        embeddedRunId,
        sessionIdSha256,
        invocationIndex: callbackIndex,
        promptSubmissionIndex: promptSubmissionTraceIndex,
        modelLoopIterationIndex: currentProviderPayloadTraceIndex,
        messageCount: callbackExit.messageCount,
        outcome: observerOutcome,
        elapsedMs: Math.max(0, Math.round(performance.now() - callbackStartedAt)),
      });
      recordPromptAwait("request-observer-return", {
        elapsedMs: Math.max(0, Math.round(performance.now() - callbackStartedAt)),
        messageCount: callbackExit.messageCount,
        requestObserverInvocations: callbackIndex,
        sourceStage: "runOne.diagnostics.hooks.onProviderRequest finally",
      });
    }
    if (input.requestCapture?.stopAfterCapture) {
      callbackJournal?.increment(
        "preflightStopSignalRaised",
        `arm-${callbackJournal?.arm.toLowerCase() ?? input.arm.toLowerCase()}-stop-before-dispatch-signal`,
        {
          invocationIndex: capture.requests.length,
          providerRequestPhase: "stop-before-dispatch",
          callSite: "runOne.diagnostics.hooks.onProviderRequest",
          signalName: V1IProviderRequestCapturedError.name,
        },
      );
      input.requestCapture.liveness?.record("provider-dispatch-guard-reached", {
        providerDispatchAttempts: capture.providerDispatchAttempts,
      });
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
  const diagnosticsProviderRequestBeforeDispatch =
    diagnostics.hooks.onProviderRequestBeforeDispatch;
  diagnostics.hooks.onProviderRequestBeforeDispatch = async ({ payload, model }) => {
    await diagnosticsProviderRequestBeforeDispatch?.({ payload, model });
    if (input.requestCapture?.stopAfterProviderBoundCapture !== true) {
      return;
    }

    const callbackIndex = ++providerBoundCaptureInvocationIndex;
    const journal = input.requestCapture.preflightDiagnostics;
    const rawBody = JSON.stringify(payload);
    if (typeof rawBody !== "string" || !payload || typeof payload !== "object") {
      throw new TypeError("v1J provider-bound payload is not serializable");
    }
    const rawBodyBytes = Buffer.from(rawBody, "utf8");
    const rawBodySha256 = createHash("sha256").update(rawBodyBytes).digest("hex");
    journal?.record("provider-bound-request-captured", {
      invocationIndex: callbackIndex,
      requestJsonBytes: rawBodyBytes.byteLength,
      rawBodySha256,
      providerInvocationCount,
    });
    const finalRequest: CapturedModelRequest = {
      body: payload as Record<string, unknown>,
      url: "provider-adapter",
    };
    capture.recordProviderRequest(finalRequest);
    input.requestCapture.onRequestCaptured?.(finalRequest);
    preDispatchCallbackInvoked = true;
    await input.requestCapture.onProviderRequestBeforeDispatch?.({
      request: finalRequest,
      rawBody,
      requestIndex: callbackIndex,
      dispatchOrdinal: providerInvocationCount + 1,
    });
    preflightStopSignalRaised = true;
    input.requestCapture.onPreflightStopRaised?.();
    journal?.increment("preflightStopSignalRaised", "preflight-stop-signal-raised", {
      callSite: "runOne.diagnostics.hooks.onProviderRequestBeforeDispatch",
      signalName: V1IProviderRequestCapturedError.name,
      providerInvocationCount,
    });
    throw new V1IProviderRequestCapturedError();
  };
  const diagnosticsProviderResponse = diagnostics.hooks.onProviderResponse;
  let adapterResponseIndex = 0;
  diagnostics.hooks.onProviderResponse = async ({ response, model }) => {
    const requestIndex = ++adapterResponseIndex;
    const captureOnly =
      input.requestCapture?.stopAfterCapture === true ||
      input.requestCapture?.stopAfterProviderBoundCapture === true;
    if (captureOnly) {
      const classification =
        providerInvocationCount === 0
          ? "UNACCOUNTED_MODEL_RESULT_SOURCE"
          : "PROVIDER_RESPONSE_AFTER_CAPTURE_STOP";
      input.requestCapture?.preflightDiagnostics?.record("unexpected-provider-response", {
        resultStage: "provider-response-observed",
        providerInvocationCount,
        classification,
      });
      throw new V1JUnexpectedPreflightModelResultError(classification);
    }
    input.requestCapture?.lifecycleJournal?.record("adapter-parse-start", {
      requestIndex,
      outcome: "entered",
    });
    diagnostics.hooks.onCheckpoint?.({
      stage: "provider-response-received",
      toolCount: input.authorizedNames.length,
      representativeToolNames: input.authorizedNames.slice(0, 8),
    });
    diagnostics.hooks.onPostResponseCheckpoint?.({
      stage: "provider-response-normalization-entered",
    });
    postResponseLiveness?.arm();
    if (input.requestCapture?.lifecycleJournal) {
      await observeV1JAdapterResponse({
        journal: input.requestCapture.lifecycleJournal,
        requestIndex,
        observe: async () => diagnosticsProviderResponse?.({ response, model }),
      });
    } else {
      await diagnosticsProviderResponse?.({ response, model });
    }
  };
  const restoreAssistantMessageObserver = installAssistantMessageObserver(
    diagnostics.hooks,
    (message, modelTurnIndex) => {
      const assistantJournal = input.requestCapture?.preflightDiagnostics;
      const normalizedToolCallCount = message.content.filter(
        (block) => block.type === "toolCall",
      ).length;
      const assistantSummary = summarizeV1JTraceContent(message.content);
      assistantFinalReason = message.stopReason;
      assistantContentSha256 = assistantSummary.contentSha256;
      assistantContentBytes = assistantSummary.contentBytes;
      assistantToolCallCount = normalizedToolCallCount;
      assistantJournal?.record("assistant-turn-created", {
        runOneAttemptId: runId,
        embeddedRunId,
        sessionIdSha256,
        promptSubmissionIndex: promptSubmissionTraceIndex,
        modelLoopIterationIndex: currentProviderPayloadTraceIndex,
        modelTurnIndex,
        sourceStage: "normalized-assistant-message-observer-enter",
        role: message.role,
        ...assistantSummary,
        toolCallCount: normalizedToolCallCount,
        stopReason: message.stopReason,
        errorClass: message.errorType ?? null,
        errorCode: message.errorCode ?? null,
      });
      recordPromptAwait("assistant-turn-created", {
        assistantContentSha256: assistantSummary.contentSha256,
        assistantContentBytes: assistantSummary.contentBytes,
        assistantToolCallCount: normalizedToolCallCount,
        assistantFinalReason: message.stopReason,
        assistantErrorClass: message.errorType ?? null,
        assistantErrorCode: message.errorCode ?? null,
        sourceStage: "normalized-assistant-message-observer-enter",
      });
      if (normalizedToolCallCount > 0) {
        const toolCalls = message.content.filter((block) => block.type === "toolCall");
        assistantJournal?.record("tool-call-produced", {
          runOneAttemptId: runId,
          embeddedRunId,
          sessionIdSha256,
          promptSubmissionIndex: promptSubmissionTraceIndex,
          modelLoopIterationIndex: currentProviderPayloadTraceIndex,
          modelTurnIndex,
          sourceStage: "normalized-assistant-message-tool-call-extraction",
          toolCallCount: normalizedToolCallCount,
          ...summarizeV1JTraceContent(toolCalls),
        });
      }
      input.requestCapture?.lifecycleJournal?.record("adapter-response-parsed", {
        requestIndex: modelTurnIndex + 1,
        toolCallCount: normalizedToolCallCount,
        outcome: "parsed",
      });
      input.requestCapture?.lifecycleJournal?.record("adapter-parse-complete", {
        requestIndex: modelTurnIndex + 1,
        toolCallCount: normalizedToolCallCount,
        outcome: "parsed",
      });
      input.requestCapture?.lifecycleJournal?.record("tool-call-parse", {
        requestIndex: modelTurnIndex + 1,
        toolCallCount: normalizedToolCallCount,
        outcome: "normalized",
      });
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
      precedingModelTurnIndex = modelTurnIndex;
      try {
        const preflightResult = guardV1JPreflightAssistantResult({
          message,
          modelTurnIndex,
          providerInvocationCount,
          stopSignalRaised: preflightStopSignalRaised,
          journal: assistantJournal,
          captureOnly:
            input.requestCapture?.stopAfterCapture === true ||
            input.requestCapture?.stopAfterProviderBoundCapture === true,
        });
        if (preflightResult) {
          return;
        }
        input.requestCapture?.onAssistantMessage?.(message, modelTurnIndex);
      } finally {
        assistantJournal?.record("assistant-turn-finalized", {
          runOneAttemptId: runId,
          embeddedRunId,
          sessionIdSha256,
          promptSubmissionIndex: promptSubmissionTraceIndex,
          modelLoopIterationIndex: currentProviderPayloadTraceIndex,
          modelTurnIndex,
          sourceStage: "request-capture-assistant-message-callback-complete",
          ...assistantSummary,
          toolCallCount: normalizedToolCallCount,
          stopReason: message.stopReason,
          errorClass: message.errorType ?? null,
          errorCode: message.errorCode ?? null,
        });
        recordPromptAwait("assistant-turn-finalized", {
          assistantContentSha256: assistantSummary.contentSha256,
          assistantContentBytes: assistantSummary.contentBytes,
          assistantToolCallCount: normalizedToolCallCount,
          assistantFinalReason: message.stopReason,
          assistantErrorClass: message.errorType ?? null,
          assistantErrorCode: message.errorCode ?? null,
          sourceStage: "request-capture-assistant-message-callback-complete",
        });
      }
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
      embeddedRunId = typeof params.runId === "string" ? params.runId : null;
      sessionIdSha256 = typeof params.sessionId === "string" ? sha256V1J(params.sessionId) : null;
      input.requestCapture?.preflightDiagnostics?.record("embedded-run-enter", {
        runOneAttemptId: runId,
        embeddedRunId,
        sessionIdSha256,
        caseId: input.benchmarkCase.id,
        arm: input.arm,
        replicate: input.replicate,
        attempt: input.attempt,
      });
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
          ...(input.requestCapture?.capturePromptInstruction
            ? { extraSystemPrompt: input.requestCapture.capturePromptInstruction }
            : input.arm === "B"
              ? { extraSystemPrompt: ARM_B_INSTRUCTION }
              : {}),
          capabilityIntelligenceExperiment: {
            ...diagnostics.hooks,
            onImageToolPreparationDiagnostic: (event) => {
              const checkpoint =
                event.stage === "factory"
                  ? "image-tool-factory"
                  : event.stage === "pre-authorization"
                    ? "image-tool-pre-authorization"
                    : "image-tool-post-authorization";
              const metadata =
                event.stage === "factory"
                  ? {
                      imageFactoryCalled: event.imageFactoryCalled,
                      imageFactoryReturnedTool: event.imageFactoryReturnedTool,
                      ...(event.imageFactoryToolName
                        ? { imageFactoryToolName: event.imageFactoryToolName }
                        : {}),
                    }
                  : {
                      viewImagePresent: event.viewImagePresent,
                      imagePresent: event.imagePresent,
                    };
              input.requestCapture?.liveness?.record(checkpoint, metadata);
              if (event.stage === "factory") {
                input.requestCapture?.onImageFactoryResult?.({
                  eligible: event.imageFactoryCalled,
                  constructed: event.imageFactoryReturnedTool,
                });
              }
              diagnostics.hooks.onImageToolPreparationDiagnostic?.(event);
            },
            onAuthorizedToolsPrepared: (tools) => {
              authorizedToolSchemas = tools;
              input.requestCapture?.onAuthorizedToolsCaptured?.(tools);
              diagnostics.hooks.onAuthorizedToolsPrepared?.(tools);
            },
          },
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
            input.requestCapture?.preflightDiagnostics?.record("tool-result-produced", {
              runOneAttemptId: runId,
              embeddedRunId,
              sessionIdSha256,
              promptSubmissionIndex: promptSubmissionTraceIndex,
              modelLoopIterationIndex: currentProviderPayloadTraceIndex,
              isError: event.isError,
              ...summarizeV1JTraceContent(event.result),
              sourceStage: "runOne.runner.onAgentToolResult",
            });
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
      const requestFailure = diagnostics.readFailure();
      input.requestCapture?.lifecycleJournal?.record("model-loop-complete", {
        modelLoopStatus: execution.status,
        outcome: execution.status,
        ...(requestFailure
          ? {
              adapterErrorClass: requestFailure.errorName,
              failureStage: requestFailure.failureStage,
              timeoutState:
                requestFailure.errorName === "TimeoutError" ? "timed-out" : "not-reported",
            }
          : {}),
      });
      input.requestCapture?.lifecycleJournal?.record("model-loop-return", {
        modelLoopStatus: execution.status,
        outcome: execution.status,
      });
    }
  } catch (error) {
    input.requestCapture?.lifecycleJournal?.record("model-loop-complete", {
      modelLoopStatus: "error",
      outcome: "rejected",
      ...safeDiagnosticError(error),
      abortState: input.abortSignal?.aborted === true,
      abortReasonClass:
        input.abortSignal?.aborted && input.abortSignal.reason instanceof Error
          ? input.abortSignal.reason.name
          : undefined,
      timeoutState:
        error instanceof Error && error.name === "TimeoutError"
          ? "timed-out"
          : input.abortSignal?.aborted
            ? "aborted"
            : "not-reported",
    });
    input.requestCapture?.lifecycleJournal?.record("model-loop-return", {
      modelLoopStatus: "error",
      outcome: "rejected",
      ...safeDiagnosticError(error),
    });
    throw error;
  } finally {
    postResponseLiveness?.complete();
    restoreAssistantMessageObserver?.();
    configureAiTransportHost(originalAiTransportHost);
    capture.restore();
  }
  const postResponseTimeout = postResponseLiveness?.readTimeout();
  if (postResponseTimeout) {
    input.requestCapture?.lifecycleJournal?.record("model-loop-complete", {
      modelLoopStatus: "timeout",
      outcome: "rejected",
      ...safeDiagnosticError(postResponseTimeout),
      timeoutState: "timed-out",
    });
    input.requestCapture?.lifecycleJournal?.record("model-loop-return", {
      modelLoopStatus: "timeout",
      outcome: "rejected",
      ...safeDiagnosticError(postResponseTimeout),
      timeoutState: "timed-out",
    });
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
  const preferredMapping = preferredBenchmarkTool
    ? getBenchmarkRealToolMapping(preferredBenchmarkTool)
    : undefined;
  const mappedRealTool =
    input.preferredToolOverride !== undefined
      ? input.preferredToolOverride
      : input.mode === "synthetic"
        ? preferredBenchmarkTool || null
        : (preferredMapping?.realTool ?? null);
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
  if (preflightDiagnostics) {
    const counters = preflightDiagnostics.counters();
    const providerCallStatus = providerCallPrepareObserved
      ? "provider-payload-transform-observed"
      : "provider-call-not-observed";
    const providerCallSkipReason = providerCallPrepareObserved
      ? null
      : "No provider-payload callback was observed; skip reason is not exposed by the current runner hook.";
    if (!providerCallPrepareObserved) {
      recordPromptAwait("provider-call-skipped-or-unobserved", {
        providerCallSkipReason,
        providerCallStatus,
        providerSelectionSource: providerSelectionCompleted
          ? "provider-adapter-entered checkpoint"
          : "provider adapter checkpoint not observed",
      });
    }
    recordPromptAwait("provider-call-observation-summary", {
      provider: runProvider,
      model: runModel,
      providerCallStatus,
      providerCallSkipReason,
      providerSelectionSource: providerSelectionCompleted
        ? "provider-adapter-entered checkpoint"
        : "provider adapter checkpoint not observed",
      preDispatchCallbackExpected,
      preDispatchCallbackRegistered,
      preDispatchCallbackInvoked,
      providerRequestHookInvocations: counters.providerRequestHookInvocations,
      requestObserverInvocations: counters.requestObserverInvocations,
      fetchWrapperInvocations: counters.fetchWrapperInvocations,
      providerDispatchAttempts: counters.providerDispatchAttempts,
      providerInvocationCount,
      timeoutSource: timeoutFired
        ? "embedded-attempt-run-budget"
        : input.abortSignal?.aborted
          ? "external-abort-signal"
          : "not-observed",
      timeoutFired,
      abortRequested,
      abortObserved,
      abortSignalAborted: input.abortSignal?.aborted === true,
      abortReasonClass:
        input.abortSignal?.aborted && input.abortSignal.reason instanceof Error
          ? input.abortSignal.reason.name
          : null,
      configuredAttemptTimeoutMs,
      assistantContentSha256,
      assistantContentBytes,
      assistantToolCallCount,
      assistantFinalReason,
    });
  }
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
  it("durably localizes each pre-sink operation with the capture and commit identity", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-pre-sink-checkpoints-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);
    const liveness = createV1JCaptureLiveness("capture-1", "pre-sink-test");
    try {
      const prepared = prepareV1JPreSinkCapture({
        captureName: "capture-1",
        captureArm: "A",
        caseId: "file-write-notes",
        replicate: 1,
        surfaceMode: "REAL_EXACT",
        benchmarkCandidateNames: ["write"],
        getImageFactoryObservation: () => ({ eligible: false, constructed: false }),
        harnessCommit: "harness-sha",
        headCommit: "head-sha",
        invocationIndex: 1,
        liveness,
      });
      expect(prepared.sinkMetadata).toMatchObject({
        captureName: "capture-1",
        caseId: "file-write-notes",
        arm: "A",
        replicate: 1,
      });
      const rows = fs
        .readFileSync(liveness.filePath, "utf8")
        .trim()
        .split("\n")
        .map((row) => JSON.parse(row) as Record<string, unknown>);
      expect(rows.map((row) => row.event)).toEqual([
        "capture-options-check-start",
        "capture-options-check-complete",
        "image-observation-read-start",
        "image-observation-read-complete",
        "capture-provenance-check-start",
        "capture-provenance-check-complete",
        "invocation-metadata-build-start",
        "invocation-metadata-build-complete",
        "sink-start-checkpoint-write-start",
        "schema-sink-start",
        "sink-start-checkpoint-write-complete",
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          event: expect.any(String),
          elapsed_ms: expect.any(Number),
          capture_name: "capture-1",
          case_id: "file-write-notes",
          arm: "A",
          replicate: 1,
          harness_commit: "harness-sha",
          head_commit: "head-sha",
        });
      }
      expect(fs.readFileSync(liveness.filePath, "utf8")).not.toMatch(
        /prompt|messages|credential|provider payload|schema body/i,
      );
    } finally {
      liveness.close();
      cwd.mockRestore();
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("records pre-sink errors durably and rethrows the original error", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-pre-sink-error-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);
    const liveness = createV1JCaptureLiveness("capture-2", "pre-sink-error-test");
    const originalError = Object.assign(new Error("image observation unavailable"), {
      code: "EIMAGE",
    });
    try {
      let thrown: unknown;
      try {
        prepareV1JPreSinkCapture({
          captureName: "capture-2",
          captureArm: "A",
          caseId: "read-memory",
          replicate: 2,
          surfaceMode: "REAL_EXACT",
          benchmarkCandidateNames: ["read"],
          getImageFactoryObservation: () => {
            throw originalError;
          },
          harnessCommit: "harness-sha",
          headCommit: "head-sha",
          invocationIndex: 1,
          liveness,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(originalError);
      const rows = fs
        .readFileSync(liveness.filePath, "utf8")
        .trim()
        .split("\n")
        .map((row) => JSON.parse(row) as Record<string, unknown>);
      expect(rows.at(-1)).toMatchObject({
        event: "pre-sink-error",
        operation: "image-observation-read",
        capture_name: "capture-2",
        case_id: "read-memory",
        harness_commit: "harness-sha",
        head_commit: "head-sha",
        error: {
          name: "Error",
          code: "EIMAGE",
          message: "image observation unavailable",
        },
      });
    } finally {
      liveness.close();
      cwd.mockRestore();
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("persists only authorized and provider tool schemas with safe metadata", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-schema-capture-test-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);
    const benchmarkCandidateNames =
      TOOL_RANKING_HELD_OUT_CASES[0]?.tools.map((tool) => tool.name) ?? [];
    const runtimeSurface = deriveV1JRealExactRuntimeSurface({
      benchmarkCandidateNames,
      imageFactory: { eligible: false, constructed: false },
    });
    const names = runtimeSurface.expectedRuntimeNames;
    expect(runtimeSurface.benchmarkCandidateNames).toHaveLength(31);
    expect(runtimeSurface.mappedRuntimeNames).toContain("image");
    expect(names).toEqual(REAL_RUNTIME_TOOL_NAMES);
    expect(hashV1JNameSet(names)).toBe(V1J_REAL_EXACT_EXPECTED_RUNTIME_NAME_SET_SHA256);
    const authorizedTools = names.map((name) => ({
      name,
      description: `Capability ${name}`,
      parameters: { type: "object" },
    }));
    const providerTools = authorizedTools.map((tool) => ({
      type: "function",
      function: tool,
    }));
    const checkpoints: Array<{
      checkpoint: V1JCaptureCheckpoint;
      metadata: Record<string, unknown>;
    }> = [];
    const liveness = createV1JCaptureLiveness("capture-1", "sink-test");
    try {
      liveness.record("schema-sink-start", {
        sinkInvocationIndex: 1,
        captureName: "capture-1",
        caseId: "test-case",
        arm: "A",
        replicate: 1,
        providerRequestPhase: "offline-test",
        callSite: "offline-test",
      });
      persistV1JSchemaCapture({
        name: "capture-1",
        arm: "A",
        model: "qwen/qwen3.5-9b",
        surfaceMode: "REAL_EXACT",
        authorizedTools,
        providerTools,
        benchmarkCandidateNames,
        imageFactory: { eligible: false, constructed: false },
        invocation: {
          index: 1,
          caseId: "test-case",
          arm: "A",
          replicate: 1,
          providerRequestPhase: "offline-test",
          callSite: "offline-test",
        },
        recordCheckpoint: (checkpoint, metadata) => {
          checkpoints.push({ checkpoint, metadata });
          liveness.record(checkpoint, metadata);
        },
      });
      const root = path.join(
        workspaceDir,
        "artifacts/capability-intelligence/v1j-action-initiation/schema-baseline",
      );
      const toolsText = fs.readFileSync(path.join(root, "capture-1-provider-tools.json"), "utf8");
      const metadataText = fs.readFileSync(path.join(root, "capture-1-metadata.json"), "utf8");
      expect(JSON.parse(toolsText)).toEqual({ authorizedTools, providerTools });
      expect(metadataText).toContain('"modelRequestsSent": 0');
      const metadata = JSON.parse(metadataText) as {
        benchmarkCandidateInventory: { count: number; names: string[] };
        realExactMappedRuntimeNames: { count: number; names: string[] };
        expectedRealExactRuntimeSurface: {
          count: number;
          names: string[];
          nameSetSha256: string;
        };
        actualAuthorizedProviderSurface: {
          authorizedCount: number;
          providerCount: number;
        };
        benchmarkImageMapping: string;
        runtimeBuiltinImageToolName: string;
        imageFactoryEligible: boolean;
        imageFactoryConstructed: boolean;
      };
      expect(metadata.benchmarkCandidateInventory).toEqual({
        count: 31,
        names: runtimeSurface.benchmarkCandidateNames,
      });
      expect(metadata.realExactMappedRuntimeNames).toEqual({
        count: 16,
        names: runtimeSurface.mappedRuntimeNames,
      });
      expect(metadata.expectedRealExactRuntimeSurface).toEqual({
        count: 15,
        names: REAL_RUNTIME_TOOL_NAMES,
        nameSetSha256: V1J_REAL_EXACT_EXPECTED_RUNTIME_NAME_SET_SHA256,
      });
      expect(metadata.actualAuthorizedProviderSurface).toMatchObject({
        authorizedCount: 15,
        providerCount: 15,
      });
      expect(metadata).toMatchObject({
        benchmarkImageMapping: "image",
        runtimeBuiltinImageToolName: "view_image",
        imageFactoryEligible: false,
        imageFactoryConstructed: false,
      });
      expect(metadataText).not.toMatch(/prompt|messages|credential|requestId|conversation/i);
      expect(checkpoints.map(({ checkpoint }) => checkpoint)).toEqual([
        "schema-sink-authorized-copy-start",
        "schema-sink-authorized-copy-complete",
        "schema-sink-provider-copy-start",
        "schema-sink-provider-copy-complete",
        "schema-sink-mkdir-start",
        "schema-sink-mkdir-complete",
        "schema-sink-validate-start",
        "schema-sink-validation",
        "schema-sink-validate-complete",
        "schema-sink-canonicalize-start",
        "schema-sink-canonicalize-complete",
        "schema-sink-write-tools-start",
        "schema-sink-fsync-or-close-start",
        "schema-sink-fsync-or-close-complete",
        "schema-sink-write-tools-complete",
        "schema-sink-write-metadata-start",
        "schema-sink-fsync-or-close-start",
        "schema-sink-fsync-or-close-complete",
        "schema-sink-write-metadata-complete",
      ]);
      const validAudit = checkpoints.find(
        ({ checkpoint }) => checkpoint === "schema-sink-validation",
      )?.metadata.validationAudit as V1JSchemaValidationAudit | undefined;
      expect(validAudit).toMatchObject({
        authorizedCount: 15,
        providerCount: 15,
        expectedRuntimeCount: 15,
        authorizedUniqueCount: 15,
        providerUniqueCount: 15,
        authorizedNamesUnique: true,
        providerNamesUnique: true,
        authorizedOnlyNames: [],
        providerOnlyNames: [],
        providerSubsetOfAuthorized: true,
        authorizedNameSetMatchesExpectedRuntime: true,
        providerNameSetMatchesExpectedRuntime: true,
        expectedRuntimeFingerprintMatchesFrozen: true,
        validationPredicatesFailed: [],
      });
      expect(validAudit?.authorizedNamesSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(validAudit?.providerNamesSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.readFileSync(liveness.filePath, "utf8")).not.toContain("Capability ");

      expect(() =>
        persistV1JSchemaCapture({
          name: "capture-2",
          arm: "A",
          model: "qwen/qwen3.5-9b",
          surfaceMode: "REAL_EXACT",
          authorizedTools,
          providerTools: providerTools.slice(1),
          benchmarkCandidateNames,
          imageFactory: { eligible: false, constructed: false },
          invocation: {
            index: 2,
            caseId: "test-case",
            arm: "A",
            replicate: 1,
            providerRequestPhase: "offline-test",
            callSite: "offline-test",
          },
          recordCheckpoint: (checkpoint, checkpointMetadata) => {
            checkpoints.push({ checkpoint, metadata: checkpointMetadata });
            liveness.record(checkpoint, checkpointMetadata);
          },
        }),
      ).toThrow("matching complete REAL_EXACT runtime surfaces");
      const projectedAudit = checkpoints.findLast(
        ({ checkpoint }) => checkpoint === "schema-sink-validation",
      )?.metadata.validationAudit as V1JSchemaValidationAudit | undefined;
      expect(projectedAudit).toMatchObject({
        authorizedCount: 15,
        providerCount: 14,
        expectedRuntimeCount: 15,
        providerNamesUnique: true,
        authorizedOnlyNames: [names[0]],
        providerOnlyNames: [],
        providerSubsetOfAuthorized: true,
        authorizedNameSetMatchesExpectedRuntime: true,
        providerNameSetMatchesExpectedRuntime: false,
        expectedRuntimeFingerprintMatchesFrozen: true,
        validationPredicatesFailed: [
          "providerCountMatchesExpectedRuntime",
          "providerNameSetMatchesExpectedRuntime",
          "authorizedProviderNameSetEqual",
        ],
      });
      expect(() =>
        persistV1JSchemaCapture({
          name: "capture-1",
          arm: "A",
          model: "qwen/qwen3.5-9b",
          surfaceMode: "REAL_EXACT",
          authorizedTools,
          providerTools,
          benchmarkCandidateNames,
          imageFactory: { eligible: false, constructed: false },
          invocation: {
            index: 3,
            caseId: "test-case",
            arm: "A",
            replicate: 1,
            providerRequestPhase: "offline-test",
            callSite: "offline-test",
          },
          recordCheckpoint: (checkpoint, checkpointMetadata) => {
            checkpoints.push({ checkpoint, metadata: checkpointMetadata });
            liveness.record(checkpoint, checkpointMetadata);
          },
        }),
      ).toThrow("already exists");
      const recheckHarnessCommit = "0123456789abcdef0123456789abcdef01234567";
      const recheckName = `capture-1-recheck-${recheckHarnessCommit.slice(0, 8)}`;
      const recheckInput = {
        name: recheckName as V1JSchemaCaptureName,
        arm: "A" as const,
        model: "qwen/qwen3.5-9b",
        surfaceMode: "REAL_EXACT" as const,
        authorizedTools,
        providerTools,
        benchmarkCandidateNames,
        harnessCommit: recheckHarnessCommit,
        imageFactory: { eligible: false, constructed: false },
        invocation: {
          index: 4,
          caseId: "test-case",
          arm: "A" as const,
          replicate: 1,
          providerRequestPhase: "offline-test",
          callSite: "offline-test",
        },
      };
      persistV1JSchemaCapture(recheckInput);
      const recheckToolsPath = path.join(root, `${recheckName}-provider-tools.json`);
      const recheckMetadataPath = path.join(root, `${recheckName}-metadata.json`);
      const recheckToolsBytes = fs.readFileSync(recheckToolsPath);
      const recheckMetadataBytes = fs.readFileSync(recheckMetadataPath);
      expect(JSON.parse(recheckToolsBytes.toString("utf8"))).toEqual({
        authorizedTools,
        providerTools,
      });
      expect(JSON.parse(recheckMetadataBytes.toString("utf8"))).toMatchObject({
        modelRequestsSent: 0,
      });
      expect(() => persistV1JSchemaCapture(recheckInput)).toThrow("already exists");
      expect(fs.readFileSync(recheckToolsPath)).toEqual(recheckToolsBytes);
      expect(fs.readFileSync(recheckMetadataPath)).toEqual(recheckMetadataBytes);
      const rows = fs
        .readFileSync(liveness.filePath, "utf8")
        .trim()
        .split("\n")
        .map((row) => JSON.parse(row) as Record<string, unknown>);
      expect(rows[0]).toMatchObject({
        checkpoint: "schema-sink-start",
        sinkInvocationIndex: 1,
        captureName: "capture-1",
        caseId: "test-case",
        arm: "A",
        replicate: 1,
        providerRequestPhase: "offline-test",
        callSite: "offline-test",
      });
      expect(rows.at(-1)).toMatchObject({
        checkpoint: "schema-sink-error",
        sinkInvocationIndex: 3,
        operation: "capture-validation",
        errorName: "Error",
        errorMessage: "v1J schema capture already exists: capture-1",
      });
    } finally {
      liveness.close();
      cwd.mockRestore();
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("fails closed for missing, invalid, or escaping schema-capture selectors", () => {
    expect(resolveV1JSchemaCaptureOptions({})).toBeUndefined();
    expect(() =>
      resolveV1JSchemaCaptureOptions({
        OPENCLAW_V1J_SCHEMA_CAPTURE: "true",
        OPENCLAW_V1J_SCHEMA_CAPTURE_NAME: "capture-1",
        OPENCLAW_V1J_SCHEMA_CAPTURE_ARM: "A",
      }),
    ).toThrow("must be 1");
    expect(() => resolveV1JSchemaCaptureOptions({ OPENCLAW_V1J_SCHEMA_CAPTURE: "1" })).toThrow(
      "OPENCLAW_V1J_SCHEMA_CAPTURE_NAME",
    );
    expect(() =>
      resolveV1JSchemaCaptureOptions({
        OPENCLAW_V1J_SCHEMA_CAPTURE: "1",
        OPENCLAW_V1J_SCHEMA_CAPTURE_ARM: "A",
      }),
    ).toThrow("OPENCLAW_V1J_SCHEMA_CAPTURE_NAME");
    expect(() =>
      resolveV1JSchemaCaptureOptions({
        OPENCLAW_V1J_SCHEMA_CAPTURE: "1",
        OPENCLAW_V1J_SCHEMA_CAPTURE_NAME: "../../escape",
        OPENCLAW_V1J_SCHEMA_CAPTURE_ARM: "A",
      }),
    ).toThrow("recognized capture name");
    const testHarnessCommit = "0123456789abcdef0123456789abcdef01234567";
    for (const [name, arm] of [
      ["capture-1", "A"],
      ["capture-2", "A"],
      ["arm-a", "A"],
      ["arm-c", "C"],
    ] as const) {
      expect(
        resolveV1JSchemaCaptureOptions(
          {
            OPENCLAW_V1J_SCHEMA_CAPTURE: "1",
            OPENCLAW_V1J_SCHEMA_CAPTURE_NAME: name,
            OPENCLAW_V1J_SCHEMA_CAPTURE_ARM: arm,
          },
          testHarnessCommit,
        ),
      ).toEqual({ name, arm });
    }
    expect(
      resolveV1JSchemaCaptureOptions(
        {
          OPENCLAW_V1J_SCHEMA_CAPTURE: "1",
          OPENCLAW_V1J_SCHEMA_CAPTURE_NAME: "capture-1-recheck-01234567",
          OPENCLAW_V1J_SCHEMA_CAPTURE_ARM: "A",
        },
        testHarnessCommit,
      ),
    ).toEqual({ name: "capture-1-recheck-01234567", arm: "A" });
    for (const name of ["capture-1-recheck-89abcdef", "fresh-capture"]) {
      expect(() =>
        resolveV1JSchemaCaptureOptions(
          {
            OPENCLAW_V1J_SCHEMA_CAPTURE: "1",
            OPENCLAW_V1J_SCHEMA_CAPTURE_NAME: name,
            OPENCLAW_V1J_SCHEMA_CAPTURE_ARM: "A",
          },
          testHarnessCommit,
        ),
      ).toThrow("recognized capture name");
    }

    expect(() =>
      persistV1JSchemaCapture({
        name: "../../escape" as V1JSchemaCaptureName,
        arm: "A",
        authorizedTools: [],
        providerTools: [],
        model: "qwen/qwen3.5-9b",
        surfaceMode: "REAL_EXACT",
        benchmarkCandidateNames: [],
        imageFactory: { eligible: false, constructed: false },
      }),
    ).toThrow("name/arm pair is invalid");
    expect(buildV1JSchemaCaptureRequestOptions({ name: "arm-c", arm: "C" })).toMatchObject({
      stopAfterCapture: true,
      schemaCaptureName: "arm-c",
      schemaCaptureArm: "C",
      capturePromptInstruction: expect.stringContaining("When a task depends on reading"),
    });
  });

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
    const promptTraceJournal = createV1JPreflightDiagnosticJournal({
      repoRoot: workspaceDir,
      harnessCommit: "9".repeat(40),
      arm: "A",
      caseId: "offline-prompt-await",
      preflightId: "prompt-await",
      pid: process.pid,
    });
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
          preflightDiagnostics: promptTraceJournal,
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
      const promptTrace = fs
        .readFileSync(promptTraceJournal.filePath, "utf8")
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line) as { event: string });
      expect(promptTrace.map((event) => event.event)).toEqual(
        expect.arrayContaining([
          "provider-selection-start",
          "model-loop-iteration-start",
          "prompt-call-start",
          "prompt-call-settled",
          "provider-call-observation-summary",
        ]),
      );
      expect(JSON.stringify(promptTrace)).not.toContain("Read the config file");
    } finally {
      promptTraceJournal.close();
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
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);
    const captured: CapturedModelRequest[] = [];
    const authorizedSchemas: V1JAuthorizedToolSchema[] = [];
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
          ...buildV1JSchemaCaptureRequestOptions({ name: "capture-1", arm: "A" }),
          surfaceMode: "SYNTHETIC",
          benchmarkCandidateNames: benchmarkCase.tools.map((tool) => tool.name),
          onAuthorizedToolsCaptured: (tools) => authorizedSchemas.push(...tools),
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
      expect(authorizedSchemas).toHaveLength(31);
      expect(new Set(authorizedSchemas.map((tool) => tool.name))).toEqual(new Set(names));
      expect(authorizedSchemas.every((tool) => tool.parameters !== undefined)).toBe(true);
      expect(names).toEqual(expect.arrayContaining(["git_diff", "pytest", "calendar", "email"]));
      const captureRoot = path.join(
        workspaceDir,
        "artifacts/capability-intelligence/v1j-action-initiation/schema-baseline",
      );
      const capturedSchemas = JSON.parse(
        fs.readFileSync(path.join(captureRoot, "capture-1-provider-tools.json"), "utf8"),
      ) as { authorizedTools: V1JAuthorizedToolSchema[]; providerTools: unknown[] };
      const captureMetadata = fs.readFileSync(
        path.join(captureRoot, "capture-1-metadata.json"),
        "utf8",
      );
      expect(capturedSchemas.authorizedTools).toHaveLength(31);
      expect(capturedSchemas.providerTools).toHaveLength(31);
      expect(captureMetadata).toContain('"modelRequestsSent": 0');
      expect(captureMetadata).not.toMatch(/prompt|messages|credential|requestId|conversation/i);
      expect(JSON.stringify(capturedSchemas)).not.toContain(
        "Read the config file and edit the port setting",
      );
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
      cwd.mockRestore();
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

describeV1JSchemaCapture("v1J provider schema capture-only entrypoint", () => {
  it(
    "captures the selected prepared-runtime tool surface and blocks provider dispatch",
    { timeout: 120_000 },
    async () => {
      const captureOptions = resolveV1JSchemaCaptureOptions(process.env);
      if (!captureOptions) {
        throw new Error("v1J schema capture mode is not enabled");
      }
      const headCommit = assertV1JCaptureProvenance();
      const mappingSummary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
      const sets = splitV1IExperimentSets(TOOL_RANKING_HELD_OUT_CASES, mappingSummary);
      const benchmarkCase = sets.realExact[0];
      if (!benchmarkCase) {
        throw new Error("v1I REAL_EXACT case set is empty");
      }
      const mappedTools = benchmarkCase.tools.flatMap((tool) => {
        const realTool = getBenchmarkRealToolMapping(tool.name).realTool;
        return realTool ? [{ name: realTool, description: `OpenClaw ${realTool} capability` }] : [];
      });
      const requiredMappedTools = benchmarkCase.expectedTopTools.flatMap((toolName) => {
        const realTool = getBenchmarkRealToolMapping(toolName).realTool;
        return realTool ? [realTool] : [];
      });
      const liveness = createV1JCaptureLiveness(
        captureOptions.name,
        `sink-diagnostic-${process.pid}-${Date.now()}`,
      );
      liveness.record("capture-entrypoint-start");
      let workspaceDir: string | undefined;
      const captured: CapturedModelRequest[] = [];
      let authorizedSchemas: V1JAuthorizedToolSchema[] = [];
      let imageFactoryObservation: V1JImageFactoryObservation | undefined;
      const abortController = new AbortController();
      let delegatedRequests = 0;
      let providerDispatchAttempts = 0;
      try {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-schema-capture-run-"));
        const config = buildLiveConfig(workspaceDir);
        liveness.record("config-loaded");
        liveness.record("isolated-state-resolved");
        liveness.record("prepared-runtime-start");
        const observation = await runOne({
          mode: "real-exact",
          surfaceMode: "REAL_EXACT_ONLY",
          benchmarkCase,
          mappingClass: "EXACT",
          authorizedNames: [...new Set(mappedTools.map((tool) => tool.name))],
          v1cTop8: rankTop8(mappedTools, benchmarkCase.query),
          requiredMappedTools,
          arm: "A",
          replicate: 1,
          attempt: 1,
          scheduleSeed: scheduleSeedFor(benchmarkCase.id, 1),
          config,
          workspaceDir,
          directRunner: true,
          provider: PROVIDER,
          model: MODEL_ID,
          abortSignal: abortController.signal,
          requestCapture: {
            headCommit,
            surfaceMode: "REAL_EXACT",
            benchmarkCandidateNames: benchmarkCase.tools.map((tool) => tool.name),
            getImageFactoryObservation: () => imageFactoryObservation,
            onImageFactoryResult: (factoryResult) => {
              if (
                imageFactoryObservation &&
                (imageFactoryObservation.eligible !== factoryResult.eligible ||
                  imageFactoryObservation.constructed !== factoryResult.constructed)
              ) {
                throw new Error("v1J image factory result changed during one capture");
              }
              imageFactoryObservation = factoryResult;
            },
            ...buildV1JSchemaCaptureRequestOptions(captureOptions),
            liveness,
            onProviderDispatchAttempt: (count) => {
              providerDispatchAttempts = count;
            },
            onAuthorizedToolsCaptured: (tools) => {
              authorizedSchemas = [...tools];
            },
            onRequestCaptured: (request) => captured.push(request),
            onDelegatedRequest: () => {
              delegatedRequests += 1;
            },
          },
        });
        const failure = observation.requestPreparationDiagnostics?.failure;
        if (failure?.errorName === "V1IProviderDispatchAttemptError") {
          throw new Error("v1J capture reached the provider dispatch guard");
        }
        if (
          observation.valid ||
          failure?.errorName !== "V1IProviderRequestCapturedError" ||
          captured.length !== 1 ||
          delegatedRequests !== 0 ||
          observation.requestPreparationDiagnostics?.checkpoints.some(
            (checkpoint) => checkpoint.stage === "provider-request-constructed",
          ) !== true
        ) {
          throw new Error("v1J capture did not stop cleanly before provider dispatch");
        }
        if (providerDispatchAttempts !== 0) {
          throw new Error("v1J capture recorded a provider dispatch attempt");
        }
        if (!imageFactoryObservation) {
          throw new Error("v1J capture did not observe image-factory eligibility");
        }
        const expectedSurface = deriveV1JRealExactRuntimeSurface({
          benchmarkCandidateNames: benchmarkCase.tools.map((tool) => tool.name),
          imageFactory: imageFactoryObservation,
        });
        const names = toolNamesFromBody(captured[0]?.body ?? {});
        if (
          authorizedSchemas.length !== expectedSurface.expectedRuntimeNames.length ||
          names.length !== expectedSurface.expectedRuntimeNames.length ||
          new Set(names).size !== expectedSurface.expectedRuntimeNames.length ||
          expectedSurface.expectedRuntimeNames.some((name) => !names.includes(name))
        ) {
          throw new Error("v1J capture did not observe the expected REAL_EXACT runtime surface");
        }
        const root = path.resolve(
          "artifacts/capability-intelligence/v1j-action-initiation/schema-baseline",
        );
        const schemasPath = path.join(root, `${captureOptions.name}-provider-tools.json`);
        const metadataPath = path.join(root, `${captureOptions.name}-metadata.json`);
        const schemas = JSON.parse(fs.readFileSync(schemasPath, "utf8")) as {
          authorizedTools: V1JAuthorizedToolSchema[];
          providerTools: unknown[];
        };
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as Record<
          string,
          unknown
        >;
        if (
          schemas.authorizedTools.length !== expectedSurface.expectedRuntimeNames.length ||
          schemas.providerTools.length !== expectedSurface.expectedRuntimeNames.length ||
          JSON.stringify(metadata).includes(benchmarkCase.query) ||
          /prompt|messages|credential|requestId|conversation/i.test(JSON.stringify(metadata)) ||
          /apiKey|authorization|bearer\s/i.test(JSON.stringify(schemas))
        ) {
          throw new Error("v1J capture artifact failed safe-content validation");
        }
        if (
          metadata.imageFactoryEligible !== expectedSurface.imageFactoryEligible ||
          metadata.imageFactoryConstructed !== expectedSurface.imageFactoryConstructed ||
          metadata.benchmarkImageMapping !== "image" ||
          metadata.runtimeBuiltinImageToolName !== "view_image" ||
          metadata.modelRequestsSent !== 0
        ) {
          throw new Error("v1J capture metadata does not match the prepared runtime surface");
        }
        liveness.record("capture-entrypoint-complete", {
          providerDispatchAttempts: 0,
        });
      } finally {
        abortController.abort(new Error("v1J schema capture boundary complete"));
        try {
          if (workspaceDir) {
            fs.rmSync(workspaceDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 50,
            });
          }
        } catch {
          // Windows may keep the isolated agent database open until the test process exits.
        }
        liveness.close();
      }
    },
  );
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
    stopAfterProviderBoundCapture?: boolean;
    holdAfterCapture?: boolean;
    schemaCaptureName?: V1JSchemaCaptureName;
    preflightDiagnostics?: V1JPreflightDiagnosticJournal;
    liveness?: V1JCaptureLiveness;
    onProviderDispatchAttempt?: (count: number, requestIndex: number) => void;
    onRequestCaptured?: (request: CapturedModelRequest) => void;
    onProviderInvocation?: (input: {
      count: number;
      requestIndex: number;
      dispatchOrdinal: number;
      requestUrlSha256: string;
    }) => void;
    onProviderCaptureStage?: (event: V1JProviderControlEvent) => void;
    onProviderRequestBeforeDispatch?: (input: {
      request: CapturedModelRequest;
      rawBody: string;
      requestIndex: number;
      dispatchOrdinal: number;
    }) => void | Promise<void>;
    onPreflightStopRaised?: () => void;
    onDelegatedRequest?: () => void;
    onResponseSummary?: (summary: ProviderResponseSummary) => void;
    lifecycleJournal?: V1JLifecycleJournal;
    requestCorrelationId?: string;
  },
): ModelPayloadCapture {
  const requests: CapturedModelRequest[] = [];
  const responseSummaries: ProviderResponseSummary[] = [];
  let providerRequestRecorded = false;
  let delegatedRequests = 0;
  let providerDispatchAttempts = 0;
  let providerInvocationCount = 0;
  let providerRequestIndex = 0;
  let providerRequestGateFailed = false;
  let providerRequestGateError: unknown;
  const originalFetch = globalThis.fetch;
  const wrappedFetches = new WeakSet<typeof globalThis.fetch>();
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
    const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
      const preflightEvent = (event: string) =>
        options?.preflightDiagnostics
          ? `arm-${options.preflightDiagnostics.arm.toLowerCase()}-${event}`
          : event;
      options?.preflightDiagnostics?.increment(
        "fetchWrapperInvocations",
        preflightEvent("fetch-wrapper-invocation"),
        { callSite: "captureModelPayloads.wrapFetch" },
      );
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isPotentialProviderRequest =
        url.startsWith(LM_STUDIO_BASE_URL) ||
        url.includes("/chat/completions") ||
        url.includes("/responses");
      const serializationStartedAt = performance.now();
      const serializationEnteredAt = new Date().toISOString();
      if (isPotentialProviderRequest) {
        options?.onProviderCaptureStage?.({
          event: "request-serialization-start",
          details: {
            stageName: "body-serialization",
            awaited: true,
            awaitTargetClass: "readCapturedFetchBody",
            enteredAt: serializationEnteredAt,
          },
        });
      }
      let body: string | undefined;
      try {
        body = await readCapturedFetchBody(input, init);
      } catch (error) {
        if (isPotentialProviderRequest) {
          options?.onProviderCaptureStage?.({
            event: "request-serialization-failed",
            elapsedMs: Math.max(0, Math.round(performance.now() - serializationStartedAt)),
            details: {
              stageName: "body-serialization",
              awaited: true,
              awaitTargetClass: "readCapturedFetchBody",
              enteredAt: serializationEnteredAt,
              completedAt: new Date().toISOString(),
              errorName: error instanceof Error ? error.name : "NonErrorThrown",
            },
          });
        }
        throw error;
      }
      if (isPotentialProviderRequest) {
        options?.onProviderCaptureStage?.({
          event: "request-serialization-complete",
          elapsedMs: Math.max(0, Math.round(performance.now() - serializationStartedAt)),
          details: {
            stageName: "body-serialization",
            awaited: true,
            awaitTargetClass: "readCapturedFetchBody",
            enteredAt: serializationEnteredAt,
            completedAt: new Date().toISOString(),
            requestJsonBytes: body === undefined ? null : Buffer.byteLength(body, "utf8"),
          },
        });
      }
      const isProviderRequest =
        isPotentialProviderRequest && typeof body === "string" && body.trim().startsWith("{");
      const requestIndex = isProviderRequest ? ++providerRequestIndex : 0;
      if (isProviderRequest && providerRequestGateFailed) {
        throw providerRequestGateError;
      }
      const correlationId = isProviderRequest
        ? `${options?.requestCorrelationId ?? "v1j-request"}:${requestIndex}`
        : undefined;
      if (isProviderRequest) {
        let parsed: Record<string, unknown>;
        try {
          const value: unknown = JSON.parse(body);
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new TypeError("provider request body is not a JSON object");
          }
          parsed = value as Record<string, unknown>;
        } catch (error) {
          options?.onProviderCaptureStage?.({
            event: "request-object-parse-failed",
            details: { errorName: error instanceof Error ? error.name : "NonErrorThrown" },
          });
          throw error;
        }
        const request = { body: parsed, url };
        options?.onProviderCaptureStage?.({
          event: "request-object-received",
          details: {
            messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
            toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
            requestJsonBytes: Buffer.byteLength(body, "utf8"),
          },
        });
        if (!providerRequestRecorded) {
          requests.push(request);
          options?.preflightDiagnostics?.increment(
            "requestObserverInvocations",
            preflightEvent("request-observer-enter"),
            { callSite: "captureModelPayloads.wrapFetch", invocationIndex: requests.length },
          );
          const observerCallbackStartedAt = performance.now();
          const observerCallbackEnteredAt = new Date().toISOString();
          options?.onProviderCaptureStage?.({
            event: "provider-bound-callback-enter",
            details: {
              stageName: "request-object-observation",
              awaited: false,
              awaitTargetClass: null,
              enteredAt: observerCallbackEnteredAt,
            },
          });
          try {
            options?.onRequestCaptured?.(request);
            options?.onProviderCaptureStage?.({
              event: "callback-return-or-throw",
              elapsedMs: Math.max(0, Math.round(performance.now() - observerCallbackStartedAt)),
              details: {
                stageName: "request-object-observation",
                phase: "return",
                awaited: false,
                awaitTargetClass: null,
                enteredAt: observerCallbackEnteredAt,
                completedAt: new Date().toISOString(),
              },
            });
          } catch (error) {
            options?.onProviderCaptureStage?.({
              event: "outer-catch-enter",
              elapsedMs: Math.max(0, Math.round(performance.now() - observerCallbackStartedAt)),
              details: {
                stageName: "request-object-observation",
                awaited: false,
                awaitTargetClass: null,
                enteredAt: observerCallbackEnteredAt,
                completedAt: new Date().toISOString(),
                errorName: error instanceof Error ? error.name : "NonErrorThrown",
              },
            });
            options?.onProviderCaptureStage?.({
              event: "callback-return-or-throw",
              elapsedMs: Math.max(0, Math.round(performance.now() - observerCallbackStartedAt)),
              details: {
                stageName: "request-object-observation",
                phase: "throw",
                awaited: false,
                awaitTargetClass: null,
                enteredAt: observerCallbackEnteredAt,
                completedAt: new Date().toISOString(),
                errorName: error instanceof Error ? error.name : "NonErrorThrown",
              },
            });
            throw error;
          }
          options?.preflightDiagnostics?.record(preflightEvent("request-observer-exit"), {
            callSite: "captureModelPayloads.wrapFetch",
            invocationIndex: requests.length,
          });
        }
        const toolNames = toolNamesFromBody(parsed);
        hooks?.onCheckpoint?.({
          stage: "provider-request-constructed",
          toolCount: toolNames.length,
          representativeToolNames: toolNames,
        });
        if (options?.schemaCaptureName) {
          providerDispatchAttempts += 1;
          options.onProviderDispatchAttempt?.(providerDispatchAttempts, requestIndex);
          options?.preflightDiagnostics?.increment(
            "providerDispatchAttempts",
            preflightEvent("dispatch-counter-increment"),
            { callSite: "captureModelPayloads.wrapFetch", captureName: options.schemaCaptureName },
          );
          options.liveness?.record("provider-dispatch-guard-reached", {
            providerDispatchAttempts,
          });
          throw new V1IProviderDispatchAttemptError();
        }
        if (options?.stopAfterCapture) {
          options?.preflightDiagnostics?.increment(
            "preflightStopSignalRaised",
            preflightEvent("stop-before-dispatch-signal"),
            {
              callSite: "captureModelPayloads.wrapFetch",
              signalName: V1IProviderRequestCapturedError.name,
            },
          );
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
        const providerBoundCallbackEnteredAt = new Date().toISOString();
        const providerBoundCallbackStartedAt = performance.now();
        options?.onProviderCaptureStage?.({
          event: "provider-bound-callback-enter",
          details: {
            stageName: "provider-bound-callback",
            awaited: true,
            awaitTargetClass: "onProviderRequestBeforeDispatch",
            enteredAt: providerBoundCallbackEnteredAt,
          },
        });
        try {
          await options?.onProviderRequestBeforeDispatch?.({
            request,
            rawBody: body,
            requestIndex,
            dispatchOrdinal: providerDispatchAttempts + 1,
          });
          options?.onProviderCaptureStage?.({
            event: "callback-return-or-throw",
            elapsedMs: Math.max(0, Math.round(performance.now() - providerBoundCallbackStartedAt)),
            details: {
              stageName: "provider-bound-callback",
              phase: "return",
              awaited: true,
              awaitTargetClass: "onProviderRequestBeforeDispatch",
              enteredAt: providerBoundCallbackEnteredAt,
              completedAt: new Date().toISOString(),
            },
          });
          options?.onProviderCaptureStage?.({
            event: "provider-bound-request-captured",
            details: {
              stageName: "provider-bound-callback",
              awaited: false,
              awaitTargetClass: null,
            },
          });
        } catch (error) {
          providerRequestGateFailed = true;
          providerRequestGateError = error;
          options?.onProviderCaptureStage?.({
            event: "outer-catch-enter",
            elapsedMs: Math.max(0, Math.round(performance.now() - providerBoundCallbackStartedAt)),
            details: {
              stageName: "provider-bound-callback",
              awaited: true,
              awaitTargetClass: "onProviderRequestBeforeDispatch",
              enteredAt: providerBoundCallbackEnteredAt,
              completedAt: new Date().toISOString(),
              errorName: error instanceof Error ? error.name : "NonErrorThrown",
            },
          });
          options?.onProviderCaptureStage?.({
            event: "callback-return-or-throw",
            elapsedMs: Math.max(0, Math.round(performance.now() - providerBoundCallbackStartedAt)),
            details: {
              stageName: "provider-bound-callback",
              phase: "throw",
              awaited: true,
              awaitTargetClass: "onProviderRequestBeforeDispatch",
              enteredAt: providerBoundCallbackEnteredAt,
              completedAt: new Date().toISOString(),
              errorName: error instanceof Error ? error.name : "NonErrorThrown",
            },
          });
          throw error;
        }
        if (options?.stopAfterProviderBoundCapture) {
          options?.onProviderCaptureStage?.({
            event: "stop-signal-prepare",
            details: {
              stageName: "preflight-stop-signal",
              awaited: false,
              awaitTargetClass: null,
            },
          });
          const stopSignal = new V1IProviderRequestCapturedError();
          providerRequestGateFailed = true;
          providerRequestGateError = stopSignal;
          options.onPreflightStopRaised?.();
          options?.onProviderCaptureStage?.({ event: "preflight-stop-signal-raised" });
          options?.preflightDiagnostics?.increment(
            "preflightStopSignalRaised",
            preflightEvent("stop-after-provider-bound-capture-signal"),
            {
              callSite: "captureModelPayloads.wrapFetch",
              signalName: V1IProviderRequestCapturedError.name,
            },
          );
          options?.onProviderCaptureStage?.({
            event: "stop-signal-raise",
            details: {
              stageName: "preflight-stop-signal",
              awaited: false,
              awaitTargetClass: null,
            },
          });
          throw stopSignal;
        }
      }
      options?.onDelegatedRequest?.();
      delegatedRequests += 1;
      providerDispatchAttempts += 1;
      options?.onProviderDispatchAttempt?.(providerDispatchAttempts, requestIndex);
      if (isProviderRequest && !wrappedFetches.has(baseFetch)) {
        options?.preflightDiagnostics?.increment(
          "providerDispatchAttempts",
          preflightEvent("dispatch-counter-increment"),
          { callSite: "captureModelPayloads.wrapFetch" },
        );
        options?.preflightDiagnostics?.increment(
          "providerCallbackInvocations",
          preflightEvent("provider-callback-enter"),
          { callSite: "captureModelPayloads.wrapFetch.baseFetch" },
        );
        options?.preflightDiagnostics?.increment(
          "modelRequestCounter",
          preflightEvent("model-request-counter-increment"),
          { callSite: "captureModelPayloads.wrapFetch.baseFetch" },
        );
      }
      if (isProviderRequest) {
        options?.lifecycleJournal?.record("request-created", {
          requestId: correlationId,
          correlationId,
          requestIndex,
          outcome: "created",
        });
        options?.lifecycleJournal?.record("request-dispatch-start", {
          requestId: correlationId,
          correlationId,
          requestIndex,
          dispatchAttempt: providerDispatchAttempts,
          abortState: init?.signal?.aborted === true,
          timeoutState: "pending",
        });
      }
      let response: Response;
      try {
        if (isProviderRequest) {
          providerInvocationCount += 1;
          options?.onProviderInvocation?.({
            count: providerInvocationCount,
            requestIndex,
            dispatchOrdinal: providerDispatchAttempts,
            requestUrlSha256: sha256V1J(url),
          });
        }
        response = await baseFetch(input, init);
      } catch (error) {
        if (isProviderRequest) {
          const safeError = safeDiagnosticError(error);
          options?.lifecycleJournal?.record("request-dispatch-complete", {
            requestId: correlationId,
            correlationId,
            requestIndex,
            outcome: "rejected",
            ...safeError,
            abortState: init?.signal?.aborted === true,
            abortReasonClass:
              init?.signal?.aborted && init.signal.reason instanceof Error
                ? init.signal.reason.name
                : undefined,
            timeoutState:
              safeError.errorClass === "TimeoutError" || safeError.errorCode === "ETIMEDOUT"
                ? "timed-out"
                : init?.signal?.aborted || safeError.errorClass === "AbortError"
                  ? "aborted"
                  : "not-reported",
          });
        }
        throw error;
      }
      if (!isProviderRequest) {
        return response;
      }
      const contentType = safeDiagnosticContentType(response);
      options?.lifecycleJournal?.record("request-dispatch-complete", {
        requestId: correlationId,
        correlationId,
        requestIndex,
        outcome: "response",
        httpStatus: response.status,
        contentType,
      });
      options?.lifecycleJournal?.record("http-response-headers", {
        requestId: correlationId,
        correlationId,
        requestIndex,
        httpStatus: response.status,
        contentType,
      });
      options?.lifecycleJournal?.record("network-response-headers", {
        requestId: correlationId,
        correlationId,
        requestIndex,
        httpStatus: response.status,
        contentType,
      });
      options?.lifecycleJournal?.record("provider-response-observed", {
        requestId: correlationId,
        correlationId,
        requestIndex,
        providerResponseObserved: true,
        httpStatus: response.status,
      });
      const initialSummary = createPendingProviderResponseSummary(response);
      responseSummaries.push(initialSummary);
      emitResponseSummary(initialSummary);
      if (!response.body) {
        options?.lifecycleJournal?.record("network-response-body-start", {
          requestId: correlationId,
          correlationId,
          requestIndex,
          responseBytes: 0,
        });
        options?.lifecycleJournal?.record("http-response-body-start", {
          requestId: correlationId,
          correlationId,
          requestIndex,
          responseBytes: 0,
        });
        options?.lifecycleJournal?.record("http-response-body-complete", {
          requestId: correlationId,
          correlationId,
          requestIndex,
          responseBytes: 0,
          outcome: "empty",
        });
        const emptySummary = {
          ...initialSummary,
          parserOutcome: "empty-body",
        } satisfies ProviderResponseSummary;
        responseSummaries.push(emptySummary);
        emitResponseSummary(emptySummary);
        return response;
      }
      const state = createResponseSummaryState(response.headers.get("content-type"));
      const providerBody = options?.lifecycleJournal
        ? observeV1JProviderResponseBody({
            body: response.body,
            journal: options.lifecycleJournal,
            requestIndex,
            writeHeartbeat: (line) => process.stdout.write(line),
          })
        : response.body;
      const reader = providerBody.getReader();
      let responseBytes = 0;
      let adapterStreamEntered = false;
      options?.lifecycleJournal?.record("network-response-body-start", {
        requestId: correlationId,
        correlationId,
        requestIndex,
      });
      options?.lifecycleJournal?.record("http-response-body-start", {
        requestId: correlationId,
        correlationId,
        requestIndex,
      });
      const observedBody = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!adapterStreamEntered) {
            adapterStreamEntered = true;
            options?.lifecycleJournal?.record("adapter-stream-enter", {
              requestId: correlationId,
              correlationId,
              requestIndex,
              outcome: "entered",
            });
          }
          try {
            const part = await reader.read();
            if (part.done) {
              finishProviderResponseState(state);
              const summary = finishProviderResponseSummary(initialSummary, state);
              responseSummaries.push(summary);
              emitResponseSummary(summary);
              options?.lifecycleJournal?.record("http-response-body-complete", {
                requestId: correlationId,
                correlationId,
                requestIndex,
                responseBytes,
                parserOutcome: summary.parserOutcome,
                outcome: "complete",
              });
              controller.close();
              return;
            }
            responseBytes += part.value.byteLength;
            consumeProviderResponseChunk(state, part.value);
            if (responseBytes === part.value.byteLength) {
              options?.lifecycleJournal?.record("adapter-first-chunk", {
                requestId: correlationId,
                correlationId,
                requestIndex,
                responseChunkCount: 1,
                responseByteCount: responseBytes,
              });
            }
            controller.enqueue(part.value);
          } catch (error) {
            options?.lifecycleJournal?.record("http-response-body-failed", {
              requestId: correlationId,
              correlationId,
              requestIndex,
              responseBytes,
              outcome: "rejected",
              ...safeDiagnosticError(error),
              abortState: init?.signal?.aborted === true,
              timeoutState:
                init?.signal?.aborted || safeDiagnosticError(error).errorClass === "AbortError"
                  ? "aborted"
                  : safeDiagnosticError(error).errorClass === "TimeoutError"
                    ? "timed-out"
                    : "not-reported",
            });
            controller.error(error);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            options?.lifecycleJournal?.record("http-response-body-cancelled", {
              requestId: correlationId,
              correlationId,
              requestIndex,
              responseBytes,
              outcome: "cancelled",
              ...safeDiagnosticError(reason),
              abortState: init?.signal?.aborted === true,
            });
          }
        },
      });
      return new Response(observedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
    wrappedFetches.add(wrappedFetch);
    return wrappedFetch;
  };
  globalThis.fetch = wrapFetch(originalFetch);
  return {
    requests,
    delegatedRequests,
    get providerDispatchAttempts() {
      return providerDispatchAttempts;
    },
    get providerInvocationCount() {
      return providerInvocationCount;
    },
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

function guardV1JPreflightAssistantResult(input: {
  message: AssistantMessage;
  modelTurnIndex: number;
  providerInvocationCount: number;
  stopSignalRaised: boolean;
  journal?: V1JPreflightDiagnosticJournal;
  captureOnly: boolean;
}): boolean {
  if (!input.captureOnly) {
    return false;
  }
  const toolCalls = input.message.content.filter((block) => block.type === "toolCall");
  const expectedStopError =
    input.stopSignalRaised &&
    toolCalls.length === 0 &&
    (input.message.stopReason === "error" || input.message.stopReason === "aborted");
  if (expectedStopError) {
    input.journal?.record("preflight-stop-assistant-error-observed", {
      modelTurnIndex: input.modelTurnIndex,
      providerInvocationCount: input.providerInvocationCount,
      stopReason: input.message.stopReason,
    });
    return true;
  }

  const classification =
    input.providerInvocationCount === 0
      ? "UNACCOUNTED_MODEL_RESULT_SOURCE"
      : "MODEL_RESULT_AFTER_PRE_DISPATCH_STOP";
  input.journal?.record("preflight-unexpected-model-result", {
    classification,
    modelTurnIndex: input.modelTurnIndex,
    providerInvocationCount: input.providerInvocationCount,
    stopReason: input.message.stopReason,
    toolCallCount: toolCalls.length,
    toolCalls: toolCalls.map((call) => ({
      toolName: call.name,
      callIdSha256: sha256V1J(call.id),
    })),
    toolHandlerEntryCount: 0,
    toolResultCallbackCount: 0,
    secondModelLoopIterationAllowed: false,
  });
  throw new V1JUnexpectedPreflightModelResultError(classification);
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

function createTestV1JProviderResponseDiagnosticJournal() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-response-journal-test-"));
  const journal = createV1JProviderResponseDiagnosticJournal({
    repoRoot,
    harnessCommit: "a".repeat(40),
    modelId: MODEL_ID,
    modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
    schemaFingerprint: {
      authorizedToolCount: 15,
      providerToolCount: 15,
      authorizedToolNameSha256: "b".repeat(64),
      providerToolNameSha256: "b".repeat(64),
      authorizedToolSchemaSha256: "c".repeat(64),
      providerToolSchemaSha256: "d".repeat(64),
    },
    startedAt: new Date().toISOString(),
  });
  return {
    journal,
    readRows: () =>
      fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    dispose: () => {
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  };
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
