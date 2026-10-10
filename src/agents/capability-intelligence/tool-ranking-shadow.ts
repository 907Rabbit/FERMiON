import {
  createShadowContainmentEvent,
  DEFAULT_SHADOW_TRAFFIC_MODE,
  type ShadowContainmentEvent,
  type ShadowToolExecution,
  type ShadowTrafficMode,
} from "./shadow-traffic.js";

export type ToolRankingShadowObservation = {
  authorizedCount: number;
  rankedCount: number;
  top: Array<{ name: string; score: number }>;
  durationMs: number;
  queryTokenCount: number;
};

export type RankingEpoch = string;

export type ToolRankingShadowCorrelation = {
  epoch: RankingEpoch;
  turnId: string;
};

export type ToolRankingOutcome = {
  toolName: string;
  shadowRank?: number;
  shadowScore?: number;
  selectedByModel: true;
  executed: boolean;
  succeeded: boolean;
};

/** Names used for the counterfactual. Never copied onto the shadow ranking event. */
export type ShadowObservationContext = {
  authorizedNames?: readonly string[];
  runtimeMandatory?: readonly string[];
  policyPreserved?: readonly string[];
};

export type ToolRankingShadowTrackerOptions = {
  runId?: string;
  mode?: ShadowTrafficMode;
};

const RETAINED_EVENT_LIMIT = 128;

export function createToolRankingShadowTracker(options?: ToolRankingShadowTrackerOptions) {
  const runId = options?.runId ?? "";
  const mode = options?.mode ?? DEFAULT_SHADOW_TRAFFIC_MODE;
  let observation: ToolRankingShadowObservation | undefined;
  let ranksByToolName = new Map<string, { rank: number; score: number }>();
  let epoch = 0;
  let rankedTop8: string[] = [];
  let authorizedNames: readonly string[] | undefined;
  let runtimeMandatory: readonly string[] = [];
  let policyPreserved: readonly string[] = [];
  let turnId = "";
  const outcomes: ToolRankingOutcome[] = [];
  const containment: ShadowContainmentEvent[] = [];

  return {
    mode,
    runId,
    recordObservation(
      nextObservation: ToolRankingShadowObservation,
      rankings: readonly { name: string; score: number }[],
      context?: ShadowObservationContext,
      correlation?: ToolRankingShadowCorrelation,
    ): ToolRankingShadowCorrelation {
      epoch += 1;
      const top = nextObservation.top.slice(0, 8);
      observation = {
        ...nextObservation,
        top,
      };
      rankedTop8 = top.map((entry) => entry.name);
      authorizedNames = context?.authorizedNames ? [...context.authorizedNames] : undefined;
      runtimeMandatory = context?.runtimeMandatory ? [...context.runtimeMandatory] : [];
      policyPreserved = context?.policyPreserved ? [...context.policyPreserved] : [];
      turnId = correlation?.turnId ?? `${runId}:${epoch}`;
      const rankingEpoch = correlation?.epoch ?? String(epoch);
      ranksByToolName = new Map(
        rankings.map(({ name, score }, index) => [name, { rank: index + 1, score }]),
      );
      return { epoch: rankingEpoch, turnId };
    },
    recordOutcome(
      toolName: string,
      execution: ShadowToolExecution,
      onOutcome?: (outcome: ToolRankingOutcome) => void,
      onContainment?: (event: ShadowContainmentEvent) => void,
    ): ToolRankingOutcome | undefined {
      if (!observation) {
        return undefined;
      }
      const ranking = ranksByToolName.get(toolName);
      const outcome: ToolRankingOutcome = {
        toolName,
        ...(ranking ? { shadowRank: ranking.rank, shadowScore: ranking.score } : {}),
        selectedByModel: true,
        executed: execution.executed,
        succeeded: execution.succeeded,
      };
      outcomes.push(outcome);
      if (outcomes.length > RETAINED_EVENT_LIMIT) {
        outcomes.shift();
      }
      const event = createShadowContainmentEvent({
        mode,
        runId,
        turnId,
        authorizedCount: observation.authorizedCount,
        rankedTop8,
        selectedTool: toolName,
        executionStarted: execution.executed,
        success: execution.succeeded,
        role: execution.role,
        roleSource: execution.roleSource,
        degraded: execution.degraded,
        authorizedNames,
        runtimeMandatory,
        policyPreserved,
      });
      if (event) {
        containment.push(event);
        if (containment.length > RETAINED_EVENT_LIMIT) {
          containment.shift();
        }
      }
      onOutcome?.(outcome);
      if (event) {
        onContainment?.(event);
      }
      return outcome;
    },
    snapshot(): {
      observation?: ToolRankingShadowObservation;
      outcomes: ToolRankingOutcome[];
      containment: ShadowContainmentEvent[];
      mode: ShadowTrafficMode;
      runId: string;
    } {
      return {
        ...(observation ? { observation: { ...observation, top: [...observation.top] } } : {}),
        outcomes: [...outcomes],
        containment: structuredClone(containment),
        mode,
        runId,
      };
    },
  };
}

export type ToolRankingShadowTracker = ReturnType<typeof createToolRankingShadowTracker>;
