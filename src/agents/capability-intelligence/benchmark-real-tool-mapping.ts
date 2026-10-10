import type { ToolRankingBenchmarkCase } from "./tool-ranking-benchmark-cases.js";

export const BENCHMARK_TOOL_MAPPING_CLASSES = ["EXACT", "ADAPTER", "UNSUPPORTED"] as const;
export type BenchmarkToolMappingClass = (typeof BENCHMARK_TOOL_MAPPING_CLASSES)[number];

export type BenchmarkRealToolMapping = {
  benchmarkTool: string;
  realTool: string | null;
  classification: BenchmarkToolMappingClass;
  adapterIntent: string | null;
  reason: string;
};

// This registry is deliberately explicit. It is an evaluation contract, not a
// lookup over the live tool catalog, so a new benchmark name cannot silently
// acquire an inferred production equivalent.
export const BENCHMARK_REAL_TOOL_MAPPINGS: readonly BenchmarkRealToolMapping[] = [
  exact("apply_patch", "apply_patch", "OpenClaw exposes the patch tool under this name."),
  unsupported("browser", "No unconditional core browser tool is guaranteed."),
  unsupported("calendar", "No unconditional core calendar tool is guaranteed."),
  unsupported("camera", "No unconditional core camera tool is guaranteed."),
  unsupported("canvas", "No unconditional core canvas tool is guaranteed."),
  unsupported("cron", "The current runtime names scheduled-job control differently."),
  unsupported("docker", "No unconditional core Docker tool is guaranteed."),
  exact("edit", "edit", "OpenClaw exposes the file edit tool under this name."),
  unsupported("email", "No unconditional core email tool is guaranteed."),
  exact("exec", "exec", "OpenClaw exposes the shell tool under this name."),
  adapter(
    "git_diff",
    "exec",
    "git diff",
    "The benchmark operation is executed through shell control.",
  ),
  adapter(
    "git_status",
    "exec",
    "git status",
    "The benchmark operation is executed through shell control.",
  ),
  exact("image", "image", "OpenClaw exposes image analysis under this name."),
  exact("memory_get", "memory_get", "OpenClaw exposes memory retrieval under this name."),
  exact("memory_search", "memory_search", "OpenClaw exposes memory search under this name."),
  exact("message", "message", "OpenClaw exposes messaging under this name."),
  exact("process", "process", "OpenClaw exposes process control under this name."),
  adapter(
    "pytest",
    "exec",
    "run tests",
    "The benchmark operation is executed through shell control.",
  ),
  exact("read", "read", "OpenClaw exposes file reading under this name."),
  exact(
    "sessions_history",
    "sessions_history",
    "OpenClaw exposes session history under this name.",
  ),
  exact("sessions_list", "sessions_list", "OpenClaw exposes session listing under this name."),
  exact("sessions_search", "sessions_search", "OpenClaw exposes session search under this name."),
  exact("sessions_spawn", "sessions_spawn", "OpenClaw exposes session spawning under this name."),
  unsupported(
    "tool_call",
    "The benchmark tool is not unconditionally present in the runtime surface.",
  ),
  unsupported(
    "tool_describe",
    "The benchmark tool is not unconditionally present in the runtime surface.",
  ),
  unsupported(
    "tool_search",
    "The benchmark tool is not unconditionally present in the runtime surface.",
  ),
  unsupported("update", "No unconditional core update tool is guaranteed."),
  unsupported("weather", "No unconditional core weather tool is guaranteed."),
  exact("web_fetch", "web_fetch", "OpenClaw exposes page fetching under this name."),
  exact("web_search", "web_search", "OpenClaw exposes web search under this name."),
  exact("write", "write", "OpenClaw exposes file writing under this name."),
] as const;

const MAPPING_BY_BENCHMARK_TOOL = new Map(
  BENCHMARK_REAL_TOOL_MAPPINGS.map((mapping) => [mapping.benchmarkTool, mapping]),
);

export function getBenchmarkRealToolMapping(benchmarkTool: string): BenchmarkRealToolMapping {
  const mapping = MAPPING_BY_BENCHMARK_TOOL.get(benchmarkTool);
  if (!mapping) {
    throw new Error(`benchmark tool is unclassified: ${benchmarkTool}`);
  }
  return mapping;
}

export type BenchmarkCaseEligibility = {
  caseId: string;
  mappingClass: Exclude<BenchmarkToolMappingClass, "UNSUPPORTED"> | "UNSUPPORTED";
  mappedTools: readonly string[];
  unsupportedRequiredTools: readonly string[];
  adapterRequiredTools: readonly string[];
};

export type BenchmarkRealToolMappingSummary = {
  totalCases: number;
  exactOnlyCases: number;
  exactPlusAdapterCases: number;
  unsupportedCases: number;
  cases: readonly BenchmarkCaseEligibility[];
};

export function summarizeBenchmarkRealToolMappings(
  cases: readonly ToolRankingBenchmarkCase[],
): BenchmarkRealToolMappingSummary {
  const eligibility = cases.map((benchmarkCase) => {
    const required = benchmarkCase.expectedTopTools.map(getBenchmarkRealToolMapping);
    const unsupportedRequiredTools = required
      .filter((mapping) => mapping.classification === "UNSUPPORTED")
      .map((mapping) => mapping.benchmarkTool);
    const adapterRequiredTools = required
      .filter((mapping) => mapping.classification === "ADAPTER")
      .map((mapping) => mapping.benchmarkTool);
    const mappingClass =
      unsupportedRequiredTools.length > 0
        ? "UNSUPPORTED"
        : adapterRequiredTools.length > 0
          ? "ADAPTER"
          : "EXACT";
    const mappedTools = [
      ...new Set(
        benchmarkCase.tools.flatMap((tool) => {
          const mapping = getBenchmarkRealToolMapping(tool.name);
          return mapping.realTool ? [mapping.realTool] : [];
        }),
      ),
    ];
    return {
      caseId: benchmarkCase.id,
      mappingClass,
      mappedTools,
      unsupportedRequiredTools,
      adapterRequiredTools,
    } satisfies BenchmarkCaseEligibility;
  });
  return {
    totalCases: eligibility.length,
    exactOnlyCases: eligibility.filter((entry) => entry.mappingClass === "EXACT").length,
    exactPlusAdapterCases: eligibility.filter((entry) => entry.mappingClass === "ADAPTER").length,
    unsupportedCases: eligibility.filter((entry) => entry.mappingClass === "UNSUPPORTED").length,
    cases: eligibility,
  };
}

function exact(benchmarkTool: string, realTool: string, reason: string): BenchmarkRealToolMapping {
  return { benchmarkTool, realTool, classification: "EXACT", adapterIntent: null, reason };
}

function adapter(
  benchmarkTool: string,
  realTool: string,
  adapterIntent: string,
  reason: string,
): BenchmarkRealToolMapping {
  return { benchmarkTool, realTool, classification: "ADAPTER", adapterIntent, reason };
}

function unsupported(benchmarkTool: string, reason: string): BenchmarkRealToolMapping {
  return {
    benchmarkTool,
    realTool: null,
    classification: "UNSUPPORTED",
    adapterIntent: null,
    reason,
  };
}
