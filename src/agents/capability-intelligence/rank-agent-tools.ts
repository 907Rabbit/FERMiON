import {
  buildLexicalIndex,
  scoreLexical,
  tokenizeDocument,
  tokenizeQuery,
} from "../tool-search-ranking.js";
import {
  aliasesForTool,
  CAPABILITY_DOMAINS,
  domainForTool,
  type CapabilityDomain,
} from "./capability-catalog.js";
import { propagateRelationScores } from "./capability-relations.js";
import { toolNameDocument } from "./tool-identifier.js";

export type AgentToolRanking = {
  name: string;
  score: number;
};

type RankableTool = {
  name: string;
  description?: string;
};

/**
 * Fixed field shares. Names and aliases are intentional vocabulary; description
 * prose is not. Not adapted from traffic.
 */
export const CAPABILITY_FIELD_WEIGHTS = {
  name: 0.4,
  aliases: 0.4,
  description: 0.2,
} as const;

/** Stage-1 domains at least this fraction of the best score are ranked in stage 2. */
const DOMAIN_KEEP_RATIO = 0.45;
/**
 * Tools outside the selected domains stay in the list so a wrong domain guess
 * can still surface, but they lose to in-domain hits.
 */
const OUT_OF_DOMAIN_FACTOR = 0.55;
/** Unknown tools stay eligible. Assigned domains still win a close score. */
const UNSCOPED_DOMAIN_FACTOR = 0.9;

export type CapabilityDomainScore = {
  domain: CapabilityDomain;
  score: number;
  selected: boolean;
};

export type AgentToolFieldScores = {
  name: number;
  aliases: number;
  description: number;
};

export type AgentToolRankingDetail = AgentToolRanking & {
  /** Lexical score after the domain factor. Relation propagation adds to this. */
  baseScore: number;
  /** Capped one-hop boost from lexical scores only. */
  relationScore: number;
  /** Multiplier already applied to the lexical score. Relation-only tools use 1. */
  domainFactor: number;
  matchedLiteral: boolean;
  domain?: CapabilityDomain;
  fieldScores: AgentToolFieldScores;
};

export type AgentToolRankingReport = {
  rankings: AgentToolRankingDetail[];
  domains: CapabilityDomainScore[];
};

type QueryTerms = ReturnType<typeof tokenizeQuery>;
type LexicalHit = { value: string; score: number; matchedLiteral: boolean };
type FieldHit = { score: number; matchedLiteral: boolean };

const DOMAIN_INDEX = buildLexicalIndex(
  CAPABILITY_DOMAINS.map((domain) => ({
    value: domain.id,
    terms: tokenizeDocument([domain.id, ...domain.terms].join(" ")),
  })),
);

/**
 * v1A baseline: one bag of name plus description. Kept so the lexical experiment
 * can be compared on the same cases. Shadow mode only, same as the live ranker.
 */
export function rankAgentToolsV1A(
  tools: readonly RankableTool[],
  query: string,
): AgentToolRanking[] {
  const index = buildLexicalIndex(
    tools.map((tool) => ({
      value: tool.name,
      terms: tokenizeDocument(`${tool.name} ${tool.description ?? ""}`),
    })),
  );
  return scoreLexical(index, tokenizeQuery(query))
    .toSorted(compareLexicalHits)
    .map(({ value, score }) => ({ name: value, score }));
}

/**
 * Frozen v1B lexical and domain ranker. Later experiments compare against this
 * instead of the live ranker. Relations do not participate.
 */
export function rankAgentToolsV1B(
  tools: readonly RankableTool[],
  query: string,
): AgentToolRanking[] {
  return rankAgentToolsLexical(tools, query).rankings.map(({ name, score }) => ({ name, score }));
}

/**
 * Shadow ranker. One relation hop runs after v1B scoring and does not change
 * domain selection. Callers record this order; they must not drop authorized tools.
 */
export function rankAgentTools(tools: readonly RankableTool[], query: string): AgentToolRanking[] {
  return rankAgentToolsDetailed(tools, query).rankings.map(({ name, score }) => ({ name, score }));
}

export function selectCapabilityDomains(query: string): CapabilityDomainScore[] {
  return scoreDomains(tokenizeQuery(query));
}

export function rankAgentToolsDetailed(
  tools: readonly RankableTool[],
  query: string,
): AgentToolRankingReport {
  const lexical = rankAgentToolsLexical(tools, query);
  const lexicalByName = new Map(lexical.rankings.map((entry) => [entry.name, entry]));
  const rankings: AgentToolRankingDetail[] = [];
  for (const hit of propagateRelationScores({
    tools,
    base: lexical.rankings.map(({ name, score }) => ({ name, score })),
  })) {
    const existing = lexicalByName.get(hit.name);
    if (!existing) {
      rankings.push(relationOnlyRanking(hit.name, hit.baseScore, hit.relationScore, hit.score));
      continue;
    }
    existing.score = hit.score;
    existing.baseScore = hit.baseScore;
    existing.relationScore = hit.relationScore;
    rankings.push(existing);
  }
  rankings.sort(compareAgentToolRankings);
  return { rankings, domains: lexical.domains };
}

function rankAgentToolsLexical(
  tools: readonly RankableTool[],
  query: string,
): AgentToolRankingReport {
  const queryTerms = tokenizeQuery(query);
  const domains = scoreDomains(queryTerms);
  if (queryTerms.length === 0 || tools.length === 0) {
    return { rankings: [], domains };
  }

  const selected = new Set(
    domains.filter((domain) => domain.selected).map((domain) => domain.domain),
  );
  const nameScores = scaleField(scoreField(tools, queryTerms, nameTerms));
  const aliasScores = scaleField(scoreField(tools, queryTerms, aliasTerms));
  const descriptionScores = scaleField(scoreField(tools, queryTerms, descriptionTerms));
  const rankings: AgentToolRankingDetail[] = [];

  for (const tool of tools) {
    const name = fieldHit(nameScores, tool.name);
    const aliases = fieldHit(aliasScores, tool.name);
    const description = fieldHit(descriptionScores, tool.name);
    const fieldScore =
      CAPABILITY_FIELD_WEIGHTS.name * name.score +
      CAPABILITY_FIELD_WEIGHTS.aliases * aliases.score +
      CAPABILITY_FIELD_WEIGHTS.description * description.score;
    if (fieldScore <= 0) {
      continue;
    }
    const domain = domainForTool(tool.name);
    const factor = domainFactor(domain, selected, selected.size > 0);
    const baseScore = fieldScore * factor;
    rankings.push({
      name: tool.name,
      score: baseScore,
      baseScore,
      relationScore: 0,
      domainFactor: factor,
      matchedLiteral: name.matchedLiteral || aliases.matchedLiteral || description.matchedLiteral,
      ...(domain ? { domain } : {}),
      fieldScores: {
        name: name.score,
        aliases: aliases.score,
        description: description.score,
      },
    });
  }

  rankings.sort(compareAgentToolRankings);
  return { rankings, domains };
}

export function toolRetrievalTerms(tool: RankableTool): string[] {
  return [...nameTerms(tool), ...aliasTerms(tool), ...descriptionTerms(tool)];
}

function nameTerms(tool: RankableTool): string[] {
  return tokenizeDocument(toolNameDocument(tool.name));
}

function aliasTerms(tool: RankableTool): string[] {
  return tokenizeDocument(aliasesForTool(tool.name).join(" "));
}

function descriptionTerms(tool: RankableTool): string[] {
  return tokenizeDocument(tool.description ?? "");
}

function scoreDomains(queryTerms: QueryTerms): CapabilityDomainScore[] {
  const byId = new Map(scoreLexical(DOMAIN_INDEX, queryTerms).map((hit) => [hit.value, hit.score]));
  const max = Math.max(0, ...byId.values());
  return CAPABILITY_DOMAINS.map((domain) => {
    const score = byId.get(domain.id) ?? 0;
    return {
      domain: domain.id,
      score,
      selected: max > 0 && score > 0 && score >= max * DOMAIN_KEEP_RATIO,
    };
  }).toSorted((left, right) => right.score - left.score || left.domain.localeCompare(right.domain));
}

function scoreField(
  tools: readonly RankableTool[],
  queryTerms: QueryTerms,
  termsFor: (tool: RankableTool) => string[],
): Map<string, FieldHit> {
  const documents = tools.flatMap((tool) => {
    const terms = termsFor(tool);
    return terms.length > 0 ? [{ value: tool.name, terms }] : [];
  });
  return new Map(
    scoreLexical(buildLexicalIndex(documents), queryTerms).map((hit) => [
      hit.value,
      { score: hit.score, matchedLiteral: hit.matchedLiteral },
    ]),
  );
}

/**
 * Divide by the field max so the fixed weights are contribution shares.
 * Raw BM25 magnitudes are not comparable across the three indexes.
 */
function scaleField(hits: Map<string, FieldHit>): Map<string, FieldHit> {
  let max = 0;
  for (const hit of hits.values()) {
    max = Math.max(max, hit.score);
  }
  if (max <= 0) {
    return hits;
  }
  return new Map(
    [...hits].map(([name, hit]) => [
      name,
      { score: hit.score / max, matchedLiteral: hit.matchedLiteral },
    ]),
  );
}

function fieldHit(hits: ReadonlyMap<string, FieldHit>, name: string): FieldHit {
  return hits.get(name) ?? { score: 0, matchedLiteral: false };
}

function domainFactor(
  domain: CapabilityDomain | undefined,
  selected: ReadonlySet<CapabilityDomain>,
  anySelected: boolean,
): number {
  if (!anySelected) {
    return 1;
  }
  if (!domain) {
    return UNSCOPED_DOMAIN_FACTOR;
  }
  return selected.has(domain) ? 1 : OUT_OF_DOMAIN_FACTOR;
}

function compareLexicalHits(left: LexicalHit, right: LexicalHit): number {
  return (
    Number(right.matchedLiteral) - Number(left.matchedLiteral) ||
    right.score - left.score ||
    left.value.localeCompare(right.value)
  );
}

export function compareAgentToolRankings(
  left: { name: string; score: number; matchedLiteral: boolean },
  right: { name: string; score: number; matchedLiteral: boolean },
): number {
  return (
    Number(right.matchedLiteral) - Number(left.matchedLiteral) ||
    right.score - left.score ||
    left.name.localeCompare(right.name)
  );
}

function relationOnlyRanking(
  name: string,
  baseScore: number,
  relationScore: number,
  score: number,
): AgentToolRankingDetail {
  const domain = domainForTool(name);
  return {
    name,
    score,
    baseScore,
    relationScore,
    domainFactor: 1,
    matchedLiteral: false,
    ...(domain ? { domain } : {}),
    fieldScores: { name: 0, aliases: 0, description: 0 },
  };
}
