import { describe, expect, it } from "vitest";
import { applyEmbeddedAttemptToolsAllow } from "../embedded-agent-runner/run/attempt-tool-construction-plan.js";
import type { RunEmbeddedAgentParams } from "../embedded-agent-runner/run/params.js";
import type { EmbeddedAgentRunResult } from "../embedded-agent-runner/types.js";
import { FailoverError } from "../failover-error.js";
import { applyToolPolicyPipeline } from "../tool-policy-pipeline.js";
import { createToolTerminalObserver } from "../tool-terminal-outcome.js";
import {
  annotateObservedExecutions,
  createEmbeddedReplayRuntime,
  embeddedReplayModelMaterial,
  embeddedReplaySessionId,
  EmbeddedReplayIncompleteError,
  resolveEmbeddedReplayRunner,
  runEmbeddedReplay,
  runScheduledEmbeddedReplay,
  type EmbeddedReplayExecutedTool,
  type EmbeddedReplayRequest,
  type EmbeddedReplayRuntimeOptions,
} from "./embedded-replay-runtime.js";
import { rankAgentTools } from "./rank-agent-tools.js";
import {
  createShadowEvidenceBatch,
  ingestRuntimeReplay,
  runScheduledReplay,
  shadowEvidenceEvents,
  type ShadowQualificationReplayCase,
  type ShadowReplayTool,
} from "./shadow-evidence-collector.js";
import { renderShadowQualificationReport } from "./shadow-qualification-report.js";
import { qualifyShadowTraffic } from "./shadow-qualification.js";
import {
  ACTIVE_FILTERING_ENABLED,
  SHADOW_CONTAINMENT_SCHEMA_VERSION,
  SHADOW_QUALIFICATION_POLICY_VERSION,
  SHADOW_RANKER_VERSION,
} from "./shadow-traffic.js";

const PROMPT = "Inspect the repository and report the failing check.";
const HIDDEN_TOOL = "some_unrelated_tool";
const WORKSPACE = "G:/tmp/openclaw-replay-workspace";

type PolicyTool = Parameters<typeof applyToolPolicyPipeline>[0]["tools"][number];

function replayRequest(overrides: Partial<EmbeddedReplayRequest> = {}): EmbeddedReplayRequest {
  return {
    runId: "run-1",
    turnId: "run-1:1",
    prompt: PROMPT,
    caseId: "git-pytest",
    authorizedToolNames: ["read", "exec", "web_search"],
    ...overrides,
  };
}

function replayCase(
  id: string,
  domain: ShadowQualificationReplayCase["domain"],
  overrides: Partial<ShadowQualificationReplayCase> = {},
): ShadowQualificationReplayCase {
  return {
    id,
    prompt: `${PROMPT} ${id}`,
    domain,
    roleSource: "benchmark",
    requiredTools: ["pytest"],
    relevantTools: ["read"],
    expectedOutcome: "success",
    workflowContract: [HIDDEN_TOOL],
    ...overrides,
  };
}

function runResult(
  overrides: Partial<EmbeddedAgentRunResult["meta"]> = {},
): EmbeddedAgentRunResult {
  return { meta: { durationMs: 5, ...overrides } };
}

function rankingFact(
  params: RunEmbeddedAgentParams,
  rankings: ReadonlyArray<{ name: string; score: number }> = (params.toolsAllow ?? []).map(
    (name) => ({ name, score: 1 }),
  ),
  authorizedNames: readonly string[] = params.toolsAllow ?? [],
  correlation = { epoch: "epoch-1", turnId: "turn-1" },
): void {
  params.onEmbeddedReplayFact?.({
    kind: "ranking",
    ...correlation,
    observation: {
      authorizedCount: authorizedNames.length,
      rankedCount: rankings.length,
      top: rankings.slice(0, 8).map((entry) => ({ name: entry.name, score: entry.score })),
      durationMs: 1,
      queryTokenCount: 2,
    },
    rankings,
    authorizedNames,
  });
}

function terminalFact(
  params: RunEmbeddedAgentParams,
  input: {
    toolName: string;
    executionStarted: boolean;
    outcome: "success" | "failure";
  },
  correlation = { epoch: "epoch-1", turnId: "turn-1" },
): void {
  params.onEmbeddedReplayFact?.({ kind: "terminal", ...correlation, ...input });
}

function scriptedRunner(input: {
  seen: RunEmbeddedAgentParams[];
  onRun: (
    params: RunEmbeddedAgentParams,
  ) => Promise<EmbeddedAgentRunResult> | EmbeddedAgentRunResult;
}) {
  return async (params: RunEmbeddedAgentParams): Promise<EmbeddedAgentRunResult> => {
    input.seen.push(params);
    return await input.onRun(params);
  };
}

function options(
  runner: EmbeddedReplayRuntimeOptions["runner"],
  overrides: Partial<EmbeddedReplayRuntimeOptions> = {},
): EmbeddedReplayRuntimeOptions {
  return {
    runner,
    workspaceDir: WORKSPACE,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function terminalTool(
  name: string,
  executionStarted: boolean,
  outcome: "success" | "failure",
): EmbeddedReplayExecutedTool {
  return {
    name,
    executionStarted,
    success: outcome === "success",
  };
}

describe("embedded replay runtime", () => {
  it("sends the prompt and the complete supplied allowlist to the embedded runtime", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const names = ["read", "exec", "web_search"];
    const execution = await runEmbeddedReplay({
      request: replayRequest({ authorizedToolNames: names }),
      options: options(
        scriptedRunner({
          seen,
          onRun: (params) => {
            rankingFact(params);
            terminalFact(params, { toolName: "read", executionStarted: true, outcome: "success" });
            return runResult();
          },
        }),
      ),
    });
    const params = seen[0];
    if (!params) {
      throw new Error("embedded runtime was not called");
    }

    expect(params.prompt).toBe(PROMPT);
    expect(params.preparedRunAdmission?.operationalRunInstance.runId).toBe("run-1");
    expect(params.authProfileFailurePolicy).toBe("local");
    expect(params.extraSystemPrompt).toBeUndefined();
    expect(params.toolsAllow).toEqual(names);
    expect(params.toolsAllow).not.toBe(names);
    expect(params.transcriptPrompt).toBeUndefined();
    expect(params.clientTools).toBeUndefined();
    expect(execution.status).toBe("completed");
    expect(execution.result.terminal).toBe("success");
    expect(execution.result.executedTools).toEqual([terminalTool("read", true, "success")]);
    expect(execution.versions).toEqual({
      schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION,
      rankerVersion: SHADOW_RANKER_VERSION,
      qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    });
  });

  it("keeps a denied tool denied when the supplied allowlist names it", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const supplied = ["git_diff", "read", "pytest"];
    const execution = await runEmbeddedReplay({
      request: replayRequest({ authorizedToolNames: supplied }),
      options: options(
        scriptedRunner({
          seen,
          onRun: (params) => {
            rankingFact(params, [{ name: "read", score: 1 }], ["read"]);
            return runResult();
          },
        }),
        { conversationToolPolicy: { deny: ["git_diff"] } },
      ),
    });
    const params = seen[0];
    if (!params) {
      throw new Error("embedded runtime was not called");
    }

    expect(params.toolsAllow).toEqual(supplied);
    expect(params.conversationToolPolicy?.deny).toEqual(["git_diff"]);
    expect(params.forceMessageTool).toBeUndefined();
    const catalog = [{ name: "read" }, { name: "git_diff" }, { name: "exec" }] as PolicyTool[];
    const denied = applyToolPolicyPipeline({
      tools: catalog,
      toolMeta: () => undefined,
      warn: () => {},
      steps: [{ policy: { deny: ["git_diff"] }, label: "replay-normal-policy" }],
    });
    const allowlistOnly = applyEmbeddedAttemptToolsAllow(catalog, supplied).map(
      (tool) => tool.name,
    );
    const replaySurface = applyEmbeddedAttemptToolsAllow(denied, params.toolsAllow).map(
      (tool) => tool.name,
    );

    expect(allowlistOnly).toEqual(["read", "git_diff"]);
    expect(replaySurface).toEqual(["read"]);
    expect(execution.runtimeResult?.epochs[0]?.authorizedNames).toEqual(["read"]);
  });

  it("does not put hidden tool-role labels in the model request", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const hiddenLabels = {
      requiredTools: [HIDDEN_TOOL],
      relevantTools: ["read"],
      roleSource: "benchmark" as const,
    };
    const execution = await runEmbeddedReplay({
      request: replayRequest({
        authorizedToolNames: ["read", "exec"],
        prompt: PROMPT,
      }),
      options: options(
        scriptedRunner({
          seen,
          onRun: (params) => {
            rankingFact(params);
            params.onAgentToolResult?.({
              toolName: HIDDEN_TOOL,
              result: { ok: true },
              isError: false,
            });
            terminalFact(params, { toolName: "read", executionStarted: true, outcome: "success" });
            return runResult();
          },
        }),
      ),
    });
    const params = seen[0];
    if (!params) {
      throw new Error("embedded runtime was not called");
    }
    const material = embeddedReplayModelMaterial(params);
    const annotated = annotateObservedExecutions(execution.result, hiddenLabels);

    expect(material).not.toContain(HIDDEN_TOOL);
    expect(material).not.toContain("requiredTools");
    expect(material).not.toContain("relevantTools");
    expect(material).not.toContain("expectedOutcome");
    expect(material).not.toContain("roleSource");
    expect(material).not.toContain("workflowContract");
    expect(annotated.map((tool) => tool.name)).toEqual(["read"]);
    expect(annotated[0]).toMatchObject({
      executionStarted: true,
      role: "relevant",
      roleSource: "benchmark",
    });
    expect(annotated.some((tool) => tool.name === HIDDEN_TOOL)).toBe(false);
  });

  it("records terminal facts and leaves a tool result that never started out of the batch", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const observer = createToolTerminalObserver("replay-terminal-run");
    const blocked = observer({
      toolCallId: "call-blocked",
      toolName: "git_diff",
      executionStarted: false,
      outcome: "success",
    });
    const failed = observer({
      toolCallId: "call-failed",
      toolName: "pytest",
      executionStarted: true,
      outcome: "failure",
    });
    const tools: ShadowReplayTool[] = [
      { name: "read", description: "Read source files and inspect project contents" },
      { name: "pytest", description: "Run Python tests" },
      { name: "git_diff", description: "Show uncommitted git diffs" },
      { name: "exec", description: "Run a shell command" },
    ];
    const replay = replayCase("git-pytest", "git", {
      requiredTools: ["pytest", "git_diff", HIDDEN_TOOL],
      relevantTools: ["read"],
      fixtureId: "repo-dirty",
    });
    const runtime = createEmbeddedReplayRuntime(
      options(
        scriptedRunner({
          seen,
          onRun: (params) => {
            params.onAgentToolResult?.({
              toolName: "exec",
              result: { content: "ran" },
              isError: false,
            });
            rankingFact(
              params,
              [{ name: "read", score: 0.2 }],
              tools.map((tool) => tool.name),
            );
            terminalFact(params, {
              toolName: "git_diff",
              executionStarted: blocked.executionStarted,
              outcome: "success",
            });
            terminalFact(params, {
              toolName: "pytest",
              executionStarted: failed.executionStarted,
              outcome: "failure",
            });
            terminalFact(params, { toolName: "read", executionStarted: true, outcome: "success" });
            return runResult();
          },
        }),
        {
          fixtures: [
            { id: "repo-dirty", workspaceDir: "G:/tmp/fixture-repo", cwd: "G:/tmp/fixture-repo" },
          ],
        },
      ),
    );

    const collected = await runScheduledReplay({
      cases: [replay],
      batch: createShadowEvidenceBatch("batch-terminals"),
      runtime,
      toolsForCase: () => tools,
      limit: 1,
    });
    const events = shadowEvidenceEvents(collected.batch);
    const params = seen[0];
    if (!params) {
      throw new Error("embedded runtime was not called");
    }

    expect(blocked.executionStarted).toBe(false);
    expect(failed.executionStarted).toBe(true);
    expect(params.prompt).toBe(replay.prompt);
    expect(params.sessionKey).toBe(
      "qualification/v1d-1/git-pytest/replay:batch-terminals:git-pytest:1",
    );
    expect(params.sessionId).toBe("replay-session-replay_batch-terminals_git-pytest_1");
    expect(params.toolsAllow).toEqual(tools.map((tool) => tool.name));
    expect(params.workspaceDir).toBe("G:/tmp/fixture-repo");
    expect(params.cwd).toBe("G:/tmp/fixture-repo");
    expect(embeddedReplayModelMaterial(params)).not.toContain(HIDDEN_TOOL);
    expect(events.map((event) => event.selectedTool)).toEqual(["git_diff", "pytest", "read"]);
    expect(events[0]).toMatchObject({
      selectedTool: "git_diff",
      executionStarted: false,
      role: "unknown",
      roleSource: "unknown",
    });
    expect(events[1]).toMatchObject({
      selectedTool: "pytest",
      executionStarted: true,
      success: false,
      role: "required",
      roleSource: "benchmark",
    });
    expect(events[2]).toMatchObject({
      selectedTool: "read",
      executionStarted: true,
      success: true,
      role: "relevant",
      roleSource: "benchmark",
      inTop8: true,
    });
    expect(events.some((event) => event.selectedTool === "exec")).toBe(false);
    expect(collected.batch.closed).toBe(false);
    expect(exportContainsPrompt(collected.batch)).toBe(false);
  });

  it("preserves a completed tool failure without calling it a model error", async () => {
    const execution = await runEmbeddedReplay({
      request: replayRequest(),
      options: options(
        scriptedRunner({
          seen: [],
          onRun: (params) => {
            rankingFact(params);
            terminalFact(params, {
              toolName: "pytest",
              executionStarted: true,
              outcome: "failure",
            });
            return runResult();
          },
        }),
      ),
    });

    expect(execution.status).toBe("completed");
    expect(execution.result.terminal).toBe("failed");
    expect(execution.result.executedTools).toEqual([terminalTool("pytest", true, "failure")]);
    expect(execution.runtimeResult?.epochs[0]?.terminals[0]).toMatchObject({
      toolName: "pytest",
      executed: true,
      succeeded: false,
    });
  });

  it("keeps terminal facts bound to the ranking epoch that exposed them", async () => {
    const execution = await runEmbeddedReplay({
      request: replayRequest(),
      options: options(
        scriptedRunner({
          seen: [],
          onRun: (params) => {
            rankingFact(params, [{ name: "read", score: 1 }], ["read"], {
              epoch: "epoch-a",
              turnId: "turn-a",
            });
            terminalFact(
              params,
              { toolName: "read", executionStarted: true, outcome: "success" },
              { epoch: "epoch-a", turnId: "turn-a" },
            );
            rankingFact(params, [{ name: "exec", score: 2 }], ["exec"], {
              epoch: "epoch-b",
              turnId: "turn-b",
            });
            terminalFact(
              params,
              { toolName: "exec", executionStarted: true, outcome: "success" },
              { epoch: "epoch-b", turnId: "turn-b" },
            );
            terminalFact(
              params,
              { toolName: "exec", executionStarted: false, outcome: "failure" },
              { epoch: "epoch-b", turnId: "turn-b" },
            );
            return runResult();
          },
        }),
      ),
    });

    expect(execution.status).toBe("completed");
    expect(execution.runtimeResult?.epochs).toEqual([
      expect.objectContaining({
        epoch: "epoch-a",
        turnId: "turn-a",
        rankings: [{ name: "read", score: 1 }],
        terminals: [{ toolName: "read", executed: true, succeeded: true }],
      }),
      expect.objectContaining({
        epoch: "epoch-b",
        turnId: "turn-b",
        rankings: [{ name: "exec", score: 2 }],
        terminals: [
          { toolName: "exec", executed: true, succeeded: true },
          { toolName: "exec", executed: false, succeeded: false },
        ],
      }),
    ]);
    expect(execution.runtimeResult?.epochs[1]?.terminals).not.toContainEqual(
      expect.objectContaining({ toolName: "read" }),
    );
  });

  it("deduplicates repeated observations of one execution identity", async () => {
    const execution = await runEmbeddedReplay({
      request: replayRequest(),
      options: options(
        scriptedRunner({
          seen: [],
          onRun: (params) => {
            rankingFact(params);
            const terminal = {
              kind: "terminal" as const,
              epoch: "epoch-1",
              turnId: "turn-1",
              toolCallId: "call-1",
              executionId: "exec-1",
              toolName: "read",
              executionStarted: true,
              outcome: "success" as const,
            };
            params.onEmbeddedReplayFact?.(terminal);
            params.onEmbeddedReplayFact?.(terminal);
            return runResult();
          },
        }),
      ),
    });

    expect(execution.status).toBe("completed");
    expect(execution.result.executedTools).toEqual([
      expect.objectContaining({
        name: "read",
        toolCallId: "call-1",
        executionId: "exec-1",
      }),
    ]);
  });

  it("rejects a terminal fact whose ranking epoch is unknown", async () => {
    const execution = await runEmbeddedReplay({
      request: replayRequest(),
      options: options(
        scriptedRunner({
          seen: [],
          onRun: (params) => {
            rankingFact(params, [{ name: "read", score: 1 }], ["read"]);
            terminalFact(
              params,
              { toolName: "exec", executionStarted: true, outcome: "success" },
              { epoch: "unknown", turnId: "turn-unknown" },
            );
            return runResult();
          },
        }),
      ),
    });

    expect(execution.status).toBe("runtime-error");
    expect(execution.runtimeResult).toBeUndefined();
  });

  it("rejects conflicting duplicate ranking facts for one epoch", async () => {
    const execution = await runEmbeddedReplay({
      request: replayRequest(),
      options: options(
        scriptedRunner({
          seen: [],
          onRun: (params) => {
            const correlation = { epoch: "epoch-a", turnId: "turn-a" };
            rankingFact(params, [{ name: "read", score: 1 }], ["read"], correlation);
            rankingFact(params, [{ name: "exec", score: 2 }], ["exec"], correlation);
            return runResult();
          },
        }),
      ),
    });

    expect(execution.status).toBe("runtime-error");
    expect(execution.runtimeResult).toBeUndefined();
  });

  it("gives every replay its own qualification session", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const runner = scriptedRunner({
      seen,
      onRun: (params) => {
        rankingFact(params);
        return runResult();
      },
    });
    await runEmbeddedReplay({
      request: replayRequest({ runId: "run-a", turnId: "run-a:1", caseId: "case-a" }),
      options: options(runner),
    });
    await runEmbeddedReplay({
      request: replayRequest({ runId: "run-b", turnId: "run-b:1", caseId: "case-a" }),
      options: options(runner),
    });
    const first = seen[0];
    const second = seen[1];
    if (!first || !second) {
      throw new Error("missing replay sessions");
    }

    expect(first.sessionKey).toBe("qualification/v1d-1/case-a/run-a");
    expect(second.sessionKey).toBe("qualification/v1d-1/case-a/run-b");
    expect(first.sessionId).toBe("replay-session-run-a");
    expect(second.sessionId).toBe("replay-session-run-b");
    expect(embeddedReplaySessionId("replay:batch:case:1")).toBe(
      "replay-session-replay_batch_case_1",
    );
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.sessionKey).not.toBe("agent:main:main");
    expect(first.disableTrajectory).toBe(true);
    for (const params of seen) {
      const segments = (params.sessionKey ?? "").split("/");
      expect(segments).not.toContain("..");
      expect(segments).not.toContain(".");
    }

    const escaped = await runEmbeddedReplay({
      request: replayRequest({ caseId: ".." }),
      options: options(runner),
    });
    expect(escaped.status).toBe("runtime-error");
    expect(seen).toHaveLength(2);
  });

  it("uses a fixture only to change the workspace", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const runner = scriptedRunner({
      seen,
      onRun: (params) => {
        rankingFact(params);
        return runResult();
      },
    });
    const fixtures = [
      { id: "repo-dirty", workspaceDir: "G:/tmp/fixture-repo", cwd: "G:/tmp/fixture-repo" },
      {
        id: "pytest-red",
        workspaceDir: "G:/tmp/fixture-pytest",
        cwd: "G:/tmp/fixture-pytest/pkg",
      },
    ];
    await runEmbeddedReplay({
      request: replayRequest({ fixtureId: "repo-dirty", runId: "fixture-a" }),
      options: options(runner, { fixtures }),
    });
    await runEmbeddedReplay({
      request: replayRequest({ fixtureId: "pytest-red", runId: "fixture-b" }),
      options: options(runner, { fixtures }),
    });
    const repo = seen[0];
    const tests = seen[1];
    if (!repo || !tests) {
      throw new Error("missing fixture runs");
    }

    expect(repo.prompt).toBe(tests.prompt);
    expect(repo.toolsAllow).toEqual(tests.toolsAllow);
    expect(repo.workspaceDir).toBe("G:/tmp/fixture-repo");
    expect(tests.workspaceDir).toBe("G:/tmp/fixture-pytest");
    expect(tests.cwd).toBe("G:/tmp/fixture-pytest/pkg");
    expect(repo.prompt).not.toContain("git_diff");
    expect(tests.prompt).not.toContain("pytest");
    expect(embeddedReplayModelMaterial(repo)).not.toContain("force");

    const missing = await runEmbeddedReplay({
      request: replayRequest({ fixtureId: "missing-fixture" }),
      options: options(runner, { fixtures }),
    });
    expect(missing.status).toBe("runtime-error");
    expect(seen).toHaveLength(2);
  });

  it("stamps the current versions and still lets a mismatch close the batch", async () => {
    const seen: RunEmbeddedAgentParams[] = [];
    const runtime = createEmbeddedReplayRuntime(
      options(
        scriptedRunner({
          seen,
          onRun: (params) => {
            rankingFact(params, [{ name: "read", score: 1 }], ["read"]);
            terminalFact(params, { toolName: "read", executionStarted: true, outcome: "success" });
            return runResult();
          },
        }),
      ),
    );
    const collected = await runScheduledReplay({
      cases: [replayCase("version-case", "filesystem", { requiredTools: ["read"] })],
      batch: createShadowEvidenceBatch("batch-version"),
      runtime,
      toolsForCase: () => [{ name: "read" }],
      limit: 1,
    });
    const currentEvent = collected.batch.runs[0]?.events[0];
    if (!currentEvent || !collected.batch.version) {
      throw new Error("missing stamped event");
    }
    expect(currentEvent).toMatchObject({
      schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION,
      rankerVersion: SHADOW_RANKER_VERSION,
      qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
    });
    expect(collected.batch.closed).toBe(false);

    const stale = structuredClone(collected.batch);
    const staleEvent = stale.runs[0]?.events[0];
    if (!staleEvent || !stale.version) {
      throw new Error("missing cloned event");
    }
    staleEvent.qualificationPolicyVersion = "v1D-0";
    stale.version = { ...stale.version, qualificationPolicyVersion: "v1D-0" };
    const next = ingestRuntimeReplay({
      batch: stale,
      replayCase: replayCase("version-next", "filesystem", { requiredTools: ["read"] }),
      runtimeResult: {
        epochs: [
          {
            epoch: "epoch-1",
            turnId: "turn-1",
            observation: {
              authorizedCount: 1,
              rankedCount: 1,
              top: [{ name: "read", score: 1 }],
              durationMs: 1,
              queryTokenCount: 1,
            },
            rankings: [{ name: "read", score: 1 }],
            authorizedNames: ["read"],
            terminals: [{ toolName: "read", executed: true, succeeded: true }],
          },
        ],
      },
      runId: "run-next",
    });

    expect(next.closedBatch?.closed).toBe(true);
    expect(next.closedBatch?.batchId).toBe("batch-version");
    expect(next.batch.batchId).toBe("batch-version#next");
    expect(next.batch.runs.map((run) => run.runId)).toEqual(["run-next"]);
    expect(next.batch.closed).toBe(false);
  });

  it("leaves the qualifier, report, and active filtering flag unchanged", async () => {
    const collected = await runScheduledReplay({
      cases: [replayCase("report-case", "filesystem", { requiredTools: ["read"] })],
      batch: createShadowEvidenceBatch("batch-report"),
      runtime: createEmbeddedReplayRuntime(
        options(
          scriptedRunner({
            seen: [],
            onRun: (params) => {
              rankingFact(params, [{ name: "read", score: 1 }], ["read", "exec"]);
              terminalFact(params, {
                toolName: "read",
                executionStarted: true,
                outcome: "success",
              });
              return runResult();
            },
          }),
        ),
      ),
      toolsForCase: () => [{ name: "read" }, { name: "exec" }],
      limit: 1,
    });
    const events = shadowEvidenceEvents(collected.batch);
    const qualification = qualifyShadowTraffic({
      events,
      offlineRequiredRecallPassed: true,
      offlineNdcgPassed: true,
    });
    const report = renderShadowQualificationReport(qualification, events);

    expect(ACTIVE_FILTERING_ENABLED).toBe(false);
    expect(qualification.passed).toBe(false);
    expect(qualification.activeFilteringEnabled).toBe(false);
    expect(report.startsWith("QUALIFICATION: BLOCKED")).toBe(true);
    expect(report).toContain("INFO  active filtering = OFF");
  });

  it("does not turn an infrastructure failure into a containment miss", async () => {
    const calls: string[] = [];
    const collected = await runScheduledEmbeddedReplay({
      cases: [
        replayCase("tool-failed", "coding", { requiredTools: ["pytest"] }),
        replayCase("runtime-down", "shell", { requiredTools: ["exec"] }),
        replayCase("model-down", "web", { requiredTools: ["web_search"] }),
        replayCase("run-aborted", "git", { requiredTools: ["git_diff"] }),
      ],
      batch: createShadowEvidenceBatch("batch-status"),
      limit: 4,
      toolsForCase: () => [
        { name: "pytest" },
        { name: "exec" },
        { name: "web_search" },
        { name: "git_diff" },
      ],
      options: options(async (params) => {
        calls.push(params.prompt);
        rankingFact(params);
        if (params.prompt.endsWith("tool-failed")) {
          terminalFact(params, { toolName: "pytest", executionStarted: true, outcome: "failure" });
          return runResult();
        }
        terminalFact(params, { toolName: "git_diff", executionStarted: true, outcome: "failure" });
        if (params.prompt.endsWith("runtime-down")) {
          throw new Error("session store unavailable");
        }
        if (params.prompt.endsWith("model-down")) {
          throw new FailoverError("provider unavailable", { reason: "rate_limit" });
        }
        return runResult({ aborted: true });
      }),
    });
    expect(calls).toHaveLength(4);
    expect(collected.skipped.map((skip) => skip.status).toSorted()).toEqual([
      "aborted",
      "model-error",
      "runtime-error",
    ]);
    const events = shadowEvidenceEvents(collected.batch);
    expect(events.map((event) => event.selectedTool)).toEqual(["pytest"]);
    expect(events[0]).toMatchObject({
      executionStarted: true,
      success: false,
      role: "required",
      roleSource: "benchmark",
    });
    expect(events.some((event) => event.selectedTool === "git_diff")).toBe(false);
    expect(collected.batch.closed).toBe(false);
  });

  it("stores the ranking the attempt observed", async () => {
    const tools = [
      { name: "web_search", description: "Search the web for current information" },
      { name: "read", description: "Read source files and inspect project contents" },
    ];
    const preferred = rankAgentTools(tools, "search the web");
    const collected = await runScheduledReplay({
      cases: [
        replayCase("web-basic", "web", { requiredTools: ["read"], relevantTools: undefined }),
      ],
      batch: createShadowEvidenceBatch("batch-observed-rank"),
      runtime: createEmbeddedReplayRuntime(
        options(
          scriptedRunner({
            seen: [],
            onRun: (params) => {
              rankingFact(
                params,
                [{ name: "read", score: 0.4 }],
                tools.map((tool) => tool.name),
              );
              terminalFact(params, {
                toolName: "read",
                executionStarted: true,
                outcome: "success",
              });
              return runResult();
            },
          }),
        ),
      ),
      toolsForCase: () => tools,
      limit: 1,
    });

    expect(preferred[0]?.name).toBe("web_search");
    expect(collected.batch.runs[0]?.events[0]).toMatchObject({
      selectedTool: "read",
      rankedTop8: ["read"],
      role: "required",
      roleSource: "benchmark",
    });
  });

  it("treats a finished attempt with no ranking fact as a runtime error", async () => {
    const execution = await runEmbeddedReplay({
      request: replayRequest(),
      options: options(async (params) => {
        params.onAgentToolResult?.({
          toolName: "read",
          result: { ok: true },
          isError: false,
        });
        return runResult();
      }),
    });

    expect(execution.status).toBe("runtime-error");
    expect(execution.result.executedTools).toEqual([]);
    expect(execution.runtimeResult).toBeUndefined();
    await expect(
      createEmbeddedReplayRuntime(options(async () => runResult())).run({
        runId: "run-empty",
        prompt: PROMPT,
        tools: [{ name: "read" }],
      }),
    ).rejects.toBeInstanceOf(EmbeddedReplayIncompleteError);
  });

  it("uses runEmbeddedAgent when the caller does not inject a runner", async () => {
    const { runEmbeddedAgent } = await import("../embedded-agent-runner/run-orchestrator.js");
    await expect(resolveEmbeddedReplayRunner(undefined)).resolves.toBe(runEmbeddedAgent);
  });
});

function exportContainsPrompt(batch: ReturnType<typeof createShadowEvidenceBatch>): boolean {
  return JSON.stringify(batch).includes(PROMPT);
}
