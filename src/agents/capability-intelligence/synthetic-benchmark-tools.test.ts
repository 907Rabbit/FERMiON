import { describe, expect, it } from "vitest";
import { AGENT_RESERVED_TOOL_NAMES } from "../embedded-agent-runner/tool-name-allowlist.js";
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

  it("keeps the complete 31-tool synthetic client surface structurally valid", () => {
    const benchmarkCase = TOOL_RANKING_HELD_OUT_CASES[0];
    if (!benchmarkCase) {
      throw new Error("held-out corpus is empty");
    }
    const harness = createSyntheticBenchmarkToolHarness(benchmarkCase);
    const names = harness.clientTools.map((tool) => tool.function.name);

    expect(names).toHaveLength(31);
    expect(new Set(names).size).toBe(31);
    expect(names.filter((name) => AGENT_RESERVED_TOOL_NAMES.includes(name))).toEqual(
      expect.arrayContaining(["read", "edit", "write"]),
    );
    for (const tool of harness.clientTools) {
      expect(tool).toMatchObject({
        type: "function",
        function: {
          name: expect.stringMatching(/\S/),
          description: expect.stringMatching(/\S/),
          parameters: { type: "object" },
          strict: false,
        },
      });
      expect(harness.invoke(tool.function.name, {})).toMatchObject({
        caseId: benchmarkCase.id,
        tool: tool.function.name,
        result: {
          ok: true,
          synthetic: true,
          tool: tool.function.name,
        },
      });
    }
  });
});
