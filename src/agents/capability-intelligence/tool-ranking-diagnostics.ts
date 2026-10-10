import { tokenizeQuery } from "../tool-search-ranking.js";
import {
  compareAgentToolRankings,
  rankAgentToolsDetailed,
  toolRetrievalTerms,
  type CapabilityDomainScore,
} from "./rank-agent-tools.js";
import {
  toolRole,
  type ExpectedToolRole,
  type ToolRankingBenchmarkCase,
} from "./tool-ranking-benchmark-cases.js";

/**
 * Why an expected tool missed the top K. `mandatory_surface_error` is only
 * assigned when the caller marks the tool runtime-mandatory. It is not inferred
 * from the query, and it is not a ranking bonus.
 */
export type MissReason =
  | "below_k"
  | "zero_base_score"
  | "domain_discount"
  | "relation_absent"
  | "mandatory_surface_error";

export type ToolRankingMissDiagnostic = {
  expectedTool: string;
  actualRank: number | null;
  score: number;
  baseScore: number;
  relationScore: number;
  reason: MissReason;
  role: ExpectedToolRole | null;
  topCompetitor: string | null;
  topCompetitorRank: number | null;
  topCompetitorScore: number;
  scoreDifference: number;
  matchedTokens: string[];
  missingQueryTerms: string[];
};

type RankedName = {
  name: string;
  score: number;
  matchedLiteral: boolean;
};

export type ToolRankingCaseDiagnostic = {
  id: string;
  category: ToolRankingBenchmarkCase["category"];
  split: ToolRankingBenchmarkCase["split"];
  expected: string[];
  topK: string[];
  missed: string[];
  wrongHighRank: string[];
  domains: CapabilityDomainScore[];
  misses: ToolRankingMissDiagnostic[];
};

export function diagnoseToolRankingBenchmark(
  cases: readonly ToolRankingBenchmarkCase[],
): ToolRankingCaseDiagnostic[] {
  return cases.map(diagnoseToolRankingCase);
}

export function formatToolRankingDiagnostics(
  diagnostics: readonly ToolRankingCaseDiagnostic[],
): string {
  const lines = [
    "| Case | Expected | Top 8 | Missed | Wrong high-rank |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of diagnostics) {
    lines.push(
      `| ${row.id} | ${list(row.expected)} | ${list(row.topK)} | ${list(row.missed)} | ${list(row.wrongHighRank)} |`,
    );
  }
  for (const row of diagnostics) {
    if (row.misses.length === 0) {
      continue;
    }
    lines.push("", `## ${row.id}`);
    for (const miss of row.misses) {
      lines.push(
        "",
        "Expected:",
        miss.expectedTool,
        "",
        "Rank:",
        formatRank(miss.actualRank),
        "",
        "Score:",
        miss.score.toFixed(2),
        "",
        "Base score:",
        miss.baseScore.toFixed(2),
        "",
        "Relation score:",
        miss.relationScore.toFixed(2),
        "",
        "Reason:",
        miss.reason,
        "",
        "Role:",
        miss.role ?? "unlabeled",
        "",
        "Wrong candidate:",
        miss.topCompetitor ?? "none",
        "",
        "Competitor rank:",
        formatRank(miss.topCompetitorRank),
        "",
        "Competitor score:",
        miss.topCompetitorScore.toFixed(2),
        "",
        "Score difference:",
        miss.scoreDifference.toFixed(2),
        "",
        "Matched tokens:",
        list(miss.matchedTokens),
        "",
        "Missing query terms:",
        list(miss.missingQueryTerms),
      );
    }
  }
  return lines.join("\n");
}

function diagnoseToolRankingCase(
  benchmarkCase: ToolRankingBenchmarkCase,
): ToolRankingCaseDiagnostic {
  const report = rankAgentToolsDetailed(benchmarkCase.tools, benchmarkCase.query);
  const topK = report.rankings.slice(0, benchmarkCase.topK).map(({ name }) => name);
  const topNames = new Set(topK);
  const relevant = [
    ...benchmarkCase.expectedTopTools,
    ...(benchmarkCase.optionalRelevantTools ?? []),
  ];
  const relevantNames = new Set(relevant);
  const literalTerms = tokenizeQuery(benchmarkCase.query)
    .filter((term) => term.weight >= 1)
    .map((term) => term.term);
  const toolsByName = new Map(benchmarkCase.tools.map((tool) => [tool.name, tool]));
  const missed = relevant.filter((name) => !topNames.has(name));
  const competitor = report.rankings.find((entry) => !relevantNames.has(entry.name));

  return {
    id: benchmarkCase.id,
    category: benchmarkCase.category,
    split: benchmarkCase.split,
    expected: [...benchmarkCase.expectedTopTools],
    topK,
    missed,
    wrongHighRank: topK.filter((name) => !relevantNames.has(name)),
    domains: report.domains,
    misses: missed.map((expectedTool) => {
      const position = report.rankings.findIndex((entry) => entry.name === expectedTool);
      const entry = position < 0 ? undefined : report.rankings[position];
      const score = entry?.score ?? 0;
      const baseScore = entry?.baseScore ?? 0;
      const relationScore = entry?.relationScore ?? 0;
      const terms = new Set(
        toolsByName.has(expectedTool)
          ? toolRetrievalTerms(toolsByName.get(expectedTool) ?? { name: expectedTool })
          : [],
      );
      const competitorScore = competitor?.score ?? 0;
      return {
        expectedTool,
        actualRank: position < 0 ? null : position + 1,
        score,
        baseScore,
        relationScore,
        reason: classifyToolRankingMiss({
          toolName: expectedTool,
          baseScore,
          relationScore,
          domainFactor: entry?.domainFactor ?? 1,
          matchedLiteral: entry?.matchedLiteral ?? false,
          topK: benchmarkCase.topK,
          rankings: report.rankings,
        }),
        role: toolRole(benchmarkCase, expectedTool) ?? null,
        topCompetitor: competitor?.name ?? null,
        topCompetitorRank: competitor ? report.rankings.indexOf(competitor) + 1 : null,
        topCompetitorScore: competitorScore,
        scoreDifference: competitorScore - score,
        matchedTokens: literalTerms.filter((term) => terms.has(term)),
        missingQueryTerms: literalTerms.filter((term) => !terms.has(term)),
      };
    }),
  };
}

export function classifyToolRankingMiss(input: {
  toolName: string;
  baseScore: number;
  relationScore: number;
  domainFactor: number;
  matchedLiteral: boolean;
  topK: number;
  rankings: readonly RankedName[];
  /** Category F. Not inferred from text and not applied as a score bonus. */
  runtimeMandatory?: boolean;
}): MissReason {
  if (input.runtimeMandatory) {
    return "mandatory_surface_error";
  }
  if (input.baseScore <= 0 && input.relationScore <= 0) {
    return "relation_absent";
  }
  if (input.baseScore <= 0) {
    return "zero_base_score";
  }
  if (input.domainFactor > 0 && input.domainFactor < 1 && hypotheticalRank(input) <= input.topK) {
    return "domain_discount";
  }
  return "below_k";
}

function hypotheticalRank(input: {
  toolName: string;
  baseScore: number;
  relationScore: number;
  domainFactor: number;
  matchedLiteral: boolean;
  rankings: readonly RankedName[];
}): number {
  const undiscounted = input.baseScore / input.domainFactor + input.relationScore;
  const adjusted: RankedName[] = [];
  for (const entry of input.rankings) {
    adjusted.push({
      name: entry.name,
      score: entry.name === input.toolName ? undiscounted : entry.score,
      matchedLiteral: entry.matchedLiteral,
    });
  }
  if (!adjusted.some((entry) => entry.name === input.toolName)) {
    adjusted.push({
      name: input.toolName,
      score: undiscounted,
      matchedLiteral: input.matchedLiteral,
    });
  }
  adjusted.sort(compareAgentToolRankings);
  return adjusted.findIndex((entry) => entry.name === input.toolName) + 1;
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

function formatRank(rank: number | null): string {
  return rank === null ? "not ranked" : String(rank);
}
