import { describe, expect, it } from "vitest";
import {
  compareRelationalRecovery,
  compareToolRankingExperiments,
  evaluateToolRankingBenchmark,
  evaluateToolRankingPromotionGate,
  ndcgAtK,
  rankDisturbance,
  roleRecallAt,
  TOOL_RANKING_BENCHMARK_CASES,
  TOOL_RANKING_DEVELOPMENT_CASES,
  TOOL_RANKING_HELD_OUT_CASES,
  TOOL_RANKING_PROMOTION_THRESHOLDS,
  TOOL_RANKING_V1A_COMPARISON_CASES,
  zeroHitRecoveryRate,
  zeroScoreGradedTools,
  type ToolRankingBenchmarkCase,
} from "./tool-ranking-benchmark.js";
import {
  diagnoseToolRankingBenchmark,
  formatToolRankingDiagnostics,
} from "./tool-ranking-diagnostics.js";

const BENCHMARK_CATEGORIES = [
  "git",
  "filesystem",
  "coding",
  "shell",
  "sessions",
  "memory",
  "web",
  "messaging",
  "cron",
  "tool-search",
  "mixed",
] as const;

describe("tool ranking benchmark", () => {
  it("measures recall, precision, reciprocal rank, ndcg, and surface reduction", () => {
    const result = evaluateToolRankingBenchmark(TOOL_RANKING_BENCHMARK_CASES);
    const heldOut = evaluateToolRankingBenchmark(TOOL_RANKING_HELD_OUT_CASES);
    const gate = evaluateToolRankingPromotionGate(TOOL_RANKING_HELD_OUT_CASES);

    expect(TOOL_RANKING_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(30);
    expect(TOOL_RANKING_DEVELOPMENT_CASES.length).toBeGreaterThanOrEqual(15);
    expect(TOOL_RANKING_HELD_OUT_CASES.length).toBeGreaterThanOrEqual(15);
    expect(TOOL_RANKING_V1A_COMPARISON_CASES).toHaveLength(4);
    expect(
      new Set(TOOL_RANKING_V1A_COMPARISON_CASES.map((benchmarkCase) => benchmarkCase.tools.length)),
    ).toEqual(new Set([24]));
    for (const category of BENCHMARK_CATEGORIES) {
      expect(
        TOOL_RANKING_DEVELOPMENT_CASES.some((benchmarkCase) => benchmarkCase.category === category),
      ).toBe(true);
      expect(
        TOOL_RANKING_HELD_OUT_CASES.some((benchmarkCase) => benchmarkCase.category === category),
      ).toBe(true);
    }
    expect(result.recallAtK).toBeGreaterThanOrEqual(0);
    expect(result.precisionAtK).toBeGreaterThanOrEqual(0);
    expect(result.meanReciprocalRank).toBeGreaterThanOrEqual(0);
    expect(result.ndcgAtK).toBeGreaterThanOrEqual(0);
    expect(result.surfaceReductionAtK).toBeGreaterThan(0.5);
    expect(result.cases.every((benchmarkCase) => benchmarkCase.ranking.length > 0)).toBe(true);
    for (const benchmarkCase of TOOL_RANKING_BENCHMARK_CASES) {
      const topNames = result.cases
        .find((resultCase) => resultCase.id === benchmarkCase.id)
        ?.ranking.slice(0, benchmarkCase.topK)
        .map(({ name }) => name);
      expect(topNames?.filter((name) => benchmarkCase.irrelevantTools?.includes(name))).toEqual([]);
    }
    expect(gate).toMatchObject({
      mixedRecallAt8: heldOut.recallAtK,
      ndcgAt8: heldOut.ndcgAtK,
    });
    expect(gate.requiredRecallAt8Passed).toBe(
      gate.requiredRecallAt8 >= TOOL_RANKING_PROMOTION_THRESHOLDS.requiredRecallAt8,
    );
    expect(gate.requiredRecallAt16Passed).toBe(
      gate.requiredRecallAt16 === TOOL_RANKING_PROMOTION_THRESHOLDS.requiredRecallAt16,
    );
    expect(gate.ndcgAt8Passed).toBe(gate.ndcgAt8 >= TOOL_RANKING_PROMOTION_THRESHOLDS.ndcgAt8);
    expect(gate.mandatoryToolLossPassed).toBe(
      gate.mandatoryToolLoss === TOOL_RANKING_PROMOTION_THRESHOLDS.mandatoryToolLoss,
    );
    expect(
      formatToolRankingDiagnostics(diagnoseToolRankingBenchmark(TOOL_RANKING_V1A_COMPARISON_CASES)),
    ).toContain("| Case | Expected | Top 8 | Missed | Wrong high-rank |");
  });

  it("keeps the published v1A baseline and does not regress recall", () => {
    const comparison = compareToolRankingExperiments(TOOL_RANKING_V1A_COMPARISON_CASES);

    expect(comparison.baseline.recallAtK).toBeCloseTo(0.6875, 4);
    expect(comparison.baseline.precisionAtK).toBeCloseTo(0.34375, 4);
    expect(comparison.baseline.meanReciprocalRank).toBeCloseTo(0.667, 2);
    expect(comparison.baseline.surfaceReductionAtK).toBeCloseTo(2 / 3, 4);
    expect(comparison.candidate.recallAtK).toBeGreaterThanOrEqual(comparison.baseline.recallAtK);
    expect(comparison.candidate.meanReciprocalRank).toBeGreaterThan(
      comparison.baseline.meanReciprocalRank,
    );
    expect(comparison.candidate.ndcgAtK).toBeGreaterThan(comparison.baseline.ndcgAtK);
    expect(comparison.candidate.recallAtK).toBeCloseTo(0.8125, 4);
    expect(comparison.candidate.precisionAtK).toBeCloseTo(0.40625, 4);
    expect(comparison.candidate.meanReciprocalRank).toBeCloseTo(0.75, 4);
    expect(comparison.candidate.ndcgAtK).toBeCloseTo(0.850084, 4);
  });

  it("keeps the promotion gate unchanged and compares v1C only as an ablation", () => {
    expect(TOOL_RANKING_PROMOTION_THRESHOLDS).toEqual({
      requiredRecallAt8: 0.99,
      requiredRecallAt16: 1,
      ndcgAt8: 0.85,
      mandatoryToolLoss: 0,
    });

    const heldOut = compareRelationalRecovery(TOOL_RANKING_HELD_OUT_CASES);
    const development = compareRelationalRecovery(TOOL_RANKING_DEVELOPMENT_CASES);
    const original = compareRelationalRecovery(TOOL_RANKING_V1A_COMPARISON_CASES);
    const gate = evaluateToolRankingPromotionGate(TOOL_RANKING_HELD_OUT_CASES);

    expect(heldOut.baseline.recallAtK).toBeCloseTo(0.902941, 4);
    expect(heldOut.baseline.ndcgAtK).toBeCloseTo(0.887406, 4);
    expect(heldOut.baseline.precisionAtK).toBeCloseTo(0.330882, 4);
    expect(heldOut.baseline.meanReciprocalRank).toBeCloseTo(0.833333, 4);
    expect(heldOut.baselineMandatoryToolLoss).toBeCloseTo(0.041667, 4);
    expect(heldOut.baselineRecallAt16).toBeCloseTo(heldOut.baseline.recallAtK, 4);

    expect(heldOut.candidate.recallAtK).toBeCloseTo(0.985294, 4);
    expect(heldOut.candidateRecallAt16).toBeCloseTo(0.985294, 4);
    expect(heldOut.candidate.ndcgAtK).toBeCloseTo(0.933909, 4);
    expect(heldOut.candidate.precisionAtK).toBeCloseTo(0.367647, 4);
    expect(heldOut.candidate.meanReciprocalRank).toBeCloseTo(0.813725, 4);
    expect(heldOut.candidateMandatoryToolLoss).toBe(0);
    expect(heldOut.zeroHitRecovery).toBeCloseTo(5 / 6, 4);
    expect(heldOut.rankDisturbance).toBeCloseTo(0.151961, 4);
    expect(heldOut.candidate.ndcgAtK).toBeGreaterThan(heldOut.baseline.ndcgAtK);
    expect(heldOut.candidateRecallAt16).toBeLessThan(0.99);
    expect(gate.mixedRecallAt16).toBeCloseTo(heldOut.candidateRecallAt16, 4);
    expect(gate.requiredRecallAt16Passed).toBe(true);

    expect(development.zeroHitRecovery).toBeCloseTo(0.8, 4);
    expect(development.candidate.recallAtK).toBeGreaterThan(development.baseline.recallAtK);
    expect(development.candidate.ndcgAtK).toBeGreaterThan(development.baseline.ndcgAtK);

    expect(original.candidate.recallAtK).toBeCloseTo(0.9375, 4);
    expect(original.candidate.meanReciprocalRank).toBeCloseTo(0.75, 4);
    expect(original.zeroHitRecovery).toBeCloseTo(2 / 3, 4);
    expect(original.rankDisturbance).toBeLessThan(0.1);
  });

  it("uses the requested top-K denominator and returns zero for an empty corpus", () => {
    const benchmarkCase: ToolRankingBenchmarkCase = {
      id: "one-hit",
      category: "web",
      split: "development",
      query: "search web",
      tools: [
        { name: "web_search", description: "Search the web" },
        { name: "read", description: "Read files" },
      ],
      expectedTopTools: ["web_search"],
      topK: 2,
    };

    expect(evaluateToolRankingBenchmark([benchmarkCase])).toMatchObject({
      recallAtK: 1,
      precisionAtK: 0.5,
      meanReciprocalRank: 1,
      ndcgAtK: 1,
      surfaceReductionAtK: 0,
    });
    expect(evaluateToolRankingBenchmark([])).toMatchObject({
      recallAtK: 0,
      precisionAtK: 0,
      meanReciprocalRank: 0,
      ndcgAtK: 0,
      surfaceReductionAtK: 0,
    });
  });

  it("scores an early relevant hit above the same hit at the bottom of the window", () => {
    const relevant = new Set(["git_diff", "pytest", "read"]);

    const early = ndcgAtK(["git_diff", "pytest", "noise", "read"], relevant, 8);
    const late = ndcgAtK(
      ["noise", "noise2", "noise3", "noise4", "noise5", "git_diff", "pytest", "read"],
      relevant,
      8,
    );

    expect(early).toBeGreaterThan(late);
    expect(ndcgAtK(["git_diff", "pytest", "read"], relevant, 8)).toBeCloseTo(1);
    expect(ndcgAtK(["noise"], new Set(), 8)).toBe(0);
  });

  it("does not let an optional miss or a runtime tool decide required recall", () => {
    const benchmarkCase: ToolRankingBenchmarkCase = {
      id: "optional-miss",
      category: "cron",
      split: "held-out",
      query: "remind me",
      tools: [
        { name: "cron", description: "Schedule a job" },
        { name: "message", description: "Send a message" },
        { name: "sessions_list", description: "List sessions" },
      ],
      expectedTopTools: ["cron"],
      optionalRelevantTools: ["message", "sessions_list"],
      toolRoles: {
        cron: "required",
        message: "optional",
        sessions_list: "runtime-mandatory",
      },
      irrelevantTools: [],
      topK: 8,
    };
    const rank = () => [{ name: "cron", score: 1 }];

    expect(roleRecallAt([benchmarkCase], "required", 8, rank)).toMatchObject({
      recall: 1,
      recovered: 1,
      total: 1,
      misses: [],
    });
    expect(roleRecallAt([benchmarkCase], "optional", 8, rank).recall).toBe(0);
    expect(evaluateToolRankingPromotionGate([benchmarkCase], rank)).toMatchObject({
      requiredRecallAt8: 1,
      requiredRecallAt16: 1,
      mandatoryToolLoss: 0,
      runtimeMandatoryMisses: [{ id: "optional-miss", tool: "sessions_list" }],
    });
    expect(zeroScoreGradedTools([benchmarkCase], rank)).toEqual([
      { id: "optional-miss", tool: "message", role: "optional" },
      { id: "optional-miss", tool: "sessions_list", role: "runtime-mandatory" },
    ]);
  });

  it("keeps the held-out required gate clear of the one optional zero-hit", () => {
    const gate = evaluateToolRankingPromotionGate(TOOL_RANKING_HELD_OUT_CASES);

    expect(gate.requiredRecallAt8).toBe(1);
    expect(gate.requiredRecallAt16).toBe(1);
    expect(gate.relevantRecallAt8).toBe(1);
    expect(gate.optionalRecallAt8).toBeCloseTo(16 / 17, 4);
    expect(gate.mandatoryToolLoss).toBe(0);
    expect(gate.requiredRecallAt8Passed).toBe(true);
    expect(gate.requiredRecallAt16Passed).toBe(true);
    expect(gate.ndcgAt8Passed).toBe(true);
    expect(gate.mandatoryToolLossPassed).toBe(true);
    expect(gate.runtimeMandatoryMisses).toEqual([]);
    expect(gate.mixedRecallAt16).toBeLessThan(0.99);
    expect(zeroScoreGradedTools(TOOL_RANKING_HELD_OUT_CASES)).toEqual([
      { id: "remind-and-email", tool: "message", role: "optional" },
    ]);
    expect(zeroScoreGradedTools(TOOL_RANKING_DEVELOPMENT_CASES)).toEqual([
      { id: "web-research", tool: "read", role: "optional" },
    ]);
    expect(roleRecallAt(TOOL_RANKING_DEVELOPMENT_CASES, "required", 8)).toMatchObject({
      recall: 1,
      misses: [],
    });
    expect(roleRecallAt(TOOL_RANKING_DEVELOPMENT_CASES, "relevant", 8).misses).toEqual([]);
    expect(roleRecallAt(TOOL_RANKING_DEVELOPMENT_CASES, "optional", 8).misses).toEqual([
      { id: "web-research", tool: "read" },
      { id: "web-latest", tool: "browser" },
    ]);
    expect(
      TOOL_RANKING_BENCHMARK_CASES.some((benchmarkCase) =>
        Object.values(benchmarkCase.toolRoles ?? {}).includes("runtime-mandatory"),
      ),
    ).toBe(false);
  });

  it("scores zero-hit recovery and rank movement without counting new tools twice", () => {
    expect(
      zeroHitRecoveryRate({
        relevant: ["pytest", "read"],
        baselineRanking: ["pytest"],
        candidateTop: ["pytest", "read"],
      }),
    ).toEqual({ rate: 1, zeroHit: ["read"], recovered: ["read"] });
    expect(
      zeroHitRecoveryRate({
        relevant: ["pytest"],
        baselineRanking: ["pytest"],
        candidateTop: ["pytest"],
      }).rate,
    ).toBe(1);
    expect(
      zeroHitRecoveryRate({
        relevant: ["message"],
        baselineRanking: ["cron"],
        candidateTop: ["cron"],
      }).rate,
    ).toBe(0);
    expect(
      rankDisturbance({
        baselineRanking: ["git_diff", "pytest"],
        candidateRanking: ["pytest", "git_diff"],
      }),
    ).toBe(1);
    expect(
      rankDisturbance({
        baselineRanking: [],
        candidateRanking: ["read"],
      }),
    ).toBe(0);
    expect(
      rankDisturbance({
        baselineRanking: ["pytest"],
        candidateRanking: ["pytest", "read"],
      }),
    ).toBe(0);
  });
});
