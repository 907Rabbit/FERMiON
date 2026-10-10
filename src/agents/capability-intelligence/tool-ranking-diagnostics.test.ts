import { describe, expect, it } from "vitest";
import type { ToolRankingBenchmarkCase } from "./tool-ranking-benchmark-cases.js";
import { TOOL_RANKING_BENCHMARK_CASES } from "./tool-ranking-benchmark-cases.js";
import {
  classifyToolRankingMiss,
  diagnoseToolRankingBenchmark,
  formatToolRankingDiagnostics,
} from "./tool-ranking-diagnostics.js";

describe("tool ranking diagnostics", () => {
  it("records rank, competitor, and missing terms for a missed tool", () => {
    const benchmarkCase: ToolRankingBenchmarkCase = {
      id: "constructed-miss",
      category: "coding",
      split: "development",
      query: "run the failing tests",
      tools: [
        { name: "exec", description: "Run shell commands and scripts" },
        { name: "obscure_helper", description: "Internal ledger" },
      ],
      expectedTopTools: ["obscure_helper"],
      topK: 8,
    };

    const diagnostic = diagnoseToolRankingBenchmark([benchmarkCase])[0];
    const miss = diagnostic?.misses[0];

    expect(diagnostic?.missed).toEqual(["obscure_helper"]);
    expect(diagnostic?.wrongHighRank).toContain("exec");
    expect(miss).toMatchObject({
      expectedTool: "obscure_helper",
      actualRank: null,
      topCompetitor: "exec",
      topCompetitorRank: 1,
    });
    expect(miss?.scoreDifference).toBeGreaterThan(0);
    expect(miss?.missingQueryTerms.length).toBeGreaterThan(0);
    expect(miss).toMatchObject({
      baseScore: 0,
      relationScore: 0,
      reason: "relation_absent",
      role: "required",
    });
    const formatted = formatToolRankingDiagnostics(diagnostic ? [diagnostic] : []);
    expect(formatted).toContain("Missing query terms:");
    expect(formatted).toContain("Base score:");
    expect(formatted).toContain("Relation score:");
    expect(formatted).toContain("Reason:");
    expect(formatted).toContain("relation_absent");
  });

  it("classifies zero-hit, domain, rank, and runtime-surface misses separately", () => {
    expect(
      classifyToolRankingMiss({
        toolName: "read",
        baseScore: 0,
        relationScore: 0,
        domainFactor: 1,
        matchedLiteral: false,
        topK: 8,
        rankings: [],
      }),
    ).toBe("relation_absent");
    expect(
      classifyToolRankingMiss({
        toolName: "read",
        baseScore: 0,
        relationScore: 0.2,
        domainFactor: 1,
        matchedLiteral: false,
        topK: 1,
        rankings: [
          { name: "pytest", score: 0.9, matchedLiteral: true },
          { name: "read", score: 0.2, matchedLiteral: false },
        ],
      }),
    ).toBe("zero_base_score");
    expect(
      classifyToolRankingMiss({
        toolName: "read",
        baseScore: 0.55,
        relationScore: 0,
        domainFactor: 0.55,
        matchedLiteral: true,
        topK: 1,
        rankings: [
          { name: "camera", score: 0.6, matchedLiteral: true },
          { name: "read", score: 0.55, matchedLiteral: true },
        ],
      }),
    ).toBe("domain_discount");
    expect(
      classifyToolRankingMiss({
        toolName: "read",
        baseScore: 0.2,
        relationScore: 0,
        domainFactor: 1,
        matchedLiteral: true,
        topK: 1,
        rankings: [
          { name: "pytest", score: 0.9, matchedLiteral: true },
          { name: "read", score: 0.2, matchedLiteral: true },
        ],
      }),
    ).toBe("below_k");
    expect(
      classifyToolRankingMiss({
        toolName: "read",
        baseScore: 0.9,
        relationScore: 0,
        domainFactor: 1,
        matchedLiteral: true,
        topK: 8,
        rankings: [{ name: "read", score: 0.9, matchedLiteral: true }],
        runtimeMandatory: true,
      }),
    ).toBe("mandatory_surface_error");
  });

  it("leaves a web-only read miss as a missing relation, not a mandatory exemption", () => {
    const web = diagnoseToolRankingBenchmark([caseById("web-research")])[0];
    const review = diagnoseToolRankingBenchmark([caseById("git-review-patch")])[0];
    const reminder = diagnoseToolRankingBenchmark([caseById("remind-and-email")])[0];

    expect(web?.misses.find((miss) => miss.expectedTool === "read")).toMatchObject({
      baseScore: 0,
      relationScore: 0,
      reason: "relation_absent",
      role: "optional",
    });
    expect(review?.missed).not.toContain("git_status");
    expect(reminder?.misses.find((miss) => miss.expectedTool === "message")).toMatchObject({
      baseScore: 0,
      relationScore: 0,
      reason: "relation_absent",
      role: "optional",
    });
    expect(reminder?.missed).not.toContain("cron");
    expect(reminder?.missed).not.toContain("email");
  });
});

function caseById(id: string): ToolRankingBenchmarkCase {
  const found = TOOL_RANKING_BENCHMARK_CASES.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing benchmark case ${id}`);
  }
  return found;
}
