import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyPromptToolsAllow: vi.fn(),
  beforeAgentRun: vi.fn(),
  handlePromptError: vi.fn(),
  handleMidTurnPrecheck: vi.fn(),
  observePrompt: vi.fn(),
  prepareGooglePromptCache: vi.fn(),
  preparePromptAssembly: vi.fn(),
  preparePromptContext: vi.fn(),
  preparePromptExecution: vi.fn(),
  preparePromptPreflight: vi.fn(),
  releasePendingSteering: vi.fn(),
  removeTrailingPrecheckError: vi.fn(),
  resolveApiKey: vi.fn(),
  submitPrompt: vi.fn(),
  debug: vi.fn(),
  isDebugEnabled: vi.fn(() => true),
  warn: vi.fn(),
}));

vi.mock("../../subagents/registry/subagent-registry.js", () => ({
  releasePendingAgentSteeringItems: mocks.releasePendingSteering,
}));
vi.mock("../google-prompt-cache.js", () => ({
  prepareGooglePromptCacheStreamFn: mocks.prepareGooglePromptCache,
}));
vi.mock("../logger.js", () => ({
  log: { debug: mocks.debug, isEnabled: mocks.isDebugEnabled, warn: mocks.warn },
}));
vi.mock("../stream-resolution.js", () => ({
  resolveEmbeddedAgentApiKey() {
    return mocks.resolveApiKey();
  },
}));
vi.mock("./attempt-before-agent-run.js", () => ({
  runEmbeddedAttemptBeforeAgentRun: mocks.beforeAgentRun,
}));
vi.mock("./attempt-prompt-build.js", () => ({
  prepareEmbeddedAttemptPromptAssembly: mocks.preparePromptAssembly,
  prepareEmbeddedAttemptPromptContext: mocks.preparePromptContext,
}));
vi.mock("./attempt-prompt-submit.js", () => ({
  handleEmbeddedAttemptPromptError: mocks.handlePromptError,
  prepareEmbeddedAttemptPromptExecution: mocks.preparePromptExecution,
  submitEmbeddedAttemptPrompt: mocks.submitPrompt,
}));
vi.mock("./attempt-prompt-preflight.js", () => ({
  handleEmbeddedAttemptMidTurnPrecheck: mocks.handleMidTurnPrecheck,
  prepareEmbeddedAttemptPromptPreflight: mocks.preparePromptPreflight,
}));
vi.mock("./attempt-prompt-support.js", () => ({
  applyPromptBuildToolsAllow: mocks.applyPromptToolsAllow,
  observeEmbeddedAttemptPrompt: mocks.observePrompt,
}));
vi.mock("./attempt-transcript-helpers.js", () => ({
  removeTrailingMidTurnPrecheckAssistantError: mocks.removeTrailingPrecheckError,
}));

import type { EmbeddedReplayFact } from "../../capability-intelligence/embedded-replay-observation.js";
import { createToolRankingShadowTracker } from "../../capability-intelligence/tool-ranking-shadow.js";
import { runEmbeddedAttemptPromptPhase } from "./attempt-prompt-phase.js";
import type { prepareEmbeddedAttemptPromptPreflight } from "./attempt-prompt-preflight.js";
import type { submitEmbeddedAttemptPrompt } from "./attempt-prompt-submit.js";

type PromptPhaseInput = Parameters<typeof runEmbeddedAttemptPromptPhase>[0];
type PromptPhaseState = ReturnType<PromptPhaseInput["lifecycle"]["readState"]>;
type AssemblyCall = {
  applyPromptBuildToolsAllow: (toolsAllow?: string[]) => string[];
  setLeasedSteering: (lease: { leaseId: string; runIds: string[] }) => void;
};
type PromptPreflightCall = Parameters<typeof prepareEmbeddedAttemptPromptPreflight>[0];
type PromptSubmissionCall = Parameters<typeof submitEmbeddedAttemptPrompt>[0];
type PromptErrorCall = {
  error: unknown;
  markYieldAborted: () => void;
  releaseLeasedSteering: (error?: unknown) => void;
  yieldAbortSettled: Promise<void> | null;
  yieldDetected: boolean;
  yieldMessage: string | null;
};

function createFixture() {
  const order: string[] = [];
  const state: PromptPhaseState = {
    contextBudgetStatus: undefined,
    preflightRecovery: undefined,
    promptError: null,
    promptErrorSource: null,
  };
  const yieldState = {
    yieldAbortSettled: null as Promise<void> | null,
    yieldDetected: false,
    yieldMessage: null as string | null,
  };
  const activeSession = {
    messages: [],
    agent: {
      state: { messages: [] },
      streamFn: vi.fn(),
    },
  };
  const sessionManager = {
    appendCustomEntry: vi.fn(),
    getEntries: vi.fn(() => []),
  };
  const toolRankingShadowTracker = createToolRankingShadowTracker({
    runId: "run-1",
    mode: "simulated-filter",
  });
  const recordTrajectoryEvent = vi.fn();
  let prePromptMessageCount = 1;

  const setPrePromptMessageCount = vi.fn((count: number) => {
    prePromptMessageCount = count;
  });
  const setPromptCacheChangesForTurn = vi.fn();
  const setFinalPromptText = vi.fn();
  const markBeforeAgentRunBlocked = vi.fn();
  const markYieldAborted = vi.fn(() => {
    order.push("yield-aborted");
  });
  const stopAcceptingSteerMessages = vi.fn(() => {
    order.push("stop-steering");
  });

  mocks.preparePromptAssembly.mockImplementation(async (input: AssemblyCall) => {
    order.push("assembly");
    input.applyPromptBuildToolsAllow();
    const lease = { leaseId: "lease-1", runIds: ["run-1"] };
    input.setLeasedSteering(lease);
    return {
      hookCtx: {},
      promptCacheChangesForTurn: [],
      leasedSteering: lease,
      transcriptLeafId: "leaf-1",
    };
  });
  mocks.preparePromptContext.mockImplementation(() => {
    order.push("context");
    return {
      aggregatePressureEngaged: false,
      contextTokenBudget: 32_000,
      currentUserTimestampOverride: { timestamp: 123, text: "hello" },
      effectivePrompt: "hello",
      hookMessagesForCurrentPrompt: [],
      llmBoundaryPromptForPrecheck: "hello",
      prePromptMessageCount: 2,
      promptForModel: "hello",
      promptForSession: "hello",
      promptSubmission: { prompt: "hello", runtimeOnly: false },
      promptToolResultAggregateMaxChars: 2_000,
      promptToolResultMaxChars: 1_000,
      runtimeContextMessageForCurrentTurn: { role: "custom", content: "runtime" },
      systemPromptForHook: "system",
    };
  });
  mocks.beforeAgentRun.mockImplementation(async () => {
    order.push("before-agent-run");
    return undefined;
  });
  mocks.resolveApiKey.mockResolvedValue("test-key");
  mocks.prepareGooglePromptCache.mockImplementation(async () => {
    order.push("google-cache");
    return undefined;
  });
  mocks.preparePromptExecution.mockImplementation(async () => {
    order.push("images");
    return {
      images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      imageFactIndexes: [null],
      detectedRefs: [],
      failedMediaCount: 0,
      loadedCount: 1,
      skippedCount: 0,
    };
  });
  mocks.observePrompt.mockImplementation(() => {
    order.push("observe");
    return { skipPromptSubmission: false };
  });
  mocks.preparePromptPreflight.mockImplementation(async (preflightInput: PromptPreflightCall) => {
    order.push("preflight");
    return preflightInput.state;
  });
  mocks.submitPrompt.mockImplementation(async (submissionInput: PromptSubmissionCall) => {
    order.push("submit");
    submissionInput.onFinalPromptText("hello");
    submissionInput.onSteeringAcknowledged();
  });
  mocks.applyPromptToolsAllow.mockImplementation(
    ({ effectiveTools }: { effectiveTools: Array<{ name: string }> }) => ({
      activeToolNames: effectiveTools.map(({ name }) => name),
      effectiveTools,
      uncompactedEffectiveTools: effectiveTools,
      tools: effectiveTools,
    }),
  );
  mocks.handlePromptError.mockResolvedValue({});
  const input = {
    attempt: {
      model: { id: "model-1", provider: "test" },
      modelId: "model-1",
      provider: "test",
      runId: "run-1",
      sessionId: "session-1",
      toolRankingShadowTracker,
      trajectoryRecorder: { recordEvent: recordTrajectoryEvent },
    },
    activeSession,
    sessionManager,
    withOwnedTranscriptWrite: async <T>(operation: () => Promise<T> | T) => await operation(),
    getCompactionReserveTokens: () => 77,
    assembly: {
      hookRunner: null,
      hookAgentId: "main",
      diagnosticTrace: {},
      isRawModelRun: false,
      sessionAgentId: "main",
      runtimeModel: "model-1",
      systemPromptText: "system",
      setActiveSessionSystemPrompt: vi.fn(),
      cache: {},
    },
    context: {
      includeBoundaryTimestamp: false,
      isRawModelRun: false,
      sessionAgentId: "main",
      setActiveSessionSystemPrompt: vi.fn(),
      systemPromptText: "system",
      toolResultPromptProjectionState: {},
    },
    execution: {
      mediaOwnerAgentId: "main",
      effectiveFsWorkspaceOnly: false,
      effectiveWorkspace: "/tmp/workspace",
      sandbox: null,
    },
    googlePromptCache: {
      extraParams: {},
      signal: new AbortController().signal,
    },
    observation: {
      cacheTrace: null,
      diagnosticTrace: {},
      effectiveTools: [],
      hookAgentId: "main",
      hookRunner: null,
      isRawModelRun: false,
      runTrace: {},
      streamStrategy: "default",
      systemPromptText: "system",
      toolSearchCompacted: false,
      tools: [],
      trajectoryRecorder: null,
      transport: "sse",
      uncompactedEffectiveTools: [],
    },
    preflight: {
      contextEngineAssemblySucceeded: false,
      contextEnginePromptAuthority: "assembled",
      includeBoundaryTimestamp: false,
      sessionAgentId: "main",
    },
    toolPolicy: {
      effectiveTools: [
        { name: "web_search", description: "Search the web for current information" },
        { name: "read_file", description: "Read a file from disk" },
      ],
    },
    submission: {
      promptActiveSession: vi.fn(),
      toolResultPromptProjectionState: {},
      trajectoryRecorder: null,
    },
    lifecycle: {
      readState: () => state,
      writeState: (nextState: PromptPhaseState) => {
        order.push("publish");
        Object.assign(state, nextState);
      },
      getPrePromptMessageCount: () => prePromptMessageCount,
      setPrePromptMessageCount,
      setCurrentUserTimestampOverride: vi.fn(),
      setPromptCacheChangesForTurn,
      setFinalPromptText,
      markBeforeAgentRunBlocked,
      markYieldAborted,
      isRunBudgetTimeoutAbort: () => false,
      readYieldState: () => yieldState,
      stopAcceptingSteerMessages,
      takePendingMidTurnPrecheckRequest: () => undefined,
    },
  } as unknown as PromptPhaseInput;

  return {
    input,
    markYieldAborted,
    order,
    setFinalPromptText,
    setPrePromptMessageCount,
    setPromptCacheChangesForTurn,
    state,
    toolRankingShadowTracker,
    recordTrajectoryEvent,
    yieldState,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runEmbeddedAttemptPromptPhase", () => {
  it("runs prompt work in phase order and publishes prompt outputs", async () => {
    const fixture = createFixture();

    await expect(runEmbeddedAttemptPromptPhase(fixture.input)).resolves.toEqual({
      promptStartedAt: expect.any(Number),
    });

    expect(fixture.order).toEqual([
      "assembly",
      "context",
      "before-agent-run",
      "google-cache",
      "images",
      "observe",
      "publish",
      "preflight",
      "publish",
      "submit",
      "publish",
      "stop-steering",
    ]);
    expect(fixture.setPrePromptMessageCount).toHaveBeenCalledWith(2);
    expect(fixture.setPromptCacheChangesForTurn).toHaveBeenCalledWith([]);
    expect(fixture.setFinalPromptText).toHaveBeenCalledWith("hello");
    expect(mocks.preparePromptExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "hello",
        skipPromptSubmission: false,
      }),
    );
    expect(mocks.observePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        imageCount: 1,
        reserveTokens: 77,
        transcriptLeafId: "leaf-1",
      }),
    );
    expect(mocks.submitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [expect.objectContaining({ type: "image" })],
        leasedSteering: { leaseId: "lease-1", runIds: ["run-1"] },
        modelPrompt: "hello",
        runtimeContextMessage: expect.objectContaining({ content: "runtime" }),
        transcriptLeafId: "leaf-1",
        transcriptPrompt: "hello",
      }),
    );
    expect(mocks.releasePendingSteering).not.toHaveBeenCalled();
  });

  it("records a bounded shadow ranking without changing the authorized tool surface", async () => {
    const fixture = createFixture();
    const authorizedTools = fixture.input.toolPolicy.effectiveTools;
    const preparePromptContext = mocks.preparePromptContext.getMockImplementation();
    mocks.preparePromptContext.mockImplementation(() => ({
      ...(preparePromptContext?.() as Record<string, unknown>),
      llmBoundaryPromptForPrecheck: "search the web",
    }));

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(mocks.debug).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[capability-selection\] shadow authorized=2 ranked=1 top=web_search:/,
      ),
    );
    expect(fixture.input.toolPolicy.effectiveTools).toBe(authorizedTools);
    expect(fixture.input.toolPolicy.effectiveTools).toHaveLength(2);
    expect(mocks.observePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveTools: authorizedTools }),
    );
    const shadowEvent = fixture.recordTrajectoryEvent.mock.calls.find(
      ([eventType]) => eventType === "tool-ranking.shadow",
    );
    expect(shadowEvent?.[1]).toMatchObject({
      authorizedCount: 2,
      rankedCount: 1,
      top: [{ name: "web_search", score: expect.any(Number) }],
      durationMs: expect.any(Number),
      queryTokenCount: 2,
    });
    expect(JSON.stringify(shadowEvent?.[1])).not.toContain("search the web");
    expect(shadowEvent?.[1]).not.toHaveProperty("authorizedNames");
    expect(
      fixture.toolRankingShadowTracker.recordOutcome("web_search", {
        executed: true,
        succeeded: true,
      }),
    ).toMatchObject({
      toolName: "web_search",
      shadowRank: 1,
      selectedByModel: true,
      executed: true,
      succeeded: true,
    });
    const containment = fixture.toolRankingShadowTracker.snapshot().containment;
    expect(containment).toHaveLength(1);
    expect(containment[0]).toMatchObject({
      runId: "run-1",
      selectedTool: "web_search",
      executionStarted: true,
      inTop8: true,
      role: "unknown",
      roleSource: "unknown",
      schemaVersion: 1,
      rankerVersion: "v1C",
      qualificationPolicyVersion: "v1F-2",
      family: "web",
      wouldBlockSelectedTool: false,
      wouldBlockExecutedTool: false,
      wouldBlockRequiredTool: false,
    });
    expect(JSON.stringify(containment)).not.toContain("search the web");
    expect(containment[0]).not.toHaveProperty("query");
    expect(fixture.toolRankingShadowTracker.snapshot().observation).not.toHaveProperty(
      "authorizedNames",
    );
  });

  it("emits the replay ranking from the exposed tool surface", async () => {
    const fixture = createFixture();
    const facts: EmbeddedReplayFact[] = [];
    fixture.input.attempt.onEmbeddedReplayFact = (fact) => {
      facts.push(fact);
    };
    const preparePromptContext = mocks.preparePromptContext.getMockImplementation();
    mocks.preparePromptContext.mockImplementation(() => ({
      ...(preparePromptContext?.() as Record<string, unknown>),
      llmBoundaryPromptForPrecheck: "search the web",
    }));

    await runEmbeddedAttemptPromptPhase(fixture.input);

    const fact = facts[0];
    if (!fact || fact.kind !== "ranking") {
      throw new Error("missing replay ranking");
    }
    expect(facts).toHaveLength(1);
    expect(fact.epoch).toEqual(expect.any(String));
    expect(fact.turnId).toEqual(expect.any(String));
    expect(fact.authorizedNames).toEqual(["web_search", "read_file"]);
    expect(fact.observation.top[0]?.name).toBe("web_search");
    expect(fact.rankings[0]?.name).toBe("web_search");
    expect(JSON.stringify(fact)).not.toContain("search the web");
    expect(JSON.stringify(fact)).not.toContain("requiredTools");
  });

  it("keeps the full authorized surface when the tracker mode is active", async () => {
    const fixture = createFixture();
    const authorizedTools = fixture.input.toolPolicy.effectiveTools;
    const preparePromptContext = mocks.preparePromptContext.getMockImplementation();
    mocks.preparePromptContext.mockImplementation(() => ({
      ...(preparePromptContext?.() as Record<string, unknown>),
      llmBoundaryPromptForPrecheck: "search the web",
    }));
    fixture.input.attempt.toolRankingShadowTracker = createToolRankingShadowTracker({
      runId: "run-1",
      mode: "active",
    });

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(fixture.input.toolPolicy.effectiveTools).toBe(authorizedTools);
    expect(mocks.observePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveTools: authorizedTools }),
    );
    const tracker = fixture.input.attempt.toolRankingShadowTracker;
    expect(tracker?.mode).toBe("active");
    expect(tracker?.recordOutcome("web_search", { executed: true, succeeded: true })).toMatchObject(
      {
        toolName: "web_search",
        executed: true,
        succeeded: true,
      },
    );
    expect(tracker?.snapshot().containment[0]).toMatchObject({
      mode: "active",
      inTop8: true,
      wouldBlockSelectedTool: false,
    });
    expect(JSON.stringify(tracker?.snapshot().containment)).not.toContain("search the web");
  });

  it("continues prompt preparation when shadow telemetry recording fails", async () => {
    const fixture = createFixture();
    fixture.recordTrajectoryEvent.mockImplementation(() => {
      throw new Error("trajectory write failed");
    });

    await expect(runEmbeddedAttemptPromptPhase(fixture.input)).resolves.toEqual({
      promptStartedAt: expect.any(Number),
    });
    expect(mocks.submitPrompt).toHaveBeenCalledOnce();
  });

  it("skips before_agent_run for settled-turn finalization", async () => {
    const fixture = createFixture();
    fixture.input.attempt.operation = "settled-tool-finalization";

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(mocks.beforeAgentRun).not.toHaveBeenCalled();
    expect(fixture.order).toEqual([
      "assembly",
      "context",
      "google-cache",
      "images",
      "observe",
      "publish",
      "preflight",
      "publish",
      "submit",
      "publish",
      "stop-steering",
    ]);
  });

  it("admits the provider prompt when aggregate projection pressure is only heuristic", async () => {
    const fixture = createFixture();
    const preparePromptContext = mocks.preparePromptContext.getMockImplementation();
    mocks.preparePromptContext.mockImplementation(() => ({
      ...(preparePromptContext?.() as Record<string, unknown>),
      aggregatePressureEngaged: true,
    }));

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(mocks.preparePromptExecution).toHaveBeenCalledWith(
      expect.objectContaining({ skipPromptSubmission: false }),
    );
    expect(mocks.submitPrompt).toHaveBeenCalledOnce();
  });

  it("reads yield state after submission fails and publishes abort state before recovery", async () => {
    const fixture = createFixture();
    const submissionError = new Error("submission failed");
    const yieldAbortSettled = Promise.resolve();
    mocks.submitPrompt.mockImplementation(async () => {
      fixture.order.push("submit");
      fixture.yieldState.yieldDetected = true;
      fixture.yieldState.yieldAbortSettled = yieldAbortSettled;
      fixture.yieldState.yieldMessage = "yield context";
      throw submissionError;
    });
    mocks.handlePromptError.mockImplementation(async (input: PromptErrorCall) => {
      fixture.order.push("prompt-error");
      expect(input.yieldDetected).toBe(true);
      expect(input.yieldAbortSettled).toBe(yieldAbortSettled);
      expect(input.yieldMessage).toBe("yield context");
      input.releaseLeasedSteering(input.error);
      input.markYieldAborted();
      return {};
    });

    await expect(runEmbeddedAttemptPromptPhase(fixture.input)).resolves.toEqual({
      promptStartedAt: expect.any(Number),
    });

    expect(fixture.order.slice(-4)).toEqual([
      "submit",
      "prompt-error",
      "yield-aborted",
      "stop-steering",
    ]);
    expect(fixture.markYieldAborted).toHaveBeenCalledOnce();
    expect(mocks.releasePendingSteering).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: "lease-1", runIds: ["run-1"] }),
    );
  });

  it("keeps a run-budget timeout failure-free for partial-output salvage", async () => {
    const fixture = createFixture();
    const timeoutAbort = new Error("request timed out");
    mocks.submitPrompt.mockRejectedValueOnce(timeoutAbort);
    mocks.handlePromptError.mockResolvedValueOnce({
      promptFailure: { error: timeoutAbort, source: "prompt" },
    });
    fixture.input.lifecycle.isRunBudgetTimeoutAbort = (error) => error === timeoutAbort;

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(fixture.state.promptError).toBeNull();
    expect(fixture.state.promptErrorSource).toBeNull();
  });

  it("records a provider failure that races a run-budget timeout", async () => {
    const fixture = createFixture();
    const providerError = new Error("provider failed");
    mocks.submitPrompt.mockRejectedValueOnce(providerError);
    mocks.handlePromptError.mockResolvedValueOnce({
      promptFailure: { error: providerError, source: "prompt" },
    });
    fixture.input.lifecycle.isRunBudgetTimeoutAbort = () => false;

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(fixture.state.promptError).toBe(providerError);
    expect(fixture.state.promptErrorSource).toBe("prompt");
  });

  it("releases steering when preflight skips provider submission", async () => {
    const fixture = createFixture();
    const promptError = new Error("preflight rejected");
    mocks.preparePromptExecution.mockResolvedValueOnce({
      images: [],
      imageFactIndexes: [],
      detectedRefs: [],
      failedMediaCount: 1,
      loadedCount: 0,
      skippedCount: 1,
    });
    mocks.observePrompt.mockImplementationOnce(() => {
      fixture.order.push("observe");
      return { skipPromptSubmission: true };
    });
    mocks.preparePromptPreflight.mockImplementationOnce(
      async (preflightInput: PromptPreflightCall) => {
        fixture.order.push("preflight");
        return {
          ...preflightInput.state,
          promptError,
          promptErrorSource: "precheck",
        };
      },
    );

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(fixture.state.promptError).toBe(promptError);
    expect(mocks.releasePendingSteering).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "preflight rejected",
        leaseId: "lease-1",
        runIds: ["run-1"],
      }),
    );
    expect(mocks.submitPrompt).not.toHaveBeenCalled();
  });

  it("publishes preflight state before a submission failure", async () => {
    const fixture = createFixture();
    const promptError = new Error("admission warning");
    const submitError = new Error("provider failed");
    mocks.preparePromptPreflight.mockImplementationOnce(
      async (preflightInput: PromptPreflightCall) => {
        fixture.order.push("preflight");
        return {
          ...preflightInput.state,
          promptError,
          promptErrorSource: "precheck",
        };
      },
    );
    mocks.submitPrompt.mockImplementationOnce(async () => {
      fixture.order.push("submit");
      expect(fixture.state.promptError).toBe(promptError);
      throw submitError;
    });
    mocks.handlePromptError.mockImplementationOnce(async (errorInput: PromptErrorCall) => {
      fixture.order.push("prompt-error");
      expect(errorInput.error).toBe(submitError);
      return {};
    });

    await runEmbeddedAttemptPromptPhase(fixture.input);

    expect(fixture.order.slice(-5)).toEqual([
      "preflight",
      "publish",
      "submit",
      "prompt-error",
      "stop-steering",
    ]);
  });
});
