/**
 * Frozen execution hedge for one model. This is not a semantic relation
 * and it does not call or modify the v1C ranker.
 *
 * The edges were counted on v1E-3. v1F-2 was used only to choose this
 * one-slot union. A later batch must not rewrite the counts.
 */
export const EXECUTION_HEDGE_ID = "qwen3.5-9b-substitution-v1";
export const SURFACE_POLICY_ID = "semantic-union-1";
export const EXECUTION_HEDGE_MODEL_ID = "qwen/qwen3.5-9b";
export const EXECUTION_HEDGE_TRAINING_BATCH = "v1e-3-surface-valid";
export const EXECUTION_HEDGE_SELECTION_BATCH = "v1f-2-surface-valid";
export const EXECUTION_HEDGE_MIN_OPPORTUNITIES = 8;
export const EXECUTION_HEDGE_MAX_ADDED_TOOLS = 1;

export type ExecutionSubstitutionEdge = {
  semanticTool: string;
  executedTool: string;
  opportunities: number;
  executionCount: number;
  modelId: string;
};

export type ExecutionSubstitutionChoice = {
  hedgeTool: string;
  hedgeTriggeredBy: string;
  opportunities: number;
  executionCount: number;
};

type FrozenEdge = ExecutionSubstitutionEdge & { readonly modelId: typeof EXECUTION_HEDGE_MODEL_ID };

function edgeKey(semanticTool: string, executedTool: string): string {
  return `${semanticTool}\t${executedTool}`;
}

function rateCross(left: ExecutionSubstitutionEdge, right: ExecutionSubstitutionEdge): number {
  return left.executionCount * right.opportunities - right.executionCount * left.opportunities;
}

function eligibleEdge(edge: ExecutionSubstitutionEdge): boolean {
  return (
    edge.modelId === EXECUTION_HEDGE_MODEL_ID &&
    edge.opportunities >= EXECUTION_HEDGE_MIN_OPPORTUNITIES &&
    edge.executionCount > 0 &&
    edge.semanticTool !== edge.executedTool &&
    edge.semanticTool.length > 0 &&
    edge.executedTool.length > 0
  );
}

function indexEdges(
  table: readonly ExecutionSubstitutionEdge[],
  strict: boolean,
): Map<string, ExecutionSubstitutionEdge> {
  const index = new Map<string, ExecutionSubstitutionEdge>();
  for (const edge of table) {
    if (!eligibleEdge(edge)) {
      if (strict) {
        throw new Error(
          `execution substitution edge ${edge.semanticTool} -> ${edge.executedTool} is not eligible`,
        );
      }
      continue;
    }
    const key = edgeKey(edge.semanticTool, edge.executedTool);
    if (index.has(key)) {
      throw new Error(`duplicate execution substitution edge ${edge.semanticTool} -> ${edge.executedTool}`);
    }
    index.set(key, edge);
  }
  return index;
}

/**
 * High-ranked substitution counts from v1E-3.
 * An edge is present only when the semantic tool was on that run's v1C
 * surface, the executed tool was authorized, and at least eight runs support it.
 */
export const FROZEN_EXECUTION_SUBSTITUTIONS: readonly FrozenEdge[] = [
  { semanticTool: "message", executedTool: "sessions_spawn", opportunities: 119, executionCount: 59, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_fetch", executedTool: "web_search", opportunities: 350, executionCount: 132, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "write", executedTool: "read", opportunities: 229, executionCount: 84, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "message", executedTool: "sessions_list", opportunities: 119, executionCount: 42, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "sessions_list", opportunities: 292, executionCount: 100, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "sessions_list", opportunities: 415, executionCount: 138, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "sessions_list", opportunities: 649, executionCount: 194, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "apply_patch", executedTool: "read", opportunities: 289, executionCount: 85, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "edit", executedTool: "read", opportunities: 289, executionCount: 84, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "exec", executedTool: "sessions_list", opportunities: 351, executionCount: 96, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_search", executedTool: "sessions_list", opportunities: 356, executionCount: 97, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "edit", executedTool: "web_search", opportunities: 289, executionCount: 72, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "sessions_spawn", opportunities: 415, executionCount: 102, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "sessions_spawn", opportunities: 415, executionCount: 102, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "web_search", opportunities: 533, executionCount: 120, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "apply_patch", executedTool: "sessions_list", opportunities: 289, executionCount: 59, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "sessions_list", opportunities: 995, executionCount: 194, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "sessions_spawn", opportunities: 531, executionCount: 102, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "web_search", opportunities: 649, executionCount: 120, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "sessions_list", opportunities: 819, executionCount: 138, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "exec", executedTool: "process", opportunities: 351, executionCount: 57, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "read", opportunities: 819, executionCount: 125, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "web_search", opportunities: 415, executionCount: 63, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "write", executedTool: "exec", opportunities: 229, executionCount: 34, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "read", opportunities: 649, executionCount: 92, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "read", opportunities: 995, executionCount: 140, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "exec", executedTool: "read", opportunities: 351, executionCount: 49, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "web_search", opportunities: 995, executionCount: 135, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "exec", opportunities: 413, executionCount: 56, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "read", opportunities: 292, executionCount: 39, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "read", opportunities: 415, executionCount: 54, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "exec", executedTool: "sessions_spawn", opportunities: 351, executionCount: 43, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "apply_patch", executedTool: "exec", opportunities: 289, executionCount: 34, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "edit", executedTool: "exec", opportunities: 289, executionCount: 34, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "sessions_spawn", opportunities: 877, executionCount: 102, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "exec", opportunities: 292, executionCount: 30, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "read", opportunities: 533, executionCount: 54, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "web_search", opportunities: 819, executionCount: 78, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_fetch", executedTool: "read", opportunities: 350, executionCount: 31, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "exec", opportunities: 819, executionCount: 64, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "apply_patch", executedTool: "write", opportunities: 289, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "edit", executedTool: "write", opportunities: 289, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_fetch", executedTool: "write", opportunities: 292, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "exec", executedTool: "sessions_history", opportunities: 351, executionCount: 25, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "sessions_list", opportunities: 413, executionCount: 29, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "process", opportunities: 819, executionCount: 57, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "sessions_history", opportunities: 415, executionCount: 28, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "exec", opportunities: 995, executionCount: 66, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "message", executedTool: "read", opportunities: 119, executionCount: 7, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "sessions_history", opportunities: 533, executionCount: 31, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "sessions_history", opportunities: 413, executionCount: 24, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "process", opportunities: 995, executionCount: 57, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_fetch", executedTool: "exec", opportunities: 350, executionCount: 20, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "exec", opportunities: 649, executionCount: 37, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "write", opportunities: 412, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "exec", opportunities: 415, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "write", executedTool: "web_search", opportunities: 229, executionCount: 12, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "message", executedTool: "automations", opportunities: 119, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "exec", opportunities: 533, executionCount: 23, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "message", executedTool: "sessions_search", opportunities: 119, executionCount: 5, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "apply_patch", executedTool: "web_search", opportunities: 289, executionCount: 12, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "sessions_history", opportunities: 819, executionCount: 29, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "sessions_history", opportunities: 995, executionCount: 32, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "web_search", opportunities: 413, executionCount: 13, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "write", opportunities: 819, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_search", executedTool: "sessions_search", opportunities: 238, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "message", executedTool: "sessions_history", opportunities: 119, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "message", executedTool: "web_search", opportunities: 119, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "write", opportunities: 877, executionCount: 22, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_search", executedTool: "read", opportunities: 356, executionCount: 7, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_search", executedTool: "sessions_history", opportunities: 356, executionCount: 7, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "sessions_search", opportunities: 292, executionCount: 5, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "sessions_spawn", opportunities: 412, executionCount: 7, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "sessions_search", opportunities: 415, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "automations", opportunities: 415, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_search", executedTool: "web_fetch", opportunities: 356, executionCount: 5, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "sessions_spawn", opportunities: 292, executionCount: 4, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "write", executedTool: "apply_patch", opportunities: 229, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "sessions_search", opportunities: 531, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "automations", opportunities: 533, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "edit", executedTool: "apply_patch", opportunities: 289, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "sessions_history", opportunities: 292, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "process", executedTool: "web_search", opportunities: 292, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "automations", opportunities: 649, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "sessions_search", opportunities: 819, executionCount: 7, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "sessions_search", opportunities: 877, executionCount: 7, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "automations", opportunities: 819, executionCount: 6, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "apply_patch", opportunities: 413, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_search", executedTool: "exec", opportunities: 356, executionCount: 2, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "web_fetch", opportunities: 995, executionCount: 5, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_spawn", executedTool: "web_fetch", opportunities: 819, executionCount: 4, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "process", opportunities: 413, executionCount: 2, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_list", executedTool: "web_fetch", opportunities: 533, executionCount: 2, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "edit", executedTool: "web_fetch", opportunities: 289, executionCount: 1, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_fetch", executedTool: "sessions_search", opportunities: 292, executionCount: 1, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_history", executedTool: "web_fetch", opportunities: 649, executionCount: 2, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "automations", executedTool: "apply_patch", opportunities: 995, executionCount: 3, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "web_fetch", executedTool: "sessions_history", opportunities: 350, executionCount: 1, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "exec", executedTool: "sessions_search", opportunities: 351, executionCount: 1, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "read", executedTool: "sessions_search", opportunities: 412, executionCount: 1, modelId: EXECUTION_HEDGE_MODEL_ID },
  { semanticTool: "sessions_search", executedTool: "web_fetch", opportunities: 415, executionCount: 1, modelId: EXECUTION_HEDGE_MODEL_ID },
] as const;

const FROZEN_EDGE_INDEX = indexEdges(FROZEN_EXECUTION_SUBSTITUTIONS, true);

function bestTrigger(
  tool: string,
  semanticSurface: readonly string[],
  index: Map<string, ExecutionSubstitutionEdge>,
): ExecutionSubstitutionEdge | undefined {
  let winning: ExecutionSubstitutionEdge | undefined;
  const seen = new Set<string>();
  for (const trigger of semanticSurface) {
    if (seen.has(trigger)) {
      continue;
    }
    seen.add(trigger);
    const edge = index.get(edgeKey(trigger, tool));
    if (!edge || !eligibleEdge(edge)) {
      continue;
    }
    if (!winning) {
      winning = edge;
      continue;
    }
    const cross = rateCross(edge, winning);
    if (cross > 0 || (cross === 0 && edge.executionCount > winning.executionCount)) {
      winning = edge;
    }
  }
  return winning;
}

/**
 * One authorized substitute, or no hedge.
 * There is no global fallback when the frozen table has no supported trigger.
 */
export function selectExecutionSubstitution(
  input: {
    modelId: string;
    semanticSurface: readonly string[];
    authorizedTools: readonly string[];
    table?: readonly ExecutionSubstitutionEdge[];
  },
): ExecutionSubstitutionChoice | undefined {
  if (input.modelId !== EXECUTION_HEDGE_MODEL_ID || EXECUTION_HEDGE_MAX_ADDED_TOOLS !== 1) {
    return undefined;
  }
  const index = input.table ? indexEdges(input.table, false) : FROZEN_EDGE_INDEX;
  const surface = new Set(input.semanticSurface);
  let bestTool: string | undefined;
  let bestEdge: ExecutionSubstitutionEdge | undefined;
  const seenTools = new Set<string>();
  for (const tool of input.authorizedTools) {
    if (seenTools.has(tool) || surface.has(tool)) {
      continue;
    }
    seenTools.add(tool);
    const edge = bestTrigger(tool, input.semanticSurface, index);
    if (!edge) {
      continue;
    }
    if (!bestEdge || !bestTool) {
      bestTool = tool;
      bestEdge = edge;
      continue;
    }
    const cross = rateCross(edge, bestEdge);
    if (
      cross > 0 ||
      (cross === 0 && edge.executionCount > bestEdge.executionCount) ||
      (cross === 0 && edge.executionCount === bestEdge.executionCount && tool.localeCompare(bestTool) < 0)
    ) {
      bestTool = tool;
      bestEdge = edge;
    }
  }
  if (!bestTool || !bestEdge) {
    return undefined;
  }
  return {
    hedgeTool: bestTool,
    hedgeTriggeredBy: bestEdge.semanticTool,
    opportunities: bestEdge.opportunities,
    executionCount: bestEdge.executionCount,
  };
}

export function semanticUnionSurface(
  semanticSurface: readonly string[],
  choice: ExecutionSubstitutionChoice | undefined,
): string[] {
  if (!choice || semanticSurface.includes(choice.hedgeTool)) {
    return [...semanticSurface];
  }
  return [...semanticSurface, choice.hedgeTool];
}

export type CandidateSurfaceRun = {
  semanticSurface: readonly string[];
  hedgeTool?: string;
  executions: readonly { tool: string; requiredProvenance: boolean }[];
};

export type CandidateSurfaceSummary = {
  executions: number;
  semanticContained: number;
  candidateContained: number;
  requiredExecutions: number;
  semanticRequiredContained: number;
  candidateRequiredContained: number;
  averageSemanticSize: number;
  averageCandidateSize: number;
  hedgeActivations: number;
  hedgeRecoveries: number;
  hedgeFalseAdditions: number;
};

function ratio(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

/** Run-weighted sizes and execution-weighted containment. Not a qualification gate. */
export function summarizeCandidateSurface(
  runs: readonly CandidateSurfaceRun[],
): CandidateSurfaceSummary & {
  semanticContainment: number | null;
  candidateContainment: number | null;
  semanticRequiredContainment: number | null;
  candidateRequiredContainment: number | null;
} {
  let executions = 0;
  let semanticContained = 0;
  let candidateContained = 0;
  let requiredExecutions = 0;
  let semanticRequiredContained = 0;
  let candidateRequiredContained = 0;
  let semanticSize = 0;
  let candidateSize = 0;
  let hedgeActivations = 0;
  let hedgeRecoveries = 0;
  let hedgeFalseAdditions = 0;
  for (const run of runs) {
    const semantic = new Set(run.semanticSurface);
    const hedge = run.hedgeTool !== undefined && !semantic.has(run.hedgeTool) ? run.hedgeTool : undefined;
    semanticSize += semantic.size;
    candidateSize += semantic.size + (hedge ? 1 : 0);
    if (hedge) {
      hedgeActivations += 1;
    }
    let hedgeMatchedExecution = false;
    for (const execution of run.executions) {
      executions += 1;
      const inSemantic = semantic.has(execution.tool);
      const inCandidate = inSemantic || execution.tool === hedge;
      if (inSemantic) {
        semanticContained += 1;
      }
      if (inCandidate) {
        candidateContained += 1;
      }
      if (!inSemantic && execution.tool === hedge) {
        hedgeRecoveries += 1;
        hedgeMatchedExecution = true;
      }
      if (execution.requiredProvenance) {
        requiredExecutions += 1;
        if (inSemantic) {
          semanticRequiredContained += 1;
        }
        if (inCandidate) {
          candidateRequiredContained += 1;
        }
      }
    }
    if (hedge && run.executions.length > 0 && !hedgeMatchedExecution) {
      hedgeFalseAdditions += 1;
    }
  }
  const runCount = runs.length;
  return {
    executions,
    semanticContained,
    candidateContained,
    requiredExecutions,
    semanticRequiredContained,
    candidateRequiredContained,
    averageSemanticSize: runCount === 0 ? 0 : semanticSize / runCount,
    averageCandidateSize: runCount === 0 ? 0 : candidateSize / runCount,
    hedgeActivations,
    hedgeRecoveries,
    hedgeFalseAdditions,
    semanticContainment: ratio(semanticContained, executions),
    candidateContainment: ratio(candidateContained, executions),
    semanticRequiredContainment: ratio(semanticRequiredContained, requiredExecutions),
    candidateRequiredContainment: ratio(candidateRequiredContained, requiredExecutions),
  };
}
