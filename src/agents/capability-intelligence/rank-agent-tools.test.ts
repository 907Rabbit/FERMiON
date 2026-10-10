import { describe, expect, it } from "vitest";
import { aliasesForTool } from "./capability-catalog.js";
import {
  CAPABILITY_FIELD_WEIGHTS,
  rankAgentTools,
  rankAgentToolsDetailed,
  rankAgentToolsV1B,
  selectCapabilityDomains,
} from "./rank-agent-tools.js";
import { TOOL_RANKING_BENCHMARK_CASES } from "./tool-ranking-benchmark-cases.js";

describe("rankAgentTools", () => {
  it("ranks authorized tools by literal relevance with deterministic ties", () => {
    const ranked = rankAgentTools(
      [
        { name: "web_search", description: "Search the web for current information" },
        { name: "read_file", description: "Read a file from disk" },
        { name: "test_run", description: "Run the project test suite" },
      ],
      "search the web",
    );

    expect(ranked.map(({ name }) => name)).toEqual(["web_search"]);
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("returns no recommendation when the query has no catalog match", () => {
    expect(
      rankAgentTools([{ name: "read_file", description: "Read a file from disk" }], "play a piano"),
    ).toEqual([]);
  });

  it("retrieves a kebab-case name from its lexical parts without a description", () => {
    const ranked = rankAgentTools(
      [
        { name: "web-search", description: "" },
        { name: "camera_snap", description: "" },
      ],
      "web search",
    );

    expect(ranked[0]?.name).toBe("web-search");
  });

  it("does not let a stuffed description outrank an alias hit", () => {
    const ranked = rankAgentTools(
      [
        {
          name: "exec",
          description: "run run run run tests tests tests tests tests tests tests",
        },
        { name: "pytest", description: "helper" },
      ],
      "failing tests",
    );

    expect(ranked[0]?.name).toBe("pytest");
  });

  it("keeps the field weights fixed", () => {
    expect(CAPABILITY_FIELD_WEIGHTS).toEqual({ name: 0.4, aliases: 0.4, description: 0.2 });
  });

  it("stores capability aliases as retrieval metadata", () => {
    expect(aliasesForTool("pytest")).toEqual(
      expect.arrayContaining([
        "python tests",
        "test suite",
        "run tests",
        "failing tests",
        "pytest",
        "unit tests",
      ]),
    );
    expect(aliasesForTool("git.diff")).toEqual(
      expect.arrayContaining([
        "git",
        "diff",
        "changes",
        "modified files",
        "compare changes",
        "repository changes",
      ]),
    );
  });

  it("selects git and coding ahead of web for a mixed change-and-test query", () => {
    const domains = Object.fromEntries(
      selectCapabilityDomains("find what changed and why tests fail").map((domain) => [
        domain.domain,
        domain,
      ]),
    );

    expect(domains.git?.score).toBeGreaterThan(domains.web?.score ?? 0);
    expect(domains.coding?.score).toBeGreaterThan(domains.web?.score ?? 0);
    expect(domains.git?.selected).toBe(true);
    expect(domains.coding?.selected).toBe(true);
    expect(domains.web?.selected).toBe(false);
  });

  it("does not let relation edges change domain selection", () => {
    const query = "find what changed and why tests fail";
    const report = rankAgentToolsDetailed(
      [
        { name: "pytest", description: "Run Python tests" },
        { name: "git_diff", description: "Show repository changes" },
        { name: "read", description: "Read a file" },
      ],
      query,
    );

    expect(report.domains).toEqual(selectCapabilityDomains(query));
  });

  it("recovers read from pytest without outranking the lexical hit", () => {
    const tools = [
      { name: "pytest", description: "zzzz" },
      { name: "read", description: "zzzz" },
      { name: "camera", description: "zzzz" },
    ];
    const lexical = rankAgentToolsV1B(tools, "pytest");
    const ranked = rankAgentToolsDetailed(tools, "pytest");
    const read = ranked.rankings.find((entry) => entry.name === "read");

    expect(lexical.map(({ name }) => name)).toEqual(["pytest"]);
    expect(ranked.rankings.map(({ name }) => name)).toEqual(["pytest", "read"]);
    expect(read).toMatchObject({ baseScore: 0, matchedLiteral: false, domainFactor: 1 });
    expect(read?.relationScore).toBeGreaterThan(0);
    expect(read?.relationScore).toBeLessThanOrEqual(0.3);
    expect(read?.score).toBeLessThan(ranked.rankings[0]?.score ?? 0);
    expect(ranked.rankings.some((entry) => entry.name === "camera")).toBe(false);
  });

  it("recovers the benchmark companions that lexical scoring scored at zero", () => {
    const schedule = benchmarkCase("schedule-reminder");
    const regression = benchmarkCase("python-test-regression");
    const review = benchmarkCase("git-review-patch");

    expect(names(rankAgentToolsV1B(schedule.tools, schedule.query))).not.toContain(
      "sessions_history",
    );
    expect(top(schedule)).toContain("sessions_history");
    expect(top(schedule).indexOf("sessions_history")).toBeGreaterThan(
      top(schedule).indexOf("cron"),
    );

    expect(names(rankAgentToolsV1B(regression.tools, regression.query))).not.toContain("read");
    expect(top(regression)).toContain("read");
    expect(top(regression).indexOf("read")).toBeGreaterThan(top(regression).indexOf("pytest"));

    expect(names(rankAgentToolsV1B(review.tools, review.query))).not.toContain("git_status");
    expect(top(review)).toContain("git_status");
    expect(top(review).indexOf("git_status")).toBeGreaterThan(top(review).indexOf("git_diff"));
  });
});

function benchmarkCase(id: string) {
  const found = TOOL_RANKING_BENCHMARK_CASES.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing benchmark case ${id}`);
  }
  return found;
}

function names(rankings: readonly { name: string }[]): string[] {
  return rankings.map(({ name }) => name);
}

function top(benchmark: {
  tools: { name: string; description?: string }[];
  query: string;
}): string[] {
  return rankAgentTools(benchmark.tools, benchmark.query)
    .slice(0, 8)
    .map(({ name }) => name);
}
