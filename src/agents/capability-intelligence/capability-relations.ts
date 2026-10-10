import { normalizeToolIdentifier } from "./tool-identifier.js";

/**
 * Hand-specified task structure. One hop, fixed weights, not learned from
 * traffic and not copied into prompts.
 */
export type CapabilityRelationKind = "companion" | "prerequisite" | "followup" | "alternative";

export type CapabilityRelation = {
  from: string;
  to: string;
  kind: CapabilityRelationKind;
  /** Share of the source tool's lexical score added to the target, before the cap. */
  weight: number;
};

export const RELATION_LAMBDA = 1;
/** A relation boost cannot exceed this, so it stays below a strong lexical hit. */
export const RELATION_SCORE_CAP = 0.3;
/** Only sources at least this fraction of the best lexical score propagate. */
export const RELATION_HIGH_RANK_RATIO = 0.25;

export const CAPABILITY_RELATIONS: readonly CapabilityRelation[] = [
  { from: "pytest", to: "read", kind: "companion", weight: 0.35 },
  { from: "git_diff", to: "read", kind: "followup", weight: 0.25 },
  { from: "cron", to: "sessions_history", kind: "companion", weight: 0.2 },
  { from: "git_diff", to: "git_status", kind: "companion", weight: 0.3 },
  { from: "git_status", to: "git_diff", kind: "companion", weight: 0.3 },
  { from: "pytest", to: "git_diff", kind: "companion", weight: 0.25 },
  { from: "edit", to: "read", kind: "prerequisite", weight: 0.25 },
  { from: "apply_patch", to: "read", kind: "prerequisite", weight: 0.2 },
  { from: "sessions_history", to: "sessions_list", kind: "companion", weight: 0.2 },
  { from: "tool_search", to: "tool_describe", kind: "followup", weight: 0.2 },
  { from: "tool_describe", to: "tool_call", kind: "followup", weight: 0.2 },
  { from: "tool_search", to: "tool_call", kind: "followup", weight: 0.15 },
];

export type RelationPropagationBase = {
  name: string;
  score: number;
};

export type RelationPropagationHit = {
  name: string;
  baseScore: number;
  relationScore: number;
  score: number;
};

type NamedTool = {
  name: string;
};

/**
 * One hop: S1 = S0 + min(cap, λ Aᵀ S0). Sources are the lexical scores only,
 * so a tool that gained its score from this pass cannot propagate further.
 */
export function propagateRelationScores(input: {
  tools: readonly NamedTool[];
  base: readonly RelationPropagationBase[];
  relations?: readonly CapabilityRelation[];
  lambda?: number;
  cap?: number;
  highRankRatio?: number;
}): RelationPropagationHit[] {
  const relations = input.relations ?? CAPABILITY_RELATIONS;
  const lambda = input.lambda ?? RELATION_LAMBDA;
  const cap = input.cap ?? RELATION_SCORE_CAP;
  const highRankRatio = input.highRankRatio ?? RELATION_HIGH_RANK_RATIO;
  const baseByName = new Map(input.base.map((hit) => [hit.name, hit.score]));
  let best = 0;
  for (const score of baseByName.values()) {
    best = Math.max(best, score);
  }
  const threshold = best * highRankRatio;
  const sources = new Set(
    [...baseByName].filter(([, score]) => score > 0 && score >= threshold).map(([name]) => name),
  );
  const rawBoost = new Map<string, number>();
  for (const relation of relations) {
    if (relation.weight <= 0) {
      continue;
    }
    const from = resolveToolName(relation.from, input.tools);
    const to = resolveToolName(relation.to, input.tools);
    if (!from || !to || from === to || !sources.has(from)) {
      continue;
    }
    const sourceScore = baseByName.get(from) ?? 0;
    if (sourceScore <= 0) {
      continue;
    }
    rawBoost.set(to, (rawBoost.get(to) ?? 0) + relation.weight * sourceScore);
  }

  const hits: RelationPropagationHit[] = [];
  for (const tool of input.tools) {
    const baseScore = baseByName.get(tool.name) ?? 0;
    const relationScore = Math.min(cap, Math.max(0, (rawBoost.get(tool.name) ?? 0) * lambda));
    const score = baseScore + relationScore;
    if (score <= 0) {
      continue;
    }
    hits.push({ name: tool.name, baseScore, relationScore, score });
  }
  return hits;
}

function resolveToolName(edgeName: string, tools: readonly NamedTool[]): string | undefined {
  const lowered = edgeName.trim().toLowerCase();
  const exact = tools.find((tool) => tool.name.toLowerCase() === lowered);
  if (exact) {
    return exact.name;
  }
  const key = relationKey(edgeName);
  const matches = tools.filter((tool) => relationKey(tool.name) === key);
  return matches.length === 1 ? matches[0]?.name : undefined;
}

function relationKey(name: string): string {
  return normalizeToolIdentifier(name).replace(/ /g, "_");
}
