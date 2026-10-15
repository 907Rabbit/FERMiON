import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildV1JPreflightTerminalReport,
  createV1JArmCOnlyPreflightDiagnosticJournal,
  createV1JPreflightCounters,
  evaluateV1JPreflightTerminalPredicates,
  recordV1JModelResultProvenance,
  resolveV1JSmokeRoot,
  runV1JPreflightWithTerminalReport,
  runV1JArmCPreflightOnly,
  type V1JPreflightCounters,
  V1J_FORMAL_ARTIFACT_RELATIVE_PATH,
} from "./model-choice-action-initiation-smoke.js";

function passingPreflightCounters(): V1JPreflightCounters {
  return {
    ...createV1JPreflightCounters(),
    promptSubmissions: 1,
    requestObserverInvocations: 1,
    providerBoundCaptureCallbacks: 1,
    preflightStopSignalRaised: 1,
    preflightStopSignalCaught: 1,
    preflightCompleted: 1,
  };
}

function evaluateTerminal(counters: V1JPreflightCounters) {
  return evaluateV1JPreflightTerminalPredicates({
    counters,
    requestSummaryPresent: true,
    providerBoundCaptureCount: 1,
    expectedBodyPublicationCalls: 0,
    activeFilteringEnabled: false,
  });
}

describe("v1J preflight terminal diagnostics", () => {
  it.each([
    ["before prompt submission", () => createV1JPreflightCounters()],
    [
      "after prompt submission before capture",
      () => ({ ...createV1JPreflightCounters(), promptSubmissions: 1 }),
    ],
  ])("reports predicate failures %s", (_scenario, buildCounters) => {
    const counters = buildCounters();
    const predicateEvaluations = evaluateV1JPreflightTerminalPredicates({
      counters,
      requestSummaryPresent: counters.promptSubmissions > 0,
      providerBoundCaptureCount: 0,
      expectedBodyPublicationCalls: 0,
      activeFilteringEnabled: false,
    });
    const failed = predicateEvaluations.filter((predicate) => !predicate.pass);
    expect(failed.length).toBeGreaterThan(0);
    expect(predicateEvaluations.map((predicate) => predicate.evaluationOrder)).toEqual(
      predicateEvaluations.map((_, index) => index + 1),
    );
    const report = buildV1JPreflightTerminalReport({
      counters,
      lastCompletedStage: "schema-preflight",
      blockingStage: "schema-preflight-validation",
      captureHookLiveness:
        counters.promptSubmissions > 0
          ? "PROMPT_SUBMITTED_CAPTURE_NOT_REACHED"
          : "HOOK_INSTALLED_PROMPT_NOT_SUBMITTED",
      failureClass: "Error",
      predicateEvaluations,
    });
    expect(report.PREFLIGHT_PREDICATE_FAILURES).toEqual(failed);
    expect(report.FIRST_FAILED_PREDICATE).toBe(failed[0]?.predicateName);
    expect(report.PROMPT_SUBMISSIONS).toBe(counters.promptSubmissions);
  });

  it("identifies the first failed schema predicate without weakening later gates", () => {
    const counters = passingPreflightCounters();
    counters.providerDispatchAttempts = 1;
    const predicates = evaluateTerminal(counters);
    expect(predicates.find((predicate) => !predicate.pass)).toMatchObject({
      predicateName: "providerDispatchAttemptsIsZero",
      expected: 0,
      observed: 1,
      evaluationOrder: predicates.findIndex((predicate) => !predicate.pass) + 1,
    });
    expect(predicates.at(-1)).toMatchObject({
      predicateName: "activeFilteringIsDisabled",
      expected: false,
      observed: false,
      pass: true,
    });
  });

  it("includes provider callback reachability events in the terminal report", () => {
    const event = {
      stage: "request-observer-enter",
      entered: true,
      completed: false,
      invocationCount: 1,
      runId: "offline-run",
      promptSubmissionIndex: 1,
      modelLoopIteration: 1,
      providerInstanceId: "provider-fingerprint",
      hookIdentity: "hook-registration",
      failureClass: null,
    };
    const report = buildV1JPreflightTerminalReport({
      counters: createV1JPreflightCounters(),
      lastCompletedStage: "request-observer",
      blockingStage: "provider-transform",
      captureHookLiveness: "PROMPT_SUBMITTED_CAPTURE_NOT_REACHED",
      failureClass: null,
      predicateEvaluations: null,
      providerCallbackReachability: {
        classification: "OBSERVER_WITHOUT_PROVIDER_TRANSFORM",
        events: [event],
      },
    });

    expect(report.PROVIDER_CALLBACK_REACHABILITY).toEqual({
      classification: "OBSERVER_WITHOUT_PROVIDER_TRANSFORM",
      events: [event],
    });
  });

  it("distinguishes an expected synthetic sentinel from an unaccounted model result", () => {
    const counters = passingPreflightCounters();
    const increment = (counter: keyof V1JPreflightCounters) => {
      counters[counter] += 1;
    };
    recordV1JModelResultProvenance({
      journal: { increment: (counter) => increment(counter) },
      resultKind: "synthetic-abort-result",
      details: { resultEventId: "synthetic-1" },
    });
    expect(counters.syntheticAbortResultsObserved).toBe(1);
    expect(counters.modelResultsObserved).toBe(0);
    expect(evaluateTerminal(counters).every((predicate) => predicate.pass)).toBe(true);

    recordV1JModelResultProvenance({
      journal: { increment: (counter) => increment(counter) },
      resultKind: "other",
      details: { resultEventId: "unknown-1" },
    });
    const predicates = evaluateTerminal(counters);
    expect(counters.unaccountedModelResults).toBe(1);
    expect(
      predicates.filter((predicate) => !predicate.pass).map((predicate) => predicate.predicateName),
    ).toEqual(["modelResultsObservedIsZero", "unaccountedModelResultsIsZero"]);
  });

  it.each([
    ["unexpected tool execution", "toolExecutions", "toolExecutionsIsZero"],
    ["unexpected tool result", "toolResultsProduced", "toolResultsProducedIsZero"],
    ["unexpected dispatch", "providerDispatchAttempts", "providerDispatchAttemptsIsZero"],
  ] as const)("fails closed on %s", (_label, counter, predicateName) => {
    const counters = passingPreflightCounters();
    counters[counter] = 1;
    expect(evaluateTerminal(counters).find((predicate) => !predicate.pass)?.predicateName).toBe(
      predicateName,
    );
  });

  it.each([
    ["assertion failure", Object.assign(new Error("assertion"), { name: "AssertionError" }), false],
    [
      "timeout",
      Object.assign(new Error("timeout"), { name: "V1JPreflightStageTimeoutError" }),
      false,
    ],
    [
      "thrown sentinel",
      Object.assign(new Error("sentinel"), { name: "V1IProviderRequestCapturedError" }),
      true,
    ],
  ])("emits the live counters from finally after %s", async (_label, failure, syntheticResult) => {
    const counters = passingPreflightCounters();
    counters.promptSubmissions = 1;
    if (syntheticResult) {
      counters.resultEventsObserved = 1;
      counters.syntheticAbortResultsObserved = 1;
    }
    const reports: Record<string, unknown>[] = [];
    await expect(
      runV1JPreflightWithTerminalReport({
        operation: async () => {
          throw failure;
        },
        report: () =>
          buildV1JPreflightTerminalReport({
            counters,
            lastCompletedStage: "prepared-runtime",
            blockingStage: "prompt-submission",
            captureHookLiveness: "PROMPT_SUBMITTED_CAPTURE_NOT_REACHED",
            failureClass: failure.name,
            predicateEvaluations: null,
          }),
        emit: (report) => reports.push(report),
      }),
    ).rejects.toBe(failure);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      PROMPT_SUBMISSIONS: 1,
      REQUEST_OBSERVER_INVOCATIONS: 1,
      PROVIDER_BOUND_CAPTURE_CALLBACKS: 1,
      PROVIDER_CALLBACK_INVOCATIONS: 0,
      MODEL_RESULTS_OBSERVED_TOTAL: syntheticResult ? 1 : 0,
      SYNTHETIC_RESULTS_OBSERVED: syntheticResult ? 1 : 0,
      UNACCOUNTED_MODEL_RESULTS: 0,
      TOOL_RESULTS_PRODUCED: 0,
      FIRST_FAILED_PREDICATE: "NOT_EVALUATED",
      PREFLIGHT_PREDICATES_EVALUATED: false,
      PREFLIGHT_PREDICATE_FAILURES: [],
      PROVIDER_DISPATCH_ATTEMPTS: 0,
      TOOL_EXECUTIONS: 0,
      RAW_REQUESTS_SENT: 0,
      BODY_PUBLICATION_CALLS: 0,
      FAILURE_CLASS: failure.name,
    });
  });
});

describe("v1J Arm C preflight-only diagnostic", () => {
  it("rejects an aliased artifact parent before creating diagnostic files", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-arm-c-alias-test-"));
    const artifactParent = path.join(
      repoRoot,
      "artifacts",
      "capability-intelligence",
      "v1j-action-initiation",
    );
    const redirectedParent = path.join(repoRoot, "redirect-target");
    fs.mkdirSync(path.dirname(artifactParent), { recursive: true });
    fs.mkdirSync(redirectedParent);
    fs.symlinkSync(
      redirectedParent,
      artifactParent,
      process.platform === "win32" ? "junction" : "dir",
    );
    try {
      expect(() =>
        createV1JArmCOnlyPreflightDiagnosticJournal({
          repoRoot,
          harnessCommit: "8".repeat(40),
          caseId: "offline-arm-c-case",
          preflightId: "offline-arm-c-alias",
          pid: process.pid,
        }),
      ).toThrow();
      expect(fs.readdirSync(redirectedParent)).toEqual([]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("terminates after successful Arm C preflight without touching formal or smoke artifacts", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-arm-c-only-path-test-"));
    const head = "9".repeat(40);
    const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
    const smokeRoot = resolveV1JSmokeRoot(repoRoot, head);
    fs.mkdirSync(formalRoot, { recursive: true });
    fs.mkdirSync(smokeRoot, { recursive: true });
    const formalSentinel = path.join(formalRoot, "preserve-sentinel");
    const smokeSentinel = path.join(smokeRoot, "preserve-sentinel");
    fs.writeFileSync(formalSentinel, "formal-state-preserved\n");
    fs.writeFileSync(smokeSentinel, "smoke-state-preserved\n");
    const journal = createV1JArmCOnlyPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: head,
      caseId: "offline-arm-c-case",
      preflightId: "offline-arm-c-success",
      pid: process.pid,
      startedAtMs: Date.now(),
    });
    let capturedArm = 0;
    try {
      const result = await runV1JArmCPreflightOnly({
        journal,
        captureArmC: async () => {
          capturedArm += 1;
          return { arm: "C", complete: true };
        },
      });
      expect(result).toEqual({ arm: "C", complete: true });
      expect(capturedArm).toBe(1);
      expect(journal.arm).toBe("C");
      expect(path.dirname(journal.filePath)).toBe(
        path.join(
          repoRoot,
          "artifacts/capability-intelligence/v1j-action-initiation",
          `arm-c-preflight-diagnostic-${head}`,
        ),
      );
    } finally {
      journal.close();
    }
    try {
      const rows = fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rows.map((row) => row.event)).toEqual([
        "arm-c-preflight-start",
        "arm-c-only-preflight-start",
        "arm-c-only-preflight-terminated",
      ]);
      expect(rows.at(-1)).toMatchObject({
        outcome: "complete",
        entrypointGuards: {
          armAPreflightReached: false,
          smokeScheduleReached: false,
          formalArtifactTouched: false,
          normalSmokeArtifactTouched: false,
        },
      });
      expect(fs.readFileSync(formalSentinel, "utf8")).toBe("formal-state-preserved\n");
      expect(fs.readFileSync(smokeSentinel, "utf8")).toBe("smoke-state-preserved\n");
      expect(fs.readdirSync(formalRoot)).toEqual(["preserve-sentinel"]);
      expect(fs.readdirSync(smokeRoot)).toEqual(["preserve-sentinel"]);
      expect(fs.readdirSync(path.dirname(journal.filePath))).toEqual(["arm-c-preflight.jsonl"]);
      expect(() =>
        createV1JArmCOnlyPreflightDiagnosticJournal({
          repoRoot,
          harnessCommit: head,
          caseId: "offline-arm-c-case",
          preflightId: "offline-arm-c-duplicate",
          pid: process.pid,
        }),
      ).toThrow();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
