import { describe, expect, it, vi } from "vitest";
import {
  assertV1JPreflightCaptureOnly,
  type V1JPreflightCounters,
} from "../../../test/helpers/agents/model-choice-action-initiation-smoke.js";
import {
  createV1JPreflightStageLedger,
  V1JPreflightStageTimeoutError,
} from "../../../test/helpers/agents/model-choice-preflight-stage-diagnostics.js";
import { runV1JPreflightWithHeartbeat } from "../../../test/helpers/agents/model-choice-provider-repeatability.js";

describe("v1J preflight stage diagnostics", () => {
  it("records all successful preflight stages without content", () => {
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const ledger = createV1JPreflightStageLedger({
      record: (event, details) => events.push({ event, details }),
      now: () => 100,
    });
    ledger.enter("schema-preflight");
    ledger.complete("schema-discovery");
    ledger.complete("authorized-tool-surface");
    ledger.complete("prepared-runtime");
    ledger.complete("provider-bound-capture-hook");
    ledger.complete("prompt-submission");
    ledger.complete("request-observer");
    ledger.complete("provider-bound-callback");
    ledger.complete("preflight-stop");
    ledger.complete("schema-preflight");
    const summary = ledger.snapshot();

    expect(summary.find((stage) => stage.stage_name === "schema-preflight")).toMatchObject({
      entered: true,
      completed: true,
    });
    expect(summary.find((stage) => stage.stage_name === "request-observer")).toMatchObject({
      entered: true,
      completed: true,
      failure_class: null,
    });
    expect(events.every(({ details }) => "stage_name" in details && "elapsed_ms" in details)).toBe(
      true,
    );
    expect(JSON.stringify({ events, summary })).not.toMatch(/prompt text|request body|secret/iu);
  });

  it("distinguishes hook, prompt, observer, and provider-callback reachability", () => {
    const ledger = createV1JPreflightStageLedger({ record: () => undefined, now: () => 1 });
    ledger.enter("schema-preflight");
    ledger.complete("schema-discovery");
    ledger.complete("authorized-tool-surface");
    ledger.complete("prepared-runtime");
    const beforeHook = ledger.snapshot();
    expect(
      beforeHook.find((stage) => stage.stage_name === "provider-bound-capture-hook"),
    ).toMatchObject({
      entered: false,
      completed: false,
    });

    ledger.complete("provider-bound-capture-hook");
    ledger.complete("prompt-submission");
    const afterPrompt = ledger.snapshot();
    expect(afterPrompt.find((stage) => stage.stage_name === "prompt-submission")).toMatchObject({
      entered: true,
      completed: true,
    });
    expect(afterPrompt.find((stage) => stage.stage_name === "request-observer")).toMatchObject({
      entered: false,
      completed: false,
    });
    expect(
      afterPrompt.find((stage) => stage.stage_name === "provider-bound-callback"),
    ).toMatchObject({
      entered: false,
      completed: false,
    });
  });

  it("records schema failure and the exact timeout stage/last completed stage", async () => {
    vi.useFakeTimers();
    let currentStage = "schema-preflight";
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const records: Array<{ event: string; details?: Record<string, unknown> }> = [];
    const onTimeout = vi.fn();
    try {
      const operation = runV1JPreflightWithHeartbeat({
        operation: () => pending,
        stage: () => currentStage,
        timeoutMsByStage: { "request-observer": 1_000 },
        onStageTimeout: onTimeout,
        heartbeatMs: 25,
        record: (event) => records.push(event),
        now: () => Date.now(),
      });
      const rejected = expect(operation).rejects.toMatchObject({
        name: "V1JPreflightStageTimeoutError",
        stage: "request-observer",
        lastCompletedStage: "schema-preflight",
      });
      currentStage = "request-observer";
      await vi.advanceTimersByTimeAsync(2_000);
      await rejected;
      expect(onTimeout).toHaveBeenCalledWith(expect.any(V1JPreflightStageTimeoutError));
      expect(records.at(-1)).toMatchObject({
        event: "preflight-stage-timeout",
        details: {
          stage_name: "request-observer",
          entered: true,
          completed: false,
          failure_class: "V1JPreflightStageTimeoutError",
          last_completed_stage: "schema-preflight",
        },
      });
      const schemaLedger = createV1JPreflightStageLedger({
        record: (event, details) => records.push({ event, details }),
        now: () => 0,
      });
      schemaLedger.enter("schema-preflight");
      schemaLedger.fail("schema-preflight", new Error("schema failure"));
      expect(schemaLedger.snapshot()[0]).toMatchObject({
        entered: true,
        completed: false,
        failure_class: "Error",
      });
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it("fails capture-only accounting on tool execution, tool result, or model result", () => {
    const base: V1JPreflightCounters = {
      requestObserverInvocations: 0,
      providerRequestHookInvocations: 0,
      fetchWrapperInvocations: 0,
      providerCallbackInvocations: 0,
      providerDispatchAttempts: 0,
      modelRequestCounter: 0,
      schemaCaptureStarts: 0,
      schemaCaptureCompletes: 0,
      preflightStopSignalRaised: 0,
      preflightStopSignalCaught: 0,
      preflightCompleted: 0,
      toolExecutions: 0,
      toolResultsProduced: 0,
      modelResultsObserved: 0,
      promptSubmissions: 0,
      providerBoundCaptureCallbacks: 0,
    };
    expect(() => assertV1JPreflightCaptureOnly(base)).not.toThrow();
    for (const counter of [
      "toolExecutions",
      "toolResultsProduced",
      "modelResultsObserved",
    ] as const) {
      expect(() => assertV1JPreflightCaptureOnly({ ...base, [counter]: 1 })).toThrow(
        /capture-only preflight observed execution\/result activity/,
      );
    }
  });
});
