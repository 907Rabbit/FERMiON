import { prepareSystemAgentRunAdmission } from "../admitted-run-context.js";
import type { RunEmbeddedAgentParams } from "../embedded-agent-runner/run/params.js";
/**
 * Drives the canonical embedded turn for one qualification replay.
 * Role labels stay with the caller. This module does not rank, qualify,
 * or close evidence batches.
 */
import type { EmbeddedAgentRunResult } from "../embedded-agent-runner/types.js";
import { isFailoverError } from "../failover-error.js";
import type { EmbeddedReplayFact } from "./embedded-replay-observation.js";
import {
  annotateExecutedToolRole,
  runScheduledReplay,
  selectReplayCases,
  type ShadowEvidenceBatch,
  type ShadowQualificationReplayCase,
  type ShadowReplayRuntime,
  type ShadowReplayRuntimeResult,
  type ShadowReplayTool,
} from "./shadow-evidence-collector.js";
import {
  SHADOW_CONTAINMENT_SCHEMA_VERSION,
  SHADOW_QUALIFICATION_POLICY_VERSION,
  SHADOW_RANKER_VERSION,
  type ShadowToolRole,
  type ToolRoleSource,
} from "./shadow-traffic.js";
import type { RankingEpoch, ToolRankingShadowObservation } from "./tool-ranking-shadow.js";

const REPLAY_SESSION_NAMESPACE = "qualification/v1d-1";
const DEFAULT_REPLAY_TIMEOUT_MS = 120_000;

export type ReplayRunStatus = "completed" | "runtime-error" | "model-error" | "aborted";

export type EmbeddedReplayVersions = {
  schemaVersion: typeof SHADOW_CONTAINMENT_SCHEMA_VERSION;
  rankerVersion: typeof SHADOW_RANKER_VERSION;
  qualificationPolicyVersion: typeof SHADOW_QUALIFICATION_POLICY_VERSION;
};

/**
 * What the model is allowed to see. Trusted tool roles are not fields here.
 */
export type EmbeddedReplayRequest = {
  runId: string;
  turnId: string;
  prompt: string;
  fixtureId?: string;
  /** Isolation key only. It is not a tool role and it is not sent as instructions. */
  caseId?: string;
  authorizedToolNames: readonly string[];
};

export type EmbeddedReplayExecutedTool = {
  name: string;
  executionStarted: boolean;
  success?: boolean;
  toolCallId?: string;
  executionId?: string;
  startedAt?: number;
  completedAt?: number;
};

export type EmbeddedReplayResult = {
  runId: string;
  turnId: string;
  terminal: "success" | "failed" | "aborted";
  executedTools: EmbeddedReplayExecutedTool[];
};

export type EmbeddedReplayExecution = {
  status: ReplayRunStatus;
  result: EmbeddedReplayResult;
  versions: EmbeddedReplayVersions;
  /** Set only when the run completed and the attempt observed a ranking. */
  runtimeResult?: ShadowReplayRuntimeResult;
};

export type EmbeddedReplayFixture = {
  id: string;
  workspaceDir: string;
  cwd?: string;
};

export type EmbeddedReplayAgentRunner = (
  params: RunEmbeddedAgentParams,
) => Promise<EmbeddedAgentRunResult>;

export type EmbeddedReplayRuntimeOptions = {
  /** Defaults to the canonical `runEmbeddedAgent` turn loop. */
  runner?: EmbeddedReplayAgentRunner;
  workspaceDir: string;
  fixtures?: readonly EmbeddedReplayFixture[];
  timeoutMs?: number;
  provider?: string;
  model?: string;
  config?: RunEmbeddedAgentParams["config"];
  /** Normal deny policy. An allowlist must not delete these entries. */
  conversationToolPolicy?: RunEmbeddedAgentParams["conversationToolPolicy"];
  abortSignal?: AbortSignal;
};

export type EmbeddedReplaySkip = {
  caseId: string;
  status: Exclude<ReplayRunStatus, "completed">;
};

const MODEL_RESULT_ERROR_KINDS = new Set<string>([
  "context_overflow",
  "role_ordering",
  "image_size",
  "retry_limit",
  "incomplete_turn",
]);

export class EmbeddedReplayIncompleteError extends Error {
  readonly status: Exclude<ReplayRunStatus, "completed">;

  constructor(status: Exclude<ReplayRunStatus, "completed">) {
    super(`embedded replay ${status}`);
    this.name = "EmbeddedReplayIncompleteError";
    this.status = status;
  }
}

type ReplayEnvironment = {
  workspaceDir: string;
  cwd?: string;
};

type CollectedRanking = {
  epoch: RankingEpoch;
  turnId: string;
  observation: ToolRankingShadowObservation;
  rankings: { name: string; score: number }[];
  authorizedNames: string[];
};

let defaultRunnerPromise: Promise<EmbeddedReplayAgentRunner> | undefined;

export function embeddedReplaySessionKey(input: { caseId?: string; runId: string }): string {
  const run = sanitizeSessionSegment(input.runId);
  if (!input.caseId) {
    return `${REPLAY_SESSION_NAMESPACE}/${run}`;
  }
  return `${REPLAY_SESSION_NAMESPACE}/${sanitizeSessionSegment(input.caseId)}/${run}`;
}

/** Session ids are path names. `validateSessionId` rejects `:`, so the prefix uses a hyphen. */
export function embeddedReplaySessionId(runId: string): string {
  const segment = sanitizeSessionSegment(runId).replace(/[^\p{L}\p{N}._-]+/gu, "_");
  if (segment.length === 0 || segment === "." || segment === "..") {
    throw new EmbeddedReplayIncompleteError("runtime-error");
  }
  return `replay-session-${segment}`;
}

/** Fields that can reach the model request. Role labels are not part of this view. */
export function embeddedReplayModelMaterial(params: RunEmbeddedAgentParams): string {
  return JSON.stringify({
    prompt: params.prompt,
    transcriptPrompt: params.transcriptPrompt ?? null,
    extraSystemPrompt: params.extraSystemPrompt ?? null,
    toolsAllow: params.toolsAllow ?? null,
    clientTools: params.clientTools ?? null,
    internalEvents: params.internalEvents ?? null,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey ?? null,
    workspaceDir: params.workspaceDir,
    cwd: params.cwd ?? null,
    conversationToolPolicy: params.conversationToolPolicy ?? null,
  });
}

export async function resolveEmbeddedReplayRunner(
  runner: EmbeddedReplayAgentRunner | undefined,
): Promise<EmbeddedReplayAgentRunner> {
  if (runner) {
    return runner;
  }
  defaultRunnerPromise ??= import("../embedded-agent-runner/run-orchestrator.js").then(
    (module) => module.runEmbeddedAgent,
  );
  return await defaultRunnerPromise;
}

export async function runEmbeddedReplay(input: {
  request: EmbeddedReplayRequest;
  options: EmbeddedReplayRuntimeOptions;
}): Promise<EmbeddedReplayExecution> {
  const versions = currentReplayVersions();
  try {
    return await runEmbeddedReplayAttempt(input, versions);
  } catch (error) {
    if (error instanceof EmbeddedReplayIncompleteError) {
      return incompleteExecution(input.request, error.status, versions);
    }
    return incompleteExecution(
      input.request,
      classifyThrownReplay(error, input.options.abortSignal),
      versions,
    );
  }
}

/**
 * Shadow runtime used by `runScheduledReplay`.
 * Infrastructure failures throw so they are not stored as ranker misses.
 */
export function createEmbeddedReplayRuntime(
  options: EmbeddedReplayRuntimeOptions,
): ShadowReplayRuntime {
  return {
    async run(request) {
      const execution = await runEmbeddedReplay({
        request: {
          runId: request.runId,
          turnId: `${request.runId}:1`,
          prompt: request.prompt,
          authorizedToolNames: request.tools.map((tool) => tool.name),
          ...(request.caseId === undefined ? {} : { caseId: request.caseId }),
          ...(request.fixtureId === undefined ? {} : { fixtureId: request.fixtureId }),
        },
        options,
      });
      if (execution.status !== "completed" || !execution.runtimeResult) {
        throw new EmbeddedReplayIncompleteError(
          execution.status === "completed" ? "runtime-error" : execution.status,
        );
      }
      return execution.runtimeResult;
    },
  };
}

/**
 * Runs one selected batch. Incomplete embedded runs are skipped.
 * Completed runs still go through `runScheduledReplay` and the collector.
 */
export async function runScheduledEmbeddedReplay(input: {
  cases: readonly ShadowQualificationReplayCase[];
  batch: ShadowEvidenceBatch;
  options: EmbeddedReplayRuntimeOptions;
  toolsForCase: (replayCase: ShadowQualificationReplayCase) => readonly ShadowReplayTool[];
  limit: number;
}): Promise<{
  batch: ShadowEvidenceBatch;
  closedBatches: ShadowEvidenceBatch[];
  skipped: EmbeddedReplaySkip[];
}> {
  const selected = selectReplayCases(input);
  const runtime = createEmbeddedReplayRuntime(input.options);
  let batch = input.batch;
  const closedBatches: ShadowEvidenceBatch[] = [];
  const skipped: EmbeddedReplaySkip[] = [];
  for (const replayCase of selected) {
    try {
      const admitted = await runScheduledReplay({
        cases: [replayCase],
        batch,
        runtime,
        toolsForCase: () => input.toolsForCase(replayCase),
        limit: 1,
      });
      batch = admitted.batch;
      for (const closed of admitted.closedBatches) {
        closedBatches.push(closed);
      }
    } catch (error) {
      if (error instanceof EmbeddedReplayIncompleteError) {
        skipped.push({ caseId: replayCase.id, status: error.status });
        continue;
      }
      throw error;
    }
  }
  return { batch, closedBatches, skipped };
}

export function annotateObservedExecutions(
  result: EmbeddedReplayResult,
  labels: {
    requiredTools?: readonly string[];
    relevantTools?: readonly string[];
    roleSource: Exclude<ToolRoleSource, "unknown">;
  },
): Array<EmbeddedReplayExecutedTool & { role: ShadowToolRole; roleSource: ToolRoleSource }> {
  const replayCase: ShadowQualificationReplayCase = {
    id: "annotation",
    prompt: "",
    domain: "git",
    roleSource: labels.roleSource,
    ...(labels.requiredTools === undefined ? {} : { requiredTools: labels.requiredTools }),
    ...(labels.relevantTools === undefined ? {} : { relevantTools: labels.relevantTools }),
  };
  return result.executedTools.map((tool) => {
    const annotation = annotateExecutedToolRole(replayCase, tool.name, tool.executionStarted);
    const annotated: EmbeddedReplayExecutedTool & {
      role: ShadowToolRole;
      roleSource: ToolRoleSource;
    } = {
      name: tool.name,
      executionStarted: tool.executionStarted,
      ...(tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
      ...(tool.executionId ? { executionId: tool.executionId } : {}),
      ...(tool.startedAt === undefined ? {} : { startedAt: tool.startedAt }),
      ...(tool.completedAt === undefined ? {} : { completedAt: tool.completedAt }),
      role: annotation.role,
      roleSource: annotation.roleSource,
    };
    if (tool.success !== undefined) {
      annotated.success = tool.success;
    }
    return annotated;
  });
}

function currentReplayVersions(): EmbeddedReplayVersions {
  return {
    schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION,
    rankerVersion: SHADOW_RANKER_VERSION,
    qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
  };
}

function sanitizeSessionSegment(value: string): string {
  const cleaned = value.trim().replace(/[\\/]+/g, "_");
  if (cleaned.length === 0 || cleaned === "." || cleaned === "..") {
    throw new EmbeddedReplayIncompleteError("runtime-error");
  }
  return cleaned;
}

function resolveReplayEnvironment(
  options: EmbeddedReplayRuntimeOptions,
  fixtureId: string | undefined,
): ReplayEnvironment {
  if (fixtureId === undefined) {
    return { workspaceDir: options.workspaceDir };
  }
  const fixture = options.fixtures?.find((entry) => entry.id === fixtureId);
  if (!fixture) {
    throw new EmbeddedReplayIncompleteError("runtime-error");
  }
  if (fixture.cwd === undefined) {
    return { workspaceDir: fixture.workspaceDir };
  }
  return { workspaceDir: fixture.workspaceDir, cwd: fixture.cwd };
}

function copyConversationPolicy(
  policy: RunEmbeddedAgentParams["conversationToolPolicy"],
): RunEmbeddedAgentParams["conversationToolPolicy"] {
  if (!policy) {
    return undefined;
  }
  return {
    ...(policy.allow === undefined ? {} : { allow: [...policy.allow] }),
    ...(policy.alsoAllow === undefined ? {} : { alsoAllow: [...policy.alsoAllow] }),
    ...(policy.deny === undefined ? {} : { deny: [...policy.deny] }),
  };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) {
    return false;
  }
  return error.name === "AbortError";
}

function classifyThrownReplay(
  error: unknown,
  abortSignal: AbortSignal | undefined,
): Exclude<ReplayRunStatus, "completed"> {
  if (abortSignal?.aborted || isAbortError(error)) {
    return "aborted";
  }
  if (isFailoverError(error)) {
    return "model-error";
  }
  return "runtime-error";
}

function classifyReplayResult(
  result: EmbeddedAgentRunResult,
  abortSignal: AbortSignal | undefined,
): ReplayRunStatus {
  if (abortSignal?.aborted || result.meta.aborted) {
    return "aborted";
  }
  const kind = result.meta.error?.kind;
  if (!kind) {
    return "completed";
  }
  if (MODEL_RESULT_ERROR_KINDS.has(kind)) {
    return "model-error";
  }
  return "runtime-error";
}

function copyRanking(fact: Extract<EmbeddedReplayFact, { kind: "ranking" }>): CollectedRanking {
  return {
    epoch: fact.epoch,
    turnId: fact.turnId,
    observation: {
      ...fact.observation,
      top: fact.observation.top.map((entry) => ({ name: entry.name, score: entry.score })),
    },
    rankings: fact.rankings.map((entry) => ({ name: entry.name, score: entry.score })),
    authorizedNames: [...fact.authorizedNames],
  };
}

function rankingEquivalent(left: CollectedRanking, right: CollectedRanking): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createFactCollector(): {
  listener: (fact: EmbeddedReplayFact) => void;
  epochs: () => Array<{ ranking: CollectedRanking; terminals: EmbeddedReplayExecutedTool[] }>;
  invalid: () => boolean;
} {
  const buckets = new Map<
    RankingEpoch,
    {
      ranking: CollectedRanking;
      terminals: EmbeddedReplayExecutedTool[];
    }
  >();
  const seenExecutions = new Map<string, string>();
  let invalid = false;
  return {
    listener(fact) {
      if (fact.kind === "ranking") {
        if (!fact.epoch || !fact.turnId) {
          invalid = true;
          return;
        }
        const ranking = copyRanking(fact);
        const existing = buckets.get(fact.epoch);
        if (existing) {
          if (!rankingEquivalent(existing.ranking, ranking)) {
            invalid = true;
          }
        } else {
          buckets.set(fact.epoch, { ranking, terminals: [] });
        }
        return;
      }
      if (!fact.epoch || !fact.turnId) {
        invalid = true;
        return;
      }
      const bucket = buckets.get(fact.epoch);
      if (!bucket || bucket.ranking.turnId !== fact.turnId) {
        invalid = true;
        return;
      }
      if (fact.executionId) {
        const executionShape = JSON.stringify({
          epoch: fact.epoch,
          turnId: fact.turnId,
          toolCallId: fact.toolCallId ?? null,
          toolName: fact.toolName,
          executionStarted: fact.executionStarted,
          outcome: fact.outcome,
        });
        const priorShape = seenExecutions.get(fact.executionId);
        if (priorShape !== undefined) {
          if (priorShape !== executionShape) {
            invalid = true;
          }
          return;
        }
        seenExecutions.set(fact.executionId, executionShape);
      }
      bucket.terminals.push({
        name: fact.toolName,
        executionStarted: fact.executionStarted,
        success: fact.outcome === "success",
        ...(fact.toolCallId ? { toolCallId: fact.toolCallId } : {}),
        ...(fact.executionId ? { executionId: fact.executionId } : {}),
        ...(fact.startedAt === undefined ? {} : { startedAt: fact.startedAt }),
        ...(fact.completedAt === undefined ? {} : { completedAt: fact.completedAt }),
      });
    },
    epochs: () =>
      [...buckets.values()].map(({ ranking, terminals }) => ({
        ranking: {
          ...ranking,
          observation: {
            ...ranking.observation,
            top: ranking.observation.top.map((entry) => ({ ...entry })),
          },
          rankings: ranking.rankings.map((entry) => ({ ...entry })),
          authorizedNames: [...ranking.authorizedNames],
        },
        terminals: terminals.map((tool) => ({ ...tool })),
      })),
    invalid: () => invalid,
  };
}

function resultTerminal(
  status: ReplayRunStatus,
  tools: readonly EmbeddedReplayExecutedTool[],
): EmbeddedReplayResult["terminal"] {
  if (status === "aborted") {
    return "aborted";
  }
  if (status !== "completed") {
    return "failed";
  }
  if (tools.some((tool) => tool.executionStarted && tool.success === false)) {
    return "failed";
  }
  return "success";
}

function incompleteExecution(
  request: EmbeddedReplayRequest,
  status: Exclude<ReplayRunStatus, "completed">,
  versions: EmbeddedReplayVersions,
): EmbeddedReplayExecution {
  return {
    status,
    versions,
    result: {
      runId: request.runId,
      turnId: request.turnId,
      terminal: resultTerminal(status, []),
      executedTools: [],
    },
  };
}

function runtimeResultFromFacts(
  epochs: readonly {
    ranking: CollectedRanking;
    terminals: readonly EmbeddedReplayExecutedTool[];
  }[],
): ShadowReplayRuntimeResult {
  return {
    epochs: epochs.map(({ ranking, terminals }) => ({
      epoch: ranking.epoch,
      turnId: ranking.turnId,
      observation: ranking.observation,
      rankings: ranking.rankings,
      authorizedNames: ranking.authorizedNames,
      terminals: terminals.map((tool) => ({
        toolName: tool.name,
        executed: tool.executionStarted,
        succeeded: tool.success === true,
        ...(tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
        ...(tool.executionId ? { executionId: tool.executionId } : {}),
        ...(tool.startedAt === undefined ? {} : { startedAt: tool.startedAt }),
        ...(tool.completedAt === undefined ? {} : { completedAt: tool.completedAt }),
      })),
    })),
  };
}

async function runEmbeddedReplayAttempt(
  input: { request: EmbeddedReplayRequest; options: EmbeddedReplayRuntimeOptions },
  versions: EmbeddedReplayVersions,
): Promise<EmbeddedReplayExecution> {
  if (input.options.abortSignal?.aborted) {
    return incompleteExecution(input.request, "aborted", versions);
  }
  const toolsAllow = [...input.request.authorizedToolNames];
  const environment = resolveReplayEnvironment(input.options, input.request.fixtureId);
  const sessionKey = embeddedReplaySessionKey({
    runId: input.request.runId,
    ...(input.request.caseId === undefined ? {} : { caseId: input.request.caseId }),
  });
  const collector = createFactCollector();
  const conversationToolPolicy = copyConversationPolicy(input.options.conversationToolPolicy);
  const runner = await resolveEmbeddedReplayRunner(input.options.runner);
  // Direct helper runs have to carry the same admission the canonical loop requires.
  const preparedRunAdmission = prepareSystemAgentRunAdmission(
    input.options.config ?? {},
    input.request.runId,
    "main",
    "capability-intelligence.embedded-replay",
  );
  let result: EmbeddedAgentRunResult;
  try {
    result = await runner({
      runId: input.request.runId,
      prompt: input.request.prompt,
      toolsAllow,
      sessionId: embeddedReplaySessionId(input.request.runId),
      sessionKey,
      workspaceDir: environment.workspaceDir,
      ...(environment.cwd === undefined ? {} : { cwd: environment.cwd }),
      timeoutMs: input.options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS,
      disableTrajectory: true,
      preparedRunAdmission,
      authProfileFailurePolicy: "local",
      cleanupBundleMcpOnRunEnd: true,
      onEmbeddedReplayFact: collector.listener,
      ...(input.options.provider === undefined ? {} : { provider: input.options.provider }),
      ...(input.options.model === undefined ? {} : { model: input.options.model }),
      ...(input.options.config === undefined ? {} : { config: input.options.config }),
      ...(conversationToolPolicy === undefined ? {} : { conversationToolPolicy }),
      ...(input.options.abortSignal === undefined
        ? {}
        : { abortSignal: input.options.abortSignal }),
    });
  } finally {
    preparedRunAdmission.close();
  }
  const status = classifyReplayResult(result, input.options.abortSignal);
  if (status !== "completed") {
    return incompleteExecution(input.request, status, versions);
  }
  const epochs = collector.epochs();
  if (collector.invalid() || epochs.length === 0) {
    return incompleteExecution(input.request, "runtime-error", versions);
  }
  const executedTools = epochs.flatMap(({ terminals }) => terminals);
  return {
    status,
    versions,
    result: {
      runId: input.request.runId,
      turnId: input.request.turnId,
      terminal: resultTerminal(status, executedTools),
      executedTools,
    },
    runtimeResult: runtimeResultFromFacts(epochs),
  };
}
