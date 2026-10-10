import { describe, expect, it } from "vitest";
import { createSyntheticBenchmarkToolHarness } from "./synthetic-benchmark-tools.js";
import { TOOL_RANKING_HELD_OUT_CASES } from "./tool-ranking-benchmark-cases.js";

describe("synthetic benchmark tools", () => {
  it("exposes the original benchmark names and descriptions without evaluator labels", () => {
    const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!benchmarkCase) {
      throw new Error("held-out corpus is empty");
    }
    const harness = createSyntheticBenchmarkToolHarness(benchmarkCase);
    expect(harness.clientTools.map((tool) => tool.function.name)).toEqual(
      benchmarkCase.tools.map((tool) => tool.name),
    );
    expect(JSON.stringify(harness.clientTools)).not.toMatch(
      /requiredTools|relevantTools|expectedOutcome|toolRoles|rank/i,
    );
  });

  it("returns deterministic structured results and records model calls", () => {
    const harness = createSyntheticBenchmarkToolHarness({
      id: "synthetic-case",
      tools: [{ name: "calendar", description: "Manage calendar events" }],
    });
    expect(harness.invoke("calendar", { action: "list" })).toEqual({
      caseId: "synthetic-case",
      invocationIndex: 0,
      tool: "calendar",
      params: { action: "list" },
      result: {
        ok: true,
        synthetic: true,
        tool: "calendar",
        caseId: "synthetic-case",
        invocationIndex: 0,
      },
    });
    expect(harness.recordClientToolCalls([{ name: "calendar", params: {} }])[0]).toMatchObject({
      invocationIndex: 1,
      result: { ok: true, synthetic: true, tool: "calendar" },
    });
  });
});
