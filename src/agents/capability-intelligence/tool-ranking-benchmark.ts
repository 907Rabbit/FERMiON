import {
  rankAgentTools,
  rankAgentToolsV1A,
  rankAgentToolsV1B,
  type AgentToolRanking,
} from "./rank-agent-tools.js";
import {
  TOOL_RANKING_BENCHMARK_CASES,
  TOOL_RANKING_DEVELOPMENT_CASES,
  TOOL_RANKING_HELD_OUT_CASES,
  TOOL_RANKING_V1A_COMPARISON_CASES,
  toolRole,
  type ExpectedToolRole,
  type ToolRankingBenchmarkCase,
} from "./tool-ranking-benchmark-cases.js";

export type {
  BenchmarkTool,
  ExpectedToolRole,
  ToolRankingBenchmarkCase,
  ToolRankingBenchmarkCategory,
  ToolRankingBenchmarkSplit,
} from "./tool-ranking-benchmark-cases.js";

export { toolRole };

export {
  TOOL_RANKING_BENCHMARK_CASES,
  TOOL_RANKING_DEVELOPMENT_CASES,
  TOOL_RANKING_HELD_OUT_CASES,
  TOOL_RANKING_V1A_COMPARISON_CASES,
};

export type ToolRanker = (
  tools: readonly { name: string; description?: string }[],
  query: string,
) => AgentToolRanking[];

export type ToolRankingBenchmarkCaseResult = {
  id: string;
  recallAtK: number;
  precisionAtK: number;
  reciprocalRank: number;
  ndcgAtK: number;
  surfaceReductionAtK: number;
  ranking: AgentToolRanking[];
};

export type ToolRankingBenchmarkResult = {
  recallAtK: number;
  precisionAtK: number;
  meanReciprocalRank: number;
  ndcgAtK: number;
  surfaceReductionAtK: number;
  cases: ToolRankingBenchmarkCaseResult[];
};

/**
 * Hard gate for a future filtering decision. It uses required tools only.
 * Passing it does not enable filtering; the live path only records shadow rankings.
 * Optional and strongly relevant tools stay quality metrics.
 * Runtime-mandatory tools are not judged here. They have to be unioned onto
 * the authorized surface outside retrieval.
 */
export const TOOL_RANKING_PROMOTION_THRESHOLDS = {
  requiredRecallAt8: 0.99,
  requiredRecallAt16: 1,
  ndcgAt8: 0.85,
  mandatoryToolLoss: 0,
} as const;

export type ToolRoleMiss = {
  id: string;
  tool: string;
};

export type ToolRoleRecall = {
  recall: number;
  recovered: number;
  total: number;
  misses: ToolRoleMiss[];
};

export type ZeroScoreGradedTool = {
  id: string;
  tool: string;
  role: ExpectedToolRole;
};

export type ToolRankingPromotionGate = {
  requiredRecallAt8: number;
  requiredRecallAt8Passed: boolean;
  requiredRecallAt16: number;
  requiredRecallAt16Passed: boolean;
  relevantRecallAt8: number;
  optionalRecallAt8: number;
  ndcgAt8: number;
  ndcgAt8Passed: boolean;
  /** Required tools missing from the top 8. Optional tools are not included. */
  mandatoryToolLoss: number;
  mandatoryToolLossPassed: boolean;
  /** Graded recall, including optional tools. Not a promotion input. */
  mixedRecallAt8: number;
  mixedRecallAt16: number;
  runtimeMandatoryMisses: ToolRoleMiss[];
};

export type ToolRankingExperimentComparison = {
  baseline: ToolRankingBenchmarkResult;
  candidate: ToolRankingBenchmarkResult;
};

export type RelationalRecoveryCaseResult = {
  id: string;
  zeroHitRelevant: string[];
  recovered: string[];
  zeroHitRecovery: number;
  rankDisturbance: number;
};

export type RelationalRecoveryComparison = {
  baseline: ToolRankingBenchmarkResult;
  candidate: ToolRankingBenchmarkResult;
  baselineRecallAt16: number;
  candidateRecallAt16: number;
  baselineMandatoryToolLoss: number;
  candidateMandatoryToolLoss: number;
  /** Pooled recovered / previous zero-score relevant tools. 1 when there are none. */
  zeroHitRecovery: number;
  /** Mean per-case absolute rank movement of tools v1B already ranked. */
  rankDisturbance: number;
  cases: RelationalRecoveryCaseResult[];
};

export function ndcgAtK(
  rankedNames: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (relevant.size === 0 || k <= 0) {
    return 0;
  }
  const limit = Math.min(k, rankedNames.length);
  let discountedGain = 0;
  for (let index = 0; index < limit; index += 1) {
    if (!relevant.has(rankedNames[index] ?? "")) {
      continue;
    }
    discountedGain += 1 / Math.log2(index + 2);
  }
  const idealCount = Math.min(k, relevant.size);
  let idealGain = 0;
  for (let index = 0; index < idealCount; index += 1) {
    idealGain += 1 / Math.log2(index + 2);
  }
  return idealGain === 0 ? 0 : discountedGain / idealGain;
}

export function evaluateToolRankingPromotionGate(
  cases: readonly ToolRankingBenchmarkCase[],
  rank: ToolRanker = rankAgentTools,
): ToolRankingPromotionGate {
  const requiredAt8 = roleRecallAt(cases, "required", 8, rank);
  const requiredAt16 = roleRecallAt(cases, "required", 16, rank);
  const relevantAt8 = roleRecallAt(cases, "relevant", 8, rank);
  const optionalAt8 = roleRecallAt(cases, "optional", 8, rank);
  const mixedAt8 = evaluateToolRankingBenchmark(withTopK(cases, 8), rank);
  const mixedAt16 = evaluateToolRankingBenchmark(withTopK(cases, 16), rank);
  const mandatoryToolLoss =
    requiredAt8.total === 0 ? 0 : requiredAt8.misses.length / requiredAt8.total;
  return {
    requiredRecallAt8: requiredAt8.recall,
    requiredRecallAt8Passed:
      requiredAt8.recall >= TOOL_RANKING_PROMOTION_THRESHOLDS.requiredRecallAt8,
    requiredRecallAt16: requiredAt16.recall,
    requiredRecallAt16Passed:
      requiredAt16.recall === TOOL_RANKING_PROMOTION_THRESHOLDS.requiredRecallAt16,
    relevantRecallAt8: relevantAt8.recall,
    optionalRecallAt8: optionalAt8.recall,
    ndcgAt8: mixedAt8.ndcgAtK,
    ndcgAt8Passed: mixedAt8.ndcgAtK >= TOOL_RANKING_PROMOTION_THRESHOLDS.ndcgAt8,
    mandatoryToolLoss,
    mandatoryToolLossPassed:
      mandatoryToolLoss === TOOL_RANKING_PROMOTION_THRESHOLDS.mandatoryToolLoss,
    mixedRecallAt8: mixedAt8.recallAtK,
    mixedRecallAt16: mixedAt16.recallAtK,
    runtimeMandatoryMisses: roleRecallAt(cases, "runtime-mandatory", 8, rank).misses,
  };
}

/**
 * Pooled recall for one role. An empty role set is 1. This is not the
 * per-case average used by the mixed benchmark.
 */
export function roleRecallAt(
  cases: readonly ToolRankingBenchmarkCase[],
  role: ExpectedToolRole,
  topK: number,
  rank: ToolRanker = rankAgentTools,
): ToolRoleRecall {
  let recovered = 0;
  let total = 0;
  const misses: ToolRoleMiss[] = [];
  for (const benchmarkCase of cases) {
    const top = new Set(
      rank(benchmarkCase.tools, benchmarkCase.query)
        .slice(0, topK)
        .map(({ name }) => name),
    );
    for (const name of gradedToolNames(benchmarkCase)) {
      if (toolRole(benchmarkCase, name) !== role) {
        continue;
      }
      total += 1;
      if (top.has(name)) {
        recovered += 1;
      } else {
        misses.push({ id: benchmarkCase.id, tool: name });
      }
    }
  }
  return {
    recall: total === 0 ? 1 : recovered / total,
    recovered,
    total,
    misses,
  };
}

/** Graded tools absent from the whole ranking, not merely outside the top K. */
export function zeroScoreGradedTools(
  cases: readonly ToolRankingBenchmarkCase[],
  rank: ToolRanker = rankAgentTools,
): ZeroScoreGradedTool[] {
  const misses: ZeroScoreGradedTool[] = [];
  for (const benchmarkCase of cases) {
    const ranked = new Set(rank(benchmarkCase.tools, benchmarkCase.query).map(({ name }) => name));
    for (const name of gradedToolNames(benchmarkCase)) {
      if (ranked.has(name)) {
        continue;
      }
      const role = toolRole(benchmarkCase, name);
      if (!role) {
        continue;
      }
      misses.push({ id: benchmarkCase.id, tool: name, role });
    }
  }
  return misses;
}

/**
 * v1A versus frozen v1B. The live ranker may move on; this comparison must not.
 */
export function compareToolRankingExperiments(
  cases: readonly ToolRankingBenchmarkCase[],
): ToolRankingExperimentComparison {
  return {
    baseline: evaluateToolRankingBenchmark(cases, rankAgentToolsV1A),
    candidate: evaluateToolRankingBenchmark(cases, rankAgentToolsV1B),
  };
}

/**
 * Frozen v1B versus the live one-hop ranker. A higher score here does not
 * enable active filtering.
 */
export function compareRelationalRecovery(
  cases: readonly ToolRankingBenchmarkCase[],
  baselineRank: ToolRanker = rankAgentToolsV1B,
  candidateRank: ToolRanker = rankAgentTools,
): RelationalRecoveryComparison {
  const baseline = evaluateToolRankingBenchmark(cases, baselineRank);
  const candidate = evaluateToolRankingBenchmark(cases, candidateRank);
  const caseResults = cases.map((benchmarkCase, index) => {
    const baselineRanking = baseline.cases[index]?.ranking.map(({ name }) => name) ?? [];
    const candidateRanking = candidate.cases[index]?.ranking.map(({ name }) => name) ?? [];
    const recovery = zeroHitRecoveryRate({
      relevant: [...benchmarkCase.expectedTopTools, ...(benchmarkCase.optionalRelevantTools ?? [])],
      baselineRanking,
      candidateTop: candidateRanking.slice(0, benchmarkCase.topK),
    });
    return {
      id: benchmarkCase.id,
      zeroHitRelevant: recovery.zeroHit,
      recovered: recovery.recovered,
      zeroHitRecovery: recovery.rate,
      rankDisturbance: rankDisturbance({ baselineRanking, candidateRanking }),
    };
  });
  const zeroHitCount = caseResults.reduce((sum, row) => sum + row.zeroHitRelevant.length, 0);
  const recoveredCount = caseResults.reduce((sum, row) => sum + row.recovered.length, 0);
  return {
    baseline,
    candidate,
    baselineRecallAt16: evaluateToolRankingBenchmark(withTopK(cases, 16), baselineRank).recallAtK,
    candidateRecallAt16: evaluateToolRankingBenchmark(withTopK(cases, 16), candidateRank).recallAtK,
    baselineMandatoryToolLoss: mandatoryToolLossAt(cases, 8, baselineRank),
    candidateMandatoryToolLoss: mandatoryToolLossAt(cases, 8, candidateRank),
    zeroHitRecovery: zeroHitCount === 0 ? 1 : recoveredCount / zeroHitCount,
    rankDisturbance:
      caseResults.length === 0 ? 0 : average(caseResults.map((row) => row.rankDisturbance)),
    cases: caseResults,
  };
}

/**
 * Relevant tools absent from the entire baseline ranking, recovered when they
 * appear in the candidate top K. Empty denominator is 1.
 */
export function zeroHitRecoveryRate(input: {
  relevant: readonly string[];
  baselineRanking: readonly string[];
  candidateTop: readonly string[];
}): { rate: number; zeroHit: string[]; recovered: string[] } {
  const baselineNames = new Set(input.baselineRanking);
  const topNames = new Set(input.candidateTop);
  const zeroHit = input.relevant.filter((name) => !baselineNames.has(name));
  const recovered = zeroHit.filter((name) => topNames.has(name));
  return {
    rate: zeroHit.length === 0 ? 1 : recovered.length / zeroHit.length,
    zeroHit,
    recovered,
  };
}

/**
 * Mean absolute rank change for tools the baseline already ranked. A tool the
 * candidate adds is not a term. A baseline tool missing from the candidate is
 * ranked at width + 1, where width is the longer ranking.
 */
export function rankDisturbance(input: {
  baselineRanking: readonly string[];
  candidateRanking: readonly string[];
}): number {
  if (input.baselineRanking.length === 0) {
    return 0;
  }
  const width = Math.max(input.baselineRanking.length, input.candidateRanking.length);
  const candidateRank = new Map(
    input.candidateRanking.map((name, index) => [name, index + 1] as const),
  );
  const absentRank = width + 1;
  let total = 0;
  for (const [index, name] of input.baselineRanking.entries()) {
    total += Math.abs((candidateRank.get(name) ?? absentRank) - (index + 1));
  }
  return total / input.baselineRanking.length;
}

export function evaluateToolRankingBenchmark(
  cases: readonly ToolRankingBenchmarkCase[],
  rank: ToolRanker = rankAgentTools,
): ToolRankingBenchmarkResult {
  const results = cases.map((benchmarkCase) =>
    evaluateToolRankingBenchmarkCase(benchmarkCase, rank),
  );
  const count = results.length;
  if (count === 0) {
    return {
      recallAtK: 0,
      precisionAtK: 0,
      meanReciprocalRank: 0,
      ndcgAtK: 0,
      surfaceReductionAtK: 0,
      cases: results,
    };
  }
  return {
    recallAtK: average(results.map((result) => result.recallAtK)),
    precisionAtK: average(results.map((result) => result.precisionAtK)),
    meanReciprocalRank: average(results.map((result) => result.reciprocalRank)),
    ndcgAtK: average(results.map((result) => result.ndcgAtK)),
    surfaceReductionAtK: average(results.map((result) => result.surfaceReductionAtK)),
    cases: results,
  };
}

function withTopK(
  cases: readonly ToolRankingBenchmarkCase[],
  topK: number,
): ToolRankingBenchmarkCase[] {
  return cases.map((benchmarkCase) => ({ ...benchmarkCase, topK }));
}

function evaluateToolRankingBenchmarkCase(
  benchmarkCase: ToolRankingBenchmarkCase,
  rank: ToolRanker,
): ToolRankingBenchmarkCaseResult {
  const ranking = rank(benchmarkCase.tools, benchmarkCase.query);
  const top = ranking.slice(0, benchmarkCase.topK);
  const relevant = new Set([
    ...benchmarkCase.expectedTopTools,
    ...(benchmarkCase.optionalRelevantTools ?? []),
  ]);
  const topNames = new Set(top.map(({ name }) => name));
  const dominantRank = ranking.findIndex(({ name }) => name === benchmarkCase.expectedTopTools[0]);
  return {
    id: benchmarkCase.id,
    recallAtK:
      relevant.size === 0
        ? 0
        : [...relevant].filter((name) => topNames.has(name)).length / relevant.size,
    precisionAtK: [...topNames].filter((name) => relevant.has(name)).length / benchmarkCase.topK,
    reciprocalRank: dominantRank < 0 ? 0 : 1 / (dominantRank + 1),
    ndcgAtK: ndcgAtK(
      ranking.map(({ name }) => name),
      relevant,
      benchmarkCase.topK,
    ),
    surfaceReductionAtK: 1 - benchmarkCase.topK / benchmarkCase.tools.length,
    ranking,
  };
}

function gradedToolNames(benchmarkCase: ToolRankingBenchmarkCase): string[] {
  return [...benchmarkCase.expectedTopTools, ...(benchmarkCase.optionalRelevantTools ?? [])];
}

function mandatoryToolLossAt(
  cases: readonly ToolRankingBenchmarkCase[],
  topK: number,
  rank: ToolRanker,
): number {
  let total = 0;
  let missed = 0;
  for (const benchmarkCase of cases) {
    const top = new Set(
      rank(benchmarkCase.tools, benchmarkCase.query)
        .slice(0, topK)
        .map(({ name }) => name),
    );
    for (const name of benchmarkCase.expectedTopTools) {
      total += 1;
      if (!top.has(name)) {
        missed += 1;
      }
    }
  }
  return total === 0 ? 0 : missed / total;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
