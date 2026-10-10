import { describe, expect, it } from "vitest";
import {
  BENCHMARK_REAL_TOOL_MAPPINGS,
  getBenchmarkRealToolMapping,
  summarizeBenchmarkRealToolMappings,
} from "./benchmark-real-tool-mapping.js";
import { TOOL_RANKING_HELD_OUT_CASES } from "./tool-ranking-benchmark-cases.js";

describe("benchmark to real tool mapping", () => {
  it("classifies every tool in the frozen held-out corpus exactly once", () => {
    const corpusTools = new Set(
      TOOL_RANKING_HELD_OUT_CASES.flatMap((entry) => entry.tools.map((tool) => tool.name)),
    );
    const registryTools = BENCHMARK_REAL_TOOL_MAPPINGS.map((mapping) => mapping.benchmarkTool);
    expect(new Set(registryTools)).toEqual(corpusTools);
    expect(registryTools).toHaveLength(corpusTools.size);
    for (const tool of corpusTools) {
      expect(() => getBenchmarkRealToolMapping(tool)).not.toThrow();
    }
  });

  it("keeps adapter intent explicit and never turns unsupported tools into equivalents", () => {
    expect(getBenchmarkRealToolMapping("git_diff")).toMatchObject({
      realTool: "exec",
      classification: "ADAPTER",
      adapterIntent: "git diff",
    });
    expect(getBenchmarkRealToolMapping("email")).toMatchObject({
      realTool: null,
      classification: "UNSUPPORTED",
      adapterIntent: null,
    });
  });

  it("reports exact-only, adapter, and unsupported strata from required operations", () => {
    const summary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
    expect(summary.totalCases).toBe(17);
    expect(summary.exactOnlyCases + summary.exactPlusAdapterCases + summary.unsupportedCases).toBe(
      17,
    );
    expect(summary.cases.find((entry) => entry.caseId === "git-review-patch")).toMatchObject({
      mappingClass: "ADAPTER",
      adapterRequiredTools: ["git_diff", "git_status"],
    });
    expect(summary.cases.find((entry) => entry.caseId === "remind-and-email")).toMatchObject({
      mappingClass: "UNSUPPORTED",
      unsupportedRequiredTools: ["cron", "email"],
    });
  });

  it("fails closed when a caller asks for a tool outside the registry", () => {
    expect(() => getBenchmarkRealToolMapping("not-in-the-corpus")).toThrow(
      "benchmark tool is unclassified",
    );
  });
});
