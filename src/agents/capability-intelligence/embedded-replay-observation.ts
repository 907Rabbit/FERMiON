/**
 * Facts the embedded attempt already records for shadow ranking.
 * The replay adapter listens; ordinary runs leave the listener unset.
 */
import type { RankingEpoch, ToolRankingShadowObservation } from "./tool-ranking-shadow.js";

export type EmbeddedReplayRankingFact = {
  kind: "ranking";
  epoch: RankingEpoch;
  turnId: string;
  observation: ToolRankingShadowObservation;
  rankings: readonly { name: string; score: number }[];
  authorizedNames: readonly string[];
};

export type EmbeddedReplayTerminalFact = {
  kind: "terminal";
  epoch: RankingEpoch;
  turnId: string;
  toolCallId?: string;
  executionId?: string;
  startedAt?: number;
  completedAt?: number;
  toolName: string;
  executionStarted: boolean;
  outcome: "success" | "failure";
};

export type EmbeddedReplayFact = EmbeddedReplayRankingFact | EmbeddedReplayTerminalFact;

export function emitEmbeddedReplayFact(
  listener: ((fact: EmbeddedReplayFact) => void) | undefined,
  fact: EmbeddedReplayFact,
): void {
  if (!listener) {
    return;
  }
  listener(fact);
}
