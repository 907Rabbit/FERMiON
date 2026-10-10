import type { ClientToolDefinition } from "../command/shared-types.js";
import type { ToolRankingBenchmarkCase } from "./tool-ranking-benchmark-cases.js";

export type SyntheticToolInvocation = {
  caseId: string;
  invocationIndex: number;
  tool: string;
  params: Record<string, unknown>;
  result: {
    ok: true;
    synthetic: true;
    tool: string;
    caseId: string;
    invocationIndex: number;
  };
};

export type SyntheticBenchmarkToolHarness = {
  clientTools: readonly ClientToolDefinition[];
  invoke: (tool: string, params?: Record<string, unknown>) => SyntheticToolInvocation;
  recordClientToolCalls: (
    calls: readonly { name: string; params: Record<string, unknown> }[],
  ) => readonly SyntheticToolInvocation[];
};

const SYNTHETIC_PARAMETERS = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: true,
});

export function createSyntheticBenchmarkToolHarness(
  benchmarkCase: Pick<ToolRankingBenchmarkCase, "id" | "tools">,
): SyntheticBenchmarkToolHarness {
  let invocationIndex = 0;
  const clientTools = benchmarkCase.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: SYNTHETIC_PARAMETERS,
      strict: false,
    },
  }));
  const invoke = (tool: string, params: Record<string, unknown> = {}) => {
    const index = invocationIndex++;
    return {
      caseId: benchmarkCase.id,
      invocationIndex: index,
      tool,
      params: { ...params },
      result: {
        ok: true as const,
        synthetic: true as const,
        tool,
        caseId: benchmarkCase.id,
        invocationIndex: index,
      },
    } satisfies SyntheticToolInvocation;
  };
  return {
    clientTools,
    invoke,
    recordClientToolCalls: (calls) => calls.map((call) => invoke(call.name, call.params)),
  };
}
