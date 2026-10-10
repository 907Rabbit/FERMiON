import { describe, expect, it } from "vitest";
import { rankAgentTools } from "./rank-agent-tools.js";
import {
  annotateExecutedToolRole,
  createShadowEvidenceBatch,
  exportShadowEvidenceBatch,
  ingestRuntimeReplay,
  loadShadowEvidenceBatch,
  runScheduledReplay,
  selectReplayCases,
  shadowEvidenceEvents,
  type ShadowEvidenceBatch,
  type ShadowQualificationReplayCase,
  type ShadowReplayRuntime,
  type ShadowReplayRuntimeResult,
} from "./shadow-evidence-collector.js";
import {
  describeEvidenceCoverage,
  evidenceCollectionDecision,
  formatReplayRepetition,
  renderCollectedEvidence,
  replayRepetition,
} from "./shadow-evidence-progress.js";
import { renderShadowQualificationReport } from "./shadow-qualification-report.js";
import { qualifyShadowTraffic } from "./shadow-qualification.js";
import {
  ACTIVE_FILTERING_ENABLED,
  SHADOW_QUALIFICATION_POLICY_VERSION,
} from "./shadow-traffic.js";

const PROMPT = "UNIQUE_PROMPT_DO_NOT_LEAK";
const FAMILY_TOOLS = ["git_status", "read", "exec", "edit", "web_search"] as const;

function replayCase(
  id: string,
  domain: ShadowQualificationReplayCase["domain"],
  overrides: Partial<ShadowQualificationReplayCase> = {},
): ShadowQualificationReplayCase {
  return {
    id,
    prompt: PROMPT,
    domain,
    roleSource: "benchmark",
    requiredTools: ["git_diff", "pytest"],
    relevantTools: ["read"],
    workflowContract: ["git_diff", "pytest", "read"],
    expectedOutcome: "success",
    ...overrides,
  };
}

let runtimeResultSequence = 0;

function runtimeResult(
  terminals: ShadowReplayRuntimeResult["epochs"][number]["terminals"],
  options?: { top?: string[]; authorizedNames?: string[] },
): ShadowReplayRuntimeResult {
  runtimeResultSequence += 1;
  const top = options?.top ?? terminals.map((terminal) => terminal.toolName);
  const names = new Set<string>([
    ...top,
    ...terminals.map((terminal) => terminal.toolName),
    ...(options?.authorizedNames ?? []),
  ]);
  return {
    epochs: [
      {
        epoch: "epoch-1",
        turnId: `turn-${runtimeResultSequence}`,
        observation: {
          authorizedCount: names.size,
          rankedCount: top.length,
          top: top.map((name) => ({ name, score: 1 })),
          durationMs: 0,
          queryTokenCount: 1,
        },
        rankings: top.map((name) => ({ name, score: 1 })),
        authorizedNames: [...names],
        terminals,
      },
    ],
  };
}

function ingest(
  batchId: string,
  replay: ShadowQualificationReplayCase,
  result: ShadowReplayRuntimeResult,
  runId = `${batchId}:${replay.id}`,
) {
  return ingestRuntimeReplay({
    batch: createShadowEvidenceBatch(batchId),
    replayCase: replay,
    runtimeResult: {
      epochs: result.epochs.map((epoch) => ({
        ...epoch,
        turnId: `${runId}:${epoch.turnId}`,
      })),
    },
    runId,
  });
}

describe("shadow evidence collector", () => {
  it("annotates only tools that actually executed and does not plan the calls", async () => {
    const replay = replayCase("git-pytest", "git", { fixtureId: "repo-a" });
    const seen: Array<Parameters<ShadowReplayRuntime["run"]>[0]> = [];
    const runtime: ShadowReplayRuntime = {
      async run(input) {
        seen.push(input);
        return runtimeResult([{ toolName: "read", executed: true, succeeded: true }], {
          top: ["read"],
        });
      },
    };
    const collected = await runScheduledReplay({
      cases: [replay],
      batch: createShadowEvidenceBatch("batch-labels"),
      runtime,
      toolsForCase: () => [{ name: "read", description: "Read a file" }],
      limit: 1,
    });
    const input = seen[0];
    expect(input).toMatchObject({
      prompt: PROMPT,
      fixtureId: "repo-a",
      caseId: "git-pytest",
      tools: [{ name: "read", description: "Read a file" }],
    });
    expect(input).not.toHaveProperty("requiredTools");
    expect(input).not.toHaveProperty("relevantTools");
    expect(input).not.toHaveProperty("workflowContract");
    expect(input).not.toHaveProperty("expectedOutcome");

    const events = shadowEvidenceEvents(collected.batch);
    expect(events.map((event) => event.selectedTool)).toEqual(["read"]);
    expect(events[0]).toMatchObject({ role: "relevant", roleSource: "benchmark" });
    expect(exportShadowEvidenceBatch(collected.batch)).not.toContain(PROMPT);
    expect(ACTIVE_FILTERING_ENABLED).toBe(false);
  });

  it("keeps a required label from putting a tool into the top 8 or rewriting failure", () => {
    const replay = replayCase("contract", "coding", { roleSource: "workflow-contract" });
    const admitted = ingest(
      "batch-roles",
      replay,
      runtimeResult(
        [
          { toolName: "git_diff", executed: true, succeeded: false },
          { toolName: "pytest", executed: false, succeeded: false },
          { toolName: "git-diff", executed: true, succeeded: true },
          { toolName: "exec", executed: true, succeeded: true },
        ],
        { top: ["exec"] },
      ),
    );
    const byTool = new Map(
      admitted.batch.runs[0]?.events.map((event) => [event.selectedTool, event]),
    );
    expect(byTool.get("git_diff")).toMatchObject({
      role: "required",
      roleSource: "workflow-contract",
      inTop8: false,
      success: false,
      executionStarted: true,
    });
    expect(byTool.get("pytest")).toMatchObject({
      role: "unknown",
      roleSource: "unknown",
      executionStarted: false,
    });
    expect(byTool.get("git-diff")).toMatchObject({ role: "unknown", roleSource: "unknown" });
    expect(byTool.get("exec")).toMatchObject({
      role: "unknown",
      roleSource: "unknown",
      inTop8: true,
    });
    expect(annotateExecutedToolRole(replay, "git_diff", false)).toEqual({
      role: "unknown",
      roleSource: "unknown",
    });
  });

  it("schedules starved domains before repeating a common case", () => {
    let batch = createShadowEvidenceBatch("batch-schedule");
    batch = ingestRuntimeReplay({
      batch,
      replayCase: replayCase("git-basic", "git"),
      runtimeResult: runtimeResult(
        Array.from({ length: 6 }, () => ({
          toolName: "git_status",
          executed: true,
          succeeded: true,
        })),
      ),
      runId: "git-run",
    }).batch;
    batch = ingestRuntimeReplay({
      batch,
      replayCase: replayCase("session-old", "sessions", { requiredTools: ["sessions_list"] }),
      runtimeResult: runtimeResult([
        { toolName: "sessions_list", executed: true, succeeded: true },
      ]),
      runId: "session-run",
    }).batch;

    const cases = [
      replayCase("git-basic", "git"),
      replayCase("session-old", "sessions", { requiredTools: ["sessions_list"] }),
      replayCase("session-new", "sessions", { requiredTools: undefined }),
      replayCase("cron-basic", "automation", { requiredTools: undefined }),
    ];
    expect(selectReplayCases({ cases, batch, limit: 3 }).map((item) => item.id)).toEqual([
      "cron-basic",
      "session-new",
      "session-old",
    ]);
    expect(describeEvidenceCoverage(batch, cases).domainCalls).toMatchObject({
      git: 6,
      sessions: 1,
      automation: 0,
    });

    const tied = [
      replayCase("session-plain", "sessions", { requiredTools: undefined }),
      replayCase("session-required", "sessions", { requiredTools: ["sessions_history"] }),
    ];
    expect(
      selectReplayCases({
        cases: tied,
        batch: createShadowEvidenceBatch("batch-tie"),
        limit: 1,
      })[0]?.id,
    ).toBe("session-required");
  });

  it("reports repeat concentration without grading it", () => {
    let batch = createShadowEvidenceBatch("batch-repeat");
    const repeated = replayCase("case-a", "git", { requiredTools: ["git_status"] });
    for (let index = 0; index < 3; index += 1) {
      batch = ingestRuntimeReplay({
        batch,
        replayCase: repeated,
        runtimeResult: runtimeResult([
          { toolName: "git_status", executed: true, succeeded: true },
          { toolName: "git_status", executed: true, succeeded: true },
        ]),
        runId: `a:${index}`,
      }).batch;
    }
    batch = ingestRuntimeReplay({
      batch,
      replayCase: replayCase("case-b", "web", { requiredTools: ["web_search"] }),
      runtimeResult: runtimeResult([{ toolName: "web_search", executed: true, succeeded: true }]),
      runId: "b:1",
    }).batch;

    expect(replayRepetition(batch)).toMatchObject({
      uniqueReplayCases: 2,
      totalReplayRuns: 4,
      maxRunsPerCase: 3,
      replayCalls: 7,
      maxCallsPerCase: 6,
      mostRepeatedCaseId: "case-a",
    });
    expect(replayRepetition(batch).rMax).toBeCloseTo(6 / 7);
    const text = formatReplayRepetition(batch);
    expect(text).toContain("Rmax = 85.7% (6/7)");
    expect(text).toContain("most repeated case = case-a");
    expect(text).not.toMatch(/^(PASS|FAIL|WARN) /m);
  });

  it("closes a batch when the loaded or next run changes version", () => {
    const current = ingest(
      "batch-version",
      replayCase("git-basic", "git", { requiredTools: ["git_status"] }),
      runtimeResult([{ toolName: "git_status", executed: true, succeeded: true }]),
      "run-current",
    );
    const exported = exportShadowEvidenceBatch(current.batch);
    const foreign = exported.replaceAll(
      `"qualificationPolicyVersion":"${SHADOW_QUALIFICATION_POLICY_VERSION}"`,
      '"qualificationPolicyVersion":"v1D-0"',
    );
    const loaded = loadShadowEvidenceBatch(foreign, current.batch);
    expect(loaded.closedBatch?.closed).toBe(true);
    expect(loaded.closedBatch?.runs.map((run) => run.runId)).toEqual(["run-current"]);
    expect(loaded.batch.runs).toHaveLength(1);
    expect(loaded.batch.runs[0]?.events[0]?.qualificationPolicyVersion).toBe("v1D-0");
    expect(
      loaded.batch.runs.some(
        (run) =>
          run.runId === "run-current" &&
          run.events[0]?.qualificationPolicyVersion === SHADOW_QUALIFICATION_POLICY_VERSION,
      ),
    ).toBe(false);

    const matching = loadShadowEvidenceBatch(exported, current.batch);
    expect(matching.closedBatch).toBeUndefined();
    expect(matching.batch.runs.map((run) => run.runId)).toEqual(["run-current", "run-current"]);

    const parsed = JSON.parse(exported) as {
      runs: Array<{ runId: string; events: Array<Record<string, unknown>> }>;
    };
    const firstRun = parsed.runs[0];
    const firstEvent = firstRun?.events[0];
    if (!firstRun || !firstEvent) {
      throw new Error("missing exported run");
    }
    const leaked = "PROMPT_STUFFED_INTO_EVENT";
    firstEvent.prompt = leaked;
    const foreignRun = structuredClone(firstRun);
    foreignRun.runId = "run-foreign";
    const foreignEvent = foreignRun.events[0];
    if (!foreignEvent) {
      throw new Error("missing cloned event");
    }
    foreignEvent.qualificationPolicyVersion = "v1D-0";
    parsed.runs.push(foreignRun);
    expect(() => loadShadowEvidenceBatch(JSON.stringify(parsed))).toThrow(
      /mixes qualification versions/,
    );
    const stuffed = JSON.parse(exported) as typeof parsed;
    const stuffedEvent = stuffed.runs[0]?.events[0];
    if (!stuffedEvent) {
      throw new Error("missing exported event");
    }
    stuffedEvent.prompt = leaked;
    expect(
      exportShadowEvidenceBatch(loadShadowEvidenceBatch(JSON.stringify(stuffed)).batch),
    ).not.toContain(leaked);

    const stale = structuredClone(current.batch);
    const staleEvent = stale.runs[0]?.events[0];
    if (!staleEvent || !stale.version) {
      throw new Error("missing current event");
    }
    staleEvent.qualificationPolicyVersion = "v1D-0";
    stale.version = { ...stale.version, qualificationPolicyVersion: "v1D-0" };
    const next = ingestRuntimeReplay({
      batch: stale,
      replayCase: replayCase("git-next", "git", { requiredTools: ["git_status"] }),
      runtimeResult: runtimeResult([{ toolName: "git_status", executed: true, succeeded: true }]),
      runId: "run-next",
    });
    expect(next.closedBatch?.closed).toBe(true);
    expect(next.closedBatch?.runs.map((run) => run.runId)).toEqual(["run-current"]);
    expect(next.batch.batchId).toBe("batch-version#next");
    expect(next.batch.runs.map((run) => run.runId)).toEqual(["run-next"]);
    expect(next.batch.runs[0]?.events[0]?.qualificationPolicyVersion).toBe(
      SHADOW_QUALIFICATION_POLICY_VERSION,
    );
  });

  it("records the runtime's call even when the real ranker preferred another tool", () => {
    const tools = [
      { name: "web_search", description: "Search the web for current information" },
      { name: "read", description: "Read source files and inspect project contents" },
    ];
    const rankings = rankAgentTools(tools, "search the web");
    const admitted = ingest(
      "batch-runtime",
      replayCase("web-basic", "web", { requiredTools: ["read"], relevantTools: undefined }),
      {
        epochs: [
          {
            epoch: "epoch-1",
            turnId: "turn-1",
            observation: {
              authorizedCount: tools.length,
              rankedCount: rankings.length,
              top: rankings.slice(0, 8),
              durationMs: 1,
              queryTokenCount: 2,
            },
            rankings,
            authorizedNames: tools.map((tool) => tool.name),
            terminals: [{ toolName: "read", executed: true, succeeded: true }],
          },
        ],
      },
    );
    expect(rankings[0]?.name).toBe("web_search");
    expect(admitted.batch.runs[0]?.events.map((event) => event.selectedTool)).toEqual(["read"]);
    expect(admitted.batch.runs[0]?.events[0]).toMatchObject({
      role: "required",
      roleSource: "benchmark",
    });
  });

  it("lets the existing qualifier stop on a measured failure without treating coverage gaps as one", () => {
    const gitCase = replayCase("git-only", "git", { requiredTools: ["git_status"] });
    let familyBatch = createShadowEvidenceBatch("batch-family");
    for (let index = 0; index < 100; index += 1) {
      familyBatch = ingestRuntimeReplay({
        batch: familyBatch,
        replayCase: gitCase,
        runtimeResult: runtimeResult(
          Array.from({ length: 5 }, () => ({
            toolName: "git_status",
            executed: true,
            succeeded: true,
          })),
        ),
        runId: `git:${index}`,
      }).batch;
    }
    const familyDecision = evidenceCollectionDecision({
      batch: familyBatch,
      cases: [
        gitCase,
        replayCase("session-needed", "sessions", { requiredTools: ["sessions_list"] }),
      ],
      offlineRequiredRecallPassed: true,
      offlineNdcgPassed: true,
    });
    expect(familyDecision).toEqual({ stop: false, reason: "continue" });
    expect(describeEvidenceCoverage(familyBatch, [gitCase]).executedCallsRemaining).toBe(0);

    const missCase = replayCase("pytest-miss", "coding", {
      requiredTools: ["git_status", "pytest"],
    });
    let missBatch = createShadowEvidenceBatch("batch-miss");
    for (let index = 0; index < 100; index += 1) {
      missBatch = ingestRuntimeReplay({
        batch: missBatch,
        replayCase: missCase,
        runtimeResult: runtimeResult(
          [
            ...FAMILY_TOOLS.map((toolName) => ({ toolName, executed: true, succeeded: true })),
            { toolName: "pytest", executed: true, succeeded: true },
          ],
          { top: [...FAMILY_TOOLS] },
        ),
        runId: `miss:${index}`,
      }).batch;
    }
    const qualification = qualifyShadowTraffic({
      events: shadowEvidenceEvents(missBatch),
      offlineRequiredRecallPassed: true,
      offlineNdcgPassed: true,
    });
    expect(qualification.executedContainmentPassed).toBe(false);
    expect(qualification.requiredExecutedCalls).toBeGreaterThan(0);
    expect(
      evidenceCollectionDecision({
        batch: missBatch,
        cases: [missCase],
        offlineRequiredRecallPassed: true,
        offlineNdcgPassed: true,
      }),
    ).toEqual({ stop: true, reason: "measured-failure" });

    let passBatch = createShadowEvidenceBatch("batch-pass");
    const passCase = replayCase("balanced", "git", { requiredTools: [...FAMILY_TOOLS] });
    for (let index = 0; index < 100; index += 1) {
      passBatch = ingestRuntimeReplay({
        batch: passBatch,
        replayCase: passCase,
        runtimeResult: runtimeResult(
          FAMILY_TOOLS.map((toolName) => ({ toolName, executed: true, succeeded: true })),
        ),
        runId: `pass:${index}`,
      }).batch;
    }
    const passDecision = evidenceCollectionDecision({
      batch: passBatch,
      cases: [passCase],
      offlineRequiredRecallPassed: true,
      offlineNdcgPassed: true,
    });
    expect(passDecision).toEqual({ stop: true, reason: "qualified" });
    const report = renderShadowQualificationReport(
      qualifyShadowTraffic({
        events: shadowEvidenceEvents(passBatch),
        offlineRequiredRecallPassed: true,
        offlineNdcgPassed: true,
      }),
      shadowEvidenceEvents(passBatch),
    );
    const collected = renderCollectedEvidence({
      batch: passBatch,
      cases: [passCase],
      offlineRequiredRecallPassed: true,
      offlineNdcgPassed: true,
    });
    expect(collected.startsWith(report)).toBe(true);
    expect(collected).toContain("EVIDENCE COVERAGE");
    expect(collected).toContain("REPLAY REPETITION");
    expect(collected).toContain("QUALIFICATION: PASS");
    expect(collected).toContain("INFO  active filtering = OFF");

    expect(
      evidenceCollectionDecision({
        batch: createShadowEvidenceBatch("batch-empty"),
        cases: [replayCase("no-role", "web", { requiredTools: undefined })],
        offlineRequiredRecallPassed: true,
        offlineNdcgPassed: true,
      }),
    ).toEqual({ stop: true, reason: "required-role-exhausted" });
  });

  it("stops v1F-2 early only after the evidence floor and an anytime upper bound below the gate", () => {
    const outsideTop = [
      "read",
      "write",
      "edit",
      "exec",
      "process",
      "web_search",
      "web_fetch",
      "message",
    ];
    const insideTop = [
      "read",
      "write",
      "edit",
      "exec",
      "process",
      "web_search",
      "web_fetch",
      "apply_patch",
    ];
    const collect = (batchId: string, calls: { toolName: string; inTop: boolean }[]) => {
      const replay = replayCase(batchId, "coding", { requiredTools: ["git_status"] });
      let batch = createShadowEvidenceBatch(batchId);
      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        if (!call) {
          continue;
        }
        batch = ingestRuntimeReplay({
          batch,
          replayCase: replay,
          runtimeResult: runtimeResult(
            [{ toolName: call.toolName, executed: true, succeeded: true }],
            { top: call.inTop ? insideTop : outsideTop },
          ),
          runId: `${batchId}:${index}`,
        }).batch;
      }
      return batch;
    };
    const restamp = (batch: ShadowEvidenceBatch, version: string) => ({
      ...batch,
      version: batch.version
        ? { ...batch.version, qualificationPolicyVersion: version }
        : batch.version,
      runs: batch.runs.map((run) => ({
        ...run,
        events: run.events.map((event) => ({ ...event, qualificationPolicyVersion: version })),
      })),
    });
    const offline = { offlineRequiredRecallPassed: true, offlineNdcgPassed: true };
    const decide = (batch: ShadowEvidenceBatch, caseId: string, requiredTools: string[]) =>
      evidenceCollectionDecision({
        batch,
        cases: [replayCase(caseId, "coding", { requiredTools })],
        ...offline,
      });
    const firstMiss = collect("v1f-first-miss", [{ toolName: "pytest", inTop: false }]);
    expect(decide(firstMiss, "v1f-first-miss", ["git_status"])).toEqual({
      stop: false,
      reason: "continue",
    });
    expect(decide(restamp(firstMiss, "v1D-1"), "v1f-first-miss", ["git_status"])).toEqual({
      stop: false,
      reason: "continue",
    });

    const template = firstMiss.runs[0]?.events[0];
    if (!template) {
      throw new Error("missing template event");
    }
    const clonedBatch = (
      batchId: string,
      calls: { toolName: string; inTop8: boolean; required?: boolean }[],
    ) => ({
      ...firstMiss,
      batchId,
      runs: calls.map((call, index) => ({
        caseId: batchId,
        runId: `${batchId}:${index}`,
        events: [
          {
            ...template,
            runId: `${batchId}:${index}`,
            turnId: `${batchId}:${index}:1`,
            selectedTool: call.toolName,
            inTop8: call.inTop8,
            executionStarted: true,
            role: call.required ? ("required" as const) : ("unknown" as const),
            roleSource: call.required ? ("benchmark" as const) : ("unknown" as const),
          },
        ],
      })),
    });
    const calls = (
      count: number,
      call: { toolName: string; inTop8: boolean; required?: boolean },
    ) => Array.from({ length: count }, () => call);
    const nearGate = clonedBatch("v1f-near-gate", [
      ...calls(97, { toolName: "read", inTop8: true }),
      ...calls(3, { toolName: "pytest", inTop8: false }),
    ]);
    expect(decide(nearGate, "v1f-near-gate", ["git_status"])).toEqual({
      stop: false,
      reason: "continue",
    });

    const belowFloor = clonedBatch(
      "v1f-below-floor",
      calls(7, { toolName: "pytest", inTop8: false }),
    );
    expect(decide(belowFloor, "v1f-below-floor", ["git_status"])).toEqual({
      stop: false,
      reason: "continue",
    });
    const almostFloor = clonedBatch(
      "v1f-almost-floor",
      calls(49, { toolName: "pytest", inTop8: false }),
    );
    expect(decide(almostFloor, "v1f-almost-floor", ["git_status"])).toEqual({
      stop: false,
      reason: "continue",
    });
    const lost = clonedBatch("v1f-lost", calls(50, { toolName: "pytest", inTop8: false }));
    expect(decide(lost, "v1f-lost", ["git_status"])).toEqual({
      stop: true,
      reason: "measured-failure",
      basis: "C8-below-gate",
    });
    expect(decide(restamp(lost, "v1D-1"), "v1f-lost", ["git_status"])).toEqual({
      stop: false,
      reason: "continue",
    });

    const observed = clonedBatch("v1f-observed", [
      ...calls(710, { toolName: "read", inTop8: true }),
      ...calls(73, { toolName: "pytest", inTop8: false }),
    ]);
    const observedCase = [replayCase("v1f-observed", "coding", { requiredTools: ["git_status"] })];
    expect(
      evidenceCollectionDecision({ batch: observed, cases: observedCase, ...offline }),
    ).toEqual({
      stop: true,
      reason: "measured-failure",
      basis: "C8-below-gate",
    });
    expect(
      evidenceCollectionDecision({
        batch: restamp(observed, "v1D-1"),
        cases: observedCase,
        ...offline,
      }),
    ).toEqual({ stop: false, reason: "continue" });
    expect(
      qualifyShadowTraffic({
        events: shadowEvidenceEvents(observed),
        ...offline,
      }).multiToolTurns,
    ).toBe(0);

    const requiredTooSmall = clonedBatch("v1f-required-small", [
      ...calls(400, { toolName: "read", inTop8: true }),
      ...calls(19, { toolName: "pytest", inTop8: false, required: true }),
    ]);
    expect(decide(requiredTooSmall, "v1f-required-small", ["pytest"])).toEqual({
      stop: false,
      reason: "continue",
    });
    const requiredLost = clonedBatch("v1f-required", [
      ...calls(400, { toolName: "read", inTop8: true }),
      ...calls(20, { toolName: "pytest", inTop8: false, required: true }),
    ]);
    expect(decide(requiredLost, "v1f-required", ["pytest"])).toEqual({
      stop: true,
      reason: "measured-failure",
      basis: "Creq8-below-gate",
    });

    const perfect = clonedBatch("v1f-perfect", calls(40, { toolName: "read", inTop8: true }));
    expect(decide(perfect, "v1f-perfect", ["read"])).toEqual({
      stop: false,
      reason: "continue",
    });
    expect(qualifyShadowTraffic({ events: shadowEvidenceEvents(perfect), ...offline }).passed).toBe(
      false,
    );

    const zeroCount = clonedBatch("v1f-zero-count", calls(60, { toolName: "read", inTop8: true }));
    const zeroEvent = zeroCount.runs[0]?.events[0];
    if (!zeroEvent) {
      throw new Error("missing zero-count event");
    }
    zeroEvent.authorizationRegression = true;
    zeroEvent.wouldBlockRequiredTool = true;
    zeroEvent.taskCriticalBlock = true;
    expect(decide(zeroCount, "v1f-zero-count", ["read"])).toEqual({
      stop: false,
      reason: "continue",
    });
  });

  it("rejects a duplicate case id", () => {
    const cases = [replayCase("same", "git"), replayCase("same", "web")];
    expect(() =>
      selectReplayCases({ cases, batch: createShadowEvidenceBatch("batch"), limit: 1 }),
    ).toThrow(/duplicate replay case id/);
  });
});
