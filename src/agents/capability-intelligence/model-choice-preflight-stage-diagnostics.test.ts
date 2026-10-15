import { describe, expect, it, vi } from "vitest";
import {
  assertV1JPreflightCaptureOnly,
  createV1JPreflightCounters,
  type V1JPreflightCounters,
} from "../../../test/helpers/agents/model-choice-action-initiation-smoke.js";
import {
  classifyV1JCaptureHookLiveness,
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
    ledger.enter("capture-hook-installation");
    ledger.complete("capture-hook-installation");
    ledger.enter("prepared-runtime");
    ledger.complete("prepared-runtime");
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

  it.each([
    {
      name: "installation was not entered",
      install: "absent",
      prompt: false,
      expected: "HOOK_INSTALLATION_NOT_ENTERED",
    },
    {
      name: "installation entered but did not complete",
      install: "entered",
      prompt: false,
      expected: "HOOK_INSTALLATION_ENTERED_NOT_COMPLETED",
    },
    {
      name: "hook installed but prompt was not submitted",
      install: "complete",
      prompt: false,
      expected: "HOOK_INSTALLED_PROMPT_NOT_SUBMITTED",
    },
    {
      name: "prompt submitted but capture was not reached",
      install: "complete",
      prompt: true,
      expected: "PROMPT_SUBMITTED_CAPTURE_NOT_REACHED",
    },
  ] as const)("classifies $name", ({ install, prompt, expected }) => {
    const ledger = createV1JPreflightStageLedger({ record: () => undefined, now: () => 1 });
    ledger.complete("schema-discovery");
    if (install !== "absent") {
      ledger.enter("capture-hook-installation");
    }
    if (install === "complete") {
      ledger.complete("capture-hook-installation");
    }
    if (prompt) {
      ledger.enter("prompt-submission");
    }

    expect(classifyV1JCaptureHookLiveness(ledger.snapshot())).toBe(expected);
  });

  it("records successful progression through hook installation, runtime, prompt, and capture", () => {
    const ledger = createV1JPreflightStageLedger({ record: () => undefined, now: () => 1 });
    ledger.complete("schema-discovery");
    ledger.enter("capture-hook-installation");
    ledger.complete("capture-hook-installation");
    ledger.enter("prepared-runtime");
    ledger.complete("prepared-runtime");
    ledger.enter("prompt-preflight");
    ledger.complete("prompt-preflight");
    ledger.enter("prompt-submission");
    ledger.enter("provider-bound-callback");

    expect(classifyV1JCaptureHookLiveness(ledger.snapshot())).toBe("CAPTURE_REACHED");
    expect(ledger.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage_name: "capture-hook-installation",
          entered: true,
          completed: true,
          await_target_class: null,
          timeout_owner: "none; synchronous runOne hook assignment",
        }),
        expect.objectContaining({
          stage_name: "prepared-runtime",
          entered: true,
          completed: true,
          await_target_class: "prepared-runtime acquisition",
          timeout_owner: "v1J provider-capture preflight stage timeout",
        }),
        expect.objectContaining({
          stage_name: "prompt-submission",
          entered: true,
          completed: false,
          elapsed_ms: null,
          await_target_class: "AgentSession.prompt",
          timeout_owner: "v1J provider-capture preflight stage timeout",
        }),
      ]),
    );
  });

  it("keeps an unentered hook stage unentered when the outer stage fails first", () => {
    const ledger = createV1JPreflightStageLedger({ record: () => undefined, now: () => 1 });
    ledger.complete("schema-discovery");
    ledger.fail(
      "capture-hook-installation",
      new V1JPreflightStageTimeoutError(
        "capture-hook-installation",
        30_000,
        30_000,
        "schema-discovery",
        "capture preflight wrapper",
      ),
    );

    expect(
      ledger.snapshot().find((stage) => stage.stage_name === "capture-hook-installation"),
    ).toMatchObject({
      entered: false,
      completed: false,
      elapsed_ms: 30_000,
      await_target_class: null,
      timeout_owner: "capture preflight wrapper",
      failure_class: "V1JPreflightStageTimeoutError",
    });
    expect(classifyV1JCaptureHookLiveness(ledger.snapshot())).toBe("HOOK_INSTALLATION_NOT_ENTERED");
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
          timeout_owner: "runV1JPreflightWithHeartbeat",
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
    const base: V1JPreflightCounters = createV1JPreflightCounters();
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
